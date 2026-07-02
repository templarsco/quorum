/**
 * Role templates — startup-team presets used when the orchestrator (or a human)
 * spawns squad agents without spelling out every field (P2).
 */
import type { SquadAgentSpec, SquadRole } from "./types"

export interface RoleTemplate {
  role: SquadRole
  adapter: string
  model: string
  blockType: SquadAgentSpec["blockType"]
  cmd: string[]
  pinned?: boolean
}

/** Model-diverse defaults: Opus plans, Sonnet builds, GPT-5.5 reviews, Haiku scouts. */
export const ROLE_TEMPLATES: Record<SquadRole, RoleTemplate> = {
  orchestrator: {
    role: "orchestrator",
    adapter: "claude",
    model: "claude-opus-4-8",
    blockType: "chat",
    cmd: ["claude"],
    pinned: true,
  },
  scout: {
    role: "scout",
    adapter: "claude",
    model: "claude-haiku-4-5",
    blockType: "terminal",
    cmd: ["claude"],
  },
  builder: {
    role: "builder",
    adapter: "copilot",
    model: "gpt-5.5",
    blockType: "terminal",
    cmd: ["copilot"],
  },
  reviewer: {
    role: "reviewer",
    adapter: "copilot",
    model: "gpt-5.5",
    blockType: "terminal",
    cmd: ["copilot"],
  },
  executor: {
    role: "executor",
    adapter: "claude",
    model: "claude-sonnet-4-6",
    blockType: "terminal",
    cmd: ["claude"],
  },
}

/**
 * Materialize an agent spec from a role template. Any provided overrides win.
 * `agentFromRole("builder", 3)` → `builder-3` on copilot/gpt-5.5 terminal.
 */
export function agentFromRole(
  role: SquadRole,
  index?: number,
  overrides?: Partial<SquadAgentSpec>,
): SquadAgentSpec {
  const t = ROLE_TEMPLATES[role]
  const agentId = overrides?.agentId ?? (index != null ? `${role}-${index}` : role)
  return {
    agentId,
    role: t.role,
    adapter: t.adapter,
    blockType: t.blockType,
    model: t.model,
    cmd: [...t.cmd],
    env: { QUORUM_AGENT_ID: agentId, ...(overrides?.env ?? {}) },
    ...(t.pinned ? { pinned: true } : {}),
    ...stripUndefined(overrides ?? {}),
  }
}

/** Standard squad shape: piloto chat + scout + N builders + reviewer (+ executor). */
export function defaultSquadAgents(opts?: { builders?: number; executor?: boolean }): SquadAgentSpec[] {
  const builders = Math.max(1, opts?.builders ?? 2)
  const agents: SquadAgentSpec[] = [
    agentFromRole("orchestrator", undefined, { agentId: "piloto" }),
    agentFromRole("scout", 1),
  ]
  for (let i = 1; i <= builders; i++) agents.push(agentFromRole("builder", i))
  agents.push(agentFromRole("reviewer", 1))
  if (opts?.executor ?? true) agents.push(agentFromRole("executor", 1))
  return agents
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v
  return out as Partial<T>
}
