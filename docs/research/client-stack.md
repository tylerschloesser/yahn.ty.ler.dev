# Client Stack Research Report — September 2026

## 1. Versions

**Verdict:** Mostly patch/minor drift from the reference catalog — safe to bump. Two **major** version jumps need explicit decisions before adopting: **TypeScript 6→7** (native/Go compiler) and **Vitest 4→5**. TanStack Query stays on v5 for React (v6 exists only as Solid/Svelte adapter RCs). TanStack Router stays on v1 for React (v2 is Solid-only beta). Vite 8 is fully stable.

| Package | Reference catalog | Latest (npm, Sep 2026) | Change |
|---|---|---|---|
| `react` / `react-dom` | ^19.2.8 | 19.3.0 | minor |
| `vite` | ^8.2.2 | 8.3.0 | minor (Vite 8/Rolldown stable since Mar 12 2026) |
| `@vitejs/plugin-react` | ^6.1.1 | 6.1.1 | none |
| `@tanstack/react-router` | ^1.170.32 | 1.170.36 | patch |
| `@tanstack/router-plugin` | ^1.168.35 | 1.168.38 | patch |
| `@tanstack/react-query` | ^5.102.8 | 5.102.8 | none |
| `@tanstack/react-router-devtools` | ^1.167.1 | 1.167.2 | patch |
| `@base-ui/react` | ^1.7.0 | 1.8.0 | minor |
| `zod` | ^4.5.4 | 4.6.4 | minor |
| `typescript` | ~6.0.3 | 7.0.2 | **major** |
| `oxlint` | ^1.81.0 | 1.82.0 | patch |
| `@playwright/test` | ^1.63.0 | 1.63.0 | none |
| `vitest` | ^4.1.11 | 5.0.0 | **major** |
| `@anthropic-ai/sdk` | ^0.124.0 | 0.125.0 | patch |
| `hono` | ^4.13.7 | 4.13.7 | none |
| `@css-modules-kit/{codegen,ts-plugin,stylelint-plugin}` | ^1.4.0 | 1.4.0 | none |
| `stylelint` | ^17.14.1 | 17.15.0 | minor |
| `@radix-ui/colors` | ^3.0.0 | 3.0.0 | none |

**TypeScript 7** went GA July 8, 2026 as a Go-compiled native binary. Breaking for this stack: `target: es5`, `moduleResolution: node10/classic` removed (irrelevant here, Vite already uses `bundler`); strict is on by default; all TS 6.0 deprecations are now hard errors. The bigger risk is tooling, not app code: **the compiler-API/language-service-plugin surface isn't stable until TS 7.1** (targeted autumn 2026) — tools like `ts-morph` "break completely" on it today. `@css-modules-kit/ts-plugin` is exactly this kind of tool (a TS Language Service plugin), so editor-time typed-class-name checking may not work under tsgo until 7.1 ships, even though `@css-modules-kit/codegen` (the build-time `.d.ts` generator used by `typecheck`/`build`) is a separate, likely-unaffected code path.

**Vitest 5** requires Vite ≥6.4 and Node ≥22.12 (fine here). Breaking changes relevant to a small SPA: `clearMocks` now defaults `true`; config lookup no longer walks ancestor dirs; `vi.mock`/`vi.hoisted` now throw (not warn) outside module top level.

