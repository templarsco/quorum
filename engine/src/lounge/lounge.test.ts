import { expect, test } from "vitest"
import { Bus } from "../bus/bus"
import { Lounge } from "./lounge"
import { parseAllMentions, parseMentions } from "./mentions"
import { MessageStore } from "../store/store"

function freshLounge() {
  const store = new MessageStore(":memory:")
  const bus = new Bus(store)
  return { store, bus, lounge: new Lounge(bus, "main") }
}

test("parseMentions extracts agent ids", () => {
  expect(parseMentions("@builder-1 please review @reviewer-1")).toEqual(["builder-1", "reviewer-1"])
  expect(parseMentions("no mentions")).toEqual([])
})

test("parseAllMentions handles squad/block/group grammar (P3)", () => {
  const p = parseAllMentions("@builder-1 check @squad:checkout-build then @block:cs-blk_a1 and @group:cs-grp_9")
  expect(p.agents).toEqual(["builder-1"])
  expect(p.squads).toEqual(["checkout-build"])
  expect(p.blocks).toEqual(["cs-blk_a1"])
  expect(p.groups).toEqual(["cs-grp_9"])
  // scoped tokens are NOT agent mentions
  expect(parseMentions("@squad:checkout-build status?")).toEqual([])
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

test("@squad:id fans out to members via resolver (P3)", () => {
  const { lounge } = freshLounge()
  lounge.useSquadResolver((id) => (id === "checkout-build" ? ["builder-1", "reviewer-1"] : []))
  const b: string[] = []
  const r: string[] = []
  const other: string[] = []
  lounge.watchAgent("builder-1", (_m, l) => b.push(l))
  lounge.watchAgent("reviewer-1", (_m, l) => r.push(l))
  lounge.watchAgent("scout-9", (_m, l) => other.push(l))

  lounge.chat("piloto", "@squad:checkout-build status report please")

  expect(b).toHaveLength(1)
  expect(r).toHaveLength(1)
  expect(other).toHaveLength(0)
})

test("threads group messages; thread() returns them in order (P3)", () => {
  const { store, lounge } = freshLounge()
  lounge.chat("piloto", "kickoff", { threadId: "t-1" })
  lounge.chat("builder-1", "on it", { threadId: "t-1" })
  lounge.chat("scout-1", "unrelated", { threadId: "t-2" })
  lounge.delegate("piloto", "builder-1", "next step", { threadId: "t-1" })

  const t1 = lounge.thread(store, "t-1")
  expect(t1.map((m) => m.author)).toEqual(["piloto", "builder-1", "piloto"])
  expect(lounge.thread(store, "t-2")).toHaveLength(1)
})

test("handoff carries contextPack and wakes the receiving agent (P3 Synara)", () => {
  const { lounge } = freshLounge()
  const inbox: string[] = []
  lounge.watchAgent("copilot-1", (_m, l) => inbox.push(l))

  const msg = lounge.handoff(
    { from: "claude-1", to: "copilot-1", contextPack: "auth.ts refactored; tests failing on rate limit", adapter: "copilot", model: "gpt-5.5" },
    { threadId: "t-9" },
  )

  expect(msg.type).toBe("handoff")
  expect(msg.meta?.handoff?.contextPack).toContain("rate limit")
  expect(msg.meta?.threadId).toBe("t-9")
  expect(inbox).toHaveLength(1)
  expect(inbox[0]).toContain("[handoff]")
})
