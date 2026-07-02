import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import type { QuorumServices } from "./services.js"
import { createServices, effortForTask, inboxForAgent } from "./services.js"
import type { SquadAgentSpec } from "../squad/types.js"
import { agentFromRole, defaultSquadAgents } from "../squad/templates.js"

const agentSpecSchema = z.object({
  agentId: z.string(),
  role: z.string(),
  adapter: z.string(),
  blockType: z.enum(["terminal", "chat", "browser"]),
  model: z.string().optional(),
  cmd: z.array(z.string()).optional(),
  env: z.record(z.string()).optional(),
  pinned: z.boolean().optional(),
})

const edgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.enum(["context", "output", "control"]).optional(),
})

const roleSchema = z.enum(["orchestrator", "scout", "builder", "reviewer", "executor"])

export function buildQuorumMcpServer(svc: QuorumServices): McpServer {
  const server = new McpServer({ name: "quorum", version: "0.1.0" })

  server.tool(
    "quorum_post",
    "Post a message to the Agent Lounge bus (chat, @mentions, @squad:id fan-out, threads).",
    {
      author: z.string().describe("Your agent id, e.g. builder-1"),
      text: z.string(),
      to: z.array(z.string()).optional().describe("Direct recipients"),
      threadId: z.string().optional().describe("Thread this message belongs to"),
    },
    async ({ author, text, to, threadId }) => {
      const msg = svc.lounge.chat(author, text, { to, threadId })
      return { content: [{ type: "text", text: JSON.stringify({ id: msg.id, type: msg.type, text: msg.text }) }] }
    },
  )

  server.tool(
    "quorum_inbox",
    "Read new Agent Lounge messages addressed to you (delegate, done, ack, @mentions). Call after each tool loop.",
    { agentId: z.string() },
    async ({ agentId }) => {
      const { messages, formatted } = inboxForAgent(svc, agentId)
      if (messages.length === 0) {
        return { content: [{ type: "text", text: "(inbox empty)" }] }
      }
      return { content: [{ type: "text", text: formatted.join("\n\n") }] }
    },
  )

  server.tool(
    "quorum_delegate",
    "Assign work to another agent (Devin-style delegation).",
    {
      from: z.string(),
      to: z.string(),
      task: z.string(),
    },
    async ({ from, to, task }) => {
      const msg = svc.lounge.delegate(from, to, task)
      return { content: [{ type: "text", text: msg.text }] }
    },
  )

  server.tool(
    "quorum_done",
    "Notify peers you finished a task.",
    {
      from: z.string(),
      peers: z.array(z.string()),
      summary: z.string(),
    },
    async ({ from, peers, summary }) => {
      const msg = svc.lounge.notifyDone(from, peers, summary)
      return { content: [{ type: "text", text: msg.text }] }
    },
  )

  server.tool(
    "quorum_ack",
    "Acknowledge a peer's work (ok, reviewing your progress).",
    {
      from: z.string(),
      to: z.string(),
      message: z.string().optional(),
    },
    async ({ from, to, message }) => {
      const msg = svc.lounge.ack(from, to, { text: message })
      return { content: [{ type: "text", text: msg.text }] }
    },
  )

  server.tool(
    "quorum_effort_plan",
    "Analyze task complexity and recommend ultrathink vs ultracode vs standard effort (+ gstack skills).",
    {
      task: z.string(),
      forceMode: z
        .enum(["low", "medium", "high", "think", "megathink", "ultrathink", "ultracode", "workflow"])
        .optional(),
    },
    async ({ task, forceMode }) => {
      const plan = effortForTask(task, forceMode)
      return { content: [{ type: "text", text: JSON.stringify(plan, null, 2) }] }
    },
  )

  server.tool(
    "quorum_web_fetch",
    "Fetch URL as markdown-ish text (OpenClaw-style, cached 15m). For scout/research agents.",
    { url: z.string().url() },
    async ({ url }) => {
      const result = await svc.knowledge.fetch(url)
      const header = `# ${url}\nstatus: ${result.status} cached: ${result.cached}\n\n`
      return { content: [{ type: "text", text: header + result.text }] }
    },
  )

  server.tool(
    "quorum_web_search",
    "Web search for fresh docs/CVEs/API changes (DuckDuckGo lite, no API key).",
    {
      query: z.string(),
      limit: z.number().min(1).max(10).optional(),
    },
    async ({ query, limit }) => {
      const results = await svc.knowledge.search(query, { limit: limit ?? 5 })
      if (results.length === 0) return { content: [{ type: "text", text: "(no results)" }] }
      const text = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}`).join("\n\n")
      return { content: [{ type: "text", text }] }
    },
  )

  server.tool(
    "quorum_handoff",
    "Synara-style handoff: transfer a thread to another agent/provider with a packed context.",
    {
      from: z.string(),
      to: z.string(),
      contextPack: z.string().describe("Compressed context the receiving agent needs to continue"),
      adapter: z.string().optional().describe("Target adapter, e.g. copilot"),
      model: z.string().optional(),
      threadId: z.string().optional(),
    },
    async ({ from, to, contextPack, adapter, model, threadId }) => {
      const msg = svc.lounge.handoff({ from, to, contextPack, adapter, model }, { threadId })
      return { content: [{ type: "text", text: msg.text }] }
    },
  )

  server.tool(
    "quorum_thread",
    "Read all messages of a thread in order.",
    { threadId: z.string() },
    async ({ threadId }) => {
      const msgs = svc.lounge.thread(svc.store, threadId)
      if (!msgs.length) return { content: [{ type: "text", text: "(empty thread)" }] }
      return { content: [{ type: "text", text: msgs.map((m) => svc.lounge.format(m)).join("\n") }] }
    },
  )

  server.tool(
    "quorum_squad_spawn",
    "Spawn a squad (CodeSurf block group) for a mission. Provide agents explicitly OR use roles/builders for role templates (scout/builder/reviewer/executor + piloto chat).",
    {
      missionId: z.string(),
      squadId: z.string(),
      title: z.string().optional(),
      agents: z.array(agentSpecSchema).optional(),
      roles: z.array(roleSchema).optional().describe("Spawn one agent per role from templates"),
      builders: z.number().int().min(1).max(250).optional().describe("Default squad with N builders"),
      edges: z.array(edgeSchema).optional(),
    },
    async ({ missionId, squadId, title, agents, roles, builders, edges }) => {
      let squadAgents: SquadAgentSpec[]
      if (agents?.length) {
        squadAgents = agents as SquadAgentSpec[]
      } else if (roles?.length) {
        const counters: Record<string, number> = {}
        squadAgents = roles.map((r) => {
          counters[r] = (counters[r] ?? 0) + 1
          return r === "orchestrator" ? agentFromRole(r, undefined, { agentId: "piloto" }) : agentFromRole(r, counters[r])
        })
      } else {
        squadAgents = defaultSquadAgents({ builders: builders ?? 2 })
      }
      const squad = await svc.squads.spawn({
        missionId,
        squadId,
        title,
        agents: squadAgents,
        edges: edges ?? [],
        waitAck: false,
      })
      return { content: [{ type: "text", text: JSON.stringify(squad, null, 2) }] }
    },
  )

  server.tool(
    "quorum_squad_ack",
    "CodeSurf adapter: acknowledge a squad_spawn — link groupId and blockIds back to Quorum.",
    {
      missionId: z.string(),
      squadId: z.string(),
      groupId: z.string(),
      blocks: z.array(
        z.object({
          agentId: z.string(),
          blockId: z.string(),
          blockType: z.enum(["terminal", "chat", "browser"]),
        }),
      ),
    },
    async ({ missionId, squadId, groupId, blocks }) => {
      const squad = svc.squads.ack({ missionId, squadId, groupId, blocks })
      return { content: [{ type: "text", text: JSON.stringify(squad, null, 2) }] }
    },
  )

  server.tool(
    "quorum_squad_update",
    "Scale a squad dynamically: add/remove agents, add workflow edges (group layout preserved).",
    {
      squadId: z.string(),
      add: z.array(agentSpecSchema).optional(),
      addRoles: z.array(roleSchema).optional().describe("Add agents from role templates (auto-numbered)"),
      remove: z.array(z.string()).optional(),
      edges: z.array(edgeSchema).optional(),
    },
    async ({ squadId, add, addRoles, remove, edges }) => {
      const found = svc.squads.registry.findSquad(squadId)
      const additions: SquadAgentSpec[] = [...((add as SquadAgentSpec[] | undefined) ?? [])]
      if (addRoles?.length && found) {
        for (const r of addRoles) {
          const existing = found.squad.agents.filter((a) => a.role === r).length + additions.filter((a) => a.role === r).length
          additions.push(agentFromRole(r, existing + 1))
        }
      }
      const squad = svc.squads.update({ squadId, add: additions, remove, edges })
      if (!squad) return { content: [{ type: "text", text: `(unknown squad ${squadId})` }], isError: true }
      return { content: [{ type: "text", text: JSON.stringify(squad, null, 2) }] }
    },
  )

  server.tool(
    "quorum_squad_list",
    "List missions and squads with groupId/blockId links and status.",
    {
      missionId: z.string().optional(),
    },
    async ({ missionId }) => {
      const missions = missionId ? [svc.missions.get(missionId)].filter(Boolean) : svc.missions.list()
      return { content: [{ type: "text", text: JSON.stringify(missions, null, 2) }] }
    },
  )

  server.tool(
    "quorum_studio_paste",
    "Inject text into a terminal block PTY (Studio mode). Resolves agentId → blockId when linked.",
    {
      agentId: z.string().optional(),
      blockId: z.string().optional(),
      text: z.string(),
      submit: z.boolean().optional().describe("Send Enter after the text"),
    },
    async ({ agentId, blockId, text, submit }) => {
      svc.squads.studioPaste({ agentId, blockId, text, submit })
      return { content: [{ type: "text", text: "studio_paste posted" }] }
    },
  )

  server.tool(
    "quorum_mission_fork",
    "PR-style mission clone: duplicate all live squads of a mission under a new missionId.",
    {
      missionId: z.string(),
      newMissionId: z.string().optional(),
    },
    async ({ missionId, newMissionId }) => {
      const fork = await svc.squads.fork(missionId, newMissionId)
      return { content: [{ type: "text", text: JSON.stringify(fork, null, 2) }] }
    },
  )

  return server
}

export async function runQuorumMcpStdio(workspaceRoot?: string): Promise<void> {
  const root = workspaceRoot ?? process.env.QUORUM_WORKSPACE ?? process.cwd()
  const channel = process.env.QUORUM_CHANNEL ?? "main"
  const svc = createServices(root, channel)
  const server = buildQuorumMcpServer(svc)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}
