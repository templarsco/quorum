import { expect, test } from "vitest"
import { injectClaudeEffort, planEffort, scoreComplexity } from "./router"

test("ultracode for large migration tasks", () => {
  const p = planEffort("Migrate entire codebase to new auth — audit all 500 files in monorepo")
  expect(p.mode).toBe("ultracode")
  expect(p.spawnWorkflow).toBe(true)
  expect(p.claudePrefix).toBe("ultracode:")
})

test("ultrathink for architecture without full sweep", () => {
  const p = planEffort("Design the architecture for legacy payment refactor ultrathink")
  expect(["ultrathink", "ultracode"]).toContain(p.mode)
  expect(p.usePlanMode).toBe(true)
})

test("low effort for tiny tasks", () => {
  const p = planEffort("Fix typo in README")
  expect(p.score).toBeLessThan(30)
  expect(p.mode).toBe("low")
})

test("injectClaudeEffort appends ultrathink", () => {
  const p = planEffort("Optimize database queries for performance")
  if (p.claudePrefix === "ultrathink") {
    expect(injectClaudeEffort("Analyze indexes", p)).toContain("ultrathink")
  }
})

test("gstack skills suggested for review tasks", () => {
  const p = planEffort("Review this PR and ship to production")
  expect(p.gstackSkills.some((s) => s.includes("review") || s.includes("ship"))).toBe(true)
})

test("scoreComplexity bounded 0-100", () => {
  expect(scoreComplexity("x")).toBeGreaterThanOrEqual(0)
  expect(scoreComplexity("x".repeat(5000))).toBeLessThanOrEqual(100)
})
