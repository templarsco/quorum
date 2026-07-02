import { expect, test } from "vitest"
import { mkdtempSync } from "node:fs"
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
