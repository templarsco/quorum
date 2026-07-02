import { execRunner, type Runner } from "../llm/llm"
import type { AgentAdapter, AgentEvent, AgentHandle } from "../types"

const ANSI = /\x1b\[[0-9;]*[A-Za-z]/g
export function stripAnsi(s: string): string {
  return s.replace(ANSI, "")
}

// The Copilot CLI exposes a non-interactive mode (`copilot -p ... --allow-all-tools`),
// which is far more reliable than driving its TUI. We use it headless here; a visible
// PTY "watch" mode for any agent is deferred to the shell layer (roadmap Camada 1).
export class CopilotAdapter implements AgentAdapter {
  name = "copilot"
  private cbs = new Map<string, (e: AgentEvent) => void>()

  constructor(private runner: Runner = execRunner, private model = "gpt-5.5") {}

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
      const { stdout } = await this.runner("copilot", ["-p", prompt, "--allow-all-tools", "--model", this.model])
      cb?.({ agentId: handle.agentId, type: "done", text: stripAnsi(stdout).trim() })
    } catch (e) {
      cb?.({ agentId: handle.agentId, type: "blocked", error: String(e) })
      // Converge: emit done so the orchestrator's result wait resolves (no hung mission).
      cb?.({ agentId: handle.agentId, type: "done", text: `copilot failed: ${String(e)}`, error: String(e) })
    }
  }

  async stop(): Promise<void> {}
}
