import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import test from 'node:test'
import { createMongoAuthState } from '../src/auth-state.js'

class MemoryCollection {
  constructor() { this.docs = [] }
  async createIndex() {}
  matches(doc, filter) {
    return Object.entries(filter).every(([key, value]) => {
      if (value && typeof value === 'object' && '$ne' in value) return doc[key] !== value.$ne
      return doc[key] === value
    })
  }
  async findOne(filter) { return this.docs.find((doc) => this.matches(doc, filter)) || null }
  async bulkWrite(operations) {
    for (const operation of operations) {
      if (operation.deleteOne) {
        this.docs = this.docs.filter((doc) => !this.matches(doc, operation.deleteOne.filter))
      } else {
        const { filter, update } = operation.updateOne
        let doc = this.docs.find((item) => this.matches(item, filter))
        if (!doc) { doc = { ...filter, ...(update.$setOnInsert || {}) }; this.docs.push(doc) }
        Object.assign(doc, update.$set || {})
      }
    }
  }
  async deleteMany(filter) {
    this.docs = this.docs.filter((doc) => !this.matches(doc, filter))
  }
}

class MemoryDb {
  constructor() { this.auth = new MemoryCollection() }
  collection(name) { assert.equal(name, 'wa_baileys_auth'); return this.auth }
}

test('auth state is encrypted, tenant isolated and survives a reload', async () => {
  process.env.WHATSAPP_SESSION_ENCRYPTION_KEY = randomBytes(32).toString('base64')
  const db = new MemoryDb()
  const first = await createMongoAuthState(db, 'tenant-a')
  first.state.creds.registered = true
  first.state.creds.me = { id: '5511999991111:1@s.whatsapp.net', name: 'DACOT' }
  await first.saveCreds()
  await first.state.keys.set({ session: { peer: { secret: Buffer.from('signal-secret') } } })

  const raw = JSON.stringify(db.auth.docs)
  assert.equal(raw.includes('signal-secret'), false)
  assert.equal(raw.includes('5511999991111'), false)

  const restored = await createMongoAuthState(db, 'tenant-a')
  assert.equal(restored.state.creds.registered, true)
  assert.equal(restored.state.creds.me.id, '5511999991111:1@s.whatsapp.net')
  const keys = await restored.state.keys.get('session', ['peer'])
  assert.equal(keys.peer.secret.toString(), 'signal-secret')

  const other = await createMongoAuthState(db, 'tenant-b')
  assert.equal(other.state.creds.registered, false)
  assert.deepEqual(await other.state.keys.get('session', ['peer']), {})
  await restored.clear()
  assert.equal((await createMongoAuthState(db, 'tenant-a')).state.creds.registered, false)
  assert.equal((await createMongoAuthState(db, 'tenant-b')).state.creds.registered, false)
})
