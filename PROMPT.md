On the main branch, I have a hacker news clone built on AWS, with some AI features built on top.
It's working well, but my AWS stack is too complicated.
I want to switch to Vercel.

Use the main branch for inspiration, but most decisions are going to be remade/respecified here.

The goal of the initial session is to create a PRE-PLAN.md. The pre-plan file is responsible for generating a PLAN.md file. This session owns delegating research and decisions to sub-agents and collecting results into a PRE-PLAN.md file. This session should not create the final plan.

Known stack components:
Vite & react (already setup)
CSS modules
Base UI (latest version is 1.8.0)
Simple CSS tokens (including color pallette)

Decisions:
Backend. Backend is responsible for two things: managing Jobs for long async AI tasks: summarizing articles, threads, etc. Abstracting the hackernews APIs (the official firebase & algoria APIs). Our API is optimized for SPA. We need some basic caching - can likely just use basic CDN caching. We need some storage for the AI jobs. Research vercel options.
Client query/state mangement. Likely something tanstack (shoudl use tanstack router).

Other:
Copy the hacker news UX as close as possible. Goal is not to improve the UX beyond minor things. We are mostly interested in AI features.
Use my Antrhopic API key from env.
Need e2e tests that mock the anthropic layer so I don't have to pay for tests. Playwright tests. Should be fast (targetting 1 min max incl. parallelization).

Research modern context management. Small CLAUDE.md with dedicated context files for various subjects/domains.
I general claude should be instructed to create plans that delegate as much as possible to sonnet sub-agents. Plans should be scoped to what a single manager opus session can handle.

Once the vercel stack is setup, we're going to teardown the AWS stack. No need for any sort of migration.
