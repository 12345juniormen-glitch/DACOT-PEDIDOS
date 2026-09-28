import { createHmac, createHash } from 'node:crypto'

function signature(body, secret) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

export class EventOutbox {
  constructor(db, backendUrl, secret, logger) {
    this.collection = db.collection('wa_baileys_events')
    this.backendUrl = backendUrl.replace(/\/$/, '')
    this.secret = secret
    this.logger = logger
    this.timer = null
  }

  async start() {
    await this.collection.createIndex({ state: 1, next_attempt_at: 1 })
    await this.collection.createIndex({ delivered_at: 1 }, { expireAfterSeconds: 604800 })
    this.timer = setInterval(() => this.flush().catch((error) => {
      this.logger.warn({ error: error.message }, 'provider event retry failed')
    }), 2000)
    this.timer.unref?.()
    await this.flush()
  }

  stop() {
    if (this.timer) clearInterval(this.timer)
  }

  async enqueue(event) {
    const identity = `${event.restaurant_id}:${event.event}:${event.external_id}:${event.status || ''}`
    const id = createHash('sha256').update(identity).digest('hex')
    try {
      await this.collection.insertOne({
        _id: id, event, state: 'pending', attempts: 0,
        next_attempt_at: new Date(), created_at: new Date(),
      })
    } catch (error) {
      if (error?.code !== 11000) throw error
    }
    await this.deliver(id)
  }

  async deliver(id) {
    const record = await this.collection.findOne({ _id: id, state: 'pending' })
    if (!record) return
    const body = JSON.stringify(record.event)
    try {
      const response = await fetch(`${this.backendUrl}/api/whatsapp/provider/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Dacot-Provider-Signature': signature(body, this.secret),
        },
        body,
        signal: AbortSignal.timeout(10000),
      })
      if (!response.ok) throw new Error(`backend status ${response.status}`)
      await this.collection.updateOne(
        { _id: id, state: 'pending' },
        { $set: { state: 'delivered', delivered_at: new Date() } },
      )
    } catch (error) {
      const attempts = record.attempts + 1
      const delay = Math.min(60000, 1000 * (2 ** Math.min(attempts, 6)))
      await this.collection.updateOne(
        { _id: id, state: 'pending' },
        { $set: { attempts, next_attempt_at: new Date(Date.now() + delay), last_error: error.message } },
      )
    }
  }

  async flush() {
    const pending = await this.collection.find({
      state: 'pending', next_attempt_at: { $lte: new Date() },
    }).sort({ created_at: 1 }).limit(50).toArray()
    for (const record of pending) await this.deliver(record._id)
  }
}
