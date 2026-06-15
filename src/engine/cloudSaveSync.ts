/** Wave 84 (v4.59–v4.63) — cloud save manifest + cross-device copy hint (IndexedDB stub).
 *  Wave 89 (v4.84–v4.88) — JSON import/export for cross-device transfer. */

import {
  getCloudSaveLevelName,
  listCloudCheckpointEntries,
  listCloudManifestSlots,
  mergeCloudCheckpoints,
  type CloudCheckpointEntry,
} from './cloudSaveStub'

export const CLOUD_SYNC_MANIFEST_VERSION = 1
export const CLOUD_SAVE_JSON_VERSION = 2

export interface CloudSaveManifest {
  version: typeof CLOUD_SYNC_MANIFEST_VERSION
  level: string
  generatedAt: number
  slots: { slot: string; savedAt: number }[]
  crossDeviceHint: string
}

export interface CloudSaveJson {
  version: typeof CLOUD_SAVE_JSON_VERSION
  level: string
  generatedAt: number
  entries: CloudCheckpointEntry[]
  crossDeviceHint: string
}

export interface CloudSaveImportResult {
  merged: number
  skipped: number
  level: string
}

/** Compact token for QR / clipboard — same level required on target device. */
export function buildCrossDeviceHint(level: string, slots: { slot: string; savedAt: number }[]): string {
  const token = `LOTUS-CLOUD-SYNC:v${CLOUD_SYNC_MANIFEST_VERSION}|${level}|${slots
    .map((s) => `${s.slot}@${s.savedAt}`)
    .join(',')}`
  return `Cross-device stub — copy this token to another browser (same level) or encode as QR: ${token}`
}

function sanitizeLevelKey(name: string): string {
  const t = String(name ?? '').trim() || 'Untitled'
  return t.replace(/[^\w.-]+/g, '_').slice(0, 64)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Validate cloud save JSON schema (v2 full export). */
export function validateCloudSaveJson(json: unknown): CloudSaveJson {
  let doc: unknown = json
  if (typeof json === 'string') {
    try {
      doc = JSON.parse(json)
    } catch {
      throw new Error('Invalid JSON')
    }
  }
  if (!isRecord(doc)) throw new Error('Cloud save JSON must be an object')
  if (doc.version !== CLOUD_SAVE_JSON_VERSION) {
    throw new Error(`Unsupported cloud save JSON version (expected ${CLOUD_SAVE_JSON_VERSION})`)
  }
  const level = String(doc.level ?? '').trim()
  if (!level) throw new Error('Cloud save JSON missing level')
  if (!Array.isArray(doc.entries)) throw new Error('Cloud save JSON missing entries array')
  const entries: CloudCheckpointEntry[] = []
  for (const row of doc.entries) {
    if (!isRecord(row)) throw new Error('Cloud save entry must be an object')
    const slot = String(row.slot ?? '').trim()
    if (!slot) throw new Error('Cloud save entry missing slot')
    const savedAt = Number(row.savedAt)
    if (!Number.isFinite(savedAt)) throw new Error(`Cloud save entry "${slot}" missing savedAt`)
    if (!('data' in row)) throw new Error(`Cloud save entry "${slot}" missing data`)
    entries.push({ slot, savedAt, data: row.data })
  }
  const generatedAt = Number(doc.generatedAt)
  const slots = entries.map((e) => ({ slot: e.slot, savedAt: e.savedAt }))
  return {
    version: CLOUD_SAVE_JSON_VERSION,
    level,
    generatedAt: Number.isFinite(generatedAt) ? generatedAt : Date.now(),
    entries,
    crossDeviceHint:
      typeof doc.crossDeviceHint === 'string'
        ? doc.crossDeviceHint
        : buildCrossDeviceHint(level, slots),
  }
}

/** Build manifest listing IndexedDB cloud slots with timestamps + cross-device hint. */
export async function exportCloudSaveManifest(): Promise<CloudSaveManifest> {
  const level = getCloudSaveLevelName()
  const slots = await listCloudManifestSlots()
  return {
    version: CLOUD_SYNC_MANIFEST_VERSION,
    level,
    generatedAt: Date.now(),
    slots,
    crossDeviceHint: buildCrossDeviceHint(level, slots),
  }
}

/** Export full checkpoint JSON for download / cross-device transfer. */
export async function exportCloudSaveJson(): Promise<CloudSaveJson> {
  const level = getCloudSaveLevelName()
  const entries = await listCloudCheckpointEntries()
  const slots = entries.map((e) => ({ slot: e.slot, savedAt: e.savedAt }))
  return {
    version: CLOUD_SAVE_JSON_VERSION,
    level,
    generatedAt: Date.now(),
    entries,
    crossDeviceHint: buildCrossDeviceHint(level, slots),
  }
}

/** Validate schema and merge entries into IndexedDB for the active level. */
export async function importCloudSaveJson(json: unknown): Promise<CloudSaveImportResult> {
  const doc = validateCloudSaveJson(json)
  const active = sanitizeLevelKey(getCloudSaveLevelName())
  const incoming = sanitizeLevelKey(doc.level)
  if (incoming !== active) {
    throw new Error(`Level mismatch: export is "${doc.level}", active is "${getCloudSaveLevelName()}"`)
  }
  const { merged, skipped } = await mergeCloudCheckpoints(doc.entries)
  return { merged, skipped, level: doc.level }
}

/** Trigger browser download of cloud save JSON file. */
export async function downloadCloudSaveJsonFile(filename?: string): Promise<CloudSaveJson> {
  const doc = await exportCloudSaveJson()
  const name =
    filename ?? `lotus-cloud-saves-${sanitizeLevelKey(doc.level) || 'untitled'}.json`
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
  return doc
}