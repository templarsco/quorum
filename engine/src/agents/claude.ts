import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"
import type { AgentAdapter, AgentEvent, AgentHandle } from "../types"

// Pure mapper: one NDJSON line from `claude -p --output-format stream-json` -> event (or null).
// NOTE: exact keys depend on the installed Claude Code version. Calibrate with:
//   claude -p "say hi" --output-format stream-json --verbose
export function mapClaudeLine(line: string): Omit<AgentEvent, "agentId"> | null {
  let o: any
  try {
    o = JSON.parse(line)
  } catch {
    return null
  }
  if (o.type === "assistant" && Array.isArray(o.message?.content)) {
    const text = o.message.content.map((c: any) => c.text ?? "").join("")
    return text ? { type: "progress", text } : null
  }
  if (o.type === "result") {
    const usage =
      o.total_cost_usd != null || o.usage
        ? {
            ...(o.total_cost_usd != null ? { costUsd: o.total_cost_usd } : {}),
            ...(o.usage?.input_tokens != null ? { tokensIn: o.usage.input_tokens } : {}),
            ...(o.usage?.output_tokens != null ? { tokensOut: o.usage.output_tokens } : {}),
          }
        : undefined
    return {
      type: "done",
      text: o.result ?? "",
      error: o.is_error ? (o.result ?? "error") : undefined,
      ...(usage ? { usage } : {}),
    }
  }
  return null
}

export class ClaudeAdapter implements AgentAdapter {
  name = "claude"
  private cbs = new Map<string, (e: AgentEvent) => void>()
  private procs = new Map<string, ChildProcessWithoutNullStreams>()

  constructor(private model = "claude-opus-4-8") {}

  async spawn(opts: { agentId: string; mode: "headless" | "pty"; cwd?: string }): Promise<AgentHandle> {
    return { agentId: opts.agentId, adapter: this.name, mode: "headless" }
  }

  onEvent(handle: AgentHandle, cb: (e: AgentEvent) => void): void {
    this.cbs.set(handle.agentId, cb)
  }

  async send(handle: AgentHandle, prompt: string): Promise<void> {
    const cb = this.cbs.get(handle.agentId)
    // Prompt via stdin (not argv) to avoid the OS arg-length limit on large prompts.
    const cp = spawn("claude", ["-p", "--model", this.model, "--output-format", "stream-json", "--verbose"], {
      shell: false,
    })
    this.procs.set(handle.agentId, cp)
    cp.stdin.write(prompt)
    cp.stdin.end()
    cb?.({ agentId: handle.agentId, type: "started" })
    const rl = createInterface({ input: cp.stdout })
    rl.on("line", (line) => {
      const ev = mapClaudeLine(line)
      if (ev) cb?.({ agentId: handle.agentId, ...ev })
    })
    cp.on("close", () => this.procs.delete(handle.agentId))
  }

  async stop(handle: AgentHandle): Promise<void> {
    this.procs.get(handle.agentId)?.kill()
    this.procs.delete(handle.agentId)
  }
}
