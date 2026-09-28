import assert from 'node:assert/strict'
import test from 'node:test'
import { extractText, phoneFromKey } from '../src/session-manager.js'

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
