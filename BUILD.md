# One-click Windows build (Quorum desktop)

Quorum ships as a native Windows app (Tauri v2). Opening the `.exe` starts the automations daemon and opens the mission UI — no manual `npm run automations` or terminal setup.

## Requirements (build machine only)

- **Node.js ≥ 20** (bundled into the installer at build time)
- **Rust** stable + MSVC build tools ([rustup](https://rustup.rs/))
- **WebView2** runtime (preinstalled on Windows 11; [install on Win10](https://developer.microsoft.com/en-us/microsoft-edge/webview2/))

Agent CLIs (`claude`, `copilot`) are **not** bundled — install and authenticate them separately if you want live orchestration tasks to reach real agents.

## Build

From the repo root:

```powershell
npm run build:win
```

This runs:

1. `engine/scripts/bundle-desktop.mjs` — esbuild bundles `automations`, `stream`, and `mcp` entry points + copies `better-sqlite3` native addon + embeds `node.exe`
2. `npm run tauri build` in `desktop/` — produces the installer and portable exe

## Output paths

After a successful build:

| Artifact | Path |
|----------|------|
| Portable exe | `desktop/src-tauri/target/release/quorum.exe` |
| NSIS installer | `desktop/src-tauri/target/release/bundle/nsis/Quorum_0.1.0_x64-setup.exe` |

## What starts on launch

When you open Quorum:

1. **Workspace** — `%APPDATA%\com.templarsco.quorum\workspace\` (created automatically)
2. **`.quorum/`** — `%APPDATA%\com.templarsco.quorum\workspace\.quorum\` with `automations/`, `quorum.db`, `daemon-status.json`
3. **Automations daemon** — bundled Node runs `engine/automations.js` (schedule ticks every 60s, bus-triggered automations)
4. **Mission UI** — type a task and click **Run** to spawn the orchestrator (`stream.js`) and stream agent events live

On app exit, sidecar Node processes are killed.

## MCP server (stdio)

The MCP stdio server is **not** auto-spawned (IDE agents connect via MCP config). After install, point Claude Code / Copilot MCP settings at:

```
<resource-dir>\engine\mcp.js
```

Use the bundled Node at `<resource-dir>\node\node.exe` as the command. The desktop status log shows the exact paths via **get_engine_status**.

Example MCP config snippet (`.quorum/mcp-config.json`):

```json
{
  "mcpServers": {
    "quorum": {
      "command": "C:\\Users\\YOU\\AppData\\Local\\Quorum\\resources\\node\\node.exe",
      "args": ["C:\\Users\\YOU\\AppData\\Local\\Quorum\\resources\\engine\\mcp.js"],
      "env": { "QUORUM_WORKSPACE": "C:\\path\\to\\your\\project" }
    }
  }
}
```

Set `QUORUM_WORKSPACE` to your git project if you want lounge/automations in that repo instead of the app-data workspace.

## Dev mode (no bundle)

```powershell
npm run dev:desktop
```

Uses `npx tsx` against `engine/src/` (requires Node + `engine/npm install`). Automations still auto-start.

## Known limitations

- **CodeSurf** is not bundled — this exe is the walking-skeleton shell; canvas/groups UI remains a separate integration.
- **Real agent CLIs** must be on `PATH` and authenticated for orchestrator tasks to call Claude/Copilot.
- **MCP** is stdio-only; configure it in your agent IDE — Quorum does not expose an HTTP/WebSocket MCP bridge yet.
- **Project picker** — workspace defaults to app data; set `QUORUM_WORKSPACE` for MCP or future project-open UI.
