import { Bus } from "./bus/bus"
import { MessageStore } from "./store/store"
import { Translator } from "./i18n/translator"
import { ClaudeCliLLM } from "./llm/llm"
import { ClaudeAdapter } from "./agents/claude"
import { CopilotAdapter } from "./agents/copilot"
import { Orchestrator } from "./orchestrator/orchestrator"

async function main() {
  const task = process.argv.slice(2).join(" ").trim()
  if (!task) {
    console.error('Uso: npm run dev -- "sua tarefa em pt-br"')
    process.exit(1)
  }

  const store = new MessageStore("quorum.sqlite")
  const bus = new Bus(store)
  const llm = new ClaudeCliLLM()
  const translator = new Translator(llm)
  const adapters = { claude: new ClaudeAdapter(), copilot: new CopilotAdapter() }
  const orch = new Orchestrator(bus, llm, translator, adapters)

  // Live mirror of the agent bus (raw en-us traffic; translate-on-display happens at the orchestrator).
  bus.subscribe(
    () => true,
    (m) => console.log(`  [${m.author}/${m.type ?? "chat"}] ${m.text.slice(0, 120)}`),
  )

  console.log(`\n> Tarefa: ${task}\n`)
  const result = await orch.handleTask(task)
  console.log(`\n=== Resultado (pt-br) ===\n${result}\n`)
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
