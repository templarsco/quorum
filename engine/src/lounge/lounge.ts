import type { Bus } from "../bus/bus"
import type { Lang, LoungeMeta, Message, Role, StoredMessage } from "../types"
import { formatMention, parseMentions } from "./mentions"

export type LoungeListener = (msg: StoredMessage, formatted: string) => void

/** Slack-like layer on the bus — delegate, done, ack, @mentions (Devin-style agent chat). */
export class Lounge {
  constructor(
    private bus: Bus,
    private channel = "main",
  ) {}

  /** Free-form chat; @mentions in text are parsed into meta. */
  chat(author: string, text: string, opts?: { role?: Role; lang?: Lang; to?: string[] }): StoredMessage {
    const mentions = parseMentions(text)
    const to = [...new Set([...(opts?.to ?? []), ...mentions])]
    return this.post({
      author,
      role: opts?.role ?? "worker",
      lang: opts?.lang ?? "en-us",
      type: "chat",
      text,
      meta: to.length ? { to, mentions } : mentions.length ? { mentions } : undefined,
    })
  }

  /** Piloto/orchestrator assigns work to a worker — target is notified. */
  delegate(from: string, to: string, task: string, opts?: { lang?: Lang; role?: Role }): StoredMessage {
    const text = `${formatMention(to)} ${from} delegated: ${task}`
    return this.post({
      author: from,
      role: opts?.role ?? "orchestrator",
      lang: opts?.lang ?? "en-us",
      type: "delegate",
      text,
      meta: { to: [to], mentions: [to], task, summary: task.slice(0, 200) },
    })
  }

  /** Worker finished — peers get notified (e.g. reviewer, piloto). */
  notifyDone(from: string, peers: string[], summary: string, opts?: { lang?: Lang }): StoredMessage {
    const unique = [...new Set(peers.filter((p) => p !== from))]
    const mentionLine = unique.map(formatMention).join(" ")
    const text = `${mentionLine} ${from} finished: ${summary}`
    return this.post({
      author: from,
      role: "worker",
      lang: opts?.lang ?? "en-us",
      type: "done",
      text,
      meta: { to: unique, mentions: unique, summary: summary.slice(0, 500) },
    })
  }

  /** "Ok, I'm reviewing your progress" — ack tied to a prior message. */
  ack(from: string, to: string, opts?: { replyTo?: number; text?: string; lang?: Lang }): StoredMessage {
    const body = opts?.text ?? "ok, reviewing your progress now"
    const text = `${formatMention(to)} ${from}: ${body}`
    return this.post({
      author: from,
      role: "worker",
      lang: opts?.lang ?? "en-us",
      type: "ack",
      text,
      meta: { to: [to], mentions: [to], replyTo: opts?.replyTo },
    })
  }

  /** Whether this message should wake / display for `agentId`. */
  isForAgent(msg: StoredMessage, agentId: string): boolean {
    if (msg.author === agentId) return false
    const meta = msg.meta as LoungeMeta | undefined
    if (meta?.to?.includes(agentId)) return true
    if (meta?.mentions?.includes(agentId)) return true
    // Lounge traffic on the channel is visible to all squad agents when broadcast types
    if (msg.type === "delegate" || msg.type === "done" || msg.type === "ack" || msg.type === "chat") {
      if (meta?.to?.includes(agentId) || meta?.mentions?.includes(agentId)) return true
    }
    return parseMentions(msg.text).includes(agentId)
  }

  /** Human/terminal-friendly one-liner (mission room feed). */
  format(msg: StoredMessage): string {
    const tag = msg.type && msg.type !== "chat" ? `[${msg.type}] ` : ""
    return `${tag}${msg.author}: ${msg.text}`
  }

  /** Subscribe to messages relevant to one agent (event-driven inbox). */
  watchAgent(agentId: string, cb: LoungeListener): () => void {
    return this.bus.subscribe(
      (m) => m.channel === this.channel && this.isForAgent(m, agentId),
      (m) => cb(m, this.format(m)),
    )
  }

  /** Wait until the next lounge message addressed to this agent. */
  waitFor(agentId: string): Promise<StoredMessage> {
    return this.bus.once((m) => m.channel === this.channel && this.isForAgent(m, agentId))
  }

  private post(partial: Omit<Message, "channel">): StoredMessage {
    return this.bus.post({ channel: this.channel, ...partial })
  }
}
