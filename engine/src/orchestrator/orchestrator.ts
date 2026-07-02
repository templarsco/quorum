import type { Bus } from "../bus/bus"
import type { Translator } from "../i18n/translator"
import type { AgentAdapter, AgentEvent, LLM } from "../types"
import { injectClaudeEffort, planEffort } from "../effort/router"
import { Lounge } from "../lounge/lounge"
import { SquadManager } from "../squad/manager"
import { ROLE_TEMPLATES } from "../squad/templates"
import type { SquadAgentSpec, StatusChromeMeta } from "../squad/types"

export interface Subtask {
  adapter: string
  prompt: string
  /** Role template hint from decomposition (builder by default). */
  role?: string
}

export interface OrchestratorOptions {
  channel?: string
  /** Squad protocol sink — when provided, missions spawn CodeSurf squads (P2). */
  squads?: SquadManager
  /** Stable mission id; defaults to a timestamped id per task. */
  missionId?: string
}

function agentIdFor(st: Subtask, i: number): string {
  return `${st.adapter}-${i + 1}`
}

function extractJson(s: string): string {
  const a = s.indexOf("{")
  const b = s.lastIndexOf("}")
  return a >= 0 && b > a ? s.slice(a, b + 1) : s
}

function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "mission"
  )
}

export class Orchestrator {
  private lounge: Lounge
  private channel: string
  private squads?: SquadManager
  private missionIdOpt?: string

  constructor(
    private bus: Bus,
    private llm: LLM,
    private translator: Translator,
    private adapters: Record<string, AgentAdapter>,
    channelOrOptions: string | OrchestratorOptions = "main",
  ) {
    const opts = typeof channelOrOptions === "string" ? { channel: channelOrOptions } : channelOrOptions
    this.channel = opts.channel ?? "main"
    this.squads = opts.squads
    this.missionIdOpt = opts.missionId
    this.lounge = new Lounge(bus, this.channel)
  }

  async handleTask(ptBr: string): Promise<string> {
    this.bus.post({ channel: this.channel, author: "human", role: "human", lang: "pt-br", text: ptBr, type: "chat" })

    const enTask = await this.translator.translate(ptBr, "en-us")
    const effort = planEffort(enTask)
    this.bus.post({
      channel: this.channel,
      author: "piloto",
      role: "orchestrator",
      lang: "en-us",
      type: "effort_plan",
      text: `${effort.mode} (score ${effort.score}): ${effort.rationale}`,
      meta: { effort },
    })

    if (effort.spawnWorkflow) {
      this.lounge.chat("piloto", `@piloto ultracode workflow recommended for this mission. ${effort.rationale}`, {
        role: "orchestrator",
        to: ["piloto"],
      })
    }

    const subtasks = await this.decompose(enTask)
    const agentIds = subtasks.map((st, i) => agentIdFor(st, i))

    // P2: mirror the worker fan-out as a CodeSurf squad (spawn + workflow edges).
    const missionId = this.missionIdOpt ?? slugify(enTask)
    const squadId = `${missionId}-squad`
    if (this.squads) {
      const agents: SquadAgentSpec[] = [
        {
          agentId: "piloto",
          role: "orchestrator",
          adapter: "claude",
          blockType: "chat",
          model: ROLE_TEMPLATES.orchestrator.model,
          pinned: true,
        },
        ...subtasks.map((st, i) => {
          const role = st.role && st.role in ROLE_TEMPLATES ? st.role : "builder"
          const t = ROLE_TEMPLATES[role as keyof typeof ROLE_TEMPLATES]
          return {
            agentId: agentIds[i],
            role,
            adapter: st.adapter,
            blockType: "terminal" as const,
            model: st.adapter === t.adapter ? t.model : undefined,
            env: { QUORUM_AGENT_ID: agentIds[i], QUORUM_MISSION_ID: missionId },
          }
        }),
      ]
      await this.squads.spawn({
        missionId,
        squadId,
        title: missionId,
        agents,
        edges: agentIds.map((id) => ({ from: "piloto", to: id, kind: "control" as const })),
        waitAck: false,
      })
    }

    const results = await Promise.all(subtasks.map((st, i) => this.runWorker(st, i, agentIds, squadId)))

    const consolidatedEn = await this.llm.complete(
      `Consolidate these worker results into one final answer for the user (en-us). ` +
        `Be concise.\n` +
        results.map((r, i) => `#${i + 1} (${subtasks[i].adapter}): ${r}`).join("\n"),
    )
    const ptOut = await this.translator.translate(consolidatedEn, "pt-br")

    this.bus.post({
      channel: this.channel,
      author: "orchestrator",
      role: "orchestrator",
      lang: "pt-br",
      text: ptOut,
      type: "result",
    })
    return ptOut
  }

