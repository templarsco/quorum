import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import type { Harness, HarnessCheckpoint, MultiAgentWorkspace } from "./types"
import { defaultKnowledgePolicy, defaultStartupRoster } from "./types"

export class WorkspaceStore {
  constructor(private root: string) {}

  private dir(id: string) {
    const d = join(this.root, id)
    if (!existsSync(d)) mkdirSync(d, { recursive: true })
    return d
  }

  create(opts: { id: string; title: string; channel?: string; goal: string }): MultiAgentWorkspace {
    const now = Date.now()
    const ws: MultiAgentWorkspace = {
      id: opts.id,
      title: opts.title,
      channel: opts.channel ?? opts.id,
      createdAt: now,
      updatedAt: now,
      status: "active",
      roster: defaultStartupRoster(),
      harness: {
        workspaceId: opts.id,
        goal: opts.goal,
        roles: { planner: "piloto", judges: ["reviewer"] },
        todos: [],
        checkpoints: [],
        generation: 0,
      },
      knowledge: defaultKnowledgePolicy(),
      runtime: "local",
    }
    this.save(ws)
    return ws
  }

  load(id: string): MultiAgentWorkspace | null {
    const path = join(this.dir(id), "workspace.json")
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, "utf8")) as MultiAgentWorkspace
    } catch {
      return null
    }
  }

  save(ws: MultiAgentWorkspace): void {
    ws.updatedAt = Date.now()
    writeFileSync(join(this.dir(ws.id), "workspace.json"), JSON.stringify(ws, null, 2) + "\n")
  }

  checkpoint(ws: MultiAgentWorkspace, cp: Omit<HarnessCheckpoint, "at"> & { at?: number }): Harness {
    const entry: HarnessCheckpoint = { at: cp.at ?? Date.now(), phaseId: cp.phaseId, summary: cp.summary, state: cp.state }
    ws.harness.checkpoints.push(entry)
    this.save(ws)
    return ws.harness
  }
}