Sources: [Vite 8.0 announcement](https://vite.dev/blog/announcing-vite8), [TypeScript 7 native compiler, DEV](https://dev.to/nazar-boyko/typescript-7-went-native-what-actually-changes-and-what-doesnt-6b3), [TypeScript 7 breaking changes, Medium](https://medium.com/@krunalkanojiya/what-breaks-when-you-upgrade-to-typescript-7-tsgo-614005afbbd0), [Vitest 5.0 blog](https://vitest.dev/blog/vitest-5.html), [Vitest migration guide](https://github.com/vitest-dev/vitest/blob/main/docs/guide/migration.md), [TanStack Query v6 status](https://medium.com/better-dev-nextjs-react/tanstack-query-v6-breaking-changes-that-actually-improve-your-app-bec0d8e4ed1b), [TanStack Router releases](https://github.com/TanStack/router/releases), npm registry `latest` endpoints (fetched directly).

## 2. TanStack Router SPA Setup

**Verdict:** The reference app's setup is exactly the currently-recommended pattern; nothing has changed underneath it.

- Vite plugin order — `tanstackRouter({ target: 'react', autoCodeSplitting: true })` **before** `react()` — is still required (confirmed in reference `vite.config.ts` and unchanged in current plugin docs); reversed order breaks generated route-module transforms.
- `routeTree.gen.ts` generated + committed, consumed by `createRouter({ routeTree })`, is still the standard file-based-routing flow for non-Start apps.
- Router↔Query integration: `createRootRouteWithContext<{ queryClient: QueryClient }>()` to inject the client, `loader: ({ context }) => context.queryClient.ensureQueryData(...)` for prefetch, `useSuspenseQuery(...)` in the component, and `defaultPreloadStaleTime: 0` so the router "hands the freshness decision to TanStack Query" rather than keeping a second cache — this is the officially documented external-cache pattern (docs literally recommend `defaultPreloadStaleTime: 0` for this purpose and calls out `createRootRouteWithContext` for DI).
- Search-param validation with zod (`validateSearch`, `.catch()` fallbacks, `loaderDeps`) and `defaultPendingComponent`/`defaultErrorComponent`/`defaultNotFoundComponent`/`defaultPendingMs`/`defaultPendingMinMs` are all current, unmodified router APIs.
- No newer pattern supersedes this for a Vite SPA — the API surface that has moved (SPA-mode enhancements, server/client symmetry work) is inside **TanStack Start**, which this project deliberately isn't using.

Sources: [TanStack Router data loading guide](https://tanstack.com/router/latest/docs/framework/react/guide/data-loading) (defaultPreloadStaleTime / createRootRouteWithContext), [TanStack Start SPA mode docs](https://tanstack.com/start/latest/docs/framework/react/guide/spa-mode) (confirms SPA mode is a Start concept, distinct from plain Router+Vite), [TanStack Router releases](https://github.com/TanStack/router/releases).

## 3. Streaming / Polling Job Model

**Verdict:** Use `refetchInterval`-as-function for job polling. Do **not** use `streamedQuery` for the SSE case — keep the reference app's plain `useState` + manual `fetch`/`ReadableStream` reader.

- **(a) Polling:** `refetchInterval` accepts `(query) => number | false`; returning `false` once `query.state.data.status` is terminal stops polling, and returning a number again resumes it. This is documented, stable, unchanged. Docs: [TanStack Query polling guide](https://tanstack.com/query/latest/docs/framework/react/guides/polling).
- **(b) SSE/streamed text:** `experimental_streamedQuery` (`import { experimental_streamedQuery as streamedQuery } from '@tanstack/react-query'`) still ships under the `experimental_` prefix as of the current release — it's stable-enough-to-use but the API itself isn't frozen. It also has a shape mismatch for this use case: it accumulates an `AsyncIterable`'s chunks into an **array of chunks** in the query cache and the query only leaves `pending` after the first chunk — it has no native concept of multiple named SSE event types (`meta`/`delta`/`complete`/`error`) the way this app's enrichment stream does, and it isn't a good fit for one-shot user-triggered generation with no cache key worth retaining (a rerun should replace, not append). The reference app's own rule file already gives the correct reasoning for its `ThreadSummary` component: this is "a one-shot, user-triggered stream with no cache key of its own to hold" — plain `useState` + `apiFetch` + a small SSE line-parser generator (`readSSE`) is simpler and correct, and nothing in Query 5's current or planned API changes that call.
- **Recommendation:** keep `refetchInterval` for any polled job-status endpoint; keep manual `fetch`+`ReadableStream` (not `EventSource`, not `streamedQuery`) for the multi-event SSE enrichment stream, exactly as implemented.

Sources: [streamedQuery reference docs](https://tanstack.com/query/latest/docs/reference/streamedQuery), [streamedQuery PR discussion](https://github.com/TanStack/query/discussions/9065), [TanStack Query polling guide](https://tanstack.com/query/latest/docs/framework/react/guides/polling).

## 4. Base UI 1.8.0

**Verdict:** Package identity, import style, and the core conventions the reference app relies on are all still correct in 1.8. One new, previously-undocumented setup note appeared: an iOS 26+ Safari backdrop fix.

- Package is `@base-ui/react` (not `@base-ui-components/react`), tree-shakable, imported per-component from a subpath — confirmed current: `import { Popover } from '@base-ui/react/popover'`, and by extension `@base-ui/react/collapsible`, `@base-ui/react/menu`, etc.
- Full component set relevant to an HN clone exists and is unchanged in kind: **Collapsible** (comment `[–]`/`[+]` toggle — already used), **Menu**/**Menubar**/**Context Menu**, **Dialog**/**Alert Dialog**/**Drawer**, **Popover**, **Tooltip**, **Toggle**/**Toggle Group**, **Tabs**, **Accordion**, **Navigation Menu**. For a *read-only* clone, the reference app's minimal usage (Collapsible only, plain `<nav>`/`<ul>`/`<a>` for section nav and sort links per the "use semantic HTML where it is already correct" rule) is still the right call — Tabs/Menu would be over-engineering for what are just links.
- `render` prop / `className`-as-function: Base UI's `useRender` still takes `(props, state) => ReactElement` when passed as a function, merging `className`/event handlers with the component's internal props rather than overwriting them; `className` itself can be passed as a function receiving component `state` (e.g. open/closed, checked) for state-dependent styling — unchanged, documented at the composition/useRender pages.
- **Isolation/portal setup — confirmed unchanged and still required:** add `.root { isolation: isolate }` to the app's root element so portaled Dialog/Popover/Menu content stacks above page content regardless of local `z-index`. **New since 1.7:** the quick-start now also calls out adding `position: relative` to `<body>` for iOS 26+ Safari, or backdrops misbehave after scroll — worth adding to `base.css`.
- Changelog for 1.8.0 (Sept 4, 2026) is otherwise a bug-fix release (label association, roving focus, hover/focus interaction fixes, disabled-anchor tracking on scroll, passive touch listeners) — no new components, no breaking API changes.

Sources: [Base UI quick start](https://base-ui.com/react/overview/quick-start), [Base UI v1.8.0 release notes](https://base-ui.com/react/overview/releases/v1-8-0), [Base UI useRender](https://base-ui.com/react/utils/use-render), [Base UI composition handbook](https://base-ui.com/react/handbook/composition), [@base-ui/react on npm](https://www.npmjs.com/package/@base-ui/react).

## 5. CSS: Typed Modules + Tokens

**Verdict:** `@css-modules-kit` is still the right (and still-maintained, unchanged-at-1.4.0) tool — Vite and TypeScript have **not** grown built-in typed CSS Modules. The two-layer Radix-primitives → semantic-tokens approach is still the simplest correct path to an HN palette with dark mode; hand-written hex would be strictly more maintenance for no real benefit.

- Vite's CSS Modules support remains untyped by default (class names resolve to `any`); several third-party generators exist (`vite-plugin-typed-css-modules`, `unplugin-typed-css-modules`, `vite-css-modules`, `typescript-plugin-css-modules-vite`) but none of them are official/built-in, and `@css-modules-kit` remains the most complete option because it's the only one bundling a TS Language Service plugin *and* a stylelint plugin *and* a build-time codegen step against one shared parser — matching the reference setup exactly.
- **Real open risk (see §1):** `@css-modules-kit/ts-plugin` is a TS Language Service plugin; TS 7's compiler-API/plugin surface isn't guaranteed stable until 7.1 (autumn 2026). Recommend staying on TypeScript 6.x for this project until `@css-modules-kit` explicitly confirms TS 7 support, or verify editor-time class-name checking still works before upgrading `typescript` in the catalog.
- Two-layer tokens: `primitives.css` (raw `@import '@radix-ui/colors/*.css'` for `sand`/`orange`/`red`/`black-alpha`, light + dark files) → `tokens.css` (semantic aliases like `--color-bg: var(--sand-1)`, `--color-accent-solid: var(--orange-9)`) → components reference only `tokens.css`. `@radix-ui/colors` is unchanged at 3.0.0 and still the simplest source for this palette specifically because each scale ships a matching `-dark` file with the *same* step contract (1 bg → 12 high-contrast text), so `.dark`-class theming needs zero conditional logic in `tokens.css` — only the two shadow-alpha values that can't be palette-driven need a `.dark` override (as in the reference `tokens.css`). Hand-picked hex pairs would have to reinvent that 12-step, dual-theme, WCAG-checked contract by hand for at least 4 hues; not simpler, only more error-prone.
- Recommended minimal token set (this is what the reference `tokens.css` already implements — validated as still correct, not something new to design):
  - **Color:** surfaces (`bg`, `bg-subtle`, `surface`, `surface-translucent`), borders (`border-subtle`, `border`), text (`text`, `text-strong`), accent (`accent-surface`, `accent-border`, `accent-text`, `accent-solid`, `accent-solid-text` — note orange-9 needs a **dark** foreground in both themes, so alias it to `black-a12`, not a sand step), focus rings (`focus-ring`, `focus-ring-on-accent`), danger (`danger-surface`, `danger-border`, `danger-text`), shadow (2 alpha values, themed).
  - **Spacing:** 4px scale, only the steps actually used (`--space-1..10` = 4/8/12/16/24/32/40px).
  - **Type:** 6–7 steps from 12px to 28px (HN is a dense one-line-title feed, so keep it tight — 15px body, not 18px), plus `leading`/`weight`/`tracking` primitives and two font stacks.
  - **Radii:** 2 steps (4px, 6px) — HN's chrome has essentially no rounded corners, so more would be unused.
- stylelint enforcing "no literal color/px in `*.module.css`, literals only in `src/styles/**`" is a good, still-current pattern with `stylelint-config-css-modules` + `@css-modules-kit/stylelint-plugin` + `csstools/value-no-unknown-custom-properties` (with explicit `importFrom` listing the Radix CSS files, since `importFrom` doesn't follow `@import`).

Sources: [css-modules-kit GitHub](https://github.com/mizdra/css-modules-kit), npm `latest` for `@css-modules-kit/*` (1.4.0, unchanged), [Vite features guide](https://vite.dev/guide/features) (CSS Modules support, no built-in typing), [@radix-ui/colors on npm](https://www.npmjs.com/package/@radix-ui/colors) (3.0.0, unchanged).

## 6. Hacker News UX Inventory

**Verdict:** Replicate structure, byline format, comment threading/collapse, and pagination closely; replicate the *character* of the visual design (orange/sand palette, dense one-line layout) rather than its literal implementation (real `<table>`, literal Verdana, literal hex). This matches "as close as possible; improvements only minor" while staying accessible.

**Pages (read-only feasible — build these):**
- Front page `/` (`news`), `/newest`, `/best`, `/ask`, `/show`, `/jobs` — all standard Firebase HN API feeds.
- `/item?id=` thread view: story/poll header, comment tree.
- `/user?id=` profile: about text, karma, created date, links to their submissions/comments.
- `/from?site=` domain listing.
- `/front?day=` ("past") day-by-day archive.
- Search — HN itself has no native search page, it links out to **Algolia's hn.algolia.com**; a clone doing `/search` via the Algolia HN Search API (`/search` relevance, `/search_by_date` recency, tag filters, no API key needed, 10k req/hr) is faithful to what HN actually does, not an embellishment.

**Interactions to replicate:**
- Byline: `N points by user X hours ago | hide | N comments`.
- Comment `[–]`/`[+]` collapse-to-hide-subtree, with a "(N replies)" hidden-count when collapsed.
- `parent` / `context` / `next` navigation links available on a single-comment permalink view.
- "More" link at the bottom of a 30-item page for pagination (not infinite scroll).
- Header bar: logo + "Hacker News" + nav (`new | past | comments | ask | show | jobs | submit`) + right-aligned login/user.
- Footer: guidelines/FAQ/lists/API/security/legal/"Apply to YC"/contact + Algolia-powered search box.

**Skip (require a real HN login — out of scope for a read-only clone):** vote arrows (up/down), `hide`, reply/comment composer, `favorite`, `flag`, `vouch`, dupe-flagging, `noprocrast`.

**Visual details — literal facts confirmed:** header/accent `#ff6600`, page background `#f6f6ef`, secondary/meta text `#828282`, historically Verdana ~10pt body copy, classic layout is a `<table>` constrained to 85% viewport width.

**Recommended fidelity level:** keep the *palette relationship* (bright orange accent on a warm, slightly-off-white neutral background, muted gray metadata) via the Radix `orange`/`sand` token system already in place — it reproduces HN's character without hardcoding the exact hex, and gets dark mode "for free," which real HN doesn't have but is a reasonable, minor, accessibility-motivated addition. Do **not** copy the literal `<table>` layout (semantic-HTML/accessibility regression for zero visual gain) or force Verdana (poor cross-platform rendering, worse legibility) — a system-font stack at a slightly larger, still-dense type scale (as already specified in `tokens.css`, body at 15px vs HN's ~13px-equivalent) is the "minor improvement" the brief allows, while the max-width container (`60rem` ≈ 960px) plays the same visual-density role as HN's 85%-width table on typical viewports.

Sources: [Hacker News colors, ColorsWall](https://colorswall.com/palette/196), [Algolia HN Search API](https://hn.algolia.com/), various `news.ycombinator.com/item?id=...` threads on Verdana usage (general community confirmation, no single canonical HN styleguide page exists).

## Recommendations

1. Bump patch/minor deps freely (`react`, `vite`, `@tanstack/*`, `zod`, `oxlint`, `stylelint`, `@anthropic-ai/sdk`).
2. **Hold `typescript` at 6.x** until `@css-modules-kit/ts-plugin` publishes confirmed TS 7 support (watch for a 7.1-targeted compiler-API release this autumn) — the build-time `codegen` path is lower-risk than the editor `ts-plugin` path.
3. Before bumping `vitest` 4→5, check the repo's `vitest.config.ts` for reliance on ancestor-directory config discovery and any `vi.mock`/`vi.hoisted` calls made outside module top level, and reconcile `clearMocks` defaulting to `true`.
4. Keep the Router/Query integration exactly as implemented (`createRootRouteWithContext`, `ensureQueryData` in loaders, `useSuspenseQuery` in components, `defaultPreloadStaleTime: 0`) — it matches current official guidance verbatim.
5. Keep `refetchInterval`-as-function for polled jobs; keep the hand-rolled SSE reader (not `streamedQuery`) for the multi-event enrichment stream.
6. Add `body { position: relative }` alongside the existing `.root { isolation: isolate }` for the new iOS 26+ Safari Base UI backdrop guidance.
7. Keep the two-layer Radix-primitives/semantic-tokens CSS system and the existing minimal token set as-is; no simpler alternative beats it for a themed, palette-driven HN look.
8. Scope the clone to the read-only page/interaction list above; explicitly exclude vote/hide/reply/favorite/flag as requiring real HN auth.

## Open Questions / Risks

- **TS 7 + `@css-modules-kit/ts-plugin` compatibility is unverified** — the biggest concrete risk found; needs a direct compatibility check (or a note to re-check in autumn 2026 when TS 7.1 ships) before this catalog entry moves off 6.x.
- **`experimental_streamedQuery` may or may not exit experimental status** before this project ships; if it does and its per-event-type limitations are addressed, it's worth re-evaluating for the enrichment stream, but nothing today suggests switching.
- TanStack Router v2 and Query v6 exist only for Solid/Svelte as of Sep 2026 — no clear signal yet on when (or whether) a React v2/v6 will land; worth a light re-check before any longer-term commitment, but no action needed now.
- HN's actual current pixel-level styling isn't documented anywhere authoritative (no official style guide); the "Verdana/#f6f6ef/85%-table" facts above are drawn from long-standing community consensus and inspection, not a single citable spec page — worth a quick manual look at the live site rather than treating this report as exhaustive on exact spacing/line-height.
