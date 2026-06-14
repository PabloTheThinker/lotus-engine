/** Wave 65 (v3.64–v3.68) — localStorage checkpoints + export save slots. */
/** Wave 70 — optional IndexedDB cloud backup when cloudBackup is enabled. */
/** Wave 75 (v4.14–v4.18) — cross-level persistence via __global__ namespace. */

import { backupCheckpointToIndexedDB, setCloudSaveContext } from './cloudSaveStub'

const STORAGE_PREFIX = 'lotus-engine.saves'
export const GLOBAL_SAVE_LEVEL_KEY = '__global__'

let levelName = 'Untitled'
let enabled = false
let cloudBackup = false
let crossLevelSaves = false

function sanitizeLevelName(name: string): string {
  const t = String(name ?? '').trim() || 'Untitled'
  return t.replace(/[^\w.-]+/g, '_').slice(0, 64)
}

function sanitizeSlot(slot: string): string {
  const t = String(slot ?? '').trim()
  if (!t) return 'slot0'
  return t.replace(/[^\w.-]+/g, '_').slice(0, 32)
}

function levelStorageKey(slot: string, level?: string): string {
  return `${STORAGE_PREFIX}.${sanitizeLevelName(level ?? levelName)}.${sanitizeSlot(slot)}`
}

function globalStorageKey(slot: string): string {
  return `${STORAGE_PREFIX}.${GLOBAL_SAVE_LEVEL_KEY}.${sanitizeSlot(slot)}`
}

function storageKey(slot: string): string {
  if (crossLevelSaves) return globalStorageKey(slot)
  return levelStorageKey(slot)
}

function activeListPrefix(): string {
  if (crossLevelSaves) return `${STORAGE_PREFIX}.${GLOBAL_SAVE_LEVEL_KEY}.`
  return `${STORAGE_PREFIX}.${sanitizeLevelName(levelName)}.`
}

function syncCloudSaveContext(): void {
  setCloudSaveContext({ levelName: crossLevelSaves ? GLOBAL_SAVE_LEVEL_KEY : levelName })
}

/** Configure active level + whether save APIs are enabled (PIE + export). */
export function setSaveContext(opts: {
  levelName?: string
  enabled?: boolean
  cloudBackup?: boolean
  crossLevelSaves?: boolean
}): void {
  if (opts.levelName !== undefined) levelName = opts.levelName
  if (opts.enabled !== undefined) enabled = !!opts.enabled
  if (opts.cloudBackup !== undefined) cloudBackup = !!opts.cloudBackup
  if (opts.crossLevelSaves !== undefined) crossLevelSaves = !!opts.crossLevelSaves
  syncCloudSaveContext()
}

export function isSaveEnabled(): boolean {
  return enabled
}

export function isCloudBackupEnabled(): boolean {
  return cloudBackup
}

export function isCrossLevelSavesEnabled(): boolean {
  return crossLevelSaves
}

export function getSaveLevelName(): string {
  return levelName
}

/** Persist arbitrary JSON checkpoint data for a named slot. */
export function saveCheckpoint(slot: string, data: unknown): boolean {
  if (!enabled) return false
  try {
    const payload = {
      savedAt: Date.now(),
      level: crossLevelSaves ? GLOBAL_SAVE_LEVEL_KEY : sanitizeLevelName(levelName),
      slot: sanitizeSlot(slot),
      data,
    }
    localStorage.setItem(storageKey(slot), JSON.stringify(payload))
    if (cloudBackup) {
      void backupCheckpointToIndexedDB(slot, data).catch(() => {})
    }
    return true
  } catch {
    return false
  }
}

/** Load checkpoint data for a slot, or null when missing/disabled. */
export function loadCheckpoint(slot: string): unknown | null {
  if (!enabled) return null
  try {
    const raw = localStorage.getItem(storageKey(slot))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { data?: unknown }
    return parsed?.data ?? null
  } catch {
    return null
  }
}

/** Persist checkpoint data in the global namespace (cross-level slots). */
export function globalCheckpoint(slot: string, data: unknown): boolean {
  if (!enabled) return false
  try {
    const payload = {
      savedAt: Date.now(),
      level: GLOBAL_SAVE_LEVEL_KEY,
      slot: sanitizeSlot(slot),
      data,
    }
    localStorage.setItem(globalStorageKey(slot), JSON.stringify(payload))
    if (cloudBackup) {
      const prevCross = crossLevelSaves
      crossLevelSaves = true
      syncCloudSaveContext()
      void backupCheckpointToIndexedDB(slot, data).catch(() => {})
      crossLevelSaves = prevCross
      syncCloudSaveContext()
    }
    return true
  } catch {
    return false
  }
}

/** Load checkpoint data from the global namespace. */
export function globalLoad(slot: string): unknown | null {
  if (!enabled) return null
  try {
    const raw = localStorage.getItem(globalStorageKey(slot))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { data?: unknown }
    return parsed?.data ?? null
  } catch {
    return null
  }
}

/**
 * On changeScene — copy per-level slots from the outgoing level into __global__
 * (when cross-level saves are enabled), then switch the active level name.
 */
export function migrateToLevel(newLevelName: string): number {
  const fromLevel = sanitizeLevelName(levelName)
  let migrated = 0
  if (enabled && crossLevelSaves) {
    const fromPrefix = `${STORAGE_PREFIX}.${fromLevel}.`
    try {
      const slots: string[] = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key?.startsWith(fromPrefix)) continue
        const slot = key.slice(fromPrefix.length)
        if (slot) slots.push(slot)
      }
      for (const slot of slots) {
        const globalKey = globalStorageKey(slot)
        if (localStorage.getItem(globalKey)) continue
        const raw = localStorage.getItem(`${fromPrefix}${slot}`)
        if (!raw) continue
        localStorage.setItem(globalKey, raw)
        migrated++
      }
    } catch {
      /* ignore */
    }
  }
  levelName = newLevelName
  syncCloudSaveContext()
  return migrated
}

/** List slot ids that have saved data for the active level (or global when cross-level). */
export function listSlots(): string[] {
  if (!enabled) return []
  const prefix = activeListPrefix()
  const out: string[] = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(prefix)) continue
      const slot = key.slice(prefix.length)
      if (slot) out.push(slot)
    }
  } catch {
    return []
  }
  return out.sort()
}