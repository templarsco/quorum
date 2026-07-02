/**
 * SquadManager — engine-side owner of the squad ↔ group protocol.
 *
 * Posts `squad_spawn` / `squad_update` / `squad_collapse` / `squad_destroy` /
 * `workflow_edge` / `studio_paste` / `mission_fork` on the bus (CodeSurf's
 * adapter consumes them), waits for `squad_ack` event-driven (bus.once — no
 * polling), and persists the authoritative mission registry in
 * `.quorum/missions.json` (missionId / squadId / agentId ↔ groupId / blockId).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { dirname } from "node:path"
import type { Bus } from "../bus/bus"
import type {
  MissionRecord,
  SquadAckMeta,
  SquadAgentSpec,
  SquadEdge,
  SquadRecord,
  SquadSpawnMeta,
  SquadUpdateMeta,
  StudioPasteMeta,
} from "./types"

export class MissionRegistry {
  private missions = new Map<string, MissionRecord>()

  constructor(private path: string) {
    this.load()
  }

  private load(): void {
    if (!existsSync(this.path)) return
    try {
      const raw = JSON.parse(readFileSync(this.path, "utf8")) as { missions?: MissionRecord[] }
      for (const m of raw.missions ?? []) this.missions.set(m.missionId, m)
    } catch {
      // corrupt file — start clean, will be rewritten on next save
    }
  }

  private save(): void {
    const dir = dirname(this.path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(this.path, JSON.stringify({ missions: [...this.missions.values()] }, null, 2) + "\n")
  }

  get(missionId: string): MissionRecord | undefined {
    return this.missions.get(missionId)
  }

  list(): MissionRecord[] {
    return [...this.missions.values()]
  }

  upsertMission(missionId: string, opts?: { title?: string; channel?: string; forkedFrom?: string }): MissionRecord {
    const now = Date.now()
    let m = this.missions.get(missionId)
    if (!m) {
      m = {
        missionId,
        title: opts?.title,
        channel: opts?.channel ?? missionId,
        ...(opts?.forkedFrom ? { forkedFrom: opts.forkedFrom } : {}),
        squads: [],
        createdAt: now,
        updatedAt: now,
      }
      this.missions.set(missionId, m)
    } else {
      if (opts?.title) m.title = opts.title
      if (opts?.channel) m.channel = opts.channel
      m.updatedAt = now
    }
    this.save()
    return m
  }

  upsertSquad(missionId: string, squad: Omit<SquadRecord, "createdAt" | "updatedAt">): SquadRecord {
    const m = this.upsertMission(missionId)
    const now = Date.now()
    const existing = m.squads.find((s) => s.squadId === squad.squadId)
    if (existing) {
      Object.assign(existing, squad, { updatedAt: now })
      this.save()
      return existing
    }
    const rec: SquadRecord = { ...squad, createdAt: now, updatedAt: now }
    m.squads.push(rec)
    m.updatedAt = now
    this.save()
    return rec
  }

  findSquad(squadId: string): { mission: MissionRecord; squad: SquadRecord } | undefined {
    for (const m of this.missions.values()) {
      const s = m.squads.find((x) => x.squadId === squadId)
      if (s) return { mission: m, squad: s }
    }
    return undefined
  }

  /** Resolve blockId → agentId (or agentId → blockId with `byAgent`). */
  resolveBlock(squadId: string, key: string, byAgent = false): string | undefined {
    const found = this.findSquad(squadId)
    if (!found) return undefined
    const ref = found.squad.blocks.find((b) => (byAgent ? b.agentId === key : b.blockId === key))
    return byAgent ? ref?.blockId : ref?.agentId
  }

  touch(squadId: string, mutate: (s: SquadRecord) => void): SquadRecord | undefined {
    const found = this.findSquad(squadId)
    if (!found) return undefined
    mutate(found.squad)
    found.squad.updatedAt = Date.now()
    found.mission.updatedAt = found.squad.updatedAt
    this.save()
    return found.squad
  }
}

export interface SpawnOptions {
  missionId: string
  squadId: string
  title?: string
  agents: SquadAgentSpec[]
  edges?: SquadEdge[]
  layout?: SquadSpawnMeta["layout"]
  position?: SquadSpawnMeta["position"]
  /** Await the CodeSurf squad_ack. Default true; ignored when no UI is attached (set false). */
  waitAck?: boolean
  /** ms before giving up on the ack (only with waitAck). Default 30s. */
  ackTimeoutMs?: number
}

export class SquadManager {
  constructor(
    private bus: Bus,
    public readonly registry: MissionRegistry,
    private channel = "main",
    private author = "piloto",
  ) {}

  /** P1 — post `squad_spawn`; optionally resolve on the CodeSurf `squad_ack`. */
  async spawn(opts: SpawnOptions): Promise<SquadRecord> {
    const meta: SquadSpawnMeta = {
      missionId: opts.missionId,
      squadId: opts.squadId,
      title: opts.title ?? opts.squadId,
      layout: opts.layout ?? "grid",
      ...(opts.position ? { position: opts.position } : {}),
      agents: opts.agents,
      edges: opts.edges ?? [],
    }
    this.registry.upsertMission(opts.missionId, { channel: this.channel })
    this.registry.upsertSquad(opts.missionId, {
      squadId: opts.squadId,
      title: meta.title,
      agents: opts.agents,
      blocks: [],
      edges: meta.edges ?? [],
      status: "spawning",
    })

    // Subscribe BEFORE posting so a synchronous ack (in-process adapter) is not missed.
    const ackPromise =
      opts.waitAck === false
        ? null
        : this.bus.once((m) => m.type === "squad_ack" && (m.meta as SquadAckMeta | undefined)?.squadId === opts.squadId)

    this.bus.post({
      channel: this.channel,
      author: this.author,
      role: "orchestrator",
      lang: "en-us",
      type: "squad_spawn",
      text: `Spawn ${opts.squadId} squad (${opts.agents.length} agents)`,
      meta: meta as unknown as Record<string, unknown>,
    })

    if (!ackPromise) {
      return this.registry.findSquad(opts.squadId)!.squad
    }

    const ack = await withTimeout(ackPromise, opts.ackTimeoutMs ?? 30_000)
    if (!ack) {
      // No UI attached — squad stays "spawning"; reconcile() will link it later.
      return this.registry.findSquad(opts.squadId)!.squad
    }
    return this.applyAck(ack.meta as unknown as SquadAckMeta)
  }

  /** Record a `squad_ack` (also callable directly by an in-process adapter). */
  applyAck(meta: SquadAckMeta): SquadRecord {
    const squad = this.registry.touch(meta.squadId, (s) => {
      s.groupId = meta.groupId
      s.blocks = meta.blocks
      s.status = "active"
    })
    if (!squad) {
      // Ack for an unknown squad (e.g. registry wiped) — recreate the record.
      return this.registry.upsertSquad(meta.missionId, {
        squadId: meta.squadId,
        groupId: meta.groupId,
        agents: [],
        blocks: meta.blocks,
        edges: [],
        status: "active",
      })
    }
    return squad
  }

  /** Post `squad_ack` on behalf of the UI adapter (used by MCP tool / tests). */
  ack(meta: SquadAckMeta): SquadRecord {
    this.bus.post({
      channel: this.channel,
      author: "codesurf",
      role: "system",
      lang: "en-us",
      type: "squad_ack",
      text: `Group created for ${meta.squadId}`,
      meta: meta as unknown as Record<string, unknown>,
    })
    return this.applyAck(meta)
  }

  /** P2 — dynamic scale: add/remove agents and edges inside the existing group. */
  update(meta: SquadUpdateMeta): SquadRecord | undefined {
    const found = this.registry.findSquad(meta.squadId)
    const squad = this.registry.touch(meta.squadId, (s) => {
      if (meta.add?.length) {
        const known = new Set(s.agents.map((a) => a.agentId))
        for (const a of meta.add) if (!known.has(a.agentId)) s.agents.push(a)
      }
      if (meta.remove?.length) {
        const gone = new Set(meta.remove)
        s.agents = s.agents.filter((a) => !gone.has(a.agentId))
        s.blocks = s.blocks.filter((b) => !gone.has(b.agentId))
        s.edges = s.edges.filter((e) => !gone.has(e.from) && !gone.has(e.to))
      }
      if (meta.edges?.length) {
        const key = (e: SquadEdge) => `${e.from}->${e.to}`
        const known = new Set(s.edges.map(key))
        for (const e of meta.edges) if (!known.has(key(e))) s.edges.push(e)
      }
    })
    this.bus.post({
      channel: this.channel,
      author: this.author,
      role: "orchestrator",
      lang: "en-us",
      type: "squad_update",
      text: `Update ${meta.squadId}: +${meta.add?.length ?? 0} -${meta.remove?.length ?? 0}`,
      meta: {
        ...meta,
        missionId: meta.missionId ?? found?.mission.missionId,
        groupId: meta.groupId ?? found?.squad.groupId,
      } as unknown as Record<string, unknown>,
    })
    return squad
  }

  /** P5 — draw dependency arrows without changing membership. */
  workflowEdges(squadId: string, edges: SquadEdge[]): void {
    const found = this.registry.findSquad(squadId)
    this.registry.touch(squadId, (s) => {
      const key = (e: SquadEdge) => `${e.from}->${e.to}`
      const known = new Set(s.edges.map(key))
      for (const e of edges) if (!known.has(key(e))) s.edges.push(e)
    })
    this.bus.post({
      channel: this.channel,
      author: this.author,
      role: "orchestrator",
      lang: "en-us",
      type: "workflow_edge",
      text: edges.map((e) => `${e.from} → ${e.to}`).join(", "),
      meta: { missionId: found?.mission.missionId, squadId, edges } as unknown as Record<string, unknown>,
    })
  }

  /** Collapse group UI; agents may keep running. */
  collapse(squadId: string): void {
    const found = this.registry.findSquad(squadId)
    this.registry.touch(squadId, (s) => {
      s.status = "collapsed"
    })
    this.bus.post({
      channel: this.channel,
      author: this.author,
      role: "orchestrator",
      lang: "en-us",
      type: "squad_collapse",
      text: `Collapse ${squadId}`,
      meta: { missionId: found?.mission.missionId, squadId, groupId: found?.squad.groupId },
    })
  }

  /** Tear down group + stop agents. */
  destroy(squadId: string): void {
    const found = this.registry.findSquad(squadId)
    this.registry.touch(squadId, (s) => {
      s.status = "destroyed"
    })
    this.bus.post({
      channel: this.channel,
      author: this.author,
      role: "orchestrator",
      lang: "en-us",
      type: "squad_destroy",
      text: `Destroy ${squadId}`,
      meta: { missionId: found?.mission.missionId, squadId, groupId: found?.squad.groupId },
    })
  }

  /** P4 — inject text into a terminal block PTY (engine-side message only). */
  studioPaste(meta: StudioPasteMeta, author = "human"): void {
    const resolved = { ...meta }
    if (!resolved.blockId && resolved.agentId) {
      for (const m of this.registry.list()) {
        for (const s of m.squads) {
          const ref = s.blocks.find((b) => b.agentId === resolved.agentId)
          if (ref) resolved.blockId = ref.blockId
        }
      }
    }
    this.bus.post({
      channel: this.channel,
      author,
      role: "human",
      lang: "en-us",
      type: "studio_paste",
      text: meta.text.slice(0, 120),
      meta: resolved as unknown as Record<string, unknown>,
    })
  }

  /**
   * P6 — PR-style mission clone: duplicate every squad of `missionId` under a
   * new mission (Railway "PR environment"). Posts `mission_fork` + one
   * `squad_spawn` per cloned squad; blocks/groupIds are re-acked by the UI.
   */
  async fork(
    missionId: string,
    newMissionId?: string,
    opts?: { waitAck?: boolean; ackTimeoutMs?: number },
  ): Promise<MissionRecord> {
    const src = this.registry.get(missionId)
    if (!src) throw new Error(`mission not found: ${missionId}`)
    const forkId = newMissionId ?? `${missionId}-fork-${Date.now().toString(36)}`
    const fork = this.registry.upsertMission(forkId, {
      title: src.title ? `${src.title} (fork)` : forkId,
      channel: this.channel,
      forkedFrom: missionId,
    })

    this.bus.post({
      channel: this.channel,
      author: this.author,
      role: "orchestrator",
      lang: "en-us",
      type: "mission_fork",
      text: `Fork ${missionId} → ${forkId}`,
      meta: { missionId, forkMissionId: forkId, squads: src.squads.map((s) => s.squadId) },
    })

    for (const squad of src.squads) {
      if (squad.status === "destroyed") continue
      const cloneSquadId = `${squad.squadId}@${forkId}`
      await this.spawn({
        missionId: forkId,
        squadId: cloneSquadId,
        title: squad.title ? `${squad.title} (fork)` : cloneSquadId,
        agents: squad.agents.map((a) => ({ ...a, env: { ...(a.env ?? {}), QUORUM_MISSION_ID: forkId } })),
        edges: squad.edges.map((e) => ({ ...e })),
        waitAck: opts?.waitAck ?? false,
        ackTimeoutMs: opts?.ackTimeoutMs,
      })
    }
    return this.registry.get(forkId) ?? fork
  }

  /**
   * Reconcile after a workspace load: mark squads whose ack never arrived,
   * clear links for squads the UI no longer knows (orphans list from CodeSurf).
   */
  reconcile(knownGroupIds: string[]): { linked: string[]; orphaned: string[] } {
    const known = new Set(knownGroupIds)
    const linked: string[] = []
    const orphaned: string[] = []
    for (const m of this.registry.list()) {
      for (const s of m.squads) {
        if (s.status === "destroyed") continue
        if (s.groupId && known.has(s.groupId)) {
          linked.push(s.squadId)
        } else if (s.groupId) {
          orphaned.push(s.squadId)
          this.registry.touch(s.squadId, (x) => {
            x.groupId = undefined
            x.blocks = []
            x.status = "spawning"
          })
        }
      }
    }
    return { linked, orphaned }
  }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms)
    void p.then((v) => {
      clearTimeout(t)
      resolve(v)
    })
  })
}
