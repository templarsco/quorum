import { expect, test } from "vitest"
import { mapClaudeLine } from "./claude"

test("assistant lines map to progress events", () => {
  const line = JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "thinking" }] } })
  expect(mapClaudeLine(line)).toEqual({ type: "progress", text: "thinking" })
})

test("result line maps to a done event", () => {
  const line = JSON.stringify({ type: "result", result: "the final answer", is_error: false })
  expect(mapClaudeLine(line)).toEqual({ type: "done", text: "the final answer", error: undefined })
})

test("error result carries the error", () => {
  const line = JSON.stringify({ type: "result", result: "boom", is_error: true })
  expect(mapClaudeLine(line)).toEqual({ type: "done", text: "boom", error: "boom" })
})

test("non-JSON and irrelevant lines are ignored", () => {
  expect(mapClaudeLine("not json")).toBeNull()
  expect(mapClaudeLine(JSON.stringify({ type: "system", subtype: "init" }))).toBeNull()
})
