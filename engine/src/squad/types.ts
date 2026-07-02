/**
 * Squad ↔ Group protocol — bidirectional sync between Quorum engine state and
 * the CodeSurf canvas (Railway-style topology: mission → squad → agent).
 *
 * Invariants: squadId ↔ groupId is 1:1; agentId ↔ blockId is 1:1 for
 * Quorum-managed terminal/chat blocks. See README "CodeSurf integration spec".
 */

export type SquadBlockType = "terminal" | "chat" | "browser"

/** Startup-team role played by an agent inside a squad. */
export type SquadRole = "orchestrator" | "scout" | "builder" | "reviewer" | "executor"

export interface SquadAgentSpec {
  agentId: string
  role: SquadRole | string
  /** Adapter name: claude | copilot | codex | gemini | shell */
  adapter: string
  blockType: SquadBlockType
  model?: string
  /** Command CodeSurf launches in the terminal block (defaults to adapter CLI). */
  cmd?: string[]
  env?: Record<string, string>
  /** Pinned blocks (e.g. the piloto chat) stay visible when the group collapses. */
  pinned?: boolean
}

export type SquadEdgeKind = "context" | "output" | "control"

/** Directed dependency arrow between two agents (scout → builder → reviewer). */
export interface SquadEdge {
  from: string
  to: string
  kind?: SquadEdgeKind
}

export type SquadLayout = "grid" | "row" | "column"

/** `squad_spawn` — orchestrator → CodeSurf: create group + blocks. */
export interface SquadSpawnMeta {
  missionId: string
  squadId: string
  title?: string
  layout?: SquadLayout
  position?: { x: number; y: number }
  agents: SquadAgentSpec[]
  edges?: SquadEdge[]
}

export interface SquadBlockRef {
  agentId: string
  blockId: string
  blockType: SquadBlockType
}

/** `squad_ack` — CodeSurf → Quorum: group created, ids linked. */
export interface SquadAckMeta {
  missionId: string
  squadId: string
  groupId: string
  blocks: SquadBlockRef[]
}

/** `squad_update` — orchestrator → CodeSurf: dynamic scale 1 → N inside the group. */
export interface SquadUpdateMeta {
  missionId?: string
  squadId: string
  groupId?: string
  add?: SquadAgentSpec[]
  remove?: string[]
  edges?: SquadEdge[]
}

/** `workflow_edge` — orchestrator → CodeSurf: draw dependency arrows. */
export interface WorkflowEdgeMeta {
  missionId?: string
  squadId: string
  edges: SquadEdge[]
}

/** `studio_paste` — human/engine → CodeSurf: inject text into a focused terminal PTY. */
export interface StudioPasteMeta {
  blockId?: string
  agentId?: string
  text: string
  /** When true CodeSurf sends Enter after the text. */
  submit?: boolean
}

export type AgentChromeStatus = "idle" | "working" | "blocked" | "done"

/** `status` meta — Overclock-style metering rendered on the block header. */
export interface StatusChromeMeta {
  squadId?: string
  blockId?: string
  status?: AgentChromeStatus
  /** 0..1 */
  progress?: number
  costUsd?: number
  tokensIn?: number
  tokensOut?: number
}

export type SquadStatus = "spawning" | "active" | "collapsed" | "destroyed"

/** Engine-side record of one squad (persisted in .quorum/missions.json). */
export interface SquadRecord {
  squadId: string
  title?: string
  /** CodeSurf group id — set on squad_ack. */
  groupId?: string
  agents: SquadAgentSpec[]
  /** agentId ↔ blockId links — set on squad_ack. */
  blocks: SquadBlockRef[]
  edges: SquadEdge[]
  status: SquadStatus
  createdAt: number
  updatedAt: number
}

export interface MissionRecord {
  missionId: string
  title?: string
  channel: string
  /** Set when this mission was cloned from another (PR-style fork). */
  forkedFrom?: string
  squads: SquadRecord[]
  createdAt: number
  updatedAt: number
}

/** Message `type` values used by the squad protocol on the bus. */
export const SQUAD_MESSAGE_TYPES = [
  "squad_spawn",
  "squad_ack",
  "squad_update",
  "squad_collapse",
  "squad_destroy",
  "workflow_edge",
  "studio_paste",
  "mission_fork",
] as const

export type SquadMessageType = (typeof SQUAD_MESSAGE_TYPES)[number]
