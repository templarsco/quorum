# Quorum

> Orchestrate agents. Ship code faster.

A multi-agent IDE that orchestrates real coding-agent CLIs (Claude Code,
GitHub Copilot / GPT-5.5, and more coming) as a hierarchical team. An
orchestrator takes a task, delegates it across workers running on **different
model families** (model diversity is a feature), coordinates them over an
**event-driven message bus** that never deadlocks, and replies to you — all
with a configurable language boundary (talk to it in your language; agents
collaborate internally in English for efficiency).

**Status:** v0.1 — a working "walking skeleton". Built engine-first; the visual
shell targets **[CodeSurf](https://github.com/jasonkneen/codesurf)** (canvas +
groups) with chat UX inspired by **[Synara](https://github.com/Emanuele-web04/synara)**
(handoffs, threads, @mentions). See [CodeSurf integration spec](#codesurf-integration-spec) below.

Full vision → [docs/VISION.md](docs/VISION.md)

## What works today (v0.1)

- **Orchestrator** — takes a task in your language, decomposes it, delegates, consolidates, and replies in your language.
- **Two real adapters** — Claude Code (headless `claude -p` stream-json) and Copilot CLI (headless `copilot -p`, GPT-5.5).
- **Event-driven bus** — agents wake each other by events, not polling (no "one finishes and the other sits idle").
- **Language boundary** — your language ⇄ English, translated on display only; agents collaborate in English internally.
- **Agent Lounge** — Slack/Devin-style agent chat: `delegate`, `done`, `ack`, `@mentions` between terminals.
- **MCP server** — `quorum_inbox`, `quorum_post`, `quorum_web_fetch`, `quorum_effort_plan`, … for Claude/Copilot terminals.
- **Effort router** — auto-picks `ultrathink` vs `ultracode` vs standard effort from task complexity.
- **SQLite** persistence of the whole conversation.

```
> npm run dev -- "Suggest a short, strong name for this product and a one-line slogan."
  [human/chat]       Suggest a short, strong name...
  [copilot-2/result] Orchestrate agents. Ship code faster.
  [claude-1/result]  Quorum
  [orchestrator/result] **Quorum** — Orchestrate agents. Ship code faster.
```

## Quickstart

Requirements: **Node ≥ 20**, and the `claude` and `copilot` CLIs installed and authenticated on your `PATH`.

```bash
cd engine
npm install
npm run dev -- "your task here"
```

Run the tests (the real-CLI integration test auto-skips if `claude` is absent):

```bash
cd engine
npm test
```

## One-click Windows

Native desktop app (Tauri) — open the `.exe` and automations start automatically. See **[BUILD.md](./BUILD.md)** for `npm run build:win`, output paths, and MCP setup.

## Architecture

```
engine/                 # TypeScript orchestration engine (runs standalone)
  src/
    orchestrator/       # task intake, decomposition, delegation, consolidation
    bus/                # event-driven message bus (no polling)
    lounge/             # Agent Lounge — delegate, done, ack, @mentions (Slack/Devin)
    automations/        # Devin/Cursor-style triggers → missions
    workspace/          # Multi-agent workspace, harness, roster
    effort/             # ultrathink vs ultracode router (+ gstack skill hints)
    knowledge/          # web_fetch / web_search (OpenClaw-style scout)
    mcp/                # MCP stdio server for CodeSurf / Claude / Copilot
    agents/             # adapters: claude, copilot (+ fake for tests)
    llm/                # LLM interface (Claude CLI-backed)
    i18n/               # language boundary (your language <-> English)
    store/              # SQLite persistence
```

## Roadmap

1. **CodeSurf integration** — Squad ↔ Group protocol, MCP bridge, Studio mode (this spec).
2. **Automations UI** — create/edit automations in CodeSurf (parity with Cursor Automations editor).
3. **Multi-Agent Workspace UI** — roster toggle, harness todos, diff cards (Cursor screenshots).
4. **More adapters** — Codex, Gemini, Cursor / Azure AI Foundry (Synara-style provider matrix + Copilot).
5. **Dynamic workflow runtime** — Claude `/workflows`-style phases + script executor.
6. **Knowledge MCP** — OpenClaw-style `web_fetch` / `web_search` for scout agents.
7. **Git layer** — worktrees per agent, diff/PR (Synara patterns).

---

## Multi-Agent Workspace (Cursor + Claude workflows + long-running harness)

One **workspace** = one chat/mission where **several models work as a startup team** —
not a single agent with a model picker. This is what Cursor's [multi-agent
programming](https://cursor.com/pt-BR/help/ai-features/multi-agent), [long-running
agents](https://cursor.com/pt-BR/blog/long-running-agents), and Claude Code
[dynamic workflows](https://code.claude.com/docs/en/workflows) converge toward —
implemented in Quorum with **real CLIs in CodeSurf terminal blocks** (Opus 4.8,
GPT-5.5 Copilot, Codex, …) coordinated over Agent Lounge.

### What the screenshots show (Cursor) → Quorum equivalent

| Cursor UI | Quorum + CodeSurf |
|-----------|-------------------|
| Composer + GPT-5 Codex + Sonnet cards on one task | **Roster** — one workspace, many `ModelSlot`s with file deltas per agent |
| "Use Multiple Models" toggle | `workspace.roster[].enabled` — mix Opus + GPT-5.5 + Sonnet in same mission |
| To-dos (2/3) | `workspace.harness.todos` — planner owns list, workers claim items |
| Diff review pane | CodeSurf code blocks + Synara-style diff/PR (future) |
| `/multitask`, parallel implement | **Dynamic workflow** phases — independent steps in parallel |
| Long-running / cloud handoff | `workspace.runtime` + harness **checkpoints** — resume after pause |
| Subagents (research, shell, browser) | **Areas**: research=scout+web, devops=executor, qa=reviewer |

### Three orchestration layers (who holds the plan)

| Layer | Quorum module | Who decides next step | Scale |
|-------|---------------|----------------------|-------|
| **Turn-by-turn** | `orchestrator/` | Piloto LLM each turn | 1–3 workers |
| **Agent team** | `lounge/` + CodeSurf squad | Piloto + @mentions | 6–20 agents |
| **Dynamic workflow** | `workspace/` workflow script | **Script** (phases, loops) | 16–1000 agents |
| **Automation** | `automations/` | Trigger → mission | event-driven |

Move to a **workflow script** when the task outgrows one conversation (500-file
migration, codebase audit, cross-checked research) — same as Claude `/deep-research`
or Cursor planner/worker/judge at scale.

### Long-running harness (Anthropic + Cursor)

[Harness design for long-running apps](https://www.anthropic.com/engineering/harness-design-long-running-apps)
+ Cursor's planner/worker/judge pattern:

| Harness field | Purpose |
|---------------|---------|
| `goal` | North star for the workspace (survives context compression) |
| `todos` | Planner-owned task list (Cursor 2/3 todos UI) |
| `checkpoints` | Phase summaries + artifact refs — **resume** without re-reading everything |
| `generation` | Increment on fresh-start — fight drift |
| `roles.planner` / `roles.judges` | Explicit planner/judge assignment |

Persisted at `.quorum/workspaces/{id}/workspace.json`.

### Startup team roster (multi-model in one workspace)

| Area | Agent | Adapter | Model example |
|------|-------|---------|---------------|
| planner | piloto | claude | Opus 4.8 |
| backend | builder-be | claude | Sonnet 4.6 |
| frontend | builder-fe | copilot | GPT-5.5 |
| qa | reviewer | copilot | GPT-5.5 |
| research | scout | claude | Haiku 4.5 |
| devops | executor | claude | Sonnet 4.6 |

Each slot → **CodeSurf terminal** in one **squad group**. Coordination via Agent
Lounge (`delegate` → `done` → `ack`), not one shared context window.

### Knowledge layer (OpenClaw-style internet)

| Tool | Policy | Used by |
|------|--------|---------|
| `web_fetch` | `knowledge.webFetch` | scout — URL → markdown |
| `web_search` | `knowledge.webSearch` | scout, piloto — multi-angle research |
| cache | `cacheTtlMinutes: 15` | avoid repeat fetches |

Future MCP: `quorum_web_fetch`, `quorum_web_search` — cross-check like Claude
`/deep-research` before piloto merges results.

### One workspace in CodeSurf

```
Workspace: feat-parallel-search
├── Mission chat (Synara-style, @mentions)
├── Squad group
│   ├── piloto · Opus          (chat)
│   ├── builder-be · Claude      (terminal)
│   ├── builder-fe · GPT-5.5     (terminal · Copilot)
│   ├── reviewer · GPT-5.5       (terminal)
│   ├── scout · web research     (terminal + browser)
│   └── executor · CI/smoke      (terminal)
├── Harness — todos 2/3, checkpoints
└── Diff review — +137 −59 per agent card
```

### Implementation status

| Piece | Status |
|-------|--------|
| Roster + harness types | ✅ `engine/src/workspace/` |
| Agent Lounge | ✅ |
| Automations | ✅ |
| Workflow JS runtime | 🔜 |
| web_fetch MCP | ✅ |
| CodeSurf workspace UI | 🔜 |

---

## CodeSurf integration spec

Quorum is the **brain** (orchestrator + bus + adapters). CodeSurf is the **body**
(infinite canvas, block groups, terminals, browser). The goal is a multi-agent IDE
with **Railway-style topology**: environments, groups, services — except each
"service" is an agent terminal (Claude Code, Copilot/GPT-5.5, Codex, …).

### Mental model (Railway → Quorum)

| Railway | CodeSurf | Quorum |
|---------|----------|--------|
| Project | Workspace (`~/.codesurf/workspaces/…`) | Quorum workspace |
| Environment (`production`, `development`, `pr-115`) | Canvas region or top-level group | **Mission** (`missionId`) |
| Service group (`Backend` → redis + postgres) | **Block group** | **Squad** (`squadId`) |
| Service node (frontend, api, worker) | Terminal / chat / browser block | **Agent** (`agentId`) |
| Deploy status | Block chrome (idle / working / blocked) | Bus event `type` + `meta.status` |
| Dependency arrow | Edge between blocks (optional UI) | Workflow edge in orchestrator graph |
| PR environment spawn | Duplicate group + new terminals | `squad_spawn` with `template` |

```
Workspace
└── Mission: liga-o-checkout                    ← Railway "environment"
    ├── Squad: checkout-build                   ← Railway "service group"
    │   ├── @piloto      (orchestrator chat)
    │   ├── @scout-1     (terminal · claude)
    │   ├── @builder-1   (terminal · copilot)
    │   ├── @builder-2   (terminal · claude)
    │   ├── @reviewer    (terminal · copilot)
    │   └── @executor    (terminal · shell)
    └── Squad: checkout-verify
        └── browser block · sentinela.io
```

One mission can own multiple squads. One squad maps to **exactly one** CodeSurf block
group. Agents inside a squad share a **bus channel** (`channel = missionId` or
`missionId/squadId`).

### Squad ↔ Group protocol

Bidirectional sync between Quorum engine state and CodeSurf workspace JSON.
Transport: **MCP tools** (preferred), **file watch** on `.quorum/` (fallback), or
WebSocket sidecar (future).

#### Identifiers

| ID | Owner | Example | Persists in |
|----|-------|---------|-------------|
| `missionId` | Quorum | `liga-o-checkout` | SQLite + `.quorum/missions.json` |
| `squadId` | Quorum | `checkout-build` | SQLite + mission record |
| `groupId` | CodeSurf | `cs-grp_8f3a…` | CodeSurf `workspace.json` |
| `blockId` | CodeSurf | `cs-blk_term_…` | CodeSurf `workspace.json` |
| `agentId` | Quorum | `builder-1` | SQLite; `meta.blockId` links to CodeSurf |

**Invariant:** `squadId` ↔ `groupId` is 1:1. `agentId` ↔ `blockId` is 1:1 for
terminal/chat blocks managed by Quorum.

#### Bus message types (Quorum → CodeSurf)

All messages use the existing `Message` shape; `type` and `meta` carry integration
payloads. CodeSurf extension / MCP client subscribes to the bus and applies canvas
mutations.

| `type` | Direction | Purpose |
|--------|-----------|---------|
| `chat` | any | Human/agent text, @mentions (Synara-style) |
| `status` | agent → all | Progress line, token/cost hints in `meta` |
| `result` | agent → all | Worker finished |
| `blocked` | agent → piloto | Needs replan or another agent |
| `squad_spawn` | orchestrator → CodeSurf | Create group + blocks |
| `squad_update` | orchestrator → CodeSurf | Add/remove agents in squad |
| `squad_collapse` | orchestrator → CodeSurf | Collapse group UI; agents may stay running |
| `squad_destroy` | orchestrator → CodeSurf | Tear down group + stop agents |
| `workflow_edge` | orchestrator → CodeSurf | Draw dependency arrow A → B |
| `studio_paste` | human → agent | Direct paste/inject into focused terminal block |

#### `squad_spawn` payload

Posted by orchestrator when a mission needs a new squad (Railway "create environment"
/ PR preview equivalent).

```json
{
  "channel": "liga-o-checkout",
  "author": "piloto",
  "role": "orchestrator",
  "lang": "en-us",
  "type": "squad_spawn",
  "text": "Spawn checkout-build squad",
  "meta": {
    "missionId": "liga-o-checkout",
    "squadId": "checkout-build",
    "title": "checkout-build",
    "layout": "grid",
    "position": { "x": 120, "y": 80 },
    "agents": [
      {
        "agentId": "scout-1",
        "role": "scout",
        "adapter": "claude",
        "blockType": "terminal",
        "model": "claude-opus-4-8",
        "cmd": ["claude"],
        "env": { "QUORUM_AGENT_ID": "scout-1" }
      },
      {
        "agentId": "builder-1",
        "role": "builder",
        "adapter": "copilot",
        "blockType": "terminal",
        "model": "gpt-5.5",
        "cmd": ["copilot"],
        "env": { "QUORUM_AGENT_ID": "builder-1" }
      },
      {
        "agentId": "reviewer-1",
        "role": "reviewer",
        "adapter": "copilot",
        "blockType": "terminal",
        "cmd": ["copilot"]
      },
      {
        "agentId": "piloto",
        "role": "orchestrator",
        "adapter": "claude",
        "blockType": "chat",
        "pinned": true
      }
    ],
    "edges": [
      { "from": "scout-1", "to": "builder-1" },
      { "from": "builder-1", "to": "reviewer-1" }
    ]
  }
}
```

**CodeSurf adapter responsibilities:**

1. Create block group `groupId`, set title from `meta.title`.
2. For each agent in `meta.agents`, create the block inside the group; store
   `blockId` back via `squad_ack` (below).
3. Wire terminal MCP to Quorum (`quorum_post`, `quorum_read`).
4. Apply `edges` as optional canvas connectors.

#### `squad_ack` payload (CodeSurf → Quorum)

```json
{
  "channel": "liga-o-checkout",
  "author": "codesurf",
  "role": "system",
  "lang": "en-us",
  "type": "squad_ack",
  "text": "Group created",
  "meta": {
    "missionId": "liga-o-checkout",
    "squadId": "checkout-build",
    "groupId": "cs-grp_8f3a2b1c",
    "blocks": [
      { "agentId": "builder-1", "blockId": "cs-blk_term_a1", "blockType": "terminal" },
      { "agentId": "piloto", "blockId": "cs-blk_chat_p0", "blockType": "chat" }
    ]
  }
}
```

#### `squad_update` (dynamic scale 1 → N)

When the piloto needs more workers (e.g. 5 builders, 2 scouts):

```json
{
  "type": "squad_update",
  "meta": {
    "squadId": "checkout-build",
    "groupId": "cs-grp_8f3a2b1c",
    "add": [
      { "agentId": "builder-3", "role": "builder", "adapter": "copilot", "blockType": "terminal" }
    ],
    "remove": ["builder-2"],
    "edges": [{ "from": "builder-3", "to": "reviewer-1" }]
  }
}
```

CodeSurf adds/removes blocks **inside the existing group** without breaking layout.

#### Agent status chrome

Workers post `status` with optional metering (Overclock-style):

```json
{
  "type": "status",
  "author": "builder-1",
  "text": "Editing routes/auth.ts",
  "meta": {
    "squadId": "checkout-build",
    "blockId": "cs-blk_term_a1",
    "status": "working",
    "progress": 0.78,
    "costUsd": 0.785,
    "tokensIn": 12000,
    "tokensOut": 3400
  }
}
```

CodeSurf renders `progress`, `costUsd`, and `status` on the block header inside the group.

### Agent Lounge (Slack / Devin-style inter-agent chat)

Agents in different terminals need a **shared channel** to delegate, finish, and
acknowledge work — like Devin’s internal coordination or a Slack thread between
teammates. Quorum implements this as **Agent Lounge** on top of the event bus.

#### Message types

| `type` | Who posts | What happens |
|--------|-----------|--------------|
| `delegate` | piloto → worker | `@builder-1 piloto delegated: Fix auth.ts` — worker inbox wakes |
| `done` | worker → peers | `@reviewer @piloto builder-1 finished: Rate limiter added` |
| `ack` | peer → worker | `@builder-1 reviewer-1: ok, reviewing your progress now` |
| `chat` | anyone | Free text; `@mentions` parsed into `meta.to` |

Orchestrator emits `delegate` before spawning a worker and `done` when it finishes;
other squad agents receive `done` in their inbox and can `ack` or reply via `chat`.

#### Engine API (`engine/src/lounge/lounge.ts`)

```typescript
lounge.delegate("piloto", "builder-1", "Fix auth.ts")
lounge.notifyDone("builder-1", ["piloto", "reviewer-1"], "Rate limiter added")
lounge.ack("reviewer-1", "builder-1", { text: "ok, reviewing your progress now" })
lounge.chat("builder-1", "@reviewer-1 ready for review")
lounge.watchAgent("reviewer-1", (msg, line) => console.log(line))  // event-driven inbox
await lounge.waitFor("copilot-1")  // blocks until next message for this agent
```

#### Terminals today (`quorum.mjs`)

In each CodeSurf terminal block, run a sidecar watch while the agent works:

```bash
# Terminal builder-1 (Claude) — background pane or split
node quorum.mjs watch builder-1

# Piloto delegates (or orchestrator does this automatically)
node quorum.mjs delegate piloto builder-1 "Implement rate limiter in auth.ts"

# Builder finishes → peers notified
node quorum.mjs done builder-1 piloto,reviewer-1 "Rate limiter in routes/auth.ts"

# Reviewer sees [done] in watch, responds
node quorum.mjs ack reviewer-1 builder-1 "ok, reviewing your progress now"
node quorum.mjs send reviewer-1 "@builder-1 LGTM on rate limit, checking TS types"
```

Inbox is **filtered** — agents only see messages addressed to them (`to`, `@mention`),
not their own posts. File: `.quorum/lounge.jsonl`.

#### CodeSurf Mission Room

The chat block inside a squad group renders the same bus stream as Agent Lounge
(Synara-style UI + Devin-style coordination). `@builder-1` in the mission room and
`lounge.chat(...)` in the engine are the same message.

### Automations (Devin / Cursor-style)

**Automations** wire external events and schedules to Quorum missions — the same
idea as [Devin Automations](https://docs.devin.ai/product-guides/automations) and
**Cursor Automations** (schedule, Git, Slack, webhooks → agent session).

| Capability | Devin | Cursor Automations | Quorum |
|------------|-------|-------------------|--------|
| Schedule (cron) | ✅ | ✅ | ✅ `trigger.schedule` |
| Git PR / push / CI | ✅ | ✅ | ✅ `trigger.git` |
| Webhook | ✅ | ✅ | ✅ `trigger.webhook` |
| Slack / Linear / Sentry | ✅ | ✅ | 🔜 via webhook/MCP |
| Start new mission | ✅ Start session | ✅ Agent run | ✅ `start_mission` |
| Message existing squad | ✅ Message session | — | ✅ `message_squad` |
| Triage channel | ✅ Triage Devin | — | ✅ `triage` |
| React to agent `[done]` | — | — | ✅ `trigger.bus` |
| Multi-agent squad | ✅ managed Devins | single agent | ✅ orchestrator + lounge |

Automations live as JSON in `.quorum/automations/*.json`. Copy from
`.quorum/automations/*.json.example` to enable.

#### Example: nightly smoke (Devin scheduled session)

```json
{
  "id": "nightly-smoke",
  "name": "Nightly smoke test",
  "enabled": true,
  "trigger": { "type": "schedule", "cron": "0 2 * * *" },
  "action": {
    "type": "start_mission",
    "prompt": "Run smoke tests and report failures."
  },
  "maxRunsPerHour": 1
}
```

#### Example: auto-fix CI (GitHub check failed)

```json
{
  "id": "fix-ci",
  "enabled": true,
  "trigger": { "type": "git", "event": "ci_failed", "repos": ["org/repo"] },
  "conditions": [{ "field": "branch", "equals": "main" }],
  "action": {
    "type": "start_mission",
    "prompt": "CI failed — read trigger context logs and fix the root cause."
  }
}
```

#### Example: reviewer ping when builder finishes (bus + Lounge)

```json
{
  "id": "review-on-done",
  "enabled": true,
  "trigger": { "type": "bus", "when": { "type": "done" } },
  "action": {
    "type": "message_squad",
    "text": "@reviewer-1 please ack and review the builder output.",
    "to": ["reviewer-1"]
  }
}
```

#### Actions

| `action.type` | Behaviour |
|---------------|-----------|
| `start_mission` | Runs full orchestrator pipeline (delegate → workers → consolidate) |
| `message_squad` | Posts to Agent Lounge (`@mentions` wake agents) |
| `triage` | Posts to `@piloto`; optional `spawnOnMatch` starts mission when trigger text matches |
| `notify` | Lounge notify to listed agents |

Trigger context (PR payload, webhook body, bus message) is appended to the prompt
automatically so agents see the same context Devin/Cursor inject.

#### Run the automation daemon

```bash
cd engine
npm run automations
```

Ticks schedules every 60s and listens on the bus for `trigger.bus` automations.
Wire GitHub webhooks to `AutomationRunner.onGitEvent()` / `onWebhook()` from your
HTTP handler (future CodeSurf extension or sidecar).

Manual run (programmatic):

```typescript
await runner.run("nightly-smoke", { source: "manual" })
```

### Chat (Synara-inspired, on CodeSurf canvas)

Mission room chat is a **chat block** inside the squad group (not a disconnected
sidebar). Behaviour follows [Synara](https://github.com/Emanuele-web04/synara) patterns:

| Feature | Behaviour |
|---------|-----------|
| **@mention agent** | `@builder-1 fix auth.ts` → bus `chat` with `meta.mentions: ["builder-1"]`; target agent receives via MCP/`quorum_read` |
| **@mention squad** | `@checkout-build status` → fan-out to all agents in squad |
| **@mention block** | `@terminal:scout-1` or canvas pick — resolves `blockId` → `agentId` |
| **Thread / handoff** | `meta.threadId`; handoff = new message with `meta.handoff: { from, to, contextPack }` (Synara-style provider switch with shared context) |
| **Parallel threads** | Multiple `threadId` in same mission; each thread can bind to different adapter |
| **Provider matrix** | Claude Code, Copilot (GPT-5.5), Codex, Gemini, … via Quorum adapters — Copilot is Quorum-only today |
| **Human language** | UI in your language; bus internal lang `en-us` for agent collaboration (existing i18n boundary) |

Mention grammar (regex-friendly):

```
@(?<target>[a-zA-Z0-9_-]+)     → agentId or role alias (e.g. @reviewer)
@squad:(?<squadId>[…]+)
@block:(?<blockId>[…]+)
@group:(?<groupId>[…]+)
```

### Studio mode

**Studio** is the interaction mode where the canvas defers to the block under the
cursor. Required for daily use alongside orchestration — without it, CodeSurf chrome
fights the terminal.

#### Mode toggle

| Mode | Canvas pan/zoom | Block interaction |
|------|-----------------|-------------------|
| **Navigate** | Middle-mouse pan, Ctrl+scroll zoom (Canva/Figma standard) | Blocks move/resize on drag |
| **Studio** | Pan/zoom only with Space or middle-mouse | **Hover focus** — block under cursor owns input |

Default: **Studio** when pointer is over a terminal or chat block.

#### Studio rules (UX contract for CodeSurf fork/extension)

1. **Hover focus** — When the mouse is over a terminal block, that terminal receives
   keyboard and paste events. Canvas shortcuts (delete block, open block menu,
   multi-select) are **suppressed** unless explicitly chorded (e.g. Ctrl+Shift+K).
2. **Direct paste** — Ctrl+V / right-click paste goes **into the terminal** (xterm),
   not into CodeSurf global menus or block title edit. No extra click to "focus".
3. **No menu steal** — Right-click on terminal surface shows **terminal context menu**
   (copy/paste/split) or nothing — never the canvas "block actions" menu.
4. **Mention picker** — In chat blocks, `@` opens autocomplete: agents in squad,
   squads in mission, visible blocks on canvas. Picking `@builder-1` inserts mention
   token linked to `agentId`.
5. **Drag-to-mention** — Drag a code block or file block onto chat input → inserts
   `@block:…` or file reference (Studio-only affordance).
6. **Escape** — Esc returns focus to canvas (Navigate semantics for one action) or
   exits Studio overlay.
7. **Status bar** — Shows focused `agentId`, `squadId`, `missionId`, bus channel.

#### `studio_paste` (optional programmatic inject)

For Quorum/human to push text into a focused terminal without clipboard:

```json
{
  "type": "studio_paste",
  "author": "human",
  "meta": {
    "blockId": "cs-blk_term_a1",
    "agentId": "builder-1",
    "text": "npm test -- auth",
    "submit": true
  }
}
```

CodeSurf writes to PTY stdin; if `submit: true`, sends Enter.

### MCP bridge (CodeSurf ↔ Quorum) — implemented

From project root (or `engine/`):

```bash
cd engine && npm run mcp
```

Register in `~/.codesurf/mcp-config.json` (see `.quorum/mcp-config.example.json`):

```json
{
  "servers": [
    {
      "name": "quorum",
      "command": "npm",
      "args": ["run", "mcp"],
      "cwd": "/absolute/path/to/multi-agent-ide/engine",
      "env": {
        "QUORUM_WORKSPACE": "/absolute/path/to/your/project",
        "QUORUM_CHANNEL": "main"
      }
    }
  ]
}
```

| Tool | Description |
|------|-------------|
| `quorum_inbox` | **New messages for you** — delegate, done, ack, @mentions (call every loop) |
| `quorum_post` | Chat with @mentions on Agent Lounge |
| `quorum_delegate` | Assign task to another agent |
| `quorum_done` | Notify peers you finished |
| `quorum_ack` | "ok, reviewing your progress now" |
| `quorum_effort_plan` | Complexity score → ultrathink / ultracode / think / low |
| `quorum_web_fetch` | Fetch URL (cached 15m, OpenClaw-style) |
| `quorum_web_search` | DuckDuckGo search for scout agents |

**Agent loop (Devin-style):** after each action, call `quorum_inbox(agentId)`; if
`[delegate]` or `[done]`, respond with work or `quorum_ack`.

### Effort router (ultrathink vs ultracode)

Quorum analyzes each mission and picks the right Claude Code mechanic
([ultrathink](https://claudelog.com/faqs/what-is-ultrathink/) vs
[ultracode](https://code.claude.com/docs/en/workflows)) before burning Opus tokens:

| Score / signals | Mode | When to use |
|-----------------|------|-------------|
| Small fix, typo | `low` | Copilot fast model |
| Feature work | `medium` / `think` | `/effort high` or `think` keyword |
| Architecture, security, legacy | `ultrathink` | Single-thread max reasoning + Plan Mode + rev |
| Migration, audit 500 files, parallel sweep | `ultracode` | **Dynamic workflow** + Quorum squad spawn |

```bash
# From MCP or programmatically:
quorum_effort_plan({ task: "Audit all API endpoints for missing auth" })
# → ultracode, spawnWorkflow: true, gstackSkills: ["/autoplan"]
```

Orchestrator posts `effort_plan` on the bus and injects `ultrathink` / `ultracode:`
into Claude worker prompts automatically.

**gstack integration:** when [gstack](https://github.com/garrytan/gstack) is
installed (`~/.claude/skills/gstack`), effort plan suggests slash commands:
`/autoplan`, `/review`, `/cso`, `/qa`, `/ship` per task type.

**gbrain:** [OpenClaw agent brain](https://github.com/garrytan/gbrain) for
persistent memory — future Quorum adapter for long-running workspaces.

**Helmor:** [local multi-agent workbench](https://github.com/dohooo/helmor) with
`helmor mcp` — optional shell; Quorum targets CodeSurf canvas instead but can
delegate via `helmor send` when both are installed.

### On-disk layout (project-local)

```
<project>/
  .quorum/
    channel.jsonl          # legacy file bus (quorum.mjs); superseded by SQLite in engine
    missions.json          # mission registry + squadId ↔ groupId map
    cursor-<agentId>.txt   # per-agent read cursors (optional fallback)
  .quorum/quorum.db        # SQLite message store (engine default when configured)
```

CodeSurf workspace JSON keeps `groupId` / `blockId`; Quorum keeps authoritative
`missionId` / `squadId` / `agentId` / workflow graph. Sync on `squad_ack` and
workspace load (reconcile orphans).

### Implementation phases

| Phase | Deliverable |
|-------|-------------|
| **P0** | MCP server: inbox, post, web, effort | ✅ |
| **P1** | `squad_spawn` / `squad_ack` — CodeSurf group creation | 🔜 |
| **P2** | Orchestrator emits dynamic `squad_update`; role templates (scout/builder/reviewer/executor) |
| **P3** | Chat block: @mentions, threads, Synara-style handoff metadata |
| **P4** | Studio mode: hover focus, direct paste, suppressed canvas menus |
| **P5** | Canvas: middle-mouse pan, Ctrl+zoom; workflow edges; status chrome |
| **P6** | PR-style mission clone (`mission_fork` → duplicate squad groups) |

### References

- [CodeSurf](https://github.com/jasonkneen/codesurf) — canvas, block groups, terminals, MCP
- [Synara](https://github.com/Emanuele-web04/synara) — chat UX, handoffs, parallel threads, provider matrix
- [sshx](https://sshx.io/) — infinite canvas + terminals (UX reference for pan/zoom)
- [Railway](https://railway.com/) — environments, service groups, topology (organizational metaphor)

## License

[MIT](LICENSE) © 2026 Templarsco
