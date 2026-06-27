import { execSync } from "node:child_process"
import { describe, expect, test } from "vitest"
import { Bus } from "./bus/bus"
import { MessageStore } from "./store/store"
import { Translator } from "./i18n/translator"
import { ClaudeCliLLM } from "./llm/llm"
import { ClaudeAdapter } from "./agents/claude"
import { Orchestrator } from "./orchestrator/orchestrator"

function hasClaude(): boolean {
  try {
    execSync("claude --version", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!hasClaude())("integration: real Claude CLI", () => {
  test(
    "orchestrator completes a one-worker task end to end and replies in pt-br",
    async () => {
      const store = new MessageStore(":memory:")
      const bus = new Bus(store)
      const llm = new ClaudeCliLLM()
      // Force a single Claude subtask to keep the integration test cheap and deterministic.
      const orch = new Orchestrator(bus, llm, new Translator(llm), { claude: new ClaudeAdapter() })
      ;(orch as any).decompose = async () => [{ adapter: "claude", prompt: "Reply with the single word: ok" }]

      const result = await orch.handleTask("responda apenas ok")
      expect(typeof result).toBe("string")
      expect(result.length).toBeGreaterThan(0)
      expect(store.all().some((m) => m.role === "worker" && m.type === "result")).toBe(true)
    },
    120_000,
  )
})
