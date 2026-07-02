import type { Bus } from "../bus/bus"
import type { HandoffMeta, Lang, LoungeMeta, Message, Role, StoredMessage } from "../types"
import { formatMention, parseAllMentions, parseMentions } from "./mentions"

export type LoungeListener = (msg: StoredMessage, formatted: string) => void

/** Resolves squadId → member agentIds (wire to MissionRegistry when available). */
export type SquadResolver = (squadId: string) => string[]

/** Slack-like layer on the bus — delegate, done, ack, @mentions (Devin-style agent chat). */
export class Lounge {
  private squadResolver?: SquadResolver

  constructor(
    private bus: Bus,
    private channel = "main",
  ) {}

  /** Enable @squad:id fan-out (e.g. `lounge.useSquadResolver(id => registry…)`). */
  useSquadResolver(resolver: SquadResolver): void {
    this.squadResolver = resolver
  }

  /** Free-form chat; @mentions in text are parsed into meta. Supports threads (P3). */
  chat(
    author: string,
    text: string,
    opts?: { role?: Role; lang?: Lang; to?: string[]; threadId?: string },
  ): StoredMessage {
    const parsed = parseAllMentions(text)
    const squadFanout = this.squadResolver
      ? parsed.squads.flatMap((s) => this.squadResolver!(s))
      : []
    const to = [...new Set([...(opts?.to ?? []), ...parsed.agents, ...squadFanout])].filter((a) => a !== author)
    const meta: LoungeMeta & Record<string, unknown> = {}
    if (to.length) meta.to = to
    if (parsed.agents.length) meta.mentions = parsed.agents
    if (parsed.squads.length) meta.squadMentions = parsed.squads
    if (parsed.blocks.length) meta.blockMentions = parsed.blocks
    if (parsed.groups.length) meta.groupMentions = parsed.groups
    if (opts?.threadId) meta.threadId = opts.threadId
    return this.post({
      author,
      role: opts?.role ?? "worker",
      lang: opts?.lang ?? "en-us",
      type: "chat",
      text,
      meta: Object.keys(meta).length ? meta : undefined,
    })
  }

  /** Piloto/orchestrator assigns work to a worker — target is notified. */
  delegate(from: string, to: string, task: string, opts?: { lang?: Lang; role?: Role; threadId?: string }): StoredMessage {
    const text = `${formatMention(to)} ${from} delegated: ${task}`
    return this.post({
      author: from,
      role: opts?.role ?? "orchestrator",
      lang: opts?.lang ?? "en-us",
      type: "delegate",
      text,
      meta: {
        to: [to],
        mentions: [to],
        task,
        summary: task.slice(0, 200),
        ...(opts?.threadId ? { threadId: opts.threadId } : {}),
      },
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
    if (meta?.handoff?.to === agentId) return true
    // @squad:x fan-out when a resolver is wired
    if (meta?.squadMentions?.length && this.squadResolver) {
      for (const s of meta.squadMentions) if (this.squadResolver(s).includes(agentId)) return true
    }
    // Lounge traffic on the channel is visible to all squad agents when broadcast types
    if (msg.type === "delegate" || msg.type === "done" || msg.type === "ack" || msg.type === "chat") {
      if (meta?.to?.includes(agentId) || meta?.mentions?.includes(agentId)) return true
    }
    return parseMentions(msg.text).includes(agentId)
  }

  /**
   * Synara-style handoff — transfer a thread to another agent (possibly on a
   * different provider) with a packed context so it can continue seamlessly.
   */
  handoff(
    handoffMeta: HandoffMeta,
    opts?: { threadId?: string; lang?: Lang; text?: string },
  ): StoredMessage {
    const { from, to, contextPack } = handoffMeta
    const text =
      opts?.text ?? `${formatMention(to)} handoff from ${from}: continue this thread. Context: ${contextPack.slice(0, 200)}`
    return this.post({
      author: from,
      role: "worker",
      lang: opts?.lang ?? "en-us",
      type: "handoff",
      text,
      meta: {
        to: [to],
        mentions: [to],
        handoff: handoffMeta,
        ...(opts?.threadId ? { threadId: opts.threadId } : {}),
      },
    })
  }

  /** All messages of one thread, in order (thread view). */
  thread(store: { byChannel(c: string): StoredMessage[] }, threadId: string): StoredMessage[] {
    return store.byChannel(this.channel).filter((m) => (m.meta as LoungeMeta | undefined)?.threadId === threadId)
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
