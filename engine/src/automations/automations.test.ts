import { expect, test } from "vitest"
import { mkdtempSync, rmSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { Bus } from "../bus/bus"
import { FakeAdapter } from "../agents/fake"
import { FakeLLM } from "../llm/llm"
import { MessageStore } from "../store/store"
import { Translator } from "../i18n/translator"
import { Orchestrator } from "../orchestrator/orchestrator"
import { cronMatches, matchesConditions } from "./cron"
import { AutomationStore } from "./store"
import { AutomationRunner } from "./runner"
import type { Automation } from "./types"

function buildOrch(bus: Bus) {
  const llm = new FakeLLM((prompt) => {
    if (prompt.startsWith("Translate")) return "[x] " + (prompt.split("\n\n")[1] ?? "")
    if (prompt.startsWith("Decompose")) return JSON.stringify({ subtasks: [{ adapter: "fake", prompt: "A" }] })
    if (prompt.startsWith("Consolidate")) return "auto-result"
    return "?"
  })
  return new Orchestrator(bus, llm, new Translator(llm), { fake: new FakeAdapter() })
}

function tempStore() {
  const dir = mkdtempSync(join(tmpdir(), "quorum-auto-"))
  return { store: new AutomationStore(dir), cleanup: () => rmSync(dir, { recursive: true, force: true }) }
}

test("cronMatches every day at 9:00", () => {
  const d = new Date("2026-06-29T09:00:00")
  expect(cronMatches("0 9 * * *", d)).toBe(true)
  expect(cronMatches("0 10 * * *", d)).toBe(false)
})

test("matchesConditions filters payload", () => {
  expect(
    matchesConditions([{ field: "git.event", equals: "ci_failed" }], {
      source: "git",
      at: 0,
      data: { "git.event": "ci_failed" },
    }),
  ).toBe(true)
})

test("start_mission automation runs orchestrator", async () => {
  const { store, cleanup } = tempStore()
  const bus = new Bus(new MessageStore(":memory:"))
  const runner = new AutomationRunner({ store, bus, orchestrator: buildOrch(bus) })
  const auto: Automation = {
    id: "smoke",
    name: "Smoke",
    enabled: true,
    trigger: { type: "manual" },
    action: { type: "start_mission", prompt: "Run smoke tests" },
  }
  store.save(auto)
  const result = await runner.run("smoke")
  expect(result.status).toBe("success")
  expect(result.output).toContain("auto-result")
  cleanup()
})

test("bus trigger fires on done message", async () => {
  const { store, cleanup } = tempStore()
  const bus = new Bus(new MessageStore(":memory:"))
  const runner = new AutomationRunner({ store, bus, orchestrator: buildOrch(bus) })
  store.save({
    id: "on-done",
    name: "Review on done",
    enabled: true,
    trigger: { type: "bus", when: { type: "done" } },
    action: { type: "message_squad", text: "Auto: please review", to: ["reviewer-1"] },
  })
  const results = await runner.onBusMessage({ type: "done", author: "builder-1", channel: "main", text: "finished" })
  expect(results).toHaveLength(1)
  expect(results[0].status).toBe("success")
  cleanup()
})

test("git ci_failed trigger dispatches", async () => {
  const { store, cleanup } = tempStore()
  const bus = new Bus(new MessageStore(":memory:"))
  const runner = new AutomationRunner({ store, bus, orchestrator: buildOrch(bus) })
  store.save({
    id: "fix-ci",
    name: "Fix CI",
    enabled: true,
    trigger: { type: "git", event: "ci_failed", repos: ["my-org/app"] },
    action: { type: "start_mission", prompt: "Fix the failing CI check" },
  })
  const results = await runner.onGitEvent("ci_failed", { repo: "my-org/app", branch: "main" })
  expect(results).toHaveLength(1)
  expect(results[0].status).toBe("success")
  cleanup()
})
