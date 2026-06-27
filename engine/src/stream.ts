import { Bus } from "./bus/bus"
import { MessageStore } from "./store/store"
import { Translator } from "./i18n/translator"
import { ClaudeCliLLM } from "./llm/llm"
import { ClaudeAdapter } from "./agents/claude"
import { CopilotAdapter } from "./agents/copilot"
import { Orchestrator } from "./orchestrator/orchestrator"

// Desktop bridge entry: emits one JSON line per bus message on stdout (for the Tauri
// UI to render the agents live), then a final {type:"__final__"} line. Task comes via argv.
function emit(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + "\n")
}

async function main(): Promise<void> {
  const task = process.argv.slice(2).join(" ").trim()
  if (!task) {
    emit({ type: "__error__", text: "empty task" })
    process.exit(1)
  }

  const store = new MessageStore("quorum.sqlite")
  const bus = new Bus(store)
  const llm = new ClaudeCliLLM()
  const translator = new Translator(llm)
  const adapters = { claude: new ClaudeAdapter(), copilot: new CopilotAdapter() }
  const orch = new Orchestrator(bus, llm, translator, adapters)

  bus.subscribe(
    () => true,
    (m) => emit({ author: m.author, role: m.role, type: m.type ?? "chat", lang: m.lang, text: m.text }),
  )

  try {
    const result = await orch.handleTask(task)
    emit({ type: "__final__", text: result })
    process.exit(0)
  } catch (e) {
    emit({ type: "__error__", text: String(e) })
    process.exit(1)
  }
}

main()
