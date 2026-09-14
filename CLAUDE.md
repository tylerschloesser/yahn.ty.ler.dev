# yahn.ty.ler.dev

A read-only Hacker News client, built so the *actual* product — LLM augmentation (thread
summaries, first-party reader mode) — can be added later without reshaping the API or the data
model. Single package at the repo root, deployed on Vercel: a Hono API function (`api/index.ts`)
and a Vite + React SPA (`src/`) served from the same project. `README.md` covers getting started
and deploying; this file and `.claude/rules/` hold what must stay true.

## Layout

- `api/index.ts` — Vercel Function entry, exports the Hono app from `server/app.ts`
- `server/app.ts`, `server/hn/`, `server/env.ts`, `server/dev.ts` — the API and the HN data layer
- `shared/schema/` — the zod contract shared by server and client
- `src/` — routes, components, styles (Vite + React, TanStack Router/Query)
- `e2e/` — Playwright specs and recorded HN fixtures
- `scripts/` — `record-hn-fixtures.ts`, `ordering-spike.mjs`
- `docs/hn-api.md` — canonical HN API reference; `docs/research/` — planning reports
- `vercel.json`, `.github/workflows/` — the Vercel Function config and CI/preview-smoke

Epoch 2 adds server/enrich, server/jobs, server/store, and the job routes. None of that exists
yet — do not build against it or reference it as if it did. Epoch 3 adds the custom-domain
cutover and the AWS teardown (there is nothing AWS in this repo to tear down from yet).

## Context files

Area rules live in `.claude/rules/` and load only when you read a file matching their `paths`.
Planning or reviewing happens before any file is read, so **read the area's rule first**.

| Rule | Loads when you touch | Holds |
| --- | --- | --- |
| `hn-data.md` | `server/hn/` | the two HN APIs, the ordering finding, tree-walk invariants |
| `api.md` | `api/`, `server/app.ts`, server/routes/** (reserved, not created yet), `shared/schema/` | thin handlers, zod at the boundary, cache headers, error mapping, `looseObject` |
| `web-ui.md` | `src/`, `index.html`, `vite.config.ts`, `stylelint.config.js` | tokens, CSS Modules, Base UI, `data-*`, Query-owns-cache, the route-tree gotcha |
| `testing.md` | `e2e/`, `**/*.test.ts`, `playwright.config.ts`, `vitest.config.ts` | fixtures-not-live, spec-first, structural assertions, the ten-second-in-practice budget |
| `vercel.md` | `vercel.json`, `.github/workflows/**`, `server/dev.ts` | the function entry, `.js` specifiers, env scoping, the preview-bypass header, Vercel's CDN, CI |

**`docs/hn-api.md` is the canonical HN API reference** — every endpoint, every field per item
type, tombstone shapes, measured latencies and request counts. Read it. Do not re-derive it from
the live APIs, and do not write a field list from memory.

## Always true

- **`pnpm verify` = `pnpm lint && pnpm typecheck && pnpm test && vite build`.** One command; every
  agent and CI job runs it.
- **`pnpm dev` needs no credentials.** It runs the real API on `:3001` and Vite on `:5173`; both
  HN APIs are public. That is what lets an agent verify its own work before reporting. It does
  hit live HN, so be a good citizen; `pnpm dev:e2e` uses `HN_SOURCE=fixture` instead.
- Dependency versions are plain ranges in the root `package.json` — there is no workspace and no
  version catalog.
- **Relative imports in `api/`, `server/`, `shared/`, `scripts/` use `.js` specifiers**, never `.ts` — a `.ts` one crashes the deployed function (`pnpm lint:imports` enforces; see `vercel.md`).
- No formatter. Match the surrounding style: no semicolons, single quotes.
- **vitest covers `server/hn` and `server/app.test.ts`** — the tree merge, ordering, and cache
  headers are the only real logic here, and they never touch the network.
- There is no AWS anywhere in this repo, and nothing here talks to it.

## How to work

Plan every non-trivial task as chunks small enough for a cheaper model to implement and a
*different* cheaper model to verify.

- A chunk needs a **one-line acceptance check** runnable with no conversation context. If you
  cannot write the check, the chunk is not specified yet.
- Delegate implementation to the `implementer` agent and the check to the `verifier` agent
  (`.claude/agents/`, both sonnet, `maxTurns: 30`). The verifier gets the chunk and its check,
  never the implementer's reasoning, and reports PASS/FAIL with evidence. An agent added to
  `.claude/agents/` mid-session isn't picked up by that session — it needs a fresh one.
- A dependency the chunk needs goes in the root `package.json`, never invented ad hoc.
- A finding outside the current task is neither fixed nor dropped: the **`file-issue`** skill
  (`.claude/skills/`) files it and you carry on. `.claude/settings.json` allowlists read-only
  calls — `pnpm verify` and friends, `gh` reads, `vercel` reads, `curl` against localhost and the
  deployed hosts. Nothing destructive is on that list.

## Keeping this context current

- Include what is load-bearing and not derivable from the code; leave out what the code already
  says well. A change that invalidates a claim in a rule fixes the rule in the same commit.
- When something costs a debugging session and isn't obvious from the code, add it to the
  matching rule; add a new rule and a row above if none fits.
- Budgets: this file under 100 lines, each rule under about 120.
