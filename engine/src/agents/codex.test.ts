import { expect, test } from "vitest"
import { mapCodexLine } from "./codex"

test("maps item.completed agent_message to progress", () => {
  const ev = mapCodexLine(JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Quorum" } }))
  expect(ev).toEqual({ type: "progress", text: "Quorum" })
})

test("maps turn.completed to done with usage tokens", () => {
  const ev = mapCodexLine(
    JSON.stringify({ type: "turn.completed", usage: { input_tokens: 4142, cached_input_tokens: 0, output_tokens: 9 } }),
  )
  expect(ev?.type).toBe("done")
  expect(ev?.usage).toEqual({ tokensIn: 4142, tokensOut: 9 })
})

test("maps turn.failed and error events to blocked", () => {
  expect(mapCodexLine(JSON.stringify({ type: "turn.failed", error: { message: "Quota exceeded" } }))).toEqual({
    type: "blocked",
    error: "Quota exceeded",
  })
  expect(mapCodexLine(JSON.stringify({ type: "error", message: "boom" }))).toEqual({ type: "blocked", error: "boom" })
})

test("ignores non-signal lines and garbage", () => {
  expect(mapCodexLine(JSON.stringify({ type: "thread.started", thread_id: "t" }))).toBeNull()
  expect(mapCodexLine(JSON.stringify({ type: "item.completed", item: { type: "command_execution" } }))).toBeNull()
  expect(mapCodexLine("not json")).toBeNull()
})
