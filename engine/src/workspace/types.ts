/**
 * Multi-Agent Workspace — one long-running mission with a model roster,
 * harness checkpoints, and optional dynamic workflow phases.
 *
 * Maps to: Cursor Agents Window + multi-model toggle, Claude Code workflows,
 * Anthropic harness design, CodeSurf squad group.
 */

export type ModelSlot = {
  agentId: string
  adapter: string
  model: string
  /** Startup-style area: planner | backend | frontend | qa | research | devops */
  area?: string
  enabled: boolean
}

export type WorkspacePhase = {
  id: string
  name: string
  status: "pending" | "running" | "paused" | "done" | "failed"
  agentIds: string[]
  startedAt?: number
  finishedAt?: number
  tokensUsed?: number
}

/** Claude Code dynamic-workflow-style run (script phases, resumable). */
export type DynamicWorkflow = {
  id: string
  name: string
  /** Path to orchestration script once materialized (future: JS runtime). */
  scriptPath?: string
  phases: WorkspacePhase[]
  maxConcurrentAgents?: number
  status: "draft" | "running" | "paused" | "completed" | "failed"
}

/** Anthropic / Cursor harness — durable state across long runs. */
export type HarnessCheckpoint = {
  at: number
  phaseId: string
  summary: string
  /** Artifact paths, todo state, git ref, etc. */
  state: Record<string, unknown>
}

export type Harness = {
  workspaceId: string
  goal: string
  /** planner | worker | judge role assignments */
  roles: {
    planner?: string
    judges?: string[]
  }
  todos: { id: string; text: string; done: boolean; owner?: string }[]
  checkpoints: HarnessCheckpoint[]
  /** Fresh-start counter — combat drift (Cursor blog). */
  generation: number
}

export type KnowledgePolicy = {
  /** OpenClaw-style web access for scout/research agents. */
  webFetch: boolean
  webSearch: boolean
  cacheTtlMinutes: number
  maxCharsPerFetch: number
  allowedDomains?: string[]
  blockedDomains?: string[]
}

export type MultiAgentWorkspace = {
  id: string
  title: string
  channel: string
  /** CodeSurf group id when mounted in canvas. */
  groupId?: string
  createdAt: number
  updatedAt: number
  status: "active" | "paused" | "archived"
  /** "Use Multiple Models" — Cursor-style roster in one workspace. */
  roster: ModelSlot[]
  harness: Harness
  workflow?: DynamicWorkflow
  knowledge: KnowledgePolicy
  /** Long-running: cloud/local target (future). */
  runtime?: "local" | "cloud"
}

export const STARTUP_AREAS = [
  "planner",
  "backend",
  "frontend",
  "qa",
  "research",
  "devops",
] as const

export type StartupArea = (typeof STARTUP_AREAS)[number]

/** Default roster template — startup team across model families. */
export function defaultStartupRoster(): ModelSlot[] {
  return [
    { agentId: "piloto", adapter: "claude", model: "claude-opus-4-8", area: "planner", enabled: true },
    { agentId: "builder-be", adapter: "claude", model: "claude-sonnet-4-6", area: "backend", enabled: true },
    { agentId: "builder-fe", adapter: "copilot", model: "gpt-5.5", area: "frontend", enabled: true },
    { agentId: "reviewer", adapter: "copilot", model: "gpt-5.5", area: "qa", enabled: true },
    { agentId: "scout", adapter: "claude", model: "claude-haiku-4-5", area: "research", enabled: true },
    { agentId: "executor", adapter: "claude", model: "claude-sonnet-4-6", area: "devops", enabled: true },
  ]
}

export function defaultKnowledgePolicy(): KnowledgePolicy {
  return {
    webFetch: true,
    webSearch: true,
    cacheTtlMinutes: 15,
    maxCharsPerFetch: 50_000,
  }
}
