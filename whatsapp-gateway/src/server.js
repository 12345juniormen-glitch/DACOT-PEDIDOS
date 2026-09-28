import { createHmac, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { MongoClient } from 'mongodb'
import pino from 'pino'
import { EventOutbox } from './outbox.js'
import { SessionManager } from './session-manager.js'

const logger = pino({ level: process.env.LOG_LEVEL || 'info' })
const required = ['MONGO_URL', 'DB_NAME', 'WHATSAPP_PROVIDER_SECRET', 'WHATSAPP_SESSION_ENCRYPTION_KEY', 'DACOT_BACKEND_INTERNAL_URL']
for (const name of required) {
  if (!process.env[name]) throw new Error(`${name} is required`)
}
if (process.env.WHATSAPP_PROVIDER_SECRET.length < 32) throw new Error('WHATSAPP_PROVIDER_SECRET must have at least 32 characters')

const secret = process.env.WHATSAPP_PROVIDER_SECRET
const client = new MongoClient(process.env.MONGO_URL)
await client.connect()
const db = client.db(process.env.DB_NAME)
const outbox = new EventOutbox(db, process.env.DACOT_BACKEND_INTERNAL_URL, secret, logger)
const sessions = new SessionManager(db, outbox, logger)
await outbox.start()
await sessions.start()

function signature(body) {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`
}

function authorized(body, provided = '') {
  const expected = Buffer.from(signature(body))
  const actual = Buffer.from(provided)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

function respond(response, status, payload) {
  const body = JSON.stringify(payload)
  response.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) })
  response.end(body)
}

async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 65536) throw Object.assign(new Error('request too large'), { statusCode: 413 })
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://gateway.internal')
    if (request.method === 'GET' && url.pathname === '/health') return respond(response, 200, { status: 'ok' })
    const body = await readBody(request)
    if (!authorized(body, request.headers['x-dacot-provider-signature'])) return respond(response, 403, { detail: 'forbidden' })
    const match = url.pathname.match(/^\/sessions\/([^/]+)(?:\/(connect|messages))?$/)
    if (!match) return respond(response, 404, { detail: 'not found' })
    const restaurantId = decodeURIComponent(match[1])
    const action = match[2]
    if (!restaurantId || restaurantId.length > 120) return respond(response, 400, { detail: 'invalid tenant' })

    if (request.method === 'GET' && !action) return respond(response, 200, await sessions.status(restaurantId))
    if (request.method === 'POST' && action === 'connect') return respond(response, 200, await sessions.connect(restaurantId))
    if (request.method === 'DELETE' && !action) return respond(response, 200, await sessions.disconnect(restaurantId))
    if (request.method === 'POST' && action === 'messages') {
      let payload
      try { payload = JSON.parse(body.toString('utf8')) } catch (_) { return respond(response, 400, { detail: 'invalid json' }) }
      if (typeof payload?.to !== 'string' || typeof payload?.text !== 'string' || !payload.text.trim() || payload.text.length > 4096) {
        return respond(response, 400, { detail: 'invalid message' })
      }
      const externalId = await sessions.send(restaurantId, payload.to, payload.text)
      return respond(response, 201, { external_id: externalId })
    }
    return respond(response, 405, { detail: 'method not allowed' })
  } catch (error) {
    logger.warn({ error: error.message }, 'gateway request failed')
    respond(response, error.statusCode || 500, { detail: error.statusCode ? error.message : 'provider failure' })
  }
})

const port = Number(process.env.PORT || 3100)
server.listen(port, '0.0.0.0', () => logger.info({ port }, 'WhatsApp gateway ready'))

async function shutdown() {
  server.close()
  outbox.stop()
  await sessions.stop()
  await client.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
