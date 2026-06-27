import Database from "better-sqlite3"
import type { Message, StoredMessage } from "../types"

function rowToMsg(r: any): StoredMessage {
  return {
    id: r.id,
    channel: r.channel,
    author: r.author,
    role: r.role,
    lang: r.lang,
    text: r.text,
    type: r.type ?? undefined,
    meta: r.meta ? JSON.parse(r.meta) : undefined,
    createdAt: r.createdAt,
  }
}

export class MessageStore {
  private db: Database.Database

  constructor(path = ":memory:") {
    this.db = new Database(path)
    this.db.pragma("journal_mode = WAL")
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel TEXT NOT NULL,
        author TEXT NOT NULL,
        role TEXT NOT NULL,
        lang TEXT NOT NULL,
        text TEXT NOT NULL,
        type TEXT,
        meta TEXT,
        createdAt INTEGER NOT NULL
      )`)
  }

  append(m: Message): StoredMessage {
    const createdAt = Date.now()
    const info = this.db
      .prepare(
        `INSERT INTO messages (channel, author, role, lang, text, type, meta, createdAt)
         VALUES (@channel, @author, @role, @lang, @text, @type, @meta, @createdAt)`,
      )
      .run({
        channel: m.channel,
        author: m.author,
        role: m.role,
        lang: m.lang,
        text: m.text,
        type: m.type ?? null,
        meta: m.meta ? JSON.stringify(m.meta) : null,
        createdAt,
      })
    return { ...m, id: Number(info.lastInsertRowid), createdAt }
  }

  byChannel(channel: string): StoredMessage[] {
    return (this.db.prepare(`SELECT * FROM messages WHERE channel = ? ORDER BY id`).all(channel) as any[]).map(rowToMsg)
  }

  all(): StoredMessage[] {
    return (this.db.prepare(`SELECT * FROM messages ORDER BY id`).all() as any[]).map(rowToMsg)
  }
}
