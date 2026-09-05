# yahn.ty.ler.dev

A read-only Hacker News client, built so that LLM augmentation (summaries, fact-checking,
reader mode) can be added later without reshaping the API or the data model. pnpm monorepo:
`packages/schema` (`@yahn/schema`, shared zod), `packages/hn` (`@yahn/hn`, the HN clients and
comment-tree merge), `apps/api` (`@yahn/api`, Hono on Lambda) and `apps/web` (`@yahn/web`,
Vite + React). `README.md` has the layout and the *why*. This file and `.claude/rules/` hold
what must stay true.

> **Status: Epoch 1 in progress.** This file is filled in as decisions are made. `infra/cdk`
> and `.github/workflows/` do not exist yet (Epoch 2).

## Context files

Area rules live in `.claude/rules/` and load only when you read a file matching their `paths`.
Planning or reviewing happens before any file is read, so **read the area's rule file first**
rather than waiting for it to load.

| Rule | Loads when you touch | Holds |
| --- | --- | --- |
| `hn-data.md` | `packages/hn/**` | the two HN APIs, the merge decision, the ordering finding, rate limits |

`docs/hn-api.md` is the canonical HN API reference for this repo. **Never re-derive it from
the live APIs or from memory** — read it.

## Always true

- Dependency versions live in the `catalog:` block of `pnpm-workspace.yaml`. Manifests say
  `"catalog:"`, never a semver range.
- `erasableSyntaxOnly` and `verbatimModuleSyntax` are on: no `enum`, no constructor parameter
  properties (assign fields in the body), and `import type` for types.
- No formatter. Match the surrounding style: no semicolons, single quotes.
- `pnpm verify` = `pnpm lint && pnpm typecheck && pnpm test && pnpm build`. It is what every
  agent and every CI job runs.
