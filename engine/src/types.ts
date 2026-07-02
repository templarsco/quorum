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
  | "handoff"

/** Synara-style provider handoff — new agent continues with packed context. */
export interface HandoffMeta {
  from: string
  to: string
  /** Compressed context the receiving agent needs to continue the thread. */
  contextPack: string
  /** Optional adapter/model switch (e.g. claude → copilot). */
  adapter?: string
  model?: string
}

export interface LoungeMeta {
  /** Direct recipients — they get notified even without @ in text. */
  to?: string[]
  /** Parsed @mentions from text. */
  mentions?: string[]
  /** Squad-wide mentions (@squad:checkout-build) — fan-out to squad members. */
  squadMentions?: string[]
  /** Block mentions (@block:cs-blk_…) — resolved to agentId by the UI layer. */
  blockMentions?: string[]
  /** Group mentions (@group:cs-grp_…). */
  groupMentions?: string[]
  /** Message id this replies to (ack / thread). */
  replyTo?: number
  /** Conversation thread — parallel threads share one mission channel. */
  threadId?: string
  /** Synara-style handoff between providers/agents. */
  handoff?: HandoffMeta
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

/** Overclock-style metering extracted from CLI output (when available). */
export interface AgentUsage {
  costUsd?: number
  tokensIn?: number
  tokensOut?: number
}

export interface AgentEvent {
  agentId: string
  type: AgentEventType
  text?: string
  error?: string
  usage?: AgentUsage
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
