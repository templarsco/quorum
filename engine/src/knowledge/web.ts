import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

export interface WebFetchResult {
  url: string
  ok: boolean
  status: number
  contentType: string
  text: string
  cached: boolean
  fetchedAt: number
}

export interface WebSearchResult {
  title: string
  url: string
  snippet: string
}

export class KnowledgeWeb {
  private mem = new Map<string, { text: string; at: number }>()

  constructor(
    private cacheDir?: string,
    private defaultTtlMs = 15 * 60 * 1000,
    private maxChars = 50_000,
  ) {}

  async fetch(url: string, opts?: { maxChars?: number; ttlMs?: number }): Promise<WebFetchResult> {
    const ttl = opts?.ttlMs ?? this.defaultTtlMs
    const cap = opts?.maxChars ?? this.maxChars
    const cached = this.getCached(url, ttl)
    if (cached) {
      return { url, ok: true, status: 200, contentType: "text/plain", text: cached, cached: true, fetchedAt: Date.now() }
    }

    const res = await fetch(url, {
      headers: { "User-Agent": "Quorum-Knowledge/0.1" },
      redirect: "follow",
      signal: AbortSignal.timeout(30_000),
    })
    const contentType = res.headers.get("content-type") ?? "application/octet-stream"
    let raw = await res.text()
    if (contentType.includes("html")) raw = stripHtml(raw)
    const text = raw.slice(0, cap)
    this.setCached(url, text, ttl)
    return {
      url,
      ok: res.ok,
      status: res.status,
      contentType,
      text,
      cached: false,
      fetchedAt: Date.now(),
    }
  }

  async search(query: string, opts?: { limit?: number }): Promise<WebSearchResult[]> {
    const limit = opts?.limit ?? 5
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`
    const res = await fetch(url, {
      headers: { "User-Agent": "Quorum-Knowledge/0.1" },
      signal: AbortSignal.timeout(20_000),
    })
    const html = await res.text()
    const results: WebSearchResult[] = []
    const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(html)) && results.length < limit) {
      const href = decodeDdgRedirect(m[1])
      const title = stripTags(m[2]).trim()
      if (href && title) results.push({ title, url: href, snippet: title })
    }
    return results
  }

  private getCached(url: string, ttlMs: number): string | null {
    const now = Date.now()
    const mem = this.mem.get(url)
    if (mem && now - mem.at < ttlMs) return mem.text
    if (!this.cacheDir) return null
    const path = cachePath(this.cacheDir, url)
    if (!existsSync(path)) return null
    try {
      const o = JSON.parse(readFileSync(path, "utf8")) as { text: string; at: number }
      if (now - o.at < ttlMs) {
        this.mem.set(url, o)
        return o.text
      }
    } catch {
      /* miss */
    }
    return null
  }

  private setCached(url: string, text: string, _ttlMs: number): void {
    const entry = { text, at: Date.now() }
    this.mem.set(url, entry)
    if (!this.cacheDir) return
    if (!existsSync(this.cacheDir)) mkdirSync(this.cacheDir, { recursive: true })
    writeFileSync(cachePath(this.cacheDir, url), JSON.stringify(entry))
  }
}

function cachePath(dir: string, url: string): string {
  return join(dir, createHash("sha256").update(url).digest("hex") + ".json")
}

function stripHtml(html: string): string {
  return stripTags(html.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " "))
    .replace(/\s+/g, " ")
    .trim()
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ")
}

function decodeDdgRedirect(href: string): string {
  try {
    if (href.startsWith("//duckduckgo.com/l/?")) {
      const u = new URL("https:" + href)
      return u.searchParams.get("uddg") ?? href
    }
    return href
  } catch {
    return href
  }
}
