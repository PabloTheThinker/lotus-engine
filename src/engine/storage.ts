/** Lotus Engine localStorage keys — migrates legacy `lotus-engine.*` on read. */

const LEGACY_PREFIX = 'lotus-engine.'
const PREFIX = 'lotus-engine.'

export function storageKey(suffix: string): string {
  return PREFIX + suffix
}

export function readStorage(suffix: string): string | null {
  const key = storageKey(suffix)
  const legacy = LEGACY_PREFIX + suffix
  const val = localStorage.getItem(key) ?? localStorage.getItem(legacy)
  if (val && !localStorage.getItem(key) && localStorage.getItem(legacy)) {
    try {
      localStorage.setItem(key, val)
    } catch {
      /* quota — still readable */
    }
  }
  return val
}

export function writeStorage(suffix: string, value: string): void {
  localStorage.setItem(storageKey(suffix), value)
}

export function removeStorage(suffix: string): void {
  localStorage.removeItem(storageKey(suffix))
  localStorage.removeItem(LEGACY_PREFIX + suffix)
}