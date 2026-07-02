import { execSync } from "node:child_process"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { describe, expect, test } from "vitest"
import { agentBranch, GitLayer, parseNumstat, parseWorktreeList } from "./worktrees"

test("parseWorktreeList parses porcelain output", () => {
  const out = [
    "worktree C:/repo",
    "HEAD abc123",
    "branch refs/heads/master",
    "",
    "worktree C:/repo/.quorum/worktrees/builder-1",
    "HEAD def456",
    "branch refs/heads/quorum/builder-1",
    "",
  ].join("\n")
  const list = parseWorktreeList(out)
  expect(list).toHaveLength(2)
  expect(list[1]).toEqual({
    path: "C:/repo/.quorum/worktrees/builder-1",
    branch: "quorum/builder-1",
    head: "def456",
  })
})

test("parseNumstat parses insertions/deletions and skips binary markers", () => {
  const out = "10\t2\tsrc/a.ts\n-\t-\tassets/logo.png\n0\t5\tREADME.md\n"
  const stats = parseNumstat(out)
  expect(stats).toEqual([
    { insertions: 10, deletions: 2, file: "src/a.ts" },
    { insertions: 0, deletions: 0, file: "assets/logo.png" },
    { insertions: 0, deletions: 5, file: "README.md" },
  ])
})

test("agentBranch namespaces under quorum/", () => {
  expect(agentBranch("builder-1")).toBe("quorum/builder-1")
})

function hasGit(): boolean {
  try {
    execSync("git --version", { stdio: "ignore" })
    return true
  } catch {
    return false
  }
}

describe.skipIf(!hasGit())("integration: real git repo", () => {
  test("createForAgent → edit → diffCard → removeForAgent round-trip", async () => {
    const repo = mkdtempSync(join(tmpdir(), "quorum-git-"))
    try {
      const sh = (cmd: string) => execSync(cmd, { cwd: repo, stdio: "pipe" })
      sh("git init -b master")
      sh('git config user.email "t@t" ')
      sh('git config user.name "t"')
      writeFileSync(join(repo, "a.txt"), "one\n")
      sh("git add . ")
      sh('git commit -m init')

      const git = new GitLayer(repo)
      expect(await git.isRepo()).toBe(true)

      const wt = await git.createForAgent("builder-1")
      expect(wt.branch).toBe("quorum/builder-1")

      // agent edits inside its worktree
      writeFileSync(join(wt.path, "a.txt"), "one\ntwo\nthree\n")
      const card = await git.diffCard({ agentId: "builder-1", cwd: wt.path })
      expect(card.insertions).toBe(2)
      expect(card.deletions).toBe(0)
      expect(card.files[0].file).toBe("a.txt")

      // reuse returns the same worktree (git reports /-separated paths on Windows)
      const again = await git.createForAgent("builder-1")
      expect(resolve(again.path)).toBe(resolve(wt.path))

      await git.removeForAgent("builder-1", { force: true })
      expect((await git.list()).some((w) => w.branch === "quorum/builder-1")).toBe(false)
    } finally {
      rmSync(repo, { recursive: true, force: true })
    }
  }, 30_000)
})
