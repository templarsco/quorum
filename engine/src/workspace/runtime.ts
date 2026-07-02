/**
 * Dynamic workflow runtime — Claude Code `/workflows`-style phase execution
 * at squad scale (1 → 250+ agents), with harness checkpoints for resume.
 *
 * Layering (VISION §3): turn-by-turn (orchestrator) → agent team (lounge) →
 * dynamic workflow (this runtime) — use it when the mission outgrows one
 * conversation (500-file migrations, codebase audits, cross research).
 */
import type { Bus } from "../bus/bus"
import type { AgentAdapter } from "../types"
import type { WorkspaceStore } from "./store"
import type { DynamicWorkflow, MultiAgentWorkspace, WorkspacePhase } from "./types"

export interface PhaseTaskSpec {
  agentId: string
  adapter: string
  prompt: string
}

export interface PhaseSpec {
  id: string
  name: string
  tasks: PhaseTaskSpec[]
}

export interface WorkflowSpec {
  id: string
  name: string
  phases: PhaseSpec[]
  /** Concurrency cap across a phase's fan-out (semaphore). Default 8. */
  maxConcurrentAgents?: number
}

export interface WorkflowRunDeps {
  bus: Bus
  adapters: Record<string, AgentAdapter>
  store: WorkspaceStore
  workspace: MultiAgentWorkspace
  channel?: string
}

export interface PhaseResult {
  phaseId: string
  results: { agentId: string; text: string; error?: string }[]
}

export interface WorkflowRunResult {
  status: "completed" | "failed"
  phases: PhaseResult[]
}

/** Simple counting semaphore for the fan-out cap. */
export class Semaphore {
  private queue: (() => void)[] = []
  private active = 0

  constructor(private limit: number) {}

  async acquire(): Promise<() => void> {
    if (this.active >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve))
    }
    this.active++
    let released = false
    return () => {
      if (released) return
      released = true
      this.active--
      this.queue.shift()?.()
    }
  }
}

function toWorkflowPhases(spec: WorkflowSpec): WorkspacePhase[] {
  return spec.phases.map((p) => ({
    id: p.id,
    name: p.name,
    status: "pending",
    agentIds: p.tasks.map((t) => t.agentId),
  }))
}

export class WorkflowRuntime {
  private channel: string

  constructor(private deps: WorkflowRunDeps) {
    this.channel = deps.channel ?? deps.workspace.channel
  }

  /** Materialize the spec on the workspace (idempotent) and return the record. */
  attach(spec: WorkflowSpec): DynamicWorkflow {
    const ws = this.deps.workspace
    if (ws.workflow?.id === spec.id) return ws.workflow
    ws.workflow = {
      id: spec.id,
      name: spec.name,
      phases: toWorkflowPhases(spec),
      maxConcurrentAgents: spec.maxConcurrentAgents,
      status: "draft",
    }
    this.deps.store.save(ws)
    return ws.workflow
  }

  /**
   * Run all pending phases in order. Already-done phases are skipped, so
   * calling run() again after a failure RESUMES from the failed phase
   * (harness checkpoints carry the summary of everything before it).
   */
  async run(spec: WorkflowSpec): Promise<WorkflowRunResult> {
    const ws = this.deps.workspace
    const wf = this.attach(spec)
    wf.status = "running"
    this.deps.store.save(ws)

    const out: PhaseResult[] = []
    for (const phaseSpec of spec.phases) {
      const phase = wf.phases.find((p) => p.id === phaseSpec.id)
      if (!phase) continue
      if (phase.status === "done") continue

      phase.status = "running"
      phase.startedAt = Date.now()
      this.deps.store.save(ws)
      this.post("workflow_phase", `Phase ${phase.name} started`, {
        workflowId: wf.id,
        phaseId: phase.id,
        status: "running",
        agents: phase.agentIds.length,
      })

      try {
        const results = await this.runPhase(phaseSpec, spec.maxConcurrentAgents ?? 8)
        const failed = results.filter((r) => r.error)
        phase.finishedAt = Date.now()
        out.push({ phaseId: phase.id, results })

        // Harness checkpoint — resume without re-reading everything (VISION §7).
        this.deps.store.checkpoint(ws, {
          phaseId: phase.id,
          summary:
            `${phase.name}: ${results.length - failed.length}/${results.length} agents ok. ` +
            results.map((r) => `${r.agentId}: ${(r.error ?? r.text).slice(0, 120)}`).join(" | "),
          state: { results: results.map((r) => ({ agentId: r.agentId, ok: !r.error })) },
        })

        if (failed.length) {
          phase.status = "failed"
          wf.status = "failed"
          this.deps.store.save(ws)
          this.post("workflow_phase", `Phase ${phase.name} failed (${failed.length} agents)`, {
            workflowId: wf.id,
            phaseId: phase.id,
            status: "failed",
          })
          return { status: "failed", phases: out }
        }

        phase.status = "done"
        this.deps.store.save(ws)
        this.post("workflow_phase", `Phase ${phase.name} done`, {
          workflowId: wf.id,
          phaseId: phase.id,
          status: "done",
        })
      } catch (e) {
        phase.status = "failed"
        phase.finishedAt = Date.now()
        wf.status = "failed"
        this.deps.store.save(ws)
        this.post("workflow_phase", `Phase ${phase.name} crashed: ${String(e)}`, {
          workflowId: wf.id,
          phaseId: phase.id,
          status: "failed",
        })
        return { status: "failed", phases: out }
      }
    }

    wf.status = "completed"
    ws.harness.generation += 1
    this.deps.store.save(ws)
    this.post("workflow_phase", `Workflow ${wf.name} completed`, { workflowId: wf.id, status: "completed" })
    return { status: "completed", phases: out }
  }

