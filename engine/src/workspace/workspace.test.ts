import { expect, test } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { WorkspaceStore } from "./store"
import { defaultStartupRoster } from "./types"

test("defaultStartupRoster spans claude and copilot areas", () => {
  const r = defaultStartupRoster()
  expect(r.some((s) => s.adapter === "copilot")).toBe(true)
  expect(r.some((s) => s.adapter === "claude")).toBe(true)
  expect(r.find((s) => s.area === "planner")?.agentId).toBe("piloto")
})

test("workspace persists harness checkpoints", () => {
  const dir = mkdtempSync(join(tmpdir(), "quorum-ws-"))
  const store = new WorkspaceStore(dir)
  const ws = store.create({ id: "feat-auth", title: "Add auth", goal: "Ship OAuth login" })
  store.checkpoint(ws, { phaseId: "plan", summary: "Decomposed into 3 todos", state: { todoCount: 3 } })
  const loaded = store.load("feat-auth")
  expect(loaded?.harness.checkpoints).toHaveLength(1)
  rmSync(dir, { recursive: true, force: true })
})
