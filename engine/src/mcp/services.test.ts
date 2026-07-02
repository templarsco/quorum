import { expect, test } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createServices, inboxForAgent } from "./services"

test("quorum_inbox delivers delegate to target agent", () => {
  const dir = mkdtempSync(join(tmpdir(), "quorum-mcp-"))
  const svc = createServices(dir)
  svc.lounge.delegate("piloto", "builder-1", "Fix auth.ts")
  const inbox = inboxForAgent(svc, "builder-1")
  expect(inbox.messages.length).toBe(1)
  expect(inbox.messages[0].type).toBe("delegate")
  const again = inboxForAgent(svc, "builder-1")
  expect(again.messages.length).toBe(0)
})

test("quorum_inbox skips own messages", () => {
  const dir = mkdtempSync(join(tmpdir(), "quorum-mcp-"))
  const svc = createServices(dir)
  svc.lounge.chat("builder-1", "working...")
  const inbox = inboxForAgent(svc, "builder-1")
  expect(inbox.messages.length).toBe(0)
})

test("services wire squad manager + mission registry into .quorum", async () => {
  const dir = mkdtempSync(join(tmpdir(), "quorum-mcp-"))
  const svc = createServices(dir)
  const squad = await svc.squads.spawn({
    missionId: "m1",
    squadId: "s1",
    agents: [{ agentId: "builder-1", role: "builder", adapter: "copilot", blockType: "terminal" }],
    waitAck: false,
  })
  expect(squad.status).toBe("spawning")
  expect(svc.missions.get("m1")?.squads[0].squadId).toBe("s1")
  // squad_spawn landed on the shared bus/store
  expect(svc.store.byChannel(svc.channel).some((m) => m.type === "squad_spawn")).toBe(true)
})
