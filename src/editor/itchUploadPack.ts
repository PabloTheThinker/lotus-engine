import { buildExportPackMeta, serializePackMetaForExport } from './exportPackMeta'
import { buildReleaseNotes } from './itchReleaseNotes'
import { buildButlerPushCommand, storeLastItchZipName } from './itchButlerHint'
import type { ExportOptions } from './exportPlayable'
import { scheduleExportPerfProbe } from './exportPerfProbe'
import {
  buildMiniGamePackHTML,
  MINIGAME_PACK_ICON_B64,
} from './miniGameExportPack'
import { spawnMiniGame, type MiniGameMode } from './starterMiniGames'
import { useEditor } from './store'

/** v3.49 — itch.io upload zip entries (store method, no compression). */
export const ITCH_ZIP_ENTRY_NAMES = ['index.html', 'meta.json', 'icon.png', 'RELEASE_NOTES.md'] as const

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c >>> 0
  }
  return table
})()

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff
  for (let i = 0; i < data.length; i++) crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function utf8Encode(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function writeUint16(view: DataView, offset: number, value: number) {
  view.setUint16(offset, value, true)
}

function writeUint32(view: DataView, offset: number, value: number) {
  view.setUint32(offset, value, true)
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    out.set(chunk, offset)
    offset += chunk.length
  }
  return out
}

interface ZipStoreEntry {
  name: string
  data: Uint8Array
  offset: number
  crc: number
}

/** Build raw store-method ZIP bytes (PKZIP, no deflate). */
export function encodeZipStore(files: Record<string, Uint8Array>): Uint8Array {
  const names = Object.keys(files).sort()
  const entries: ZipStoreEntry[] = []
  const localChunks: Uint8Array[] = []
  let offset = 0

  for (const name of names) {
    const data = files[name]
    const nameBytes = utf8Encode(name)
    const crc = crc32(data)
    const header = new Uint8Array(30 + nameBytes.length)
    const view = new DataView(header.buffer)
    writeUint32(view, 0, 0x04034b50)
    writeUint16(view, 4, 20)
    writeUint16(view, 6, 0)
    writeUint16(view, 8, 0)
    writeUint16(view, 10, 0)
    writeUint16(view, 12, 0)
    writeUint32(view, 14, crc)
    writeUint32(view, 18, data.length)
    writeUint32(view, 22, data.length)
    writeUint16(view, 26, nameBytes.length)
    writeUint16(view, 28, 0)
    header.set(nameBytes, 30)
    localChunks.push(header, data)
    entries.push({ name, data, offset, crc })
    offset += header.length + data.length
  }

  const centralStart = offset
  const centralChunks: Uint8Array[] = []
  for (const entry of entries) {
    const nameBytes = utf8Encode(entry.name)
    const header = new Uint8Array(46 + nameBytes.length)
    const view = new DataView(header.buffer)
    writeUint32(view, 0, 0x02014b50)
    writeUint16(view, 4, 20)
    writeUint16(view, 6, 20)
    writeUint16(view, 8, 0)
    writeUint16(view, 10, 0)
    writeUint16(view, 12, 0)
    writeUint16(view, 14, 0)
    writeUint32(view, 16, entry.crc)
    writeUint32(view, 20, entry.data.length)
    writeUint32(view, 24, entry.data.length)
    writeUint16(view, 28, nameBytes.length)
    writeUint16(view, 30, 0)
    writeUint16(view, 32, 0)
    writeUint16(view, 34, 0)
    writeUint16(view, 36, 0)
    writeUint32(view, 38, 0)
    writeUint32(view, 42, entry.offset)
    header.set(nameBytes, 46)
    centralChunks.push(header)
  }

  const centralDir = concatChunks(centralChunks)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  writeUint32(endView, 0, 0x06054b50)
  writeUint16(endView, 4, 0)
  writeUint16(endView, 6, 0)
  writeUint16(endView, 8, entries.length)
  writeUint16(endView, 10, entries.length)
  writeUint32(endView, 12, centralDir.length)
  writeUint32(endView, 16, centralStart)
  writeUint16(endView, 20, 0)

  return concatChunks([...localChunks, centralDir, end])
}

