import { expect, test } from "vitest"
import type { Runner } from "../llm/llm"
import type { AgentEvent } from "../types"
import { CopilotAdapter, stripAnsi } from "./copilot"

test("stripAnsi removes escape codes", () => {
  expect(stripAnsi("\x1b[31mred\x1b[0m")).toBe("red")
})

test("CopilotAdapter runs `copilot -p` headless and emits a done event with cleaned stdout", async () => {
  const calls: string[][] = []
  const runner: Runner = async (cmd, args) => {
    calls.push([cmd, ...args])
    return { stdout: "\x1b[32mok\x1b[0m\n", code: 0 }
  }
  const adapter = new CopilotAdapter(runner, "gpt-5.5")
  const handle = await adapter.spawn({ agentId: "c1", mode: "headless" })
  const events: AgentEvent[] = []
  adapter.onEvent(handle, (e) => events.push(e))
  await adapter.send(handle, "do thing")
  expect(events.map((e) => e.type)).toEqual(["started", "done"])
  expect(events[1].text).toBe("ok")
  expect(calls[0]).toContain("-p")
  expect(calls[0]).toContain("do thing")
  expect(calls[0]).toContain("--allow-all-tools")
})

test("CopilotAdapter emits blocked then a converging done when the runner throws", async () => {
  const runner: Runner = async () => {
    throw new Error("copilot missing")
  }
  const adapter = new CopilotAdapter(runner)
  const handle = await adapter.spawn({ agentId: "c2", mode: "headless" })
  const events: AgentEvent[] = []
  adapter.onEvent(handle, (e) => events.push(e))
  await adapter.send(handle, "x")
  expect(events.map((e) => e.type)).toEqual(["started", "blocked", "done"])
  expect(events[1].error).toContain("copilot missing")
  expect(events[2].error).toContain("copilot missing")
})
