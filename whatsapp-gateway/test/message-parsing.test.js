import assert from 'node:assert/strict'
import test from 'node:test'
import { extractText, phoneFromKey } from '../src/session-manager.js'
import { mediaDetails, MAX_MEDIA_BYTES } from '../src/media.js'

test('extracts supported text without importing unsupported content', () => {
  assert.equal(extractText({ conversation: 'Olá' }), 'Olá')
  assert.equal(extractText({ ephemeralMessage: { message: { extendedTextMessage: { text: 'Teste' } } } }), 'Teste')
  assert.equal(extractText({ imageMessage: { caption: 'não importar mídia' } }), null)
})

test('normalizes direct phone JIDs and rejects groups or status broadcasts', () => {
  assert.equal(phoneFromKey({ remoteJid: '5511999991111@s.whatsapp.net' }), '5511999991111')
  assert.equal(phoneFromKey({ remoteJid: '123@lid', remoteJidAlt: '5511888882222:4@s.whatsapp.net' }), '5511888882222')
  assert.equal(phoneFromKey({ remoteJid: '12345-1@g.us' }), null)
  assert.equal(phoneFromKey({ remoteJid: 'status@broadcast' }), null)
})

test('classifies received photos, audio, video and documents without retaining one-time media', () => {
  const message = (content) => ({ message: content })
  assert.deepEqual(mediaDetails(message({ imageMessage: { mimetype: 'image/jpeg', caption: 'Foto' } })).kind, 'image')
  assert.equal(mediaDetails(message({ audioMessage: { mimetype: 'audio/ogg; codecs=opus' } })).mimeType, 'audio/ogg')
  assert.equal(mediaDetails(message({ videoMessage: { mimetype: 'video/mp4' } })).kind, 'video')
  assert.equal(mediaDetails(message({ documentMessage: { mimetype: 'application/pdf', fileName: 'cardapio.pdf' } })).fileName, 'cardapio.pdf')
  assert.equal(mediaDetails(message({ imageMessage: { mimetype: 'image/svg+xml' } })).supported, false)
  assert.equal(mediaDetails(message({ viewOnceMessage: { message: { imageMessage: { mimetype: 'image/jpeg' } } } })), null)
  assert.equal(mediaDetails(message({ ephemeralMessage: { message: { imageMessage: { mimetype: 'image/jpeg' } } } })), null)
  assert.equal(MAX_MEDIA_BYTES, 25 * 1024 * 1024)
})