function walkZipStoreEntries<T>(
  data: Uint8Array,
  visit: (name: string, body: Uint8Array) => T | undefined,
): T | undefined {
  let offset = 0
  while (offset + 30 <= data.length) {
    const view = new DataView(data.buffer, data.byteOffset + offset, data.byteLength - offset)
    if (view.getUint32(0, true) !== 0x04034b50) break
    const nameLen = view.getUint16(26, true)
    const extraLen = view.getUint16(28, true)
    const compSize = view.getUint32(18, true)
    const nameStart = offset + 30
    const nameEnd = nameStart + nameLen
    if (nameEnd > data.length) break
    const name = new TextDecoder().decode(data.subarray(nameStart, nameEnd))
    const bodyStart = nameEnd + extraLen
    const bodyEnd = bodyStart + compSize
    if (bodyEnd > data.length) break
    const hit = visit(name, data.subarray(bodyStart, bodyEnd))
    if (hit !== undefined) return hit
    offset = bodyEnd
  }
  return undefined
}

/** Parse local headers from a store-method ZIP blob. */
export function listZipStoreEntryNames(data: Uint8Array): string[] {
  const names: string[] = []
  walkZipStoreEntries(data, (name) => {
    names.push(name)
    return undefined
  })
  return names
}

/** Read one entry body from a store-method ZIP blob. */
export function readZipStoreEntry(data: Uint8Array, entryName: string): Uint8Array | null {
  return walkZipStoreEntries(data, (name, body) => (name === entryName ? body : undefined)) ?? null
}

export function itchPackZipFilename(mode: MiniGameMode): string {
  return `${mode}-lotus-pack.zip`
}

/** Build itch.io upload zip file map for a mini-game genre. */
export function buildItchZipFiles(mode: MiniGameMode, opts: ExportOptions = {}): Record<string, Uint8Array> {
  const html = buildMiniGamePackHTML(mode, opts)
  const meta = serializePackMetaForExport(buildExportPackMeta(mode))
  const releaseNotes = opts.packReleaseNotes ?? buildReleaseNotes(mode)
  return {
    'index.html': utf8Encode(html),
    'meta.json': utf8Encode(meta),
    'icon.png': base64ToBytes(MINIGAME_PACK_ICON_B64),
    'RELEASE_NOTES.md': utf8Encode(releaseNotes),
  }
}

/** Client-side itch.io zip blob (index.html + meta.json + icon.png). */
export function buildItchZipBlob(mode: MiniGameMode, opts: ExportOptions = {}): Blob {
  const bytes = encodeZipStore(buildItchZipFiles(mode, opts))
  const copy = new Uint8Array(bytes.length)
  copy.set(bytes)
  return new Blob([copy], { type: 'application/zip' })
}

function downloadBlob(blob: Blob, filename: string, butlerHint?: string) {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
  const status = butlerHint
    ? `Exported itch.io pack: ${filename} — ${butlerHint}`
    : `Exported itch.io pack: ${filename}`
  useEditor.getState().setStatus(status)
  scheduleExportPerfProbe()
}

/** Spawn preset, then download `{genre}-lotus-pack.zip` for itch.io upload. */
export function exportItchUploadPack(mode: MiniGameMode, opts: ExportOptions = {}) {
  spawnMiniGame(mode)
  const filename = itchPackZipFilename(mode)
  const meta = buildExportPackMeta(mode)
  const butlerCmd = buildButlerPushCommand(meta, filename)
  storeLastItchZipName(filename)
  downloadBlob(buildItchZipBlob(mode, opts), filename, butlerCmd)
}