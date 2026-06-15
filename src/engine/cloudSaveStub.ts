/** Wave 70 (v3.89–v3.93) — optional IndexedDB backup of checkpoints. */

const DB_NAME = 'lotus-engine-cloud-saves-v1'
const STORE = 'checkpoints'
const DB_VERSION = 1
const KEY_PREFIX = 'lotus-engine.cloud'

let levelName = 'Untitled'

function sanitizeLevelName(name: string): string {
  const t = String(name ?? '').trim() || 'Untitled'
  return t.replace(/[^\w.-]+/g, '_').slice(0, 64)
}

function sanitizeSlot(slot: string): string {
  const t = String(slot ?? '').trim()
  if (!t) return 'slot0'
  return t.replace(/[^\w.-]+/g, '_').slice(0, 32)
}

function cloudKey(slot: string): string {
  return `${KEY_PREFIX}.${sanitizeLevelName(levelName)}.${sanitizeSlot(slot)}`
}

function levelPrefix(): string {
  return `${KEY_PREFIX}.${sanitizeLevelName(levelName)}.`
}

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    })
  }
  return dbPromise
}

/** Configure active level for cloud slot keys (mirrors saveSystem level scope). */
export function setCloudSaveContext(opts: { levelName?: string }): void {
  if (opts.levelName !== undefined) levelName = opts.levelName
}

export function getCloudSaveLevelName(): string {
  return levelName
}

/** Persist checkpoint data to IndexedDB for a named slot. */
export async function backupCheckpointToIndexedDB(slot: string, data: unknown): Promise<boolean> {
  try {
    const db = await openDb()
    const payload = {
      savedAt: Date.now(),
      level: sanitizeLevelName(levelName),
      slot: sanitizeSlot(slot),
      data,
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(payload, cloudKey(slot))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IDB put failed'))
    })
    return true
  } catch {
    return false
  }
}

/** Load checkpoint data from IndexedDB for a slot, or null when missing. */
export async function restoreFromIndexedDB(slot: string): Promise<unknown | null> {
  try {
    const db = await openDb()
    const row = await new Promise<{ data?: unknown } | undefined>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).get(cloudKey(slot))
      req.onsuccess = () => resolve(req.result as { data?: unknown } | undefined)
      req.onerror = () => reject(req.error ?? new Error('IDB get failed'))
    })
    return row?.data ?? null
  } catch {
    return null
  }
}

export interface CloudManifestSlot {
  slot: string
  savedAt: number
}

export interface CloudCheckpointEntry {
  slot: string
  savedAt: number
  data: unknown
}

interface CloudCheckpointRow {
  savedAt?: number
  level?: string
  slot?: string
  data?: unknown
}

/** List cloud backup slots with savedAt timestamps for manifest / cross-device hint. */
export async function listCloudManifestSlots(): Promise<CloudManifestSlot[]> {
  const level = sanitizeLevelName(levelName)
  try {
    const db = await openDb()
    const rows = await new Promise<{ savedAt?: number; level?: string; slot?: string }[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => resolve((req.result ?? []) as { savedAt?: number; level?: string; slot?: string }[])
      req.onerror = () => reject(req.error ?? new Error('IDB getAll failed'))
    })
    return rows
      .filter((r) => r.level === level && r.slot)
      .map((r) => ({ slot: String(r.slot), savedAt: r.savedAt ?? 0 }))
      .sort((a, b) => a.slot.localeCompare(b.slot))
  } catch {
    return []
  }
}

/** List full checkpoint rows (slot + savedAt + data) for the active level. */
export async function listCloudCheckpointEntries(): Promise<CloudCheckpointEntry[]> {
  const level = sanitizeLevelName(levelName)
  try {
    const db = await openDb()
    const rows = await new Promise<CloudCheckpointRow[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).getAll()
      req.onsuccess = () => resolve((req.result ?? []) as CloudCheckpointRow[])
      req.onerror = () => reject(req.error ?? new Error('IDB getAll failed'))
    })
    return rows
      .filter((r) => r.level === level && r.slot && r.data !== undefined)
      .map((r) => ({
        slot: String(r.slot),
        savedAt: r.savedAt ?? 0,
        data: r.data,
      }))
      .sort((a, b) => a.slot.localeCompare(b.slot))
  } catch {
    return []
  }
}

/** Put a checkpoint row preserving savedAt (import / merge). */
export async function putCloudCheckpoint(entry: CloudCheckpointEntry): Promise<boolean> {
  try {
    const db = await openDb()
    const payload = {
      savedAt: entry.savedAt,
      level: sanitizeLevelName(levelName),
      slot: sanitizeSlot(entry.slot),
      data: entry.data,
    }
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).put(payload, cloudKey(entry.slot))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IDB put failed'))
    })
    return true
  } catch {
    return false
  }
}

/** Merge imported checkpoint rows into IndexedDB for the active level. */
export async function mergeCloudCheckpoints(
  entries: CloudCheckpointEntry[],
): Promise<{ merged: number; skipped: number }> {
  let merged = 0
  let skipped = 0
  for (const entry of entries) {
    if (!entry?.slot || entry.data === undefined) {
      skipped++
      continue
    }
    const ok = await putCloudCheckpoint(entry)
    if (ok) merged++
    else skipped++
  }
  return { merged, skipped }
}

/** List slot ids with cloud backup data for the active level. */
export async function listCloudSlots(): Promise<string[]> {
  const prefix = levelPrefix()
  try {
    const db = await openDb()
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly')
      const req = tx.objectStore(STORE).getAllKeys()
      req.onsuccess = () => resolve(req.result ?? [])
      req.onerror = () => reject(req.error ?? new Error('IDB list failed'))
    })
    const out: string[] = []
    for (const key of keys) {
      const k = String(key)
      if (!k.startsWith(prefix)) continue
      const slot = k.slice(prefix.length)
      if (slot) out.push(slot)
    }
    return out.sort()
  } catch {
    return []
  }
}