#!/usr/bin/env bash
#
# Mints an ID token for the site's preview machine user, exchanges it for the
# edge's session cookie, and prints only the path to a cookie jar on stdout,
# so it composes:
#
#   curl -b "$(scripts/preview-login.sh 12)" https://pr-12.preview.yahn.ty.ler.dev/
#
# Why a cookie jar and not the bare token: the site now sits behind a
# CloudFront Function that gates every request on the `__Host-cdkcore-session`
# cookie. `curl -H "x-id-token: ..."` straight against the site is refused at
# the edge before it ever reaches the Lambda — the gate only special-cases
# the ungated `/auth/*` routes. So the token has to go through
# `GET /auth/session` first, which sets that cookie, and everything after
# that is `curl -b`/`-c` against the jar, same as a browser would.
#
# Usage:
#   scripts/preview-login.sh <pr>
#
# <pr> used to be accepted-but-unused, because the machine user's *credentials*
# are per-site, not per-PR — every preview under a site shares the same
# Cognito user pool. But `__Host-` cookies are host-only by spec (no `Domain`
# attribute allowed), so the session cookie this script now mints is bound to
# whichever host it called `/auth/session` on. That makes `<pr>` load-bearing:
# it says which preview's session to mint, even though the AWS calls behind
# it are identical for every PR.
#
# Domain defaults to yahn.ty.ler.dev; override with YAHN_DOMAIN.
# Same two AWS CLI calls as e2e/fixtures.ts: secretsmanager to fetch the
# machine user's credentials, then an unsigned cognito-idp initiate-auth.
# Then one more call this script alone makes: GET /auth/session with the
# resulting ID token, to turn it into the session cookie the edge checks.
#
# Every diagnostic goes to stderr, so stdout is always just the jar path (or
# nothing, on failure).
#
# **Do not loop on a failure.** Cognito locks the user out after 5 consecutive
# failed password attempts with a rising backoff, so a retry makes it worse.
# The usual cause is a stack update having rotated the generated password —
# running this again re-reads the secret, which is the fix, but running it in a
# loop is not.

set -euo pipefail

DOMAIN="${YAHN_DOMAIN:-yahn.ty.ler.dev}"
PR="${1:-}"

usage() {
  echo "Usage: $0 <pr>" >&2
  echo "  <pr> selects which preview host's session to mint — the cookie is" >&2
  echo "  host-only by spec, so it must be bound to one specific preview." >&2
  exit 2
}

case "$PR" in
  '') usage ;;
  *[!0-9]*) usage ;;
esac

TARGET_HOST="pr-${PR}.preview.${DOMAIN}"

command -v aws >/dev/null 2>&1 || { echo "FATAL: aws CLI not found on PATH" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "FATAL: python3 not found on PATH" >&2; exit 2; }
command -v curl >/dev/null 2>&1 || { echo "FATAL: curl not found on PATH" >&2; exit 2; }

echo "Fetching preview machine user secret for $DOMAIN..." >&2
SECRET_JSON="$(aws secretsmanager get-secret-value \
  --region us-east-1 \
  --secret-id "${DOMAIN}/preview-machine-user" \
  --query SecretString \
  --output text)" || {
  echo "FATAL: secretsmanager get-secret-value failed for ${DOMAIN}/preview-machine-user" >&2
  exit 1
}

USERNAME="$(printf '%s' "$SECRET_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["username"])')"
PASSWORD="$(printf '%s' "$SECRET_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["password"])')"
CLIENT_ID="$(printf '%s' "$SECRET_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["clientId"])')"

echo "Authenticating as $USERNAME..." >&2
# --no-sign-request is deliberate: InitiateAuth (USER_PASSWORD_AUTH) is an
# unauthenticated Cognito API, so calling it unsigned needs no IAM permission.
AUTH_JSON="$(aws cognito-idp initiate-auth \
  --region us-east-1 \
  --no-sign-request \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$CLIENT_ID" \
  --auth-parameters "USERNAME=${USERNAME},PASSWORD=${PASSWORD}" \
  --query AuthenticationResult \
  --output json)" || {
  echo "FATAL: cognito-idp initiate-auth failed for $USERNAME" >&2
  echo "       Do NOT retry in a loop — 5 failures lock the user out. Re-read the" >&2
  echo "       secret instead: a stack update may have rotated the password." >&2
  exit 1
}

ID_TOKEN="$(printf '%s' "$AUTH_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["IdToken"])')"

COOKIE_JAR="$(mktemp)"

echo "Exchanging ID token for a session cookie at https://${TARGET_HOST}/auth/session..." >&2
# GET, not POST: a POST body through CloudFront's OAC is a 403 unless the
# caller computes x-amz-content-sha256 itself, which curl does not do for
# us (`.claude/rules/cdk.md`). -c writes whatever Set-Cookie comes back into
# the jar; -o /dev/null with -w keeps stdout clean for the status code check.
STATUS="$(curl -sS -o /dev/null -w '%{http_code}' \
  -c "$COOKIE_JAR" \
  -H "x-id-token: ${ID_TOKEN}" \
  "https://${TARGET_HOST}/auth/session")"

if [ "$STATUS" != "204" ]; then
  echo "FATAL: GET https://${TARGET_HOST}/auth/session returned ${STATUS}, expected 204" >&2
  rm -f "$COOKIE_JAR"
  exit 1
fi

echo "Session cookie written to $COOKIE_JAR" >&2
echo "Reuse it against the site with:" >&2
echo "  curl -b '$COOKIE_JAR' https://${TARGET_HOST}/" >&2

printf '%s' "$COOKIE_JAR"
