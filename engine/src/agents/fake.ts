import type { AgentAdapter, AgentEvent, AgentHandle } from "../types"

export class FakeAdapter implements AgentAdapter {
  name = "fake"
  private cbs = new Map<string, (e: AgentEvent) => void>()

  constructor(private script: (prompt: string) => string = (p) => `done:${p}`) {}

  async spawn(opts: { agentId: string; mode: "headless" | "pty" }): Promise<AgentHandle> {
    return { agentId: opts.agentId, adapter: this.name, mode: opts.mode }
  }

  onEvent(handle: AgentHandle, cb: (e: AgentEvent) => void): void {
    this.cbs.set(handle.agentId, cb)
  }

  async send(handle: AgentHandle, prompt: string): Promise<void> {
    const cb = this.cbs.get(handle.agentId)
    queueMicrotask(() => {
      cb?.({ agentId: handle.agentId, type: "progress", text: "working" })
      cb?.({ agentId: handle.agentId, type: "done", text: this.script(prompt) })
    })
  }

  async stop(): Promise<void> {}
}
