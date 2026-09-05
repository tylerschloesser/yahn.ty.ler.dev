# yahn.ty.ler.dev

A read-only Hacker News client, built so that the *actual* product — LLM augmentation
(summaries, fact-checking, first-party reader mode) — can be added without reshaping the API or
the data model. pnpm monorepo: `packages/schema` (`@yahn/schema`, the zod contract),
`packages/hn` (`@yahn/hn`, the HN clients and comment-tree merge), `apps/api` (`@yahn/api`, Hono
on Lambda) and `apps/web` (`@yahn/web`, Vite + React). `README.md` has the layout and the *why*.
This file and `.claude/rules/` hold what must stay true.

`infra/cdk` (`@yahn/cdk`) holds three stacks and `.github/workflows/` deploys them.

> Everything *except* those two directories is verifiable on `localhost` with no AWS and no
> credentials, and that stays true: `pnpm verify`, `pnpm dev` and `pnpm e2e` never touch AWS.

## Context files

Area rules live in `.claude/rules/` and load only when you read a file matching their `paths`.
Planning or reviewing happens before any file is read, so **read the area's rule first** rather
than waiting for it to load.

| Rule | Loads when you touch | Holds |
| --- | --- | --- |
| `typescript-config.md` | `tsconfig*.json`, `package.json`, `pnpm-workspace.yaml` | the catalog, why consumers never reference `packages/*`, deliberate version pins |
| `hn-data.md` | `packages/hn/**` | the two APIs, the ordering spike's finding, the invariants a tree walk must hold |
| `api.md` | `apps/api/**`, `packages/schema/**` | thin handlers, error mapping, cache headers, the enrichment/auth/DynamoDB seams |
| `web-ui.md` | `apps/web/**` | tokens, CSS Modules, Base UI, `data-*` variants, Query-owns-cache |
| `testing.md` | `e2e/**`, `**/*.test.ts` | offline vitest, structural-not-content Playwright, pointing it at a preview |
| `cdk.md` | `infra/cdk/**`, `.github/workflows/**` | the three stacks, the shared cert, the CloudFront gotchas, the preview lifecycle, what deploys locally only |

**`docs/hn-api.md` is the canonical HN API reference** — every endpoint, every field per item
type, the tombstone shapes, measured request counts and latencies. It was mined from the
planning transcript so no session ever spends 25k tokens re-deriving it. **Read it. Do not
re-derive it from the live APIs, and do not write a field list from memory** — a confidently
wrong field there is worse than a missing one, because every later agent will trust it.

## Always true

- **`pnpm verify` = `pnpm lint && pnpm typecheck && pnpm test && pnpm build`.** One command, and
  it is what every agent and every CI job runs.
- **`pnpm dev` needs no credentials.** It runs the real API locally on :3001 and Vite on :5173,
  and both HN APIs are public. That is deliberate and load-bearing: it is what lets a remote
  session verify its own work before opening a PR. It does hit live HN, so be a good citizen.
- Dependency versions live in the `catalog:` block of `pnpm-workspace.yaml`. Manifests say
  `"catalog:"`, never a semver range.
- `erasableSyntaxOnly` and `verbatimModuleSyntax` are on: no `enum`, no constructor parameter
  properties (assign fields in the body), `import type` for types.
- No formatter. Match the surrounding style: no semicolons, single quotes.
- **vitest covers `packages/hn` and nothing else**, on purpose: the tree merge and ordering are
  the only real logic here, and they are pure. Tests never touch the network.

## How to work

Plan every non-trivial task as chunks that a cheaper model implements and a *different* cheaper
model verifies, so the expensive model spends its context on judgment, not typing.

- A chunk is small enough to carry a **one-line acceptance check** that someone with no
  conversation context could run. If you cannot write the check, the chunk is not specified yet.
- Delegate implementation to the `implementer` agent and the check to the `verifier` agent
  (`.claude/agents/`, both sonnet). The verifier gets the chunk and its check, never the
  implementer's reasoning, and reports PASS/FAIL with evidence without fixing anything.
- Keep the expensive model for decomposition, judgment calls, anything touching an invariant in
  a rule file, and review of the integrated diff.
- A finding the current task should not absorb is neither fixed nor dropped: the **`file-issue`
  skill** (`.claude/skills/`) files it and you carry on. `.claude/settings.json` allowlists the
  read-only calls — `pnpm verify` and friends, `gh` reads, `aws` describes, `curl` against the
  live site and localhost. Nothing destructive is on that list, and `cdk destroy` and
  `delete-stack` are deliberately absent: the account also hosts thai.ler.dev's production.
- Don't delegate a chunk smaller than its handoff, or one that only makes sense with the whole
  conversation in view.

## Keeping this context current

These files are a contract with the next session, and a false claim is worse than a missing one:
an agent reading it literally will "fix" working code.

- Include what is load-bearing and not derivable from the code; leave out what the code already
  says well. Prefer pointing at a comment in the code to restating it.
- A change that invalidates a claim in any rule fixes the rule **in the same commit**.
- When something costs a debugging session and isn't obvious from the code, add it to the
  matching rule. If no rule fits, add one and a row to the table above.
- Budgets: this file under 100 lines, each rule under about 120. `cdk.md` is the one deliberate
  exception, now **~165**, because it is the only rule covering two `paths` globs —
  `infra/cdk/**` and `.github/workflows/**` — whose contents cross-reference constantly. Epoch 3
  raised the ceiling from 140 rather than splitting, deliberately: the obvious split puts the
  preview lifecycle in a workflows rule, and a session editing `cleanup.yml` would then no longer
  load the IAM scope and stack-naming facts that make that workflow safe. **The trigger to split
  is a workflow section that stops referring to stack internals**, not a line count.
- A claim about a third party's undocumented behaviour needs a way to re-check it, not just a
  date. `scripts/ordering-spike.mjs` is the pattern.
