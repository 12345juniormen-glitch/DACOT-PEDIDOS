import { BufferJSON, initAuthCreds, proto } from '@whiskeysockets/baileys'
import { decryptString, encryptString } from './crypto.js'

const CREDS_KIND = 'creds'
const CREDS_ID = 'primary'

function aad(restaurantId, kind, keyId) {
  return `${restaurantId}:${kind}:${keyId}`
}

function serialize(value) {
  return JSON.stringify(value, BufferJSON.replacer)
}

function deserialize(value) {
  return JSON.parse(value, BufferJSON.reviver)
}

export async function createMongoAuthState(db, restaurantId) {
  const collection = db.collection('wa_baileys_auth')
  await collection.createIndex(
    { restaurant_id: 1, kind: 1, key_id: 1 },
    { unique: true, name: 'wa_baileys_auth_tenant_key' },
  )

  const read = async (kind, keyId) => {
    const record = await collection.findOne({ restaurant_id: restaurantId, kind, key_id: keyId })
    if (!record) return null
    return deserialize(decryptString(record, aad(restaurantId, kind, keyId)))
  }

  const writeOperation = (kind, keyId, value) => {
    const filter = { restaurant_id: restaurantId, kind, key_id: keyId }
    if (value == null) return { deleteOne: { filter } }
    const encrypted = encryptString(serialize(value), aad(restaurantId, kind, keyId))
    return {
      updateOne: {
        filter,
        update: {
          $set: { ...filter, ...encrypted, updated_at: new Date() },
          $setOnInsert: { created_at: new Date() },
        },
        upsert: true,
      },
    }
  }

  const creds = (await read(CREDS_KIND, CREDS_ID)) || initAuthCreds()
  const keys = {
    async get(type, ids) {
      const result = {}
      await Promise.all(ids.map(async (id) => {
        let value = await read(type, id)
        if (type === 'app-state-sync-key' && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value)
        }
        if (value != null) result[id] = value
      }))
      return result
    },
    async set(data) {
      const operations = []
      for (const [type, entries] of Object.entries(data)) {
        for (const [id, value] of Object.entries(entries || {})) {
          operations.push(writeOperation(type, id, value))
        }
      }
      if (operations.length) await collection.bulkWrite(operations, { ordered: false })
    },
    async clear() {
      await collection.deleteMany({ restaurant_id: restaurantId, kind: { $ne: CREDS_KIND } })
    },
  }

  return {
    state: { creds, keys },
    saveCreds: async () => {
      await collection.bulkWrite([writeOperation(CREDS_KIND, CREDS_ID, creds)])
    },
    clear: async () => {
      await collection.deleteMany({ restaurant_id: restaurantId })
    },
  }
}
