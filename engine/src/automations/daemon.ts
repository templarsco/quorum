#!/usr/bin/env node
/** Quorum automations daemon — tick schedules + optional bus hook. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Bus } from "../bus/bus"
import { ClaudeAdapter } from "../agents/claude"
import { CopilotAdapter } from "../agents/copilot"
import { ClaudeCliLLM } from "../llm/llm"
import { Translator } from "../i18n/translator"
import { MessageStore } from "../store/store"
import { Orchestrator } from "../orchestrator/orchestrator"
import { AutomationRunner } from "./runner"
import { AutomationStore } from "./store"

function workspaceRoot(): string {
  return process.env.QUORUM_WORKSPACE?.trim() || process.cwd()
}

const workspace = workspaceRoot()
const quorumDir = join(workspace, ".quorum")
mkdirSync(quorumDir, { recursive: true })
mkdirSync(join(quorumDir, "automations"), { recursive: true })

const statusPath = join(quorumDir, "daemon-status.json")
const writeStatus = (patch: Record<string, unknown>) => {
  const prev = existsSync(statusPath)
    ? (JSON.parse(readFileSync(statusPath, "utf8")) as Record<string, unknown>)
    : {}
  writeFileSync(statusPath, JSON.stringify({ ...prev, ...patch, ts: Date.now() }, null, 2))
}

const autoDir = join(quorumDir, "automations")
const store = new MessageStore(join(quorumDir, "quorum.db"))
const bus = new Bus(store)
const llm = new ClaudeCliLLM()
const orch = new Orchestrator(bus, llm, new Translator(llm), {
  claude: new ClaudeAdapter(),
  copilot: new CopilotAdapter(),
})
const runner = new AutomationRunner({ store: new AutomationStore(autoDir), bus, orchestrator: orch })

// Bus-triggered automations (e.g. when builder posts [done])
bus.subscribe(
  () => true,
  (m) => {
    runner.onBusMessage({ type: m.type, author: m.author, channel: m.channel, text: m.text }).catch(console.error)
  },
)

console.log(`Quorum automations daemon — ${autoDir}`)
console.log(`  workspace: ${workspace}`)
console.log(`  ${runner.list().length} automation(s) loaded; schedule tick every 60s\n`)

writeStatus({ running: true, pid: process.pid, automations: runner.list().length })

process.on("SIGINT", () => {
  writeStatus({ running: false })
  process.exit(0)
})
process.on("SIGTERM", () => {
  writeStatus({ running: false })
  process.exit(0)
})

setInterval(() => {
  runner.tickSchedules().then((rs) => {
    for (const r of rs) console.log(`[schedule] ${r.automationId}: ${r.status}${r.reason ? ` (${r.reason})` : ""}`)
  })
}, 60_000)

runner.tickSchedules()
