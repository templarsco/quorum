import type { AutomationCondition, TriggerPayload } from "./types"

/** Minimal 5-field cron matcher (minute hour dom month dow). Supports *, ranges, lists. */
export function cronMatches(cron: string, date = new Date()): boolean {
  const parts = cron.trim().split(/\s+/)
  if (parts.length !== 5) return false
  const [min, hour, dom, month, dow] = parts
  return (
    fieldMatches(min, date.getMinutes(), 0, 59) &&
    fieldMatches(hour, date.getHours(), 0, 23) &&
    fieldMatches(dom, date.getDate(), 1, 31) &&
    fieldMatches(month, date.getMonth() + 1, 1, 12) &&
    fieldMatches(dow, date.getDay(), 0, 6)
  )
}

function fieldMatches(expr: string, value: number, _min: number, _max: number): boolean {
  if (expr === "*") return true
  for (const part of expr.split(",")) {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map(Number)
      if (value >= a && value <= b) return true
    } else if (Number(part) === value) return true
  }
  return false
}

export function matchesConditions(conditions: AutomationCondition[] | undefined, payload: TriggerPayload): boolean {
  if (!conditions?.length) return true
  const flat = flattenPayload(payload)
  return conditions.every((c) => {
    const v = flat[c.field]
    if (c.equals != null) return String(v) === c.equals
    if (c.includes != null) return String(v ?? "").includes(c.includes)
    return false
  })
}

function flattenPayload(payload: TriggerPayload): Record<string, string> {
  const out: Record<string, string> = {
    "trigger.source": payload.source,
    "trigger.at": String(payload.at),
  }
  if (payload.data) {
    for (const [k, v] of Object.entries(payload.data)) {
      out[k] = typeof v === "string" ? v : JSON.stringify(v)
    }
  }
  return out
}

export function withinRateLimit(lastRunAt: number | undefined, maxPerHour: number | undefined, now = Date.now()): boolean {
  if (!maxPerHour) return true
  if (!lastRunAt) return true
  const hourAgo = now - 60 * 60 * 1000
  if (maxPerHour === 1 && lastRunAt > hourAgo) return false
  return true
}
