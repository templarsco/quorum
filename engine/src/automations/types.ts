/** Quorum Automations — Devin / Cursor-style trigger → action workflows. */

export type TriggerType = "schedule" | "webhook" | "git" | "manual" | "bus"

export interface ScheduleTrigger {
  type: "schedule"
  /** Standard 5-field cron (minute hour dom month dow). */
  cron: string
  timezone?: string
}

export interface WebhookTrigger {
  type: "webhook"
  /** Secret for HMAC validation (optional). */
  secret?: string
}

export type GitEvent =
  | "pr_opened"
  | "pr_updated"
  | "pr_merged"
  | "push"
  | "ci_failed"
  | "issue_comment"

export interface GitTrigger {
  type: "git"
  event: GitEvent
  repos?: string[]
  branches?: string[]
  labels?: string[]
}

export interface ManualTrigger {
  type: "manual"
}

export interface BusTrigger {
  type: "bus"
  /** Fire when a bus message matches (e.g. type=done, author=builder-1). */
  when: { type?: string; author?: string; channel?: string }
}

export type AutomationTrigger = ScheduleTrigger | WebhookTrigger | GitTrigger | ManualTrigger | BusTrigger

export type ActionType = "start_mission" | "message_squad" | "triage" | "notify"

export interface StartMissionAction {
  type: "start_mission"
  prompt: string
  channel?: string
  /** Optional squad template id (future: checkout-build, review-only). */
  squadTemplate?: string
}

export interface MessageSquadAction {
  type: "message_squad"
  text: string
  to?: string[]
  channel?: string
}

/** Persistent monitor — posts to lounge; piloto may spawn child missions (Devin triage). */
export interface TriageAction {
  type: "triage"
  prompt: string
  channel?: string
  spawnOnMatch?: string
}

export interface NotifyAction {
  type: "notify"
  text: string
  to: string[]
  when?: "always" | "success" | "failure"
}

export type AutomationAction = StartMissionAction | MessageSquadAction | TriageAction | NotifyAction

export interface AutomationCondition {
  field: string
  equals?: string
  includes?: string
}

export interface Automation {
  id: string
  name: string
  description?: string
  enabled: boolean
  trigger: AutomationTrigger
  conditions?: AutomationCondition[]
  action: AutomationAction
  /** Run at most N times per window (Devin invocation limits). */
  maxRunsPerHour?: number
  /** ISO timestamps / runtime bookkeeping. */
  meta?: {
    lastRunAt?: number
    lastRunStatus?: "success" | "failure"
    runCount?: number
  }
}

export interface TriggerPayload {
  source: TriggerType
  at: number
  /** Raw event body (PR payload, webhook JSON, bus message, …). */
  data?: Record<string, unknown>
}

export interface RunResult {
  automationId: string
  status: "success" | "failure" | "skipped"
  reason?: string
  output?: string
}
