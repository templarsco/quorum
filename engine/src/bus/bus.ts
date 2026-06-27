import type { MessageStore } from "../store/store"
import type { Message, StoredMessage } from "../types"

type Filter = (m: StoredMessage) => boolean
type Handler = (m: StoredMessage) => void

interface Sub {
  filter: Filter
  cb: Handler
}

export class Bus {
  private subs = new Set<Sub>()

  constructor(private store: MessageStore) {}

  post(m: Message): StoredMessage {
    const sm = this.store.append(m)
    // Synchronous push to subscribers — this is the no-polling primitive.
    for (const s of [...this.subs]) {
      if (s.filter(sm)) s.cb(sm)
    }
    return sm
  }

  subscribe(filter: Filter, cb: Handler): () => void {
    const sub: Sub = { filter, cb }
    this.subs.add(sub)
    return () => this.subs.delete(sub)
  }

  // Resolves when the NEXT matching message is posted. Event-driven: no timers, no polling.
  once(filter: Filter): Promise<StoredMessage> {
    return new Promise((resolve) => {
      const off = this.subscribe(filter, (m) => {
        off()
        resolve(m)
      })
    })
  }
}
