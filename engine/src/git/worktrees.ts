/**
 * Git layer — one worktree per agent (Orca/Synara pattern): workers edit in
 * isolation on `quorum/<agentId>` branches; diff cards summarize their work.
 */
import { spawn } from "node:child_process"
import { join } from "node:path"

export type GitRunner = (args: string[], cwd: string) => Promise<{ stdout: string; code: number }>

export const execGit: GitRunner = (args, cwd) =>
  new Promise((resolve, reject) => {
    const cp = spawn("git", args, { cwd, shell: false })
    let stdout = ""
    let stderr = ""
    cp.stdout.on("data", (d) => (stdout += d.toString()))
    cp.stderr.on("data", (d) => (stderr += d.toString()))
    cp.on("error", reject)
    cp.on("close", (code) => {
      if (code === 0) resolve({ stdout, code: 0 })
      else reject(new Error(stderr.trim() || `git ${args[0]} exited ${code}`))
    })
  })

export interface WorktreeInfo {
  path: string
  branch: string
  head: string
}

export interface FileDiffStat {
  file: string
  insertions: number
  deletions: number
}

/** Synara-style diff card: +137 −59 per agent. */
export interface DiffCard {
  agentId?: string
  branch?: string
  files: FileDiffStat[]
  insertions: number
  deletions: number
}

export function agentBranch(agentId: string): string {
  return `quorum/${agentId}`
}

/** Parse `git worktree list --porcelain` output. */
export function parseWorktreeList(out: string): WorktreeInfo[] {
  const entries: WorktreeInfo[] = []
  let cur: Partial<WorktreeInfo> = {}
  for (const line of out.split("\n")) {
    const l = line.trim()
    if (l.startsWith("worktree ")) cur = { path: l.slice("worktree ".length) }
    else if (l.startsWith("HEAD ")) cur.head = l.slice("HEAD ".length)
    else if (l.startsWith("branch ")) cur.branch = l.slice("branch ".length).replace("refs/heads/", "")
    else if (l === "" && cur.path) {
      entries.push({ path: cur.path, branch: cur.branch ?? "(detached)", head: cur.head ?? "" })
      cur = {}
    }
  }
  if (cur.path) entries.push({ path: cur.path, branch: cur.branch ?? "(detached)", head: cur.head ?? "" })
  return entries
}

/** Parse `git diff --numstat` output into per-file stats. */
export function parseNumstat(out: string): FileDiffStat[] {
  const stats: FileDiffStat[] = []
  for (const line of out.split("\n")) {
    const m = line.trim().match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
    if (!m) continue
    stats.push({
      insertions: m[1] === "-" ? 0 : parseInt(m[1], 10),
      deletions: m[2] === "-" ? 0 : parseInt(m[2], 10),
      file: m[3],
    })
  }
  return stats
}

export class GitLayer {
  constructor(
    private repoRoot: string,
    private run: GitRunner = execGit,
  ) {}

  async isRepo(): Promise<boolean> {
    try {
      await this.run(["rev-parse", "--is-inside-work-tree"], this.repoRoot)
      return true
    } catch {
      return false
    }
  }

  async list(): Promise<WorktreeInfo[]> {
    const { stdout } = await this.run(["worktree", "list", "--porcelain"], this.repoRoot)
    return parseWorktreeList(stdout)
  }

  /**
   * Create (or reuse) the isolated worktree for an agent at
   * `<repo>/.quorum/worktrees/<agentId>` on branch `quorum/<agentId>`.
   */
  async createForAgent(agentId: string, baseRef = "HEAD"): Promise<WorktreeInfo> {
    const branch = agentBranch(agentId)
    const path = join(this.repoRoot, ".quorum", "worktrees", agentId)
    const existing = (await this.list()).find((w) => w.branch === branch)
    if (existing) return existing
    try {
      await this.run(["worktree", "add", "-b", branch, path, baseRef], this.repoRoot)
    } catch (e) {
      // Branch may already exist without a worktree — attach to it.
      if (String(e).includes("already exists")) {
        await this.run(["worktree", "add", path, branch], this.repoRoot)
      } else {
        throw e
      }
    }
    const head = (await this.run(["rev-parse", "HEAD"], path)).stdout.trim()
    return { path, branch, head }
  }

  /** Remove the agent worktree (keeps the branch for diff/PR review). */
  async removeForAgent(agentId: string, opts?: { force?: boolean }): Promise<void> {
    const branch = agentBranch(agentId)
    const wt = (await this.list()).find((w) => w.branch === branch)
    if (!wt) return
    const args = ["worktree", "remove", wt.path]
    if (opts?.force) args.push("--force")
    await this.run(args, this.repoRoot)
  }

  /** Diff card for an agent branch vs base (uncommitted work included when cwd given). */
  async diffCard(ref: { agentId?: string; branch?: string; cwd?: string; base?: string }): Promise<DiffCard> {
    const branch = ref.branch ?? (ref.agentId ? agentBranch(ref.agentId) : undefined)
    let stdout: string
    if (ref.cwd) {
      // Working-tree diff (staged + unstaged) inside a worktree.
      stdout = (await this.run(["diff", "--numstat", "HEAD"], ref.cwd)).stdout
    } else if (branch) {
      const base = ref.base ?? "HEAD"
      stdout = (await this.run(["diff", "--numstat", `${base}...${branch}`], this.repoRoot)).stdout
    } else {
      stdout = (await this.run(["diff", "--numstat"], this.repoRoot)).stdout
    }
    const files = parseNumstat(stdout)
    return {
      ...(ref.agentId ? { agentId: ref.agentId } : {}),
      ...(branch ? { branch } : {}),
      files,
      insertions: files.reduce((a, f) => a + f.insertions, 0),
      deletions: files.reduce((a, f) => a + f.deletions, 0),
    }
  }
}
