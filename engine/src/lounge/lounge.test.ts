import { expect, test } from "vitest"
import { Bus } from "../bus/bus"
import { Lounge } from "./lounge"
import { parseMentions } from "./mentions"
import { MessageStore } from "../store/store"

function freshLounge() {
  const bus = new Bus(new MessageStore(":memory:"))
  return { bus, lounge: new Lounge(bus, "main") }
}

test("parseMentions extracts agent ids", () => {
  expect(parseMentions("@builder-1 please review @reviewer-1")).toEqual(["builder-1", "reviewer-1"])
  expect(parseMentions("no mentions")).toEqual([])
})

test("delegate notifies target agent", () => {
  const { lounge } = freshLounge()
  const seen: string[] = []
  lounge.watchAgent("builder-1", (_m, line) => seen.push(line))

  lounge.delegate("piloto", "builder-1", "Fix auth.ts")

  expect(seen).toHaveLength(1)
  expect(seen[0]).toContain("[delegate]")
  expect(seen[0]).toContain("builder-1")
  expect(seen[0]).toContain("Fix auth.ts")
})

test("notifyDone wakes peers and piloto", () => {
  const { lounge } = freshLounge()
  const reviewerInbox: string[] = []
  const builderInbox: string[] = []
  lounge.watchAgent("reviewer-1", (_m, line) => reviewerInbox.push(line))
  lounge.watchAgent("builder-1", (_m, line) => builderInbox.push(line))

  lounge.notifyDone("builder-1", ["piloto", "reviewer-1"], "Rate limiter added")

  expect(reviewerInbox).toHaveLength(1)
  expect(reviewerInbox[0]).toContain("[done]")
  expect(reviewerInbox[0]).toContain("finished")
  expect(builderInbox).toHaveLength(0)
})

test("ack replies to a peer", async () => {
  const { lounge } = freshLounge()
  const done = lounge.notifyDone("builder-1", ["reviewer-1"], "done work")
  const inbox: string[] = []
  lounge.watchAgent("builder-1", (_m, line) => inbox.push(line))

  lounge.ack("reviewer-1", "builder-1", { replyTo: done.id, text: "ok, reviewing your progress now" })

  expect(inbox).toHaveLength(1)
  expect(inbox[0]).toContain("[ack]")
  expect(inbox[0]).toContain("reviewing your progress")
})

test("chat with @mention delivers to target only among workers", () => {
  const { lounge } = freshLounge()
  const a: string[] = []
  const b: string[] = []
  lounge.watchAgent("builder-1", (_m, l) => a.push(l))
  lounge.watchAgent("scout-1", (_m, l) => b.push(l))

  lounge.chat("reviewer-1", "@builder-1 can you show me routes/auth.ts?")

  expect(a).toHaveLength(1)
  expect(b).toHaveLength(0)
})

test("waitFor resolves on next addressed message", async () => {
  const { lounge } = freshLounge()
  const p = lounge.waitFor("copilot-1")
  lounge.delegate("piloto", "copilot-1", "Review diff")
  const msg = await p
  expect(msg.type).toBe("delegate")
  expect(msg.meta?.to).toContain("copilot-1")
})
