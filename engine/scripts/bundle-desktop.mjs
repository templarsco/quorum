#!/usr/bin/env node
/** Bundle Quorum engine entry points for the Tauri desktop sidecar. */
import { cpSync, mkdirSync, rmSync, existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { execFileSync } from "node:child_process"
import esbuild from "esbuild"

const __dirname = dirname(fileURLToPath(import.meta.url))
const engineRoot = join(__dirname, "..")
const outDir = join(engineRoot, "..", "desktop", "src-tauri", "resources", "engine")
const nodeOutDir = join(engineRoot, "..", "desktop", "src-tauri", "resources", "node")

rmSync(outDir, { recursive: true, force: true })
rmSync(nodeOutDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
mkdirSync(nodeOutDir, { recursive: true })

await esbuild.build({
  entryPoints: {
    automations: join(engineRoot, "src/automations/daemon.ts"),
    stream: join(engineRoot, "src/stream.ts"),
    mcp: join(engineRoot, "src/mcp/stdio.ts"),
  },
  outdir: outDir,
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: ["better-sqlite3"],
  sourcemap: false,
  logLevel: "info",
})

const nm = join(outDir, "node_modules")
mkdirSync(nm, { recursive: true })
cpSync(join(engineRoot, "node_modules", "better-sqlite3"), join(nm, "better-sqlite3"), { recursive: true })

const nodeExe = process.execPath
const nodeName = process.platform === "win32" ? "node.exe" : "node"
cpSync(nodeExe, join(nodeOutDir, nodeName))

try {
  execFileSync(process.execPath, [join(engineRoot, "node_modules", "vitest", "vitest.mjs"), "run"], {
    cwd: engineRoot,
    stdio: "inherit",
  })
} catch {
  console.warn("engine tests failed during bundle — fix before shipping")
  process.exit(1)
}

console.log(`\nBundled engine → ${outDir}`)
console.log(`Bundled ${nodeName} → ${nodeOutDir}`)
