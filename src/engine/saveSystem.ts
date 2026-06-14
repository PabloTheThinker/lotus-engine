/** Wave 65 (v3.64–v3.68) — localStorage checkpoints + export save slots. */

const STORAGE_PREFIX = 'lotus-engine.saves'

let levelName = 'Untitled'
let enabled = false

function sanitizeLevelName(name: string): string {
  const t = String(name ?? '').trim() || 'Untitled'
  return t.replace(/[^\w.-]+/g, '_').slice(0, 64)
}

function sanitizeSlot(slot: string): string {
  const t = String(slot ?? '').trim()
  if (!t) return 'slot0'
  return t.replace(/[^\w.-]+/g, '_').slice(0, 32)
}

function storageKey(slot: string): string {
  return `${STORAGE_PREFIX}.${sanitizeLevelName(levelName)}.${sanitizeSlot(slot)}`
}

/** Configure active level + whether save APIs are enabled (PIE + export). */
export function setSaveContext(opts: { levelName?: string; enabled?: boolean }): void {
  if (opts.levelName !== undefined) levelName = opts.levelName
  if (opts.enabled !== undefined) enabled = !!opts.enabled
}

export function isSaveEnabled(): boolean {
  return enabled
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
      level: sanitizeLevelName(levelName),
      slot: sanitizeSlot(slot),
      data,
    }
    localStorage.setItem(storageKey(slot), JSON.stringify(payload))
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

/** List slot ids that have saved data for the active level. */
export function listSlots(): string[] {
  if (!enabled) return []
  const prefix = `${STORAGE_PREFIX}.${sanitizeLevelName(levelName)}.`
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