import type { Lang, LLM } from "../types"

export class Translator {
  constructor(private llm: LLM) {}

  async translate(text: string, to: Lang): Promise<string> {
    const from: Lang = to === "pt-br" ? "en-us" : "pt-br"
    const out = await this.llm.complete(
      `Translate the following text from ${from} to ${to}. Return ONLY the translation, no preamble.\n\n${text}`,
    )
    return out.trim()
  }
}
