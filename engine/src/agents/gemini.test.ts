import { expect, test } from "vitest"
import type { Runner } from "../llm/llm"
import type { AgentEvent } from "../types"
import { GeminiAdapter, mapGeminiOutput } from "./gemini"

test("mapGeminiOutput parses JSON response with token stats", () => {
  const out = mapGeminiOutput(
    JSON.stringify({
      response: "Quorum",
      stats: { models: { "gemini-2.5-pro": { tokens: { prompt: 100, candidates: 12 } } } },
    }),
  )
  expect(out.type).toBe("done")
  expect(out.text).toBe("Quorum")
  expect(out.usage).toEqual({ tokensIn: 100, tokensOut: 12 })
})

test("mapGeminiOutput falls back to plain text and maps errors", () => {
  expect(mapGeminiOutput("plain answer\n")).toEqual({ type: "done", text: "plain answer" })
  expect(mapGeminiOutput(JSON.stringify({ error: { message: "quota" } }))).toEqual({ type: "blocked", error: "quota" })
})

test("GeminiAdapter runs headless via runner and emits done", async () => {
  const calls: string[][] = []
  const runner: Runner = async (cmd, args) => {
    calls.push([cmd, ...args])
    return { stdout: JSON.stringify({ response: "ok" }), code: 0 }
  }
  const adapter = new GeminiAdapter(runner, "gemini-2.5-pro")
  const handle = await adapter.spawn({ agentId: "g1", mode: "headless" })
  const events: AgentEvent[] = []
  adapter.onEvent(handle, (e) => events.push(e))
  await adapter.send(handle, "do thing")
  expect(events.map((e) => e.type)).toEqual(["started", "done"])
  expect(events[1].text).toBe("ok")
  expect(calls[0][0]).toBe("gemini")
  expect(calls[0]).toContain("--output-format")
  expect(calls[0]).toContain("-m")
})

test("GeminiAdapter converges with blocked + done when the CLI is missing", async () => {
  const runner: Runner = async () => {
    throw new Error("gemini not found")
  }
  const adapter = new GeminiAdapter(runner)
  const handle = await adapter.spawn({ agentId: "g2", mode: "headless" })
  const events: AgentEvent[] = []
  adapter.onEvent(handle, (e) => events.push(e))
  await adapter.send(handle, "x")
  expect(events.map((e) => e.type)).toEqual(["started", "blocked", "done"])
})