  private async runPhase(phase: PhaseSpec, maxConcurrent: number) {
    const sem = new Semaphore(Math.max(1, maxConcurrent))
    return Promise.all(
      phase.tasks.map(async (task) => {
        const release = await sem.acquire()
        try {
          return await this.runTask(task)
        } finally {
          release()
        }
      }),
    )
  }

  private async runTask(task: PhaseTaskSpec): Promise<{ agentId: string; text: string; error?: string }> {
    const adapter = this.deps.adapters[task.adapter] ?? this.deps.adapters[Object.keys(this.deps.adapters)[0]]
    if (!adapter) return { agentId: task.agentId, text: "", error: `no adapter for ${task.adapter}` }
    const handle = await adapter.spawn({ agentId: task.agentId, mode: "headless" })

    let error: string | undefined
    // Event-driven completion — same primitive as the orchestrator (no polling).
    const done = new Promise<string>((resolve) => {
      adapter.onEvent(handle, (e) => {
        if (e.type === "progress") {
          this.post("status", e.text ?? "", { agentId: task.agentId }, task.agentId, "worker")
        } else if (e.type === "blocked") {
          error = e.error ?? "blocked"
        } else if (e.type === "done") {
          if (e.error) error = e.error
          resolve(e.text ?? "")
        }
      })
    })
    await adapter.send(handle, task.prompt)
    const text = await done
    await adapter.stop(handle)
    this.post("result", text.slice(0, 500), { agentId: task.agentId, ...(error ? { error } : {}) }, task.agentId, "worker")
    return { agentId: task.agentId, text, ...(error ? { error } : {}) }
  }

  private post(
    type: string,
    text: string,
    meta?: Record<string, unknown>,
    author = "workflow",
    role: "orchestrator" | "worker" | "system" = "orchestrator",
  ): void {
    this.deps.bus.post({ channel: this.channel, author, role, lang: "en-us", type, text, meta })
  }
}

/**
 * Helper for the common "sweep" shape: same prompt template over N items,
 * fanned out across adapters round-robin (ultracode-style parallel sweep).
 */
export function sweepSpec(opts: {
  id: string
  name: string
  items: string[]
  promptFor: (item: string) => string
  adapters: string[]
  maxConcurrentAgents?: number
  phaseSize?: number
}): WorkflowSpec {
  const phaseSize = Math.max(1, opts.phaseSize ?? 50)
  const phases: PhaseSpec[] = []
  for (let i = 0; i < opts.items.length; i += phaseSize) {
    const chunk = opts.items.slice(i, i + phaseSize)
    const n = phases.length + 1
    phases.push({
      id: `${opts.id}-p${n}`,
      name: `${opts.name} ${n}`,
      tasks: chunk.map((item, j) => ({
        agentId: `sweep-${i + j + 1}`,
        adapter: opts.adapters[(i + j) % opts.adapters.length],
        prompt: opts.promptFor(item),
      })),
    })
  }
  return { id: opts.id, name: opts.name, phases, maxConcurrentAgents: opts.maxConcurrentAgents }
}
