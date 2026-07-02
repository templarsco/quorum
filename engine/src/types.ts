export type Role = "human" | "orchestrator" | "worker" | "system"
export type Lang = "pt-br" | "en-us"

/** Agent Lounge (Slack-like) message kinds on the bus. */
export type LoungeType =
  | "chat"
  | "delegate"
  | "done"
  | "ack"
  | "status"
  | "result"
  | "blocked"

export interface LoungeMeta {
  /** Direct recipients — they get notified even without @ in text. */
  to?: string[]
  /** Parsed @mentions from text. */
  mentions?: string[]
  /** Message id this replies to (ack / thread). */
  replyTo?: number
  /** Short summary for done/delegate cards. */
  summary?: string
  /** Task body for delegate messages. */
  task?: string
}

export interface Message {
  channel: string
  author: string
  role: Role
  lang: Lang
  text: string
  type?: LoungeType | string
  meta?: LoungeMeta & Record<string, unknown>
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
