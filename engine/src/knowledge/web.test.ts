import { expect, test, vi } from "vitest"
import { KnowledgeWeb } from "./web"

test("fetch caches in memory", async () => {
  const kw = new KnowledgeWeb(undefined)
  const html = "<html><body><p>Hello quorum</p></body></html>"
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      text: async () => html,
    }),
  )
  const a = await kw.fetch("https://example.com/doc")
  const b = await kw.fetch("https://example.com/doc")
  expect(a.cached).toBe(false)
  expect(b.cached).toBe(true)
  expect(b.text).toContain("Hello quorum")
  vi.unstubAllGlobals()
})
