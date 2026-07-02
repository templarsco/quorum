/**
 * Effort router — picks ultrathink vs ultracode vs standard effort from task complexity.
 */

export type EffortMode =
  | "low"
  | "medium"
  | "high"
  | "think"
  | "megathink"
  | "ultrathink"
  | "ultracode"
  | "workflow"

export interface EffortPlan {
  mode: EffortMode
  score: number
  claudePrefix?: string
  usePlanMode: boolean
  spawnWorkflow: boolean
  pilotoAdapter: "claude" | "copilot"
  revRounds: number
  subAgentRoles: string[]
  gstackSkills: string[]
  rationale: string
}

const ULTRACODE_SIGNALS =
  /\b(migrate|migration|audit|sweep|entire codebase|whole repo|all endpoints|500\+?\s*files?|cross-?module|monorepo|parallel(?:ize)?|multi-?agent workflow|ultracode|deep-?research|every service)\b/i

const ULTRATHINK_SIGNALS =
  /\b(architect|architecture|legacy|security|owasp|performance|optimi[sz]e|debug(?:ging)?|root cause|race condition|distributed|concurrency|refactor|design system|threat model|ultrathink)\b/i

const GSTACK_REVIEW = /\b(review|pr|pull request|ship|release|deploy|canary)\b/i
const GSTACK_SECURITY = /\b(security|audit|cso|owasp|stride|vulnerabilit)\b/i
const GSTACK_QA = /\b(qa|test|e2e|staging|browser|smoke)\b/i
const GSTACK_PLAN = /\b(plan|roadmap|feature|spec|ceo|design review)\b/i

export function scoreComplexity(task: string): number {
  let score = Math.min(40, Math.floor(task.length / 25))
  if (task.length > 400) score += 15
  if (ULTRACODE_SIGNALS.test(task)) score += 35
  else if (ULTRATHINK_SIGNALS.test(task)) score += 25
  else if (/\b(implement|add|fix|update)\b/i.test(task)) score += 10
  if ((task.match(/\?/g)?.length ?? 0) > 2) score += 5
  if (/\b(and|also|then|additionally)\b/i.test(task)) score += 5
  return Math.min(100, score)
}

export function planEffort(task: string, opts?: { forceMode?: EffortMode }): EffortPlan {
  if (opts?.forceMode) return buildPlan(opts.forceMode, scoreComplexity(task), task)

  const score = scoreComplexity(task)
  if (score >= 75 || ULTRACODE_SIGNALS.test(task)) return buildPlan("ultracode", score, task)
  if (score >= 55 || ULTRATHINK_SIGNALS.test(task)) return buildPlan("ultrathink", score, task)
  if (score >= 40) return buildPlan("megathink", score, task)
  if (score >= 25) return buildPlan("think", score, task)
  if (score >= 15) return buildPlan("medium", score, task)
  return buildPlan("low", score, task)
}

function buildPlan(mode: EffortMode, score: number, task: string): EffortPlan {
  const gstackSkills: string[] = []
  if (GSTACK_PLAN.test(task)) gstackSkills.push("/office-hours", "/autoplan")
  if (GSTACK_REVIEW.test(task)) gstackSkills.push("/review", "/ship")
  if (GSTACK_SECURITY.test(task)) gstackSkills.push("/cso")
  if (GSTACK_QA.test(task)) gstackSkills.push("/qa")

  switch (mode) {
    case "ultracode":
    case "workflow":
      return {
        mode: "ultracode",
        score,
        claudePrefix: "ultracode:",
        usePlanMode: true,
        spawnWorkflow: true,
        pilotoAdapter: "claude",
        revRounds: 0,
        subAgentRoles: ["scout", "builder", "reviewer", "executor"],
        gstackSkills: gstackSkills.length ? gstackSkills : ["/autoplan"],
        rationale:
          "Large or parallel scope — dynamic workflow (Claude ultracode) with Quorum squad.",
      }
    case "ultrathink":
      return {
        mode: "ultrathink",
        score,
        claudePrefix: "ultrathink",
        usePlanMode: true,
        spawnWorkflow: false,
        pilotoAdapter: "claude",
        revRounds: score >= 65 ? 2 : 1,
        subAgentRoles: ["architect", "security", "implementer"],
        gstackSkills: gstackSkills.length ? gstackSkills : ["/plan-eng-review"],
        rationale: "Deep single-thread reasoning — ultrathink + Plan Mode + rev rounds.",
      }
    case "megathink":
      return {
        mode: "megathink",
        score,
        claudePrefix: "megathink",
        usePlanMode: true,
        spawnWorkflow: false,
        pilotoAdapter: "claude",
        revRounds: 0,
        subAgentRoles: [],
        gstackSkills,
        rationale: "Moderate-high complexity — megathink before ultrathink.",
      }
    case "think":
      return {
        mode: "think",
        score,
        claudePrefix: "think",
        usePlanMode: false,
        spawnWorkflow: false,
        pilotoAdapter: "claude",
        revRounds: 0,
        subAgentRoles: [],
        gstackSkills,
        rationale: "Elevated thinking — think keyword or /effort high.",
      }
    case "high":
      return {
        mode: "high",
        score,
        usePlanMode: false,
        spawnWorkflow: false,
        pilotoAdapter: "claude",
        revRounds: 0,
        subAgentRoles: [],
        gstackSkills,
        rationale: "/effort high — no ultrathink token cost.",
      }
    case "medium":
      return {
        mode: "medium",
        score,
        usePlanMode: false,
        spawnWorkflow: false,
        pilotoAdapter: "copilot",
        revRounds: 0,
        subAgentRoles: [],
        gstackSkills,
        rationale: "Routine work — Copilot GPT-5.5 or Sonnet.",
      }
    default:
      return {
        mode: "low",
        score,
        usePlanMode: false,
        spawnWorkflow: false,
        pilotoAdapter: "copilot",
        revRounds: 0,
        subAgentRoles: [],
        gstackSkills,
        rationale: "Small change — fast model.",
      }
  }
}

export function injectClaudeEffort(prompt: string, plan: EffortPlan): string {
  if (!plan.claudePrefix) return prompt
  if (plan.mode === "ultracode") return `${plan.claudePrefix} ${prompt}`
  return `${prompt} ${plan.claudePrefix}`
}

export function copilotEffortHint(plan: EffortPlan): string {
  if (plan.mode === "ultrathink" || plan.mode === "ultracode") return "gpt-5.5"
  if (plan.mode === "medium" || plan.mode === "high") return "gpt-5.5"
  return "gpt-5.4-mini"
}
