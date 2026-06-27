import { expect, test } from "vitest"
import { MessageStore } from "./store"

test("append returns a stored message with id and timestamp", () => {
  const store = new MessageStore(":memory:")
  const m = store.append({ channel: "main", author: "human", role: "human", lang: "pt-br", text: "oi" })
  expect(m.id).toBeGreaterThan(0)
  expect(m.createdAt).toBeGreaterThan(0)
  expect(m.text).toBe("oi")
})

test("byChannel returns messages in insertion order with meta round-tripped", () => {
  const store = new MessageStore(":memory:")
  store.append({ channel: "main", author: "a", role: "worker", lang: "en-us", text: "one", type: "status" })
  store.append({ channel: "other", author: "b", role: "worker", lang: "en-us", text: "x" })
  store.append({ channel: "main", author: "a", role: "worker", lang: "en-us", text: "two", meta: { k: 1 } })
  const main = store.byChannel("main")
  expect(main.map((m) => m.text)).toEqual(["one", "two"])
  expect(main[1].meta).toEqual({ k: 1 })
})
