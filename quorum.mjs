#!/usr/bin/env node
// Agent Lounge — Slack-like bus for terminals (Claude Code, Copilot, …) in the same project.
// Messages live in ./.quorum/lounge.jsonl
//
//   node quorum.mjs send <agent> "<message>"              @mention aware chat
//   node quorum.mjs delegate <from> <to> "<task>"         assign work
//   node quorum.mjs done <from> <peer,peer> "<summary>"   finished — notify peers
//   node quorum.mjs ack <from> <to> ["<message>"]         ok, reviewing…
//   node quorum.mjs inbox <agent>                         new messages FOR this agent
//   node quorum.mjs watch <agent>                         live inbox
//   node quorum.mjs log                                   full channel history

import { existsSync, mkdirSync, appendFileSync, readFileSync, writeFileSync, watch } from 'node:fs'
import { join } from 'node:path'

const DIR = join(process.cwd(), '.quorum')
const CHANNEL = join(DIR, 'lounge.jsonl')

const ensure = () => {
  if (!existsSync(DIR)) mkdirSync(DIR, { recursive: true })
  if (!existsSync(CHANNEL)) writeFileSync(CHANNEL, '')
}

const readAll = () => {
  ensure()
  return readFileSync(CHANNEL, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l, i) => {
      try {
        const o = JSON.parse(l)
        if (o.id == null) o.id = i + 1
        return o
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

const cursorPath = (name) => join(DIR, `inbox-${name}.txt`)
const getCursor = (name) => {
  try {
    return parseInt(readFileSync(cursorPath(name), 'utf8'), 10) || 0
  } catch {
    return 0
  }
}
const setCursor = (name, n) => writeFileSync(cursorPath(name), String(n))

const parseMentions = (text) => {
  const found = new Set()
  for (const m of String(text).matchAll(/@([a-zA-Z][a-zA-Z0-9_-]*)/g)) found.add(m[1])
  return [...found]
}

const isForAgent = (msg, agentId) => {
  if (msg.from === agentId) return false
  if (msg.to?.includes(agentId)) return true
  if (msg.mentions?.includes(agentId)) return true
  return parseMentions(msg.text).includes(agentId)
}

const nextId = () => readAll().length + 1

const append = (msg) => {
  ensure()
  appendFileSync(CHANNEL, JSON.stringify(msg) + '\n')
}

const C = { reset: '\x1b[0m', dim: '\x1b[2m', badge: '\x1b[90m', set: ['\x1b[36m', '\x1b[32m', '\x1b[35m', '\x1b[33m', '\x1b[31m'] }
const colorFor = (() => {
  const m = new Map()
  let i = 0
  return (name) => {
    if (!m.has(name)) m.set(name, C.set[i++ % C.set.length])
    return m.get(name)
  }
})()

const fmt = (msg) => {
  const badge = msg.type && msg.type !== 'chat' ? `${C.badge}[${msg.type}]${C.reset} ` : ''
  const to = msg.to?.length ? `${C.dim} → ${msg.to.join(', ')}${C.reset} ` : ''
  return `${badge}${colorFor(msg.from)}${msg.from}${C.reset} ${to}${C.dim}${new Date(msg.ts).toLocaleTimeString()}${C.reset}\n  ${String(msg.text).replace(/\n/g, '\n  ')}`
}

const post = ({ from, text, type = 'chat', to = [], mentions, replyTo, task, summary }) => {
  const m = parseMentions(text)
  const recipients = [...new Set([...to, ...m])]
  const msg = {
    id: nextId(),
    ts: Date.now(),
    from,
    type,
    text,
    ...(recipients.length ? { to: recipients, mentions: m.length ? m : recipients } : {}),
    ...(replyTo != null ? { replyTo } : {}),
    ...(task ? { task } : {}),
    ...(summary ? { summary } : {}),
  }
  append(msg)
  console.log(`${colorFor(from)}→ lounge [${type}] as ${from}${C.reset}`)
  return msg
}

const [, , cmd, a, b, ...rest] = process.argv

function send(from, text) {
  if (!from) usage()
  if (!text) {
    try {
      text = readFileSync(0, 'utf8').trim()
    } catch {
      text = ''
    }
  }
  if (!text) {
    console.error('empty message')
    process.exit(1)
  }
  post({ from, text, type: 'chat' })
}

function delegate(from, to, task) {
  if (!from || !to || !task) {
    console.error('usage: node quorum.mjs delegate <from> <to> "<task>"')
    process.exit(1)
  }
  post({
    from,
    type: 'delegate',
    text: `@${to} ${from} delegated: ${task}`,
    to: [to],
    task,
  })
}

function done(from, peersCsv, summary) {
  if (!from || !peersCsv || !summary) {
    console.error('usage: node quorum.mjs done <from> <peer,peer> "<summary>"')
    process.exit(1)
  }
  const peers = peersCsv.split(',').map((s) => s.trim()).filter(Boolean)
  const mentionLine = peers.map((p) => `@${p}`).join(' ')
  post({
    from,
    type: 'done',
    text: `${mentionLine} ${from} finished: ${summary}`,
    to: peers,
    summary,
  })
}

function ack(from, to, body) {
  if (!from || !to) {
    console.error('usage: node quorum.mjs ack <from> <to> ["message"]')
    process.exit(1)
  }
  const text = body || 'ok, reviewing your progress now'
  post({
    from,
    type: 'ack',
    text: `@${to} ${from}: ${text}`,
    to: [to],
  })
}

function inbox(me) {
  if (!me) usage()
  const all = readAll()
  const fresh = all.slice(getCursor(me)).filter((m) => isForAgent(m, me))
  setCursor(me, all.length)
  if (fresh.length === 0) {
    console.log(`${C.dim}(inbox empty for ${me})${C.reset}`)
    return
  }
  for (const m of fresh) console.log(fmt(m) + '\n')
}

function log() {
  const all = readAll()
  if (all.length === 0) {
    console.log(`${C.dim}(lounge empty)${C.reset}`)
    return
  }
  for (const m of all) console.log(fmt(m) + '\n')
}

function watchCmd(me) {
  ensure()
  let seen = 0
  console.log(`${C.dim}— Agent Lounge — ${CHANNEL}\n  inbox for ${me}; Ctrl+C to stop —${C.reset}\n`)
  const tick = () => {
    const now = readAll()
    for (let i = seen; i < now.length; i++) {
      const m = now[i]
      if (isForAgent(m, me)) console.log(fmt(m) + '\n')
    }
    seen = now.length
  }
  tick()
  try {
    watch(CHANNEL, { persistent: true }, tick)
  } catch {
    /* polling covers it */
  }
  setInterval(tick, 800)
}

function usage() {
  console.log(`Agent Lounge — Slack-like agent chat (.quorum/lounge.jsonl)

  node quorum.mjs send <agent> "<message>"           chat with @mentions
  node quorum.mjs delegate <from> <to> "<task>"      assign work (Devin-style)
  node quorum.mjs done <from> <a,b> "<summary>"      notify peers you finished
  node quorum.mjs ack <from> <to> ["<message>"]      ok, reviewing…
  node quorum.mjs inbox <agent>                      new messages for you
  node quorum.mjs watch <agent>                      live inbox
  node quorum.mjs log                              full history`)
  process.exit(cmd ? 1 : 0)
}

switch (cmd) {
  case 'send':
    send(a, rest.join(' '))
    break
  case 'delegate':
    delegate(a, b, rest.join(' '))
    break
  case 'done':
    done(a, b, rest.join(' '))
    break
  case 'ack':
    ack(a, b, rest.join(' ') || undefined)
    break
  case 'inbox':
  case 'read':
    inbox(a)
    break
  case 'watch':
    watchCmd(a)
    break
  case 'log':
  case 'peek':
    log()
    break
  default:
    usage()
}
