import { expect, test } from "vitest"
import { Bus } from "../bus/bus"
import { FakeLLM } from "../llm/llm"
import { MessageStore } from "../store/store"
import { Translator } from "../i18n/translator"
import { FakeAdapter } from "../agents/fake"
import { Orchestrator } from "./orchestrator"

function buildLLM() {
  return new FakeLLM((prompt) => {
    if (prompt.startsWith("Translate")) {
      const to = prompt.includes(" to pt-br") ? "pt-br" : "en-us"
      const text = prompt.split("\n\n")[1] ?? ""
      return `[${to}] ${text}`
    }
    if (prompt.startsWith("Decompose")) {
      return JSON.stringify({
        subtasks: [
          { adapter: "fake", prompt: "A" },
          { adapter: "fake", prompt: "B" },
        ],
      })
    }
    if (prompt.startsWith("Consolidate")) return "final-answer"
    return "?"
  })
}

test("handleTask delegates to workers and returns a pt-br consolidated result", async () => {
  const store = new MessageStore(":memory:")
  const bus = new Bus(store)
  const llm = buildLLM()
  const orch = new Orchestrator(bus, llm, new Translator(llm), { fake: new FakeAdapter() })

  const result = await orch.handleTask("faça duas coisas")

  expect(result).toBe("[pt-br] final-answer")

  const msgs = store.all()
  // human input persisted in pt-br
  expect(msgs.find((m) => m.role === "human")?.lang).toBe("pt-br")
  // two worker results persisted in en-us
  const workerResults = msgs.filter((m) => m.role === "worker" && m.type === "result")
  expect(workerResults).toHaveLength(2)
  expect(workerResults.every((m) => m.lang === "en-us")).toBe(true)
  // orchestrator's final reply persisted in pt-br
  expect(msgs.find((m) => m.role === "orchestrator" && m.type === "result")?.lang).toBe("pt-br")
})

test("a worker that never completes leaves handleTask pending (proves event-driven wait, no fallback timer)", async () => {
  const store = new MessageStore(":memory:")
  const bus = new Bus(store)
  const llm = new FakeLLM((prompt) => {
    if (prompt.startsWith("Translate")) return "[x] " + (prompt.split("\n\n")[1] ?? "")
    if (prompt.startsWith("Decompose")) return JSON.stringify({ subtasks: [{ adapter: "stuck", prompt: "A" }] })
    if (prompt.startsWith("Consolidate")) return "final"
    return "?"
  })
  // adapter that spawns but never emits done
  const stuck = {
    name: "stuck",
    async spawn(o: any) {
      return { agentId: o.agentId, adapter: "stuck", mode: o.mode }
    },
    onEvent() {},
    async send() {},
    async stop() {},
  }
  const orch = new Orchestrator(bus, llm, new Translator(llm), { stuck } as any)
  const race = await Promise.race([
    orch.handleTask("trava").then(() => "completed"),
    new Promise((r) => setTimeout(() => r("still-pending"), 50)),
  ])
  expect(race).toBe("still-pending")
})
