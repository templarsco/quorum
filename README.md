# Quorum

> Orchestrate agents. Ship code faster.

A multi-agent IDE that orchestrates real coding-agent CLIs (Claude Code,
GitHub Copilot / GPT-5.5, and more coming) as a hierarchical team. An
orchestrator takes a task, delegates it across workers running on **different
model families** (model diversity is a feature), coordinates them over an
**event-driven message bus** that never deadlocks, and replies to you — all
with a configurable language boundary (talk to it in your language; agents
collaborate internally in English for efficiency).

**Status:** v0.1 — a working "walking skeleton". Built engine-first; the native
desktop shell + Windows installer come later (see the Roadmap below).

## What works today (v0.1)

- **Orchestrator** — takes a task in your language, decomposes it, delegates, consolidates, and replies in your language.
- **Two real adapters** — Claude Code (headless `claude -p` stream-json) and Copilot CLI (headless `copilot -p`, GPT-5.5).
- **Event-driven bus** — agents wake each other by events, not polling (no "one finishes and the other sits idle").
- **Language boundary** — your language ⇄ English, translated on display only; agents collaborate in English internally.
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

## Architecture

```
engine/                 # TypeScript orchestration engine (runs standalone)
  src/
    orchestrator/       # task intake, decomposition, delegation, consolidation
    bus/                # event-driven message bus (no polling)
    agents/             # adapters: claude, copilot (+ fake for tests)
    llm/                # LLM interface (Claude CLI-backed)
    i18n/               # language boundary (your language <-> English)
    store/              # SQLite persistence
```

## Roadmap

More adapters (Cursor / Azure AI Foundry, Codex, Gemini) → hierarchy & dynamic
workflows (teams, leaders, convergence) → dynamic skills + recursive
self-improvement → always-on fresh knowledge → integrations (Discord) → native
desktop shell + Windows installer.

## License

[MIT](LICENSE) © 2026 Templarsco
