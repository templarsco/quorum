import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import type { Automation } from "./types"

export class AutomationStore {
  constructor(private dir: string) {}

  ensure(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true })
  }

  list(): Automation[] {
    this.ensure()
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => this.load(f.replace(/\.json$/, "")))
      .filter((a): a is Automation => a != null)
  }

  load(id: string): Automation | null {
    this.ensure()
    const path = join(this.dir, `${id}.json`)
    if (!existsSync(path)) return null
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Automation
    } catch {
      return null
    }
  }

  save(automation: Automation): void {
    this.ensure()
    writeFileSync(join(this.dir, `${automation.id}.json`), JSON.stringify(automation, null, 2) + "\n")
  }

  delete(id: string): boolean {
    const path = join(this.dir, `${id}.json`)
    if (!existsSync(path)) return false
    unlinkSync(path)
    return true
  }
}
