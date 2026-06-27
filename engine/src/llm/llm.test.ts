import { expect, test } from "vitest"
import { ClaudeCliLLM, FakeLLM, type Runner } from "./llm"

test("FakeLLM returns whatever the handler produces", async () => {
  const llm = new FakeLLM((prompt) => `echo:${prompt}`)
  expect(await llm.complete("hi")).toBe("echo:hi")
})

test("ClaudeCliLLM sends the prompt via stdin (not argv) and trims stdout", async () => {
  const calls: { cmd: string; args: string[]; input?: string }[] = []
  const runner: Runner = async (cmd, args, input) => {
    calls.push({ cmd, args, input })
    return { stdout: "  the answer  \n", code: 0 }
  }
  const llm = new ClaudeCliLLM(runner, "claude-opus-4-8")
  const out = await llm.complete("translate this")
  expect(out).toBe("the answer")
  expect(calls[0].cmd).toBe("claude")
  expect(calls[0].args).toContain("-p")
  expect(calls[0].args).toContain("--model")
  expect(calls[0].args).toContain("claude-opus-4-8")
  // prompt via stdin avoids the OS arg-length limit (Windows ENAMETOOLONG on big prompts)
  expect(calls[0].input).toBe("translate this")
  expect(calls[0].args).not.toContain("translate this")
})
