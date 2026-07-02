/**
 * Mention grammar (README "Chat" spec):
 *   @agent-id                 → agent or role alias
 *   @squad:squad-id           → fan-out to every agent in the squad
 *   @block:cs-blk_…           → canvas block (UI resolves blockId → agentId)
 *   @group:cs-grp_…           → CodeSurf group
 */

export interface ParsedMentions {
  agents: string[]
  squads: string[]
  blocks: string[]
  groups: string[]
}

const TOKEN = /@(?:(squad|block|group):)?([a-zA-Z][a-zA-Z0-9_-]*)/g

/** Full grammar parse — agents plus squad/block/group scoped mentions. */
export function parseAllMentions(text: string): ParsedMentions {
  const out: ParsedMentions = { agents: [], squads: [], blocks: [], groups: [] }
  const seen = new Set<string>()
  for (const m of text.matchAll(TOKEN)) {
    const scope = m[1]
    const id = m[2]
    const key = `${scope ?? "agent"}:${id}`
    if (seen.has(key)) continue
    seen.add(key)
    if (scope === "squad") out.squads.push(id)
    else if (scope === "block") out.blocks.push(id)
    else if (scope === "group") out.groups.push(id)
    else out.agents.push(id)
  }
  return out
}

/** Extract @agent-id tokens from lounge chat (Devin / Slack style). */
export function parseMentions(text: string): string[] {
  return parseAllMentions(text).agents
}

export function formatMention(agentId: string): string {
  return `@${agentId}`
}
