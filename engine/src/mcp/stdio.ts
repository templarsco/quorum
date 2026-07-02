#!/usr/bin/env node
import { runQuorumMcpStdio } from "./server.js"

runQuorumMcpStdio().catch((e) => {
  console.error(e)
  process.exit(1)
})
