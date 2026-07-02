import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { createInterface } from "node:readline"
import type { AgentAdapter, AgentEvent, AgentHandle } from "../types"

// Pure mapper: one JSONL event from `codex exec --json` -> event (or null).
// Codex emits events like {"type":"item.completed","item":{"type":"agent_message","text":"…"}}
// and a final {"type":"turn.completed","usage":{input_tokens,output_tokens}} / turn.failed.
export function mapCodexLine(line: string): Omit<AgentEvent, "agentId"> | null {
  let o: any
  try {
    o = JSON.parse(line)
  } catch {
    return null
  }
  if (o.type === "item.completed" && o.item?.type === "agent_message") {
    const text = o.item.text ?? ""
    return text ? { type: "progress", text } : null
  }
  if (o.type === "turn.completed") {
    const usage =
      o.usage?.input_tokens != null || o.usage?.output_tokens != null
        ? {
            ...(o.usage?.input_tokens != null ? { tokensIn: o.usage.input_tokens } : {}),
            ...(o.usage?.output_tokens != null ? { tokensOut: o.usage.output_tokens } : {}),
          }
        : undefined
    return { type: "done", text: "", ...(usage ? { usage } : {}) }
  }
  if (o.type === "turn.failed" || o.type === "error") {
    return { type: "blocked", error: o.error?.message ?? o.message ?? "codex failed" }
  }
  return null
}

/**
 * OpenAI Codex CLI adapter — headless `codex exec --json` (JSONL events).
 * The final agent_message before turn.completed is the worker's answer.
 */
export class CodexAdapter implements AgentAdapter {
  name = "codex"
  private cbs = new Map<string, (e: AgentEvent) => void>()
  private procs = new Map<string, ChildProcessWithoutNullStreams>()

  constructor(private model?: string) {}

  async spawn(opts: { agentId: string; mode: "headless" | "pty"; cwd?: string }): Promise<AgentHandle> {
    return { agentId: opts.agentId, adapter: this.name, mode: "headless" }
  }

  onEvent(handle: AgentHandle, cb: (e: AgentEvent) => void): void {
    this.cbs.set(handle.agentId, cb)
  }

  async send(handle: AgentHandle, prompt: string): Promise<void> {
    const cb = this.cbs.get(handle.agentId)
    const args = ["exec", "--json", "--skip-git-repo-check", "-s", "workspace-write"]
    if (this.model) args.push("-m", this.model)
    // Prompt via stdin ("-") to avoid Windows argv length limits on big prompts.
    args.push("-")
    const cp = spawn("codex", args, { shell: process.platform === "win32" })
    this.procs.set(handle.agentId, cp)
    cp.stdin.write(prompt)
    cp.stdin.end()
    cb?.({ agentId: handle.agentId, type: "started" })

    let lastMessage = ""
    const rl = createInterface({ input: cp.stdout })
    rl.on("line", (line) => {
      const ev = mapCodexLine(line)
      if (!ev) return
      if (ev.type === "progress") lastMessage = ev.text ?? lastMessage
      // Codex's turn.completed carries no text — attach the last agent message.
      const out = ev.type === "done" && !ev.text ? { ...ev, text: lastMessage } : ev
      cb?.({ agentId: handle.agentId, ...out })
      // Converge on failure too (Claude-style): a done event with the error as
      // text lets the orchestrator's result wait resolve instead of hanging.
      if (ev.type === "blocked") {
        cb?.({ agentId: handle.agentId, type: "done", text: ev.error ?? "codex failed", error: ev.error })
      }
    })
    cp.on("close", () => this.procs.delete(handle.agentId))
    cp.on("error", (err) => cb?.({ agentId: handle.agentId, type: "blocked", error: String(err) }))
  }

  async stop(handle: AgentHandle): Promise<void> {
    this.procs.get(handle.agentId)?.kill()
    this.procs.delete(handle.agentId)
  }
}
