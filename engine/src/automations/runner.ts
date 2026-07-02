import type { Bus } from "../bus/bus"
import type { Orchestrator } from "../orchestrator/orchestrator"
import { Lounge } from "../lounge/lounge"
import { cronMatches, matchesConditions, withinRateLimit } from "./cron"
import { AutomationStore } from "./store"
import type {
  Automation,
  AutomationAction,
  RunResult,
  TriggerPayload,
  TriggerType,
} from "./types"

export interface AutomationRunnerDeps {
  store: AutomationStore
  orchestrator: Orchestrator
  bus: Bus
  defaultChannel?: string
}

/** Executes Quorum automations (Devin/Cursor-style). */
export class AutomationRunner {
  constructor(private deps: AutomationRunnerDeps) {}

  list(): Automation[] {
    return this.deps.store.list()
  }

  /** Run one automation by id (manual trigger or internal dispatch). */
  async run(id: string, payload?: Partial<TriggerPayload>): Promise<RunResult> {
    const automation = this.deps.store.load(id)
    if (!automation) return { automationId: id, status: "skipped", reason: "not found" }
    if (!automation.enabled) return { automationId: id, status: "skipped", reason: "disabled" }

    const fullPayload: TriggerPayload = {
      source: payload?.source ?? "manual",
      at: payload?.at ?? Date.now(),
      data: payload?.data,
    }

    if (!matchesConditions(automation.conditions, fullPayload)) {
      return { automationId: id, status: "skipped", reason: "conditions not met" }
    }
    if (!withinRateLimit(automation.meta?.lastRunAt, automation.maxRunsPerHour)) {
      return { automationId: id, status: "skipped", reason: "rate limited" }
    }

    try {
      const output = await this.executeAction(automation, fullPayload)
      automation.meta = {
        ...automation.meta,
        lastRunAt: Date.now(),
        lastRunStatus: "success",
        runCount: (automation.meta?.runCount ?? 0) + 1,
      }
      this.deps.store.save(automation)
      return { automationId: id, status: "success", output }
    } catch (e) {
      automation.meta = {
        ...automation.meta,
        lastRunAt: Date.now(),
        lastRunStatus: "failure",
        runCount: (automation.meta?.runCount ?? 0) + 1,
      }
      this.deps.store.save(automation)
      return { automationId: id, status: "failure", reason: e instanceof Error ? e.message : String(e) }
    }
  }

  /** Check schedule triggers and run due automations (call every minute). */
  async tickSchedules(now = new Date()): Promise<RunResult[]> {
    const results: RunResult[] = []
    for (const a of this.deps.store.list()) {
      if (!a.enabled || a.trigger.type !== "schedule") continue
      if (!cronMatches(a.trigger.cron, now)) continue
      // Avoid double-fire same minute
      const last = a.meta?.lastRunAt
      if (last && now.getTime() - last < 55_000) continue
      results.push(
        await this.run(a.id, {
          source: "schedule",
          at: now.getTime(),
          data: { cron: a.trigger.cron },
        }),
      )
    }
    return results
  }

  /** Dispatch git webhook-style events. */
  async onGitEvent(event: string, data: Record<string, unknown>): Promise<RunResult[]> {
    return this.dispatchTrigger("git", { ...data, "git.event": event })
  }

  /** Dispatch incoming webhook payload. */
  async onWebhook(data: Record<string, unknown>): Promise<RunResult[]> {
    return this.dispatchTrigger("webhook", data)
  }

  /** Dispatch when bus message matches `bus` triggers. */
  async onBusMessage(msg: { type?: string; author?: string; channel?: string; text?: string }): Promise<RunResult[]> {
    const results: RunResult[] = []
    for (const a of this.deps.store.list()) {
      if (!a.enabled || a.trigger.type !== "bus") continue
      const w = a.trigger.when
      if (w.type && msg.type !== w.type) continue
      if (w.author && msg.author !== w.author) continue
      if (w.channel && msg.channel !== w.channel) continue
      results.push(await this.run(a.id, { source: "bus", at: Date.now(), data: { ...msg } }))
    }
    return results
  }

  private async dispatchTrigger(source: TriggerType, data: Record<string, unknown>): Promise<RunResult[]> {
    const results: RunResult[] = []
    for (const a of this.deps.store.list()) {
      if (!a.enabled || a.trigger.type !== source) continue
      if (source === "git") {
        const git = a.trigger
        if (git.type !== "git") continue
        const ev = String(data["git.event"] ?? "")
        if (git.event !== ev) continue
        if (git.repos?.length) {
          const repo = String(data["repo"] ?? data["repository"] ?? "")
          if (!git.repos.some((r) => repo.includes(r))) continue
        }
      }
      results.push(await this.run(a.id, { source, at: Date.now(), data }))
    }
    return results
  }

  private async executeAction(automation: Automation, payload: TriggerPayload): Promise<string> {
    const action = automation.action
    const channel = channelFor(action, this.deps.defaultChannel ?? "main")
    const lounge = new Lounge(this.deps.bus, channel)

    const contextBlock = payload.data
      ? `\n\n--- trigger context ---\n${JSON.stringify(payload.data, null, 2)}`
      : ""

    switch (action.type) {
      case "start_mission": {
        const prompt = action.prompt + contextBlock
        return await this.deps.orchestrator.handleTask(prompt)
      }
      case "message_squad": {
        const text = action.text + contextBlock
        if (action.to?.length) {
          for (const to of action.to) lounge.chat("automation", text, { to: [to], role: "system" })
        } else {
          lounge.chat("automation", text, { role: "system" })
        }
        return text
      }
      case "triage": {
        lounge.chat("triage", `@piloto ${action.prompt}${contextBlock}`, { role: "orchestrator", to: ["piloto"] })
        if (action.spawnOnMatch && payload.data?.text) {
          const t = String(payload.data.text)
          if (t.toLowerCase().includes(action.spawnOnMatch.toLowerCase())) {
            return await this.deps.orchestrator.handleTask(action.prompt + "\n\n" + t)
          }
        }
        return "triage posted"
      }
      case "notify": {
        lounge.chat("automation", action.text + contextBlock, { to: action.to, role: "system" })
        return action.text
      }
      default:
        throw new Error(`unknown action type`)
    }
  }
}

function channelFor(action: AutomationAction, fallback: string): string {
  if ("channel" in action && action.channel) return action.channel
  return fallback
}
