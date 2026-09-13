> **Caveat (added by the pre-plan session):** the schema-level facts here (frontmatter fields, path-scoped rules, hook events, settings keys) were read from the official docs and are usable. The numeric claims about context size (a "200,000 token" window, tokens-per-file, "5–10 delegations before crisis", "/init generates a plan") are NOT verified and are stale for Claude 5 models; treat them as folklore. `.claudeplan.md` is this report's own suggestion, not an official convention.

# Claude Code Context Management: September 2026 Best Practices

**Research date**: September 2026  
**Sources**: https://code.claude.com/docs/en/memory.md, https://code.claude.com/docs/en/sub-agents.md, https://code.claude.com/docs/en/skills.md, https://code.claude.com/docs/en/hooks-guide.md, https://code.claude.com/docs/en/context-window.md, https://code.claude.com/docs/en/permissions.md, https://code.claude.com/docs/en/large-codebases.md

---

## 1. CLAUDE.md: Organization & Size

### Verdict
- **Target under 200 lines** per file to preserve context and adherence
- **Maximum 4 MiB** per file (larger files are skipped; truncated files produce an error)
- **Use `@path` imports** to include supporting docs; imports load in full at startup and count toward context
- **Path-scoped rules** (`.claude/rules/*.md` with `paths:` frontmatter) load on-demand when Claude reads matching files—**do not count against startup context**
- **`CLAUDE.local.md`** for personal, per-project preferences (add to `.gitignore`)
- **Nested subdirectory CLAUDE.md** files load on-demand when Claude enters those directories

### CLAUDE.md vs `.claude/rules/*.md`

| Aspect | CLAUDE.md | `.claude/rules/*.md` (path-scoped) |
|--------|-----------|-----|
| **Content** | Project conventions, build commands, architecture | Specific guidance for file types/paths |
| **Load timing** | At startup (project root + parent hierarchy) | On-demand when Claude reads matching files |
| **Context cost** | Full file at startup | Only when rule matches (lazy load) |
| **Use when** | Applies to all work in project | Guidance only relevant to certain files (`src/api/**`, `*.test.ts`, etc.) |
| **Location** | `./CLAUDE.md` or `./.claude/CLAUDE.md` | `./.claude/rules/<name>.md` |

### @path Imports
- Syntax: `@path/to/file` (relative to the file containing the import)
- Fully expanded and loaded at startup (imports do **not** reduce context cost vs. directly including content)
- Can chain up to 4 levels deep
- External imports (resolving outside working directory) require one-time approval from project
- To reference a path literally without importing, wrap in backticks: `` `@README` ``
- Useful for organization, not for context savings

### What to Keep in Root CLAUDE.md
1. Repository-wide coding standards
2. Common build and test commands
3. Project architecture (high-level)
4. Commit message conventions
5. Links to external docs

### What to Move to Path-Scoped Rules or Skills
- Subsystem-specific conventions → `.claude/rules/subsystem.md` with `paths: ["subsystem/**"]`
- Multi-step procedures → Skills (`.claude/skills/<name>/SKILL.md`)
- Reference material that's rarely needed → Imported via `@` or as skills
- Generated code warnings → `paths: ["**/*.generated.*"]` rule

---

## 2. Subagents: Frontmatter Schema & Context

### Frontmatter Schema (`.claude/agents/<name>.md`)

| Field | Type | Options | Purpose |
|-------|------|---------|---------|
| **name** | string | lowercase, hyphens | Unique identifier (no `:`) |
| **description** | string | 1-2 sentences | When Claude should delegate; triggers auto-invocation |
| **model** | string | `sonnet`, `opus`, `haiku`, `fable`, full ID, `inherit` | Model to use; default follows subagent model order |
| **tools** | list | Tool names or patterns | Tools subagent can access; inherits all if omitted |
| **disallowedTools** | list | Tool names | Tools to remove from allowed set |
| **permissionMode** | string | `default`, `auto`, `plan`, `dontAsk`, `bypassPermissions` | Permission mode for subagent |
| **isolation** | string | `worktree` only | Run in isolated git worktree (auto-cleaned if unchanged) |
| **maxTurns** | integer | Positive number | Max agentic turns before stopping (partial, resumable) |
| **memory** | string | `user`, `project`, `local` | Enable persistent auto memory for cross-session learning |
| **skills** | list | Skill names | Preload specific skills into context at startup |
| **mcpServers** | object/list | Server names | MCP servers available to this subagent |
| **hooks** | object | Hook definitions | Lifecycle hooks scoped to this subagent |
| **background** | boolean | `true`/`false` | Keep running in background even if Claude asks for foreground |
| **effort** | string | `low`, `medium`, `high`, `xhigh`, `max` | Effort level (overrides session) |
| **color** | string | Color name | Display color in task list |
| **initialPrompt** | string | Text + commands | Auto-submit when agent runs as main session |

