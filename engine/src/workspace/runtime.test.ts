import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, expect, test } from "vitest"
import { FakeAdapter } from "../agents/fake"
import { Bus } from "../bus/bus"
import { MessageStore } from "../store/store"
import type { AgentAdapter, AgentEvent, AgentHandle } from "../types"
import { WorkspaceStore } from "./store"
import { Semaphore, sweepSpec, WorkflowRuntime, type WorkflowSpec } from "./runtime"

let dir: string
let store: WorkspaceStore
let bus: Bus
let msgStore: MessageStore

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "quorum-wf-"))
  store = new WorkspaceStore(dir)
  msgStore = new MessageStore(":memory:")
  bus = new Bus(msgStore)
})

afterEach(() => {
  msgStore.close()
  rmSync(dir, { recursive: true, force: true })
})

function runtimeWith(adapters: Record<string, AgentAdapter>) {
  const ws = store.create({ id: "ws1", title: "WS", goal: "test goal" })
  return { ws, rt: new WorkflowRuntime({ bus, adapters, store, workspace: ws }) }
}

const spec: WorkflowSpec = {
  id: "wf1",
  name: "two-phase",
  maxConcurrentAgents: 2,
  phases: [
    {
      id: "ph1",
      name: "research",
      tasks: [
        { agentId: "scout-1", adapter: "fake", prompt: "find A" },
        { agentId: "scout-2", adapter: "fake", prompt: "find B" },
      ],
    },
    {
      id: "ph2",
      name: "build",
      tasks: [{ agentId: "builder-1", adapter: "fake", prompt: "build it" }],
    },
  ],
}

test("runs phases in order, checkpoints each, and completes", async () => {
  const { ws, rt } = runtimeWith({ fake: new FakeAdapter((p) => `ok:${p}`) })
  const result = await rt.run(spec)

  expect(result.status).toBe("completed")
  expect(result.phases.map((p) => p.phaseId)).toEqual(["ph1", "ph2"])
  expect(result.phases[0].results.map((r) => r.text).sort()).toEqual(["ok:find A", "ok:find B"])

  const saved = store.load("ws1")!
  expect(saved.workflow?.status).toBe("completed")
  expect(saved.workflow?.phases.every((p) => p.status === "done")).toBe(true)
  expect(saved.harness.checkpoints.length).toBe(2)
  expect(saved.harness.generation).toBe(1)
  // bus carries workflow_phase lifecycle
  const types = msgStore.all().map((m) => m.type)
  expect(types.filter((t) => t === "workflow_phase").length).toBeGreaterThanOrEqual(4)
  void ws
})

test("a failing agent fails the phase; re-run resumes after the failure is fixed", async () => {
  let failB = true
  const flaky: AgentAdapter = {
    name: "fake",
    async spawn(o): Promise<AgentHandle> {
      return { agentId: o.agentId, adapter: "fake", mode: "headless" }
    },
    onEvent(h, cb) {
      ;(this as any)[`cb_${h.agentId}`] = cb
    },
    async send(h, prompt) {
      const cb = (this as any)[`cb_${h.agentId}`] as (e: AgentEvent) => void
      if (h.agentId === "scout-2" && failB) {
        cb({ agentId: h.agentId, type: "done", text: "boom", error: "quota" })
      } else {
        cb({ agentId: h.agentId, type: "done", text: `ok:${prompt}` })
      }
    },
    async stop() {},
  }

  const { rt } = runtimeWith({ fake: flaky })
  const first = await rt.run(spec)
  expect(first.status).toBe("failed")
  expect(store.load("ws1")!.workflow?.phases[0].status).toBe("failed")
  expect(store.load("ws1")!.workflow?.phases[1].status).toBe("pending")

  // fix the flake — reset failed phase to pending, run again: ph2 executes, ph1 re-runs
  failB = false
  store.load("ws1") // (state persisted)
  const wsReloaded = store.load("ws1")!
  const rt2 = new WorkflowRuntime({ bus, adapters: { fake: flaky }, store, workspace: wsReloaded })
  wsReloaded.workflow!.phases[0].status = "pending"
  const second = await rt2.run(spec)
  expect(second.status).toBe("completed")
  // done phases are never re-run on resume
  expect(second.phases.map((p) => p.phaseId)).toEqual(["ph1", "ph2"])
})

test("semaphore caps concurrent fan-out", async () => {
  let active = 0
  let peak = 0
  const slow: AgentAdapter = {
    name: "fake",
    async spawn(o): Promise<AgentHandle> {
      return { agentId: o.agentId, adapter: "fake", mode: "headless" }
    },
    onEvent(h, cb) {
      ;(this as any)[`cb_${h.agentId}`] = cb
    },
    async send(h) {
      const cb = (this as any)[`cb_${h.agentId}`] as (e: AgentEvent) => void
      active++
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 10))
      active--
      cb({ agentId: h.agentId, type: "done", text: "ok" })
    },
    async stop() {},
  }

  const wide: WorkflowSpec = {
    id: "wf-wide",
    name: "wide",
    maxConcurrentAgents: 3,
    phases: [
      {
        id: "p1",
        name: "fan",
        tasks: Array.from({ length: 10 }, (_, i) => ({ agentId: `a${i}`, adapter: "fake", prompt: "x" })),
      },
    ],
  }
  const { rt } = runtimeWith({ fake: slow })
  const res = await rt.run(wide)
  expect(res.status).toBe("completed")
  expect(peak).toBeLessThanOrEqual(3)
})

test("Semaphore releases are idempotent", async () => {
  const sem = new Semaphore(1)
  const r1 = await sem.acquire()
  r1()
  r1() // double release must not free extra slots
  const r2 = await sem.acquire()
  let acquired3 = false
  const p3 = sem.acquire().then((r) => {
    acquired3 = true
    r()
  })
  await new Promise((r) => setTimeout(r, 5))
  expect(acquired3).toBe(false) // only one slot: r2 still holds it
  r2()
  await p3
  expect(acquired3).toBe(true)
})

test("sweepSpec chunks items into phases with round-robin adapters", () => {
  const s = sweepSpec({
    id: "audit",
    name: "audit",
    items: ["a.ts", "b.ts", "c.ts", "d.ts", "e.ts"],
    promptFor: (f) => `audit ${f}`,
    adapters: ["claude", "copilot"],
    phaseSize: 2,
  })
  expect(s.phases.length).toBe(3)
  expect(s.phases[0].tasks[0]).toMatchObject({ agentId: "sweep-1", adapter: "claude", prompt: "audit a.ts" })
  expect(s.phases[0].tasks[1].adapter).toBe("copilot")
  expect(s.phases[2].tasks[0].agentId).toBe("sweep-5")
})
