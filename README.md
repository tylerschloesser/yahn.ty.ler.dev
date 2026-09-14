# yahn.ty.ler.dev

A read-only Hacker News client: a Hono API (`api/index.ts`, `server/`) and a Vite + React SPA
(`src/`), one package, deployed on Vercel. `CLAUDE.md` and `.claude/rules/` hold the conventions.

## Develop

```
pnpm install
pnpm dev
```

Runs the real API on `:3001` and Vite on `:5173`. No credentials needed — both HN APIs are
public — but it does hit live HN, so be a good citizen with it.

## Test

```
pnpm verify   # lint, typecheck, unit tests, build — what CI runs first
pnpm e2e      # Playwright against recorded HN fixtures (HN_SOURCE=fixture), ~10s
pnpm e2e:live # structural canary (e2e/live/) against live HN
```

## Fixtures

The e2e suite runs against `e2e/fixtures/hn/*.json`, recorded HN responses, not live traffic.
Re-record them after a schema or spec change:

```
pnpm hn:record
```

See `.claude/skills/record-hn-fixtures/SKILL.md` for what it captures and when a re-record is
actually needed.

## Deploy

Vercel's Git integration deploys every push to this repo; the production branch is `main`. Every
deployment, production included, sits behind Vercel Authentication, so a remote check needs
`x-vercel-protection-bypass: $VERCEL_AUTOMATION_BYPASS_SECRET` — see `.claude/rules/vercel.md`.
