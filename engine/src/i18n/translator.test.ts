import { expect, test } from "vitest"
import { FakeLLM } from "../llm/llm"
import { Translator } from "./translator"

test("translate to en-us asks the LLM to translate from pt-br", async () => {
  const seen: string[] = []
  const llm = new FakeLLM((prompt) => {
    seen.push(prompt)
    return "TRANSLATED"
  })
  const t = new Translator(llm)
  const out = await t.translate("olá mundo", "en-us")
  expect(out).toBe("TRANSLATED")
  expect(seen[0]).toContain("from pt-br to en-us")
  expect(seen[0]).toContain("olá mundo")
})

test("translate to pt-br asks the LLM to translate from en-us", async () => {
  const llm = new FakeLLM((prompt) => (prompt.includes("to pt-br") ? "[pt] ok" : "wrong"))
  const t = new Translator(llm)
  expect(await t.translate("hello", "pt-br")).toBe("[pt] ok")
})
