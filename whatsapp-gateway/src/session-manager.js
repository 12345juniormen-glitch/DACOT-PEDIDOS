import makeWASocket, {
  Browsers,
  DisconnectReason,
  WAMessageStatus,
  makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys'
import QRCode from 'qrcode'
import { createMongoAuthState } from './auth-state.js'

const STATUS_MAP = new Map([
  [WAMessageStatus.SERVER_ACK, 'sent'],
  [WAMessageStatus.DELIVERY_ACK, 'delivered'],
  [WAMessageStatus.READ, 'read'],
  [WAMessageStatus.PLAYED, 'read'],
  [WAMessageStatus.ERROR, 'failed'],
])

function unwrapContent(content) {
  let current = content
  for (let i = 0; i < 4 && current; i += 1) {
    if (current.ephemeralMessage?.message) current = current.ephemeralMessage.message
    else if (current.viewOnceMessage?.message) current = current.viewOnceMessage.message
    else if (current.viewOnceMessageV2?.message) current = current.viewOnceMessageV2.message
    else break
  }
  return current || {}
}

export function extractText(content) {
  const message = unwrapContent(content)
  return message.conversation || message.extendedTextMessage?.text || null
}

export function phoneFromKey(key) {
  const candidates = [key.remoteJidAlt, key.remoteJid]
  const jid = candidates.find((value) => typeof value === 'string' && value.endsWith('@s.whatsapp.net'))
  if (!jid) return null
  const phone = jid.split('@')[0].split(':')[0].replace(/\D/g, '')
  return phone.length >= 8 && phone.length <= 15 ? phone : null
}

function messageTimestamp(value) {
  const seconds = Number(value || Math.floor(Date.now() / 1000))
  return new Date(Math.min(seconds * 1000, Date.now())).toISOString()
}

export class SessionManager {
  constructor(db, outbox, logger, socketFactory = makeWASocket) {
    this.db = db
    this.sessionsCollection = db.collection('wa_baileys_sessions')
    this.outbox = outbox
    this.logger = logger
    this.socketFactory = socketFactory
    this.sessions = new Map()
  }

  async start() {
    await this.sessionsCollection.createIndex({ restaurant_id: 1 }, { unique: true })
    const enabled = await this.sessionsCollection.find({ enabled: true }, { projection: { restaurant_id: 1 } }).toArray()
    for (const record of enabled) {
      this.connect(record.restaurant_id).catch((error) => {
        this.logger.warn({ restaurant_id: record.restaurant_id, error: error.message }, 'session restore failed')
      })
    }
  }

  async status(restaurantId) {
    const active = this.sessions.get(restaurantId)
    if (active) {
      return {
        state: active.state,
        connected: active.state === 'connected',
        qr_data_url: active.qrDataUrl || null,
        phone: active.phone || null,
      }
    }
    const stored = await this.sessionsCollection.findOne({ restaurant_id: restaurantId })
    return {
      state: stored?.enabled ? 'reconnecting' : 'disconnected',
      connected: false,
      qr_data_url: null,
      phone: null,
    }
  }

  async connect(restaurantId) {
    const current = this.sessions.get(restaurantId)
    if (current) return this.status(restaurantId)

    const auth = await createMongoAuthState(this.db, restaurantId)
    const entry = {
      auth, socket: null, state: 'connecting', qrDataUrl: null,
      phone: null, reconnectTimer: null, stopped: false,
    }
    this.sessions.set(restaurantId, entry)
    await this.sessionsCollection.updateOne(
      { restaurant_id: restaurantId },
      { $set: { restaurant_id: restaurantId, enabled: true, state: 'connecting', updated_at: new Date() },
        $setOnInsert: { created_at: new Date() } },
      { upsert: true },
    )
    await this.openSocket(restaurantId, entry)
    return this.status(restaurantId)
  }

  async openSocket(restaurantId, entry) {
    if (entry.stopped) return
    const socket = this.socketFactory({
      auth: {
        creds: entry.auth.state.creds,
        keys: makeCacheableSignalKeyStore(entry.auth.state.keys, this.logger),
      },
      browser: Browsers.ubuntu('Chrome'),
      logger: this.logger,
      markOnlineOnConnect: false,
      syncFullHistory: false,
      shouldSyncHistoryMessage: () => false,
      generateHighQualityLinkPreview: false,
    })
    entry.socket = socket
    socket.ev.on('creds.update', entry.auth.saveCreds)
    socket.ev.on('connection.update', (update) => this.handleConnectionUpdate(
      restaurantId, entry, socket, update,
    ).catch((error) => {
      this.logger.warn({ restaurant_id: restaurantId, error: error.message }, 'connection update failed')
    }))
    socket.ev.on('messages.upsert', (event) => this.handleMessages(
      restaurantId, event,
    ).catch((error) => {
      this.logger.warn({ restaurant_id: restaurantId, error: error.message }, 'incoming message handling failed')
    }))
    socket.ev.on('messages.update', (updates) => this.handleMessageUpdates(
      restaurantId, updates,
    ).catch((error) => {
      this.logger.warn({ restaurant_id: restaurantId, error: error.message }, 'message status handling failed')
    }))
  }

  async handleConnectionUpdate(restaurantId, entry, socket, update) {
      if (entry.socket !== socket || entry.stopped) return
      if (update.qr) {
        entry.qrDataUrl = await QRCode.toDataURL(update.qr, { width: 320, margin: 2 })
        entry.state = 'waiting_qr'
        await this.persistStatus(restaurantId, entry)
      }
      if (update.connection === 'open') {
        entry.state = 'connected'
        entry.qrDataUrl = null
        entry.phone = String(socket.user?.id || '').split(':')[0].split('@')[0] || null
        await this.persistStatus(restaurantId, entry)
      }
      if (update.connection === 'close') {
        const code = update.lastDisconnect?.error?.output?.statusCode
        entry.socket = null
        if (code === DisconnectReason.loggedOut) {
          entry.stopped = true
          entry.state = 'disconnected'
          entry.qrDataUrl = null
          entry.phone = null
          await entry.auth.clear()
          await this.persistStatus(restaurantId, entry, false)
          this.sessions.delete(restaurantId)
        } else {
          entry.state = 'reconnecting'
          entry.qrDataUrl = null
          await this.persistStatus(restaurantId, entry)
          entry.reconnectTimer = setTimeout(() => {
            this.openSocket(restaurantId, entry).catch((error) => {
              this.logger.warn({ restaurant_id: restaurantId, error: error.message }, 'session reconnect failed')
            })
          }, 3000)
          entry.reconnectTimer.unref?.()
        }
      }
  }

  async handleMessages(restaurantId, { messages, type }) {
      if (type !== 'notify') return
      for (const message of messages) {
        if (message.key?.fromMe || !message.key?.id) continue
        if (message.requestId || message.message?.protocolMessage?.placeholderMessageResendRequest?.requestId) continue
        const phone = phoneFromKey(message.key)
        if (!phone) continue
        const text = extractText(message.message)
        await this.outbox.enqueue({
          event: 'message.received',
          restaurant_id: restaurantId,
          external_id: message.key.id,
          phone,
          profile_name: String(message.pushName || '').slice(0, 120) || null,
          message_type: text == null ? 'unsupported' : 'text',
          text: text == null ? null : String(text).slice(0, 4096),
          timestamp: messageTimestamp(message.messageTimestamp),
        })
      }
  }

  async handleMessageUpdates(restaurantId, updates) {
      for (const { key, update } of updates) {
        if (!key?.fromMe || !key.id) continue
        const status = STATUS_MAP.get(update.status)
        if (!status) continue
        await this.outbox.enqueue({
          event: 'message.status', restaurant_id: restaurantId,
          external_id: key.id, status, timestamp: new Date().toISOString(),
        })
      }
  }

  async persistStatus(restaurantId, entry, enabled = true) {
    await this.sessionsCollection.updateOne(
      { restaurant_id: restaurantId },
      { $set: {
        restaurant_id: restaurantId, enabled, state: entry.state,
        phone: entry.phone, updated_at: new Date(),
      } },
      { upsert: true },
    )
  }

  async send(restaurantId, phone, text) {
    const entry = this.sessions.get(restaurantId)
    if (!entry?.socket || entry.state !== 'connected') {
      const error = new Error('WhatsApp session is not connected')
      error.statusCode = 409
      throw error
    }
    const normalized = String(phone).replace(/\D/g, '')
    if (normalized.length < 8 || normalized.length > 15) {
      const error = new Error('Invalid recipient phone')
      error.statusCode = 400
      throw error
    }
    const result = await entry.socket.sendMessage(`${normalized}@s.whatsapp.net`, { text })
    if (!result?.key?.id) throw new Error('Baileys returned no message id')
    return result.key.id
  }

  async disconnect(restaurantId) {
    const entry = this.sessions.get(restaurantId)
    if (entry) {
      entry.stopped = true
      if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer)
      entry.socket?.ev?.removeAllListeners?.()
      try { await entry.socket?.logout() } catch (_) { entry.socket?.end?.(new Error('session disconnected')) }
      await entry.auth.clear()
      this.sessions.delete(restaurantId)
    } else {
      const auth = await createMongoAuthState(this.db, restaurantId)
      await auth.clear()
    }
    await this.sessionsCollection.updateOne(
      { restaurant_id: restaurantId },
      { $set: { restaurant_id: restaurantId, enabled: false, state: 'disconnected', phone: null, updated_at: new Date() },
        $setOnInsert: { created_at: new Date() } },
      { upsert: true },
    )
    return { state: 'disconnected', connected: false, qr_data_url: null, phone: null }
  }

  async stop() {
    for (const entry of this.sessions.values()) {
      entry.stopped = true
      if (entry.reconnectTimer) clearTimeout(entry.reconnectTimer)
      entry.socket?.end?.(new Error('gateway shutdown'))
    }
    this.sessions.clear()
  }
}
