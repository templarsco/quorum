import { execRunner, type Runner } from "../llm/llm"
import type { AgentAdapter, AgentEvent, AgentHandle } from "../types"
import { stripAnsi } from "./copilot"

// Pure mapper for `gemini -p … --output-format json` single-document output:
// { "response": "…", "stats": { "models": { "<model>": { "tokens": { "prompt": n, "candidates": n } } } } }
export function mapGeminiOutput(stdout: string): Omit<AgentEvent, "agentId"> {
  const raw = stripAnsi(stdout).trim()
  try {
    const a = raw.indexOf("{")
    const b = raw.lastIndexOf("}")
    const o = JSON.parse(raw.slice(a, b + 1))
    if (o.error) return { type: "blocked", error: o.error.message ?? String(o.error) }
    let tokensIn: number | undefined
    let tokensOut: number | undefined
    const models = o.stats?.models
    if (models && typeof models === "object") {
      for (const m of Object.values<any>(models)) {
        tokensIn = (tokensIn ?? 0) + (m?.tokens?.prompt ?? 0)
        tokensOut = (tokensOut ?? 0) + (m?.tokens?.candidates ?? 0)
      }
    }
    const usage = tokensIn != null || tokensOut != null ? { tokensIn, tokensOut } : undefined
    return { type: "done", text: String(o.response ?? ""), ...(usage ? { usage } : {}) }
  } catch {
    // Older CLIs print plain text — treat the whole stdout as the answer.
    return { type: "done", text: raw }
  }
}

/** Google Gemini CLI adapter — headless `gemini -p` (JSON output when supported). */
export class GeminiAdapter implements AgentAdapter {
  name = "gemini"
  private cbs = new Map<string, (e: AgentEvent) => void>()

  constructor(private runner: Runner = execRunner, private model?: string) {}

  async spawn(opts: { agentId: string; mode: "headless" | "pty"; cwd?: string }): Promise<AgentHandle> {
    return { agentId: opts.agentId, adapter: this.name, mode: "headless" }
  }

  onEvent(handle: AgentHandle, cb: (e: AgentEvent) => void): void {
    this.cbs.set(handle.agentId, cb)
  }

  async send(handle: AgentHandle, prompt: string): Promise<void> {
    const cb = this.cbs.get(handle.agentId)
    cb?.({ agentId: handle.agentId, type: "started" })
    try {
      const args = ["-p", prompt, "--output-format", "json", "--approval-mode", "auto_edit"]
      if (this.model) args.push("-m", this.model)
      const { stdout } = await this.runner("gemini", args)
      cb?.({ agentId: handle.agentId, ...mapGeminiOutput(stdout) })
    } catch (e) {
      cb?.({ agentId: handle.agentId, type: "blocked", error: String(e) })
      // Converge: emit done so the orchestrator's result wait resolves (no hung mission).
      cb?.({ agentId: handle.agentId, type: "done", text: `gemini failed: ${String(e)}`, error: String(e) })
    }
  }

  async stop(): Promise<void> {}
}
