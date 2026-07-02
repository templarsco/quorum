/** Extract @agent-id tokens from lounge chat (Devin / Slack style). */
export function parseMentions(text: string): string[] {
  const found = new Set<string>()
  for (const m of text.matchAll(/@([a-zA-Z][a-zA-Z0-9_-]*)/g)) found.add(m[1])
  return [...found]
}

export function formatMention(agentId: string): string {
  return `@${agentId}`
}
