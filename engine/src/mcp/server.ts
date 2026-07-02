import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { z } from "zod"
import type { QuorumServices } from "./services.js"
import { createServices, effortForTask, inboxForAgent } from "./services.js"

export function buildQuorumMcpServer(svc: QuorumServices): McpServer {
  const server = new McpServer({ name: "quorum", version: "0.1.0" })

  server.tool(
    "quorum_post",
    "Post a message to the Agent Lounge bus (chat, @mentions).",
    {
      author: z.string().describe("Your agent id, e.g. builder-1"),
      text: z.string(),
      to: z.array(z.string()).optional().describe("Direct recipients"),
    },
    async ({ author, text, to }) => {
      const msg = svc.lounge.chat(author, text, { to })
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