  private async decompose(enTask: string): Promise<Subtask[]> {
    const raw = await this.llm.complete(
      `Decompose this task into 1-3 worker subtasks. Available adapters: ${Object.keys(this.adapters).join(", ")}. ` +
        `When subtasks are independent, prefer assigning them to DIFFERENT adapters to leverage model diversity. ` +
        `Optionally tag each subtask with a role: scout (research), builder (code), reviewer (QA), executor (run/devops). ` +
        `Return STRICT JSON: {"subtasks":[{"adapter":"<name>","prompt":"<en-us prompt>","role":"builder"}]}.\nTask: ${enTask}`,
    )
    try {
      const parsed = JSON.parse(extractJson(raw))
      if (Array.isArray(parsed.subtasks) && parsed.subtasks.length > 0) return parsed.subtasks as Subtask[]
    } catch {
      // fall through
    }
    // ponytail: if the LLM didn't return clean JSON, treat the whole task as one subtask on the first adapter
    return [{ adapter: Object.keys(this.adapters)[0], prompt: enTask }]
  }

  private statusMeta(agentId: string, squadId: string, e: AgentEvent, status: StatusChromeMeta["status"]): Record<string, unknown> {
    const meta: StatusChromeMeta = {
      squadId,
      status,
      ...(e.usage?.costUsd != null ? { costUsd: e.usage.costUsd } : {}),
      ...(e.usage?.tokensIn != null ? { tokensIn: e.usage.tokensIn } : {}),
      ...(e.usage?.tokensOut != null ? { tokensOut: e.usage.tokensOut } : {}),
    }
    const blockId = this.squads?.registry.resolveBlock(squadId, agentId, true)
    if (blockId) meta.blockId = blockId
    return meta as unknown as Record<string, unknown>
  }

  private async runWorker(st: Subtask, i: number, squadAgentIds: string[], squadId: string): Promise<string> {
    const adapter = this.adapters[st.adapter] ?? this.adapters[Object.keys(this.adapters)[0]]
    const agentId = agentIdFor(st, i)
    const peers = squadAgentIds.filter((id) => id !== agentId)
    const mode = st.adapter === "claude" ? "headless" : "pty"
    const handle = await adapter.spawn({ agentId, mode })

    this.lounge.delegate("piloto", agentId, st.prompt)

    const prompt =
      st.adapter === "claude" ? injectClaudeEffort(st.prompt, planEffort(st.prompt)) : st.prompt

    adapter.onEvent(handle, (e) => {
      if (e.type === "progress") {
        this.bus.post({
          channel: this.channel,
          author: agentId,
          role: "worker",
          lang: "en-us",
          text: e.text ?? "",
          type: "status",
          meta: this.statusMeta(agentId, squadId, e, "working"),
        })
      } else if (e.type === "done") {
        this.bus.post({
          channel: this.channel,
          author: agentId,
          role: "worker",
          lang: "en-us",
          text: e.text ?? "",
          type: "result",
          meta: this.statusMeta(agentId, squadId, e, "done"),
        })
      } else if (e.type === "blocked") {
        this.bus.post({
          channel: this.channel,
          author: agentId,
          role: "worker",
          lang: "en-us",
          text: e.error ?? "blocked",
          type: "blocked",
          meta: this.statusMeta(agentId, squadId, e, "blocked"),
        })
      }
    })

    // Event-driven wait — resolves when this worker's result message hits the bus. NO polling.
    const donePromise = this.bus.once((m) => m.author === agentId && m.type === "result")
    await adapter.send(handle, prompt)
    const doneMsg = await donePromise
    const summary = doneMsg.text.slice(0, 300)
    this.lounge.notifyDone(agentId, ["piloto", ...peers], summary)
    await adapter.stop(handle)
    return doneMsg.text
  }
}