### Context Inheritance (Non-Fork Subagents)

**Loads at startup:**
- System prompt (custom from markdown body or `prompt` field)
- Task message (Claude's delegation prompt)
- CLAUDE.md hierarchy (skipped by built-in Explore/Plan agents)
- Git status (skipped by Explore/Plan)
- Preloaded skills (full content)
- Sibling agent roster (when SendMessage tool included)

**Does NOT load:**
- Conversation history (parent session's turns)
- Previous skill invocations or file reads
- Parent's output style or auto memory
- Parent's context window size

### Fork Subagents (`/subtask`)
- Inherit **everything**: conversation history, system prompt, tools, model, context size
- Use for side tasks that need parent context
- Tool calls stay out of parent context (only final result returns)

### Model Resolution Order
1. Per-invocation `model` parameter (if Claude passes one)
2. Subagent's `model` frontmatter field
3. `CLAUDE_CODE_SUBAGENT_MODEL` env var (if set)
4. Parent conversation's model (default fallback)

### Parallel Execution
- Background subagents run concurrently while main conversation continues
- Multiple subagents spawn simultaneously (default **20 concurrent limit**)
- Configure: `env: { CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "50" }`
- Nested subagents up to **3 layers deep** (configurable: `CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`)

### Common Agent Patterns

**Implementer + Verifier pattern:**
```yaml
---
name: implementer
description: Write code for the feature
model: sonnet
tools: Read, Edit, Write, Bash
---
Implement the feature described below.

---
name: verifier
description: Review and test the implementation
model: sonnet
tools: Read, Bash, Glob
permissionMode: plan
---
Review the implementation for correctness and security.
```

**Fork agent (exploratory subagent):**
- Created via `/subtask` or direct agent invocation
- Inherits parent context for context-aware research
- Scope findings back to parent for decisions

**Background agent (long-running verification):**
```yaml
background: true
maxTurns: 20
memory: project
```

---

## 3. Skills: Frontmatter & Execution

### SKILL.md Frontmatter

| Field | Purpose |
|-------|---------|
| **name** | Display name (defaults to directory name) |
| **description** | When to use; Claude auto-invokes based on this |
| **when_to_use** | Additional activation hints |
| **disable-model-invocation** | `true` = only user can invoke (e.g., deployments) |
| **user-invocable** | `false` = only Claude can invoke (background knowledge) |
| **allowed-tools** | Pre-approved tools during skill invocation |
| **disallowed-tools** | Tools removed while skill is active |
| **model** | Override model when skill runs |
| **effort** | Override effort level (`low`, `medium`, `high`, `xhigh`, `max`) |
| **context** | `fork` to run in isolated subagent context |
| **agent** | Subagent type when `context: fork` (`Explore`, `Plan`, `general-purpose`) |
| **background** | `false` to wait for forked skill; default `true` (async) |
| **hooks** | Hooks that run when skill is invoked |
| **paths** | Glob patterns limiting when skill auto-activates |
| **shell** | `bash` or `powershell` for shell injection |

### When to Use Forked Subagent Context

```yaml
---
name: deep-audit
description: Audit codebase for security and performance
context: fork
agent: Explore  # Read-only tools only
disable-model-invocation: true
---
```

- Isolates long-running tasks
- Prevents skill's reasoning from polluting main conversation
- Specialized agent (Explore for read-only investigation)
- Runs in background by default (set `background: false` to block main session)

### Skills vs. Rules vs. Agents

| Use case | Choose |
|----------|--------|
| Reusable procedure across projects → | Skill (store in `~/.claude/skills/`) |
| Always-on convention for this project → | CLAUDE.md or `.claude/rules/` |
| Complex multi-step research with reasoning → | Subagent (`.claude/agents/<name>.md`) |
| Task-specific guidance (rarely needed) → | Skill or path-scoped rule |
| Auto-triggered command or workflow → | Skill with description for auto-invoke |

### Location Hierarchy
- `~/.claude/skills/` – User level (all projects)
- `.claude/skills/` – Project root (all teams)
- `packages/api/.claude/skills/` – Per-subsystem (monorepo pattern)
- Plugin skills – Distributed via plugins (namespace: `plugin-name:skill-name`)

---

## 4. Hooks: Events & Examples

### Hook Events (32 Total)

**Session lifecycle:**
- `SessionStart` – Session begins or resumes
- `SessionEnd` – Session terminates
- `Setup` – With `--init-only`, `--init`, or `--maintenance` in `-p` mode

**Per-turn events:**
- `UserPromptSubmit` – Before Claude processes prompt
- `UserPromptExpansion` – User-typed command expands
- `Stop` – Claude finishes responding
- `StopFailure` – Turn ends due to API error

**Tool execution (agentic loop):**
- `PreToolUse` – Before tool call (can block it)
- `PostToolUse` – After tool call succeeds
- `PostToolUseFailure` – After tool call fails
- `PostToolBatch` – After parallel tool calls resolve
- `PermissionRequest` – Tool call needs permission decision
- `PermissionDenied` – Auto mode denies tool call

**Agent/team events:**
- `SubagentStart`, `SubagentStop` – Subagent lifecycle
- `TaskCreated`, `TaskCompleted` – Task workflow
- `TeammateIdle` – Agent team teammate idle

**File & config:**
- `FileChanged`, `CwdChanged`, `DirectoryAdded`
- `ConfigChange` – Config file changes mid-session
- `InstructionsLoaded` – CLAUDE.md or `.claude/rules/*.md` loads

**Context & compaction:**
- `PreCompact`, `PostCompact`

**Model events:**
- `PreModelSwitch`, `PostModelSwitch`

**Worktree events:**
- `WorktreeCreate`, `WorktreeRemove`

**UI & MCP:**
- `Notification`, `MessageDisplay`
- `Elicitation`, `ElicitationResult`

### Example Hooks for TypeScript Repository

**Run typecheck + lint after edits:**
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "npx tsc --noEmit && npx eslint --fix $FILEPATH"
          }
        ]
      }
    ]
  }
}
```

**Block edits to generated files:**
```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          {
            "type": "command",
            "command": "if [[ \"$FILEPATH\" =~ \\.generated\\. ]]; then exit 1; fi"
          }
        ]
      }
    ]
  }
}
```

**Notify on permissions prompt:**
```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [
          {
            "type": "command",
            "command": "notify-send 'Claude Code' 'Awaiting permission approval'"
          }
        ]
      }
    ]
  }
}
```

---

## 5. Plan Files & Long-Running Work

### Context Window Capacity
- **200,000 tokens** total context window
- **Startup overhead** (~10%): system prompt, CLAUDE.md, auto memory, environment
- **Realistic task scope**: 20–40 file reads or one medium-depth codebase investigation
- **File reads dominate cost**: Each file consumes 1000–3000 tokens; grep results ~600 tokens

### Context Compaction (/compact)

**When to use:**
- Conversation grows beyond ~60% of window
- Long task spanning many turns
- Before `/compact`, context contains full conversation history + all file reads

**What survives:**
- CLAUDE.md (reloaded from disk)
- Nested CLAUDE.md and path-scoped rules (reload as Claude reads matching files)
- Preloaded skills (descriptions survive; full content reloads on-demand)
- Plan files (if you store them and reference them)
- Auto memory (persists between sessions)

**What is discarded:**
- Conversation history before compaction point
- File reads (but Claude can re-read them if needed)
- Hook output (hooks can re-execute)
- Skill descriptions (only invoked skills survive)

### Plan Mode & Plan Files

**Plan mode** (`--permission-mode plan`):
- Claude reads files and runs read-only shell commands
- No edits until you approve a written plan
- Useful for scoping work before delegating

**Plan file strategy** (for manager sessions):
- Store plan in `.claudeplan.md` (one-line summary per task)
- Reference in follow-up prompts: `@.claudeplan.md`
- Plan survives compaction if you keep referencing it
- After compaction, re-inject plan by mentioning it again

### Delegating Work: Manager + Subagent Pattern

**Manager session (Opus):**
1. Plan work in plan mode
2. Delegate chunks to subagents (Sonnet) with:
   - Clear acceptance criteria (one-line checklist)
   - Link to shared CLAUDE.md
   - Specific tool allowlist
3. Collect results; use `/compact` if context grows
4. Verify or re-delegate if needed

**Subagent scope per session:**
- **~50 turns** (configurable `maxTurns`) before stopping (partial, resumable)
- **One feature or bug fix** per subagent
- **Verify in parallel** with dedicated verifier agent
- Use worktrees to avoid collisions across parallel agents

**Context preservation across delegation:**
- Subagents load project CLAUDE.md (shared instructions)
- Subagents do NOT load parent conversation
- Manager embeds acceptance criteria in subagent prompt
- Manager uses `memory: project` on subagents to accumulate learnings

### Realistic Scoping for One Opus Session

**Before context crisis:**
- ~5–10 medium subagent delegations (each 20–30 turns)
- ~20–30 file reads in main session
- 2–3 compactions with plan re-injection

**When to stop:**
- Over 70% context used
- Accuracy degrading (Claude makes more mistakes)
- After 3–4 compactions, accuracy falls noticeably

**Patterns to keep context small:**
- Chunk work: 1 feature = 1 subagent
- Delegate research: use read-only subagent for investigations
- Write acceptance in CLAUDE.md, not conversation
- Use `/compact` early and often (after 10–15 turns)
- Store results outside conversation (in files subagents edit)

---

## 6. Settings: Permissions, Env Vars, Sandbox

### Permission Settings

#### Core Permission Keys
```json
{
  "permissions": {
    "defaultMode": "plan",  // Start sessions in plan/auto/default mode
    "allow": [
      "Bash(npm run *)",
      "Bash(git commit *)",
      "Bash(pnpm *)",
      "Bash(gh pr *)"
    ],
    "ask": [
      "Bash(npm install *)",
      "Bash(git push *)"
    ],
    "deny": [
      "Bash(rm -rf *)",
      "Read(./**/node_modules/**/*)",
      "Read(./**/dist/**/*)"
    ],
    "additionalDirectories": [
      "../shared",
      "../utils"
    ],
    "blockReadsOutsideWorkingDirectories": false,
    "disableBypassPermissionsMode": "disable"
  }
}
```

#### Pattern Examples for TypeScript + pnpm + GitHub

```json
{
  "permissions": {
    "allow": [
      "Bash(pnpm install *)",
      "Bash(pnpm run *)",
      "Bash(pnpm test *)",
      "Bash(git add *)",
      "Bash(git commit *)",
      "Bash(git log *)",
      "Bash(git status *)",
      "Bash(git diff *)",
      "Bash(gh pr *)",
      "Bash(gh issue *)",
      "Bash(vercel *)",
      "Bash(npx tsc *)",
      "Bash(npx eslint *)"
    ],
    "deny": [
      "Bash(git push *)",
      "Bash(git reset --hard *)",
      "Bash(pnpm publish *)",
      "Bash(vercel deploy --prod *)",
      "Read(./.env*)",
      "Read(./**/secrets/**/*)"
    ],
    "ask": [
      "Bash(npm *)"  // Different than pnpm; extra check
    ]
  }
}
```

### Permission Modes (September 2026)

| Mode | Behavior | Use case |
|------|----------|----------|
| **default** (Manual) | Prompts before each new tool use | Hands-on work, high safety priority |
| **auto** | Auto-approves with background classifier | Experienced users, trusted tasks |
| **plan** | Read-only; no edits until approved | Review before making changes |
| **dontAsk** | Auto-denies prompts (but allows pre-approved & reads) | Unattended sessions, CI |
| **acceptEdits** | Auto-approves file edits + safe filesystem ops | Quick iteration on known scope |
| **bypassPermissions** | Skips all prompts (except protected paths) | Isolated environments only |

### Environment Variables

```json
{
  "env": {
    "NODE_ENV": "development",
    "DEBUG": "true",
    "CUSTOM_VAR": "value",
    "EXISTING_VAR": "${CI_TOKEN}"  // Reference existing env var
  }
}
```

### Sandbox Settings (macOS/Linux/WSL2)

```json
{
  "sandbox": {
    "enabled": true,
    "failIfUnavailable": false,
    "autoAllowBashIfSandboxed": true,
    "filesystem": {
      "allowRead": [
        "~/.ssh",
        "/etc/hosts"
      ],
      "denyRead": [
        ".env*",
        "*.key",
        "secrets/**"
      ],
      "denyWrite": [
        ".git/**/*",
        ".claude/**/*"
      ]
    },
    "network": {
      "allowedDomains": [
        "github.com",
        "npm.js.org",
        "registry.npmjs.org"
      ],
      "deniedDomains": [
        "internal-*.corp.com"
      ],
      "strictAllowlist": false
    },
    "credentials": {
      "envVars": {
        "GITHUB_TOKEN": "masked",
        "NPM_TOKEN": "masked"
      },
      "files": {
        "~/.ssh/*": "masked",
        ".env": "blocked"
      }
    }
  }
}
```

### New Settings in 2026

- **`permissions.defaultMode`** – Set starting permission mode per session
- **`permissions.additionalDirectories`** – Grant file access to sibling packages without `--add-dir` flag
- **Worktree `sparsePaths`** – Check out only needed directories (via `worktree.sparsePaths` in settings)
- **Sandbox credential masking** – Mask sensitive env vars and files inside sandbox
- **Hook matcher enhancements** – More granular hook event matching
- **Auto memory per-subagent** – Each subagent can maintain own `MEMORY.md` via `memory:` field

---

## Proposed Minimal Context Layout for Multi-Agent Repo

**Goal:** Opus manager session can efficiently delegate to Sonnet subagents with ~250 lines total context overhead.

```
your-project/
├── CLAUDE.md                                    # 120 lines max
│   ├── Project overview (2 lines)
│   ├── Build commands (npm/pnpm)
│   ├── Common workflows (git, testing, deploy)
│   └── Architecture sketch (link to docs/)
│
├── .claude/
│   ├── CLAUDE.md                               # (optional: for first-time setup)
│   │
│   ├── settings.json                           # Permissions, env, sandbox
│   │   ├── permissions.defaultMode: "plan"
│   │   ├── permissions.allow: [pnpm, git, gh, vercel, tsc, eslint]
│   │   ├── permissions.deny: [git push, npm, .env files]
│   │   ├── env: NODE_ENV, DEBUG flags
│   │   └── sandbox.enabled: true
│   │
│   ├── settings.local.json                     # (user-specific, .gitignore)
│   │   └── Personal preferences, test URLs
│   │
│   ├── agents/                                 # Subagent definitions
│   │   ├── implementer.md
│   │   │   ├── model: sonnet
│   │   │   ├── maxTurns: 30
│   │   │   └── tools: Read, Edit, Write, Bash
│   │   ├── verifier.md
│   │   │   ├── model: sonnet
│   │   │   ├── permissionMode: plan
│   │   │   └── tools: Read, Bash, Glob
│   │   └── researcher.md
│   │       ├── context: fork
│   │       ├── agent: Explore
│   │       └── disable-model-invocation: true
│   │
│   ├── skills/                                 # Reusable procedures
│   │   ├── deploy/SKILL.md
│   │   │   ├── name: deploy
│   │   │   ├── disable-model-invocation: true
│   │   │   └── allowed-tools: [Bash(vercel *), Git]
│   │   ├── test-coverage/SKILL.md
│   │   ├── code-review/SKILL.md
│   │   │   ├── context: fork
│   │   │   └── agent: Explore
│   │   └── create-pr/SKILL.md
│   │
│   └── rules/                                  # Path-scoped rules (on-demand load)
│       ├── web-ui.md
│       │   ├── paths: ["src/web/**"]
│       │   └── Component patterns, styling guide
│       ├── api.md
│       │   ├── paths: ["src/api/**", "src/functions/**"]
│       │   └── API conventions, validation patterns
│       ├── data-layer.md
│       │   ├── paths: ["src/data/**", "**/hn-fetcher/**"]
│       │   └── Query builders, schema patterns
│       ├── enrichment.md
│       │   ├── paths: ["src/ai/**", "**/enrichment/**"]
│       │   └── LLM prompt patterns, retry logic
│       ├── testing.md
│       │   ├── paths: ["**/*.test.ts", "**/tests/**"]
│       │   └── Test structure, assertion patterns
│       ├── deploy.md
│       │   ├── paths: ["vercel.json", "**/serverless/**"]
│       │   └── Deployment config, edge functions
│       └── typescript.md
│           ├── paths: ["tsconfig*.json", "*.d.ts"]
│           └── Type patterns, strict mode flags
│
├── docs/
│   ├── ARCHITECTURE.md                         # High-level overview
│   ├── API.md                                  # Endpoint docs
│   ├── DATA_LAYER.md                           # Query patterns
│   └── DEPLOYMENT.md                           # Vercel setup
│
├── .claudeplan.md                              # (session-specific, .gitignore)
│   └── One-line summary per delegated task
│
└── (source code)
```

### File Size Budget

| File | Lines | Tokens | Load timing |
|------|-------|--------|-------------|
| `CLAUDE.md` | ~120 | ~600 | Startup |
| `.claude/rules/*.md` (all) | 300–400 total | 0 at startup; 50–100 each when matching | On-demand |
| Subagent frontmatter | 20–30 each | Negligible | On-demand |
| Skill frontmatter | 15–20 each | Negligible | On-demand |
| Settings keys | ~50 | ~200 | Startup |
| **Total startup cost** | ~170 | ~800–1000 | Fixed |
| Per file read | N/A | 1000–3000 | Per operation |

### Manager Session Workflow

```
1. claude --permission-mode plan                # Start in plan mode
2. (read initial scope from @CLAUDE.md, @docs/ARCHITECTURE.md)
3. /init                                        # Auto-generate plan, refine in editor
4. Write .claudeplan.md: 
   - [x] Task 1: UI component (→ implementer agent)
   - [ ] Task 2: API endpoint (→ implementer agent)
   - [ ] Task 3: Verify all (→ verifier agent)
5. Delegate: "use /agent implementer to implement Task 1"
   - Implementer gets CLAUDE.md, reads current branch state
   - Implementer runs tests, commits changes
   - Returns summary
6. /compact (after 3–5 subagent delegations)
7. Collect results, verify in parallel with verifier agent
8. Create PR with gh CLI
```

---

## Key 2026 Updates

1. **Agent SDK shipping with built-in tools** (Read, Write, Edit, Bash, Glob, Grep, WebSearch, WebFetch) for self-hosted agents
2. **Path-scoped rules load on-demand** – No startup cost; only load when Claude reads matching files
3. **Subagent memory** (`memory:` field) – Each subagent can maintain separate `MEMORY.md`
4. **Sparse worktrees** (`worktree.sparsePaths`) – Subagents create lightweight checkouts
5. **Sandbox credential masking** – Mask `$ENV_VARS` and files inside sandbox
6. **Parallel subagent limits** – Default 20 concurrent; configurable
7. **Auto memory per-project** – Shared across worktrees in same repo
8. **Plugin eval** (`claude plugin eval`) – Comprehensive evaluation harness with mock MCP tools and baseline arm support
9. **Hook improvements** – More event types, better interception, prompt-based and agent-based hooks

---

## Summary: Best Practices

✅ **DO**
- Keep root CLAUDE.md under 200 lines
- Use path-scoped rules to avoid context bloat
- Delegate investigation to read-only subagents (context savings)
- Store plan in `.claudeplan.md`; reference after `/compact`
- Pre-approve common commands in settings.json
- Use `maxTurns` on subagents (auto-stop before context crisis)
- Compress work: 1 feature = 1 subagent invocation

❌ **DON'T**
- Store large reference docs in root CLAUDE.md (move to skills or rules)
- Use `@path` imports thinking they save context (they don't)
- Expect subagents to read parent conversation (they won't)
- Let manager session context exceed 70% before `/compact`
- Skip `/compact` in long sessions (plan doesn't survive without it)
- Delegate without writing clear acceptance criteria

