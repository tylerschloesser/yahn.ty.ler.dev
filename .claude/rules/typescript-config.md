---
paths:
  - "**/tsconfig*.json"
  - "**/package.json"
  - "pnpm-workspace.yaml"
---

# TypeScript project layout and the dependency catalog

Loaded when you touch a `tsconfig*.json`, a `package.json`, or `pnpm-workspace.yaml`.

- **Dependency versions live in the `catalog:` block of `pnpm-workspace.yaml`.** Manifests
  reference them as `"catalog:"`, never a semver range. Adding a dependency means adding it to
  the catalog too; `catalogMode: prefer` nudges you when you forget.
  `minimumReleaseAgeExclude` in the same file is **appended by pnpm on install**, not
  hand-maintained — new entries there are expected, not a mistake.
- Per-package tsconfigs extend `../../tsconfig.base.json` and set only what differs. A new
  package needs a `references` entry in the **root** `tsconfig.json`; that file is a solution
  file (`files: []`), so its references only mean "build these too" and carry no `composite`
  requirement.
  **Consumer tsconfigs are the opposite: never point one at `packages/schema` or
  `packages/hn`.** Both are consumed as source through their `exports` maps and typechecked as
  part of each consumer's program, so a reference there would force them to be `composite` and
  emit declarations nothing needs. `apps/api/tsconfig.json` carries a comment saying so.
- **`tsconfig.e2e.json` is the odd one out.** `playwright.config.ts` and `e2e/**` belong to no
  package — `pnpm e2e` runs from the root — so that config is what typechecks them, and the root
  `typecheck` script runs `tsc -b` on it explicitly after the recursive pass.
- `pnpm typecheck` is `pnpm -r run typecheck` plus that one root project. `pnpm lint` is
  `oxlint && stylelint "apps/web/src/**/*.css"` — oxlint covers the repo, stylelint only
  `apps/web`. Both live at the **root**; individual packages have no `lint` script.
- **Version pins that are deliberate, not stale.** `typescript@~6.0.3`, not 7.x: TS 7 ships no
  stable programmatic compiler API until 7.1, which breaks `@css-modules-kit`'s TS plugin.
  `vitest@^4.1.11`, not 5.x: v5 changed mocking defaults. `@types/node@^24` matches the Lambda
  runtime (`nodejs24.x`), not npm's `latest`.
- `esbuild` is a **root** devDependency on purpose — the root `package.json` `"//"` key says
  why. CDK's `NodejsFunction` runs the bundler from the workspace root, so that is where the
  binary must resolve.
