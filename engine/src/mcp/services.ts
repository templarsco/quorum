import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Bus } from "../bus/bus"
import { Lounge } from "../lounge/lounge"
import { planEffort, type EffortMode, type EffortPlan } from "../effort/router"
import { KnowledgeWeb } from "../knowledge/web"
import { MessageStore } from "../store/store"
import type { StoredMessage } from "../types"

export interface QuorumServices {
  bus: Bus
  store: MessageStore
  lounge: Lounge
  channel: string
  workspaceRoot: string
  knowledge: KnowledgeWeb
  cursors: InboxCursor
}

export class InboxCursor {
  constructor(private dir: string) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }

  get(agentId: string): number {
    try {
      return parseInt(readFileSync(join(this.dir, `${agentId}.txt`), "utf8"), 10) || 0
    } catch {
      return 0
    }
  }

  set(agentId: string, id: number): void {
    writeFileSync(join(this.dir, `${agentId}.txt`), String(id))
  }
}

export function createServices(workspaceRoot: string, channel = "main"): QuorumServices {
  const quorumDir = join(workspaceRoot, ".quorum")
  if (!existsSync(quorumDir)) mkdirSync(quorumDir, { recursive: true })
  const store = new MessageStore(join(quorumDir, "quorum.db"))
  const bus = new Bus(store)
  const lounge = new Lounge(bus, channel)
  const knowledge = new KnowledgeWeb(join(quorumDir, "cache", "web"))
  const cursors = new InboxCursor(join(quorumDir, "cursors"))
  return { bus, store, lounge, channel, workspaceRoot, knowledge, cursors }
}

export function inboxForAgent(svc: QuorumServices, agentId: string): { messages: StoredMessage[]; formatted: string[] } {
  const since = svc.cursors.get(agentId)
  const all = svc.store.byChannel(svc.channel).filter((m) => m.id > since)
  const messages = all.filter((m) => svc.lounge.isForAgent(m, agentId))
  const lastId = all.length ? all[all.length - 1].id : since
  if (all.length) svc.cursors.set(agentId, lastId)
  return { messages, formatted: messages.map((m) => svc.lounge.format(m)) }
}

export function effortForTask(task: string, forceMode?: EffortMode): EffortPlan {
  return planEffort(task, forceMode ? { forceMode } : undefined)
}
