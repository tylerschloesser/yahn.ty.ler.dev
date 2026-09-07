#!/usr/bin/env bash
#
# Mints an ID token for the site's preview machine user and prints only that
# token on stdout, so it composes:
#
#   curl -H "x-id-token: $(scripts/preview-login.sh)" https://pr-12.preview.yahn.ty.ler.dev/api/v1/me
#
# Usage:
#   scripts/preview-login.sh [<pr>]
#
# <pr> is accepted but unused: the machine user is per *site*, not per PR —
# every preview under a site shares the same Cognito user pool — so there is
# nothing PR-specific to look up. It exists only so callers can pass a PR
# number without the invocation looking wrong.
#
# Domain defaults to yahn.ty.ler.dev; override with YAHN_DOMAIN.
# Same two AWS CLI calls as e2e/fixtures.ts: secretsmanager to fetch the
# machine user's credentials, then an unsigned cognito-idp initiate-auth.
#
# Every diagnostic goes to stderr, so stdout is always just the token (or
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
  echo "Usage: $0 [<pr>]" >&2
  echo "  <pr> is accepted but unused — the machine user is per-site, not per-PR." >&2
  exit 2
}

case "$PR" in
  '') ;;
  *[!0-9]*) usage ;;
esac

command -v aws >/dev/null 2>&1 || { echo "FATAL: aws CLI not found on PATH" >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "FATAL: python3 not found on PATH" >&2; exit 2; }

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

printf '%s' "$ID_TOKEN"
