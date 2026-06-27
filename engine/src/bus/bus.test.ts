import { expect, test } from "vitest"
import { MessageStore } from "../store/store"
import { Bus } from "./bus"

function freshBus() {
  return new Bus(new MessageStore(":memory:"))
}

test("subscribe receives matching posts and can unsubscribe", () => {
  const bus = freshBus()
  const seen: string[] = []
  const off = bus.subscribe((m) => m.channel === "main", (m) => seen.push(m.text))
  bus.post({ channel: "main", author: "a", role: "worker", lang: "en-us", text: "1" })
  bus.post({ channel: "other", author: "a", role: "worker", lang: "en-us", text: "skip" })
  off()
  bus.post({ channel: "main", author: "a", role: "worker", lang: "en-us", text: "after-off" })
  expect(seen).toEqual(["1"])
})

test("once resolves by event on the next matching post — not by polling", async () => {
  const bus = freshBus()
  let resolved = false
  const p = bus.once((m) => m.type === "result").then((m) => {
    resolved = true
    return m
  })
  // Nothing has been posted yet, so it must still be pending.
  expect(resolved).toBe(false)
  const posted = bus.post({ channel: "main", author: "w1", role: "worker", lang: "en-us", text: "ok", type: "result" })
  const got = await p
  expect(got.id).toBe(posted.id)
  expect(got.text).toBe("ok")
})

test("post persists to the store", () => {
  const store = new MessageStore(":memory:")
  const bus = new Bus(store)
  bus.post({ channel: "main", author: "a", role: "human", lang: "pt-br", text: "oi" })
  expect(store.all().map((m) => m.text)).toEqual(["oi"])
})
