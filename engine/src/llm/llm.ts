import { spawn } from "node:child_process"
import type { LLM } from "../types"

export class FakeLLM implements LLM {
  constructor(private handler: (prompt: string, opts?: { system?: string }) => string) {}
  async complete(prompt: string, opts?: { system?: string }): Promise<string> {
    return this.handler(prompt, opts)
  }
}

export type Runner = (cmd: string, args: string[], input?: string) => Promise<{ stdout: string; code: number }>

export const execRunner: Runner = (cmd, args, input) =>
  new Promise((resolve, reject) => {
    const cp = spawn(cmd, args, { shell: false })
    let stdout = ""
    cp.stdout.on("data", (d) => (stdout += d.toString()))
    cp.on("error", reject)
    if (input !== undefined) cp.stdin.write(input)
    cp.stdin.end() // close stdin so `claude -p` doesn't wait ~3s for piped input
    cp.on("close", (code) => resolve({ stdout, code: code ?? 0 }))
  })

export class ClaudeCliLLM implements LLM {
  constructor(private runner: Runner = execRunner, private model = "claude-opus-4-8") {}

  async complete(prompt: string, opts?: { system?: string }): Promise<string> {
    const args = ["-p", prompt, "--model", this.model]
    if (opts?.system) args.push("--append-system-prompt", opts.system)
    const { stdout } = await this.runner("claude", args)
    return stdout.trim()
  }
}
