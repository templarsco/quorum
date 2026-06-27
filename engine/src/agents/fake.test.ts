import { expect, test } from "vitest"
import type { AgentEvent } from "../types"
import { FakeAdapter } from "./fake"

test("FakeAdapter emits progress then done with scripted result", async () => {
  const adapter = new FakeAdapter((p) => `result-for:${p}`)
  const handle = await adapter.spawn({ agentId: "w1", mode: "headless" })
  const events: AgentEvent[] = []
  adapter.onEvent(handle, (e) => events.push(e))
  await adapter.send(handle, "do thing")
  await new Promise((r) => setTimeout(r, 5))
  expect(events.map((e) => e.type)).toEqual(["progress", "done"])
  expect(events[1].text).toBe("result-for:do thing")
})
