import { expect, test } from "vitest"
import { ClaudeCliLLM, FakeLLM, type Runner } from "./llm"

test("FakeLLM returns whatever the handler produces", async () => {
  const llm = new FakeLLM((prompt) => `echo:${prompt}`)
  expect(await llm.complete("hi")).toBe("echo:hi")
})

test("ClaudeCliLLM passes -p and the prompt to the runner and trims stdout", async () => {
  const calls: { cmd: string; args: string[] }[] = []
  const runner: Runner = async (cmd, args) => {
    calls.push({ cmd, args })
    return { stdout: "  the answer  \n", code: 0 }
  }
  const llm = new ClaudeCliLLM(runner, "claude-opus-4-8")
  const out = await llm.complete("translate this")
  expect(out).toBe("the answer")
  expect(calls[0].cmd).toBe("claude")
  expect(calls[0].args).toContain("-p")
  expect(calls[0].args).toContain("translate this")
  expect(calls[0].args).toContain("--model")
  expect(calls[0].args).toContain("claude-opus-4-8")
})
