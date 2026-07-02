import { execSync } from "node:child_process"
import type { AgentAdapter } from "../types"
import { ClaudeAdapter } from "./claude"
import { CopilotAdapter } from "./copilot"
import { CodexAdapter } from "./codex"
import { GeminiAdapter } from "./gemini"

function onPath(cmd: string): boolean {
  try {
    const probe = process.platform === "win32" ? `where.exe ${cmd}` : `command -v ${cmd}`
    execSync(probe, { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

/**
 * Model-diverse adapter registry — one entry per agent CLI found on PATH.
 * Claude + Copilot are the core duo; Codex and Gemini join when installed.
 */
export function detectAdapters(): Record<string, AgentAdapter> {
  const adapters: Record<string, AgentAdapter> = {}
  if (onPath("claude")) adapters.claude = new ClaudeAdapter()
  if (onPath("copilot")) adapters.copilot = new CopilotAdapter()
  if (onPath("codex")) adapters.codex = new CodexAdapter()
  if (onPath("gemini")) adapters.gemini = new GeminiAdapter()
  // Always give the orchestrator at least the core duo (they fail soft at run time).
  if (Object.keys(adapters).length === 0) {
    adapters.claude = new ClaudeAdapter()
    adapters.copilot = new CopilotAdapter()
  }
  return adapters
}
