import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { Readable } from 'node:stream'
import test from 'node:test'
import { MongoClient } from 'mongodb'
import pino from 'pino'
import { MediaStore, MAX_MEDIA_BYTES } from '../src/media.js'

async function freePort() {
  const server = createServer()
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const port = server.address().port
  await new Promise((done) => server.close(done))
  return port
}

test('media survives a gateway restart and remains isolated by restaurant', {
  skip: !process.env.MONGOD_PATH,
}, async () => {
  const data = await mkdtemp(join(tmpdir(), 'dacot-wa-media-test-'))
  const port = await freePort()
  const mongo = spawn(process.env.MONGOD_PATH, [
    '--bind_ip', '127.0.0.1', '--port', String(port), '--dbpath', data, '--quiet',
  ], { stdio: 'ignore', windowsHide: true })
  const client = new MongoClient(`mongodb://127.0.0.1:${port}/?directConnection=true`, { serverSelectionTimeoutMS: 300 })
  try {
    let ready = false
    for (let i = 0; i < 50; i += 1) {
      try { await client.connect(); ready = true; break } catch (_) { await new Promise((done) => setTimeout(done, 100)) }
    }
    assert.equal(ready, true, 'temporary MongoDB did not start')
    const db = client.db('isolated_media_test')
    const logger = pino({ level: 'silent' })
    const bytes = Buffer.from('fake-image-data')
    const downloader = async () => Readable.from([bytes])
    const store = new MediaStore(db, logger, downloader)
    await store.start()
    const details = { supported: true, declaredSize: bytes.length, mimeType: 'image/png' }
    assert.equal(await store.save('restaurant-a', 'message-1', {}, {}, details), true)
    assert.equal(await store.save('restaurant-a', 'message-1', {}, {}, details), true)
    assert.equal(await db.collection('wa_media.files').countDocuments({}), 1)
    assert.equal(await store.find('restaurant-b', 'message-1'), null)
    const restored = new MediaStore(db, logger)
    const file = await restored.find('restaurant-a', 'message-1')
    assert.equal(file.mimeType, 'image/png')
    const chunks = []
    for await (const chunk of file.stream) chunks.push(chunk)
    assert.deepEqual(Buffer.concat(chunks), bytes)
    assert.equal(await store.save('restaurant-b', 'message-1', {}, {}, details), true)
    assert.equal(await db.collection('wa_media.files').countDocuments({}), 2)
    assert.equal(await store.save('restaurant-a', 'oversized', {}, {}, {
      ...details, declaredSize: MAX_MEDIA_BYTES + 1,
    }), false)
    const failed = new MediaStore(db, logger, async () => { throw new Error('download unavailable') })
    assert.equal(await failed.save('restaurant-a', 'failed', {}, {}, details), false)
    const oversizedStream = new MediaStore(db, logger, async () =>
      Readable.from(Array.from({ length: 26 }, () => Buffer.alloc(1024 * 1024))))
    assert.equal(await oversizedStream.save('restaurant-a', 'oversized-stream', {}, {}, {
      ...details, declaredSize: 0,
    }), false)
    assert.equal(await db.collection('wa_media.files').countDocuments({}), 2)
    assert.equal(await db.collection('wa_media.chunks').countDocuments({ files_id: { $nin: (
      await db.collection('wa_media.files').find({}, { projection: { _id: 1 } }).toArray()
    ).map((file) => file._id) } }), 0)
  } finally {
    await client.close()
    if (mongo.exitCode === null) {
      mongo.kill()
      await new Promise((done) => mongo.once('exit', done))
    }
    if (resolve(data).startsWith(resolve(tmpdir()))) await rm(data, { recursive: true, force: true })
  }
})
