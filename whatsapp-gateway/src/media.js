import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { downloadMediaMessage, normalizeMessageContent } from '@whiskeysockets/baileys'
import { GridFSBucket } from 'mongodb'

export const MAX_MEDIA_BYTES = 25 * 1024 * 1024

const TYPES = {
  imageMessage: { kind: 'image', mime: ['image/jpeg', 'image/png', 'image/webp'] },
  audioMessage: { kind: 'audio', mime: ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/webm'] },
  videoMessage: { kind: 'video', mime: ['video/mp4', 'video/webm'] },
  documentMessage: { kind: 'document', mime: null },
}

export function mediaDetails(message) {
  let content = message?.message
  // One-time and disappearing media must not be retained as ordinary attachments.
  for (let i = 0; i < 5 && content; i += 1) {
    if (content.viewOnceMessage || content.viewOnceMessageV2 || content.viewOnceMessageV2Extension || content.ephemeralMessage) {
      return null
    }
    content = content.documentWithCaptionMessage?.message || content.editedMessage?.message || null
  }
  content = normalizeMessageContent(message?.message)
  const key = Object.keys(TYPES).find((item) => content?.[item])
  if (!key) return null
  const spec = TYPES[key]
  const media = content[key]
  const mimeType = String(media.mimetype || '').split(';')[0].trim().toLowerCase()
  const supported = spec.mime ? spec.mime.includes(mimeType) : true
  return {
    kind: spec.kind,
    mimeType: spec.kind === 'document' ? 'application/octet-stream' : mimeType,
    supported,
    caption: String(media.caption || '').slice(0, 4096) || null,
    fileName: spec.kind === 'document' ? String(media.fileName || 'Documento').slice(0, 120) : null,
    declaredSize: Number(media.fileLength || 0),
  }
}

export class MediaStore {
  constructor(db, logger, downloader = downloadMediaMessage) {
    this.db = db
    this.logger = logger
    this.downloader = downloader
    this.bucket = new GridFSBucket(db, { bucketName: 'wa_media' })
    this.files = db.collection('wa_media.files')
  }

  async start() {
    await this.files.createIndex({ 'metadata.restaurant_id': 1, 'metadata.external_id': 1 }, { unique: true })
  }

  async save(restaurantId, externalId, message, socket, details) {
    if (!details?.supported || details.declaredSize > MAX_MEDIA_BYTES) return false
    const filter = { 'metadata.restaurant_id': restaurantId, 'metadata.external_id': externalId }
    let upload
    try {
      if (await this.files.findOne(filter)) return true
      const source = await this.downloader(message, 'stream', { timeoutMs: 20000 }, {
        logger: this.logger,
        reuploadRequest: socket.updateMediaMessage?.bind(socket),
      })
      let size = 0
      const limit = new Transform({
        transform(chunk, encoding, callback) {
          size += chunk.length
          callback(size > MAX_MEDIA_BYTES ? new Error('media too large') : null, chunk)
        },
      })
      upload = this.bucket.openUploadStream('message', {
        metadata: { restaurant_id: restaurantId, external_id: externalId, mime_type: details.mimeType },
      })
      await pipeline(source, limit, upload)
      return true
    } catch (error) {
      if (upload) {
        await upload.abort().catch(() => {})
        await this.db.collection('wa_media.chunks').deleteMany({ files_id: upload.id }).catch(() => {})
      }
      if (error?.code === 11000) return true
      this.logger.warn({ restaurant_id: restaurantId, error: error.message }, 'media download failed')
      return false
    }
  }

  async find(restaurantId, externalId) {
    const file = await this.files.findOne({ 'metadata.restaurant_id': restaurantId, 'metadata.external_id': externalId })
    if (!file) return null
    return { stream: this.bucket.openDownloadStream(file._id), mimeType: file.metadata.mime_type, length: file.length }
  }
}
