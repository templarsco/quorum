export type Role = "human" | "orchestrator" | "worker" | "system"
export type Lang = "pt-br" | "en-us"

export interface Message {
  channel: string
  author: string
  role: Role
  lang: Lang
  text: string
  type?: string // "chat" | "status" | "result" | "blocked"
  meta?: Record<string, unknown>
}

export interface StoredMessage extends Message {
  id: number
  createdAt: number
}

export type AgentEventType = "started" | "progress" | "done" | "blocked"

export interface AgentEvent {
  agentId: string
  type: AgentEventType
  text?: string
  error?: string
}

export interface AgentHandle {
  agentId: string
  adapter: string
  mode: "headless" | "pty"
}

export interface AgentAdapter {
  name: string
  spawn(opts: { agentId: string; mode: "headless" | "pty"; cwd?: string }): Promise<AgentHandle>
  send(handle: AgentHandle, prompt: string): Promise<void>
  onEvent(handle: AgentHandle, cb: (e: AgentEvent) => void): void
  stop(handle: AgentHandle): Promise<void>
}

export interface LLM {
  complete(prompt: string, opts?: { system?: string }): Promise<string>
}
