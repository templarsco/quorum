import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { Bus } from "../bus/bus"
import { MessageStore } from "../store/store"
import type { StoredMessage } from "../types"
import { MissionRegistry, SquadManager } from "./manager"
import { agentFromRole, defaultSquadAgents, ROLE_TEMPLATES } from "./templates"
import type { SquadAckMeta, SquadSpawnMeta, SquadUpdateMeta } from "./types"

let dir: string
let store: MessageStore
let bus: Bus
let registry: MissionRegistry
let mgr: SquadManager

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "quorum-squad-"))
  store = new MessageStore(join(dir, "quorum.db"))
  bus = new Bus(store)
  registry = new MissionRegistry(join(dir, "missions.json"))
  mgr = new SquadManager(bus, registry, "main")
})

afterEach(() => {
  store.close()
  rmSync(dir, { recursive: true, force: true })
})

describe("role templates (P2)", () => {
  it("materializes agents from templates with model diversity", () => {
    const b = agentFromRole("builder", 3)
    expect(b.agentId).toBe("builder-3")
    expect(b.adapter).toBe("copilot")
    expect(b.model).toBe("gpt-5.5")
    expect(b.env?.QUORUM_AGENT_ID).toBe("builder-3")

    const p = agentFromRole("orchestrator", undefined, { agentId: "piloto" })
    expect(p.blockType).toBe("chat")
    expect(p.pinned).toBe(true)
    expect(p.adapter).toBe("claude")
  })

  it("default squad has piloto + scout + builders + reviewer + executor", () => {
    const agents = defaultSquadAgents({ builders: 2 })
    const ids = agents.map((a) => a.agentId)
    expect(ids).toEqual(["piloto", "scout-1", "builder-1", "builder-2", "reviewer-1", "executor-1"])
    // model diversity: at least 2 distinct adapters
    expect(new Set(agents.map((a) => a.adapter)).size).toBeGreaterThanOrEqual(2)
  })

  it("overrides win over template", () => {
    const s = agentFromRole("scout", 1, { model: "claude-opus-4-8", blockType: "browser" })
    expect(s.model).toBe("claude-opus-4-8")
    expect(s.blockType).toBe("browser")
    expect(ROLE_TEMPLATES.scout.model).toBe("claude-haiku-4-5")
  })
})

describe("squad_spawn / squad_ack (P1)", () => {
  it("posts squad_spawn and resolves on ack (event-driven)", async () => {
    const seen: StoredMessage[] = []
    bus.subscribe((m) => m.type === "squad_spawn", (m) => {
      seen.push(m)
      // Simulate the CodeSurf adapter acking synchronously from the bus event.
      const meta = m.meta as unknown as SquadSpawnMeta
      mgr.ack({
        missionId: meta.missionId,
        squadId: meta.squadId,
        groupId: "cs-grp_123",
        blocks: meta.agents.map((a, i) => ({ agentId: a.agentId, blockId: `cs-blk_${i}`, blockType: a.blockType })),
      })
    })

    const squad = await mgr.spawn({
      missionId: "liga-o-checkout",
      squadId: "checkout-build",
      agents: defaultSquadAgents({ builders: 1 }),
      edges: [{ from: "scout-1", to: "builder-1" }],
    })

    expect(seen).toHaveLength(1)
    expect(squad.status).toBe("active")
    expect(squad.groupId).toBe("cs-grp_123")
    expect(squad.blocks.length).toBe(5)
    // registry persisted
    const onDisk = JSON.parse(readFileSync(join(dir, "missions.json"), "utf8"))
    expect(onDisk.missions[0].missionId).toBe("liga-o-checkout")
    expect(onDisk.missions[0].squads[0].groupId).toBe("cs-grp_123")
  })

  it("spawn without UI (waitAck false) stays spawning and links on later ack", async () => {
    const squad = await mgr.spawn({
      missionId: "m1",
      squadId: "s1",
      agents: [agentFromRole("builder", 1)],
      waitAck: false,
    })
    expect(squad.status).toBe("spawning")

    const ack: SquadAckMeta = {
      missionId: "m1",
      squadId: "s1",
      groupId: "cs-grp_9",
      blocks: [{ agentId: "builder-1", blockId: "cs-blk_9", blockType: "terminal" }],
    }
    const linked = mgr.applyAck(ack)
    expect(linked.status).toBe("active")
    expect(registry.resolveBlock("s1", "cs-blk_9")).toBe("builder-1")
    expect(registry.resolveBlock("s1", "builder-1", true)).toBe("cs-blk_9")
  })

  it("registry survives reload from disk", async () => {
    await mgr.spawn({ missionId: "m1", squadId: "s1", agents: [agentFromRole("scout", 1)], waitAck: false })
    const registry2 = new MissionRegistry(join(dir, "missions.json"))
    expect(registry2.get("m1")?.squads[0].squadId).toBe("s1")
  })
})

describe("squad_update (P2)", () => {
  it("adds/removes agents and edges, posts update with groupId", async () => {
    await mgr.spawn({ missionId: "m1", squadId: "s1", agents: defaultSquadAgents({ builders: 2 }), waitAck: false })
    mgr.applyAck({
      missionId: "m1",
      squadId: "s1",
      groupId: "cs-grp_1",
      blocks: [{ agentId: "builder-2", blockId: "cs-blk_b2", blockType: "terminal" }],
    })

    const posted: StoredMessage[] = []
    bus.subscribe((m) => m.type === "squad_update", (m) => posted.push(m))

    const squad = mgr.update({
      squadId: "s1",
      add: [agentFromRole("builder", 3)],
      remove: ["builder-2"],
      edges: [{ from: "builder-3", to: "reviewer-1" }],
    })!

    expect(squad.agents.some((a) => a.agentId === "builder-3")).toBe(true)
    expect(squad.agents.some((a) => a.agentId === "builder-2")).toBe(false)
    expect(squad.blocks.some((b) => b.agentId === "builder-2")).toBe(false)
    expect(squad.edges).toContainEqual({ from: "builder-3", to: "reviewer-1" })

    const meta = posted[0].meta as unknown as SquadUpdateMeta
    expect(meta.groupId).toBe("cs-grp_1")
    expect(meta.missionId).toBe("m1")
  })

  it("scales 1 → N without duplicating existing ids", async () => {
    await mgr.spawn({ missionId: "m1", squadId: "s1", agents: [agentFromRole("builder", 1)], waitAck: false })
    const add = Array.from({ length: 24 }, (_, i) => agentFromRole("builder", i + 2))
    const squad = mgr.update({ squadId: "s1", add: [...add, agentFromRole("builder", 1)] })!
    expect(squad.agents.length).toBe(25)
  })
})

describe("collapse / destroy / workflow_edge / studio_paste (P4/P5)", () => {
  it("collapse and destroy update status and post messages", async () => {
    await mgr.spawn({ missionId: "m1", squadId: "s1", agents: [agentFromRole("scout", 1)], waitAck: false })
    mgr.collapse("s1")
    expect(registry.findSquad("s1")!.squad.status).toBe("collapsed")
    mgr.destroy("s1")
    expect(registry.findSquad("s1")!.squad.status).toBe("destroyed")
    const types = store.byChannel("main").map((m) => m.type)
    expect(types).toContain("squad_collapse")
    expect(types).toContain("squad_destroy")
  })

  it("workflowEdges posts and persists directed edges", async () => {
    await mgr.spawn({
      missionId: "m1",
      squadId: "s1",
      agents: [agentFromRole("scout", 1), agentFromRole("builder", 1)],
      waitAck: false,
    })
    mgr.workflowEdges("s1", [{ from: "scout-1", to: "builder-1", kind: "context" }])
    const squad = registry.findSquad("s1")!.squad
    expect(squad.edges).toContainEqual({ from: "scout-1", to: "builder-1", kind: "context" })
    expect(store.byChannel("main").some((m) => m.type === "workflow_edge")).toBe(true)
  })

  it("studioPaste resolves agentId → blockId from the registry", async () => {
    await mgr.spawn({ missionId: "m1", squadId: "s1", agents: [agentFromRole("builder", 1)], waitAck: false })
    mgr.applyAck({
      missionId: "m1",
      squadId: "s1",
      groupId: "g1",
      blocks: [{ agentId: "builder-1", blockId: "cs-blk_term_a1", blockType: "terminal" }],
    })
    mgr.studioPaste({ agentId: "builder-1", text: "npm test -- auth", submit: true })
    const msg = store.byChannel("main").find((m) => m.type === "studio_paste")!
    expect((msg.meta as any).blockId).toBe("cs-blk_term_a1")
    expect((msg.meta as any).submit).toBe(true)
  })
})

describe("mission_fork (P6)", () => {
  it("clones all live squads under a new mission", async () => {
    await mgr.spawn({ missionId: "m1", squadId: "s1", agents: defaultSquadAgents({ builders: 1 }), waitAck: false })
    await mgr.spawn({ missionId: "m1", squadId: "s2", agents: [agentFromRole("scout", 1)], waitAck: false })
    mgr.destroy("s2") // destroyed squads are not cloned

    const fork = await mgr.fork("m1", "m1-pr-7")
    expect(fork.forkedFrom).toBe("m1")
    expect(fork.squads.map((s) => s.squadId)).toEqual(["s1@m1-pr-7"])
    expect(fork.squads[0].agents.length).toBe(5)
    expect(fork.squads[0].agents[0].env?.QUORUM_MISSION_ID).toBe("m1-pr-7")

    const types = store.byChannel("main").map((m) => m.type)
    expect(types).toContain("mission_fork")
    expect(types.filter((t) => t === "squad_spawn").length).toBe(3) // s1, s2, clone
  })

  it("fork of unknown mission throws", async () => {
    await expect(mgr.fork("nope")).rejects.toThrow(/mission not found/)
  })
})

describe("reconcile", () => {
  it("keeps known groups linked and orphans stale ones", async () => {
    await mgr.spawn({ missionId: "m1", squadId: "s1", agents: [agentFromRole("builder", 1)], waitAck: false })
    await mgr.spawn({ missionId: "m1", squadId: "s2", agents: [agentFromRole("scout", 1)], waitAck: false })
    mgr.applyAck({ missionId: "m1", squadId: "s1", groupId: "g-live", blocks: [] })
    mgr.applyAck({ missionId: "m1", squadId: "s2", groupId: "g-gone", blocks: [] })

    const { linked, orphaned } = mgr.reconcile(["g-live"])
    expect(linked).toEqual(["s1"])
    expect(orphaned).toEqual(["s2"])
    expect(registry.findSquad("s2")!.squad.status).toBe("spawning")
    expect(registry.findSquad("s2")!.squad.groupId).toBeUndefined()
  })
})
