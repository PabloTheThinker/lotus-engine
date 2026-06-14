import type { ExportPackMeta } from './exportPackMeta'

/** v3.74 — localStorage key for last itch.io zip filename (Butler CLI hint). */
export const ITCH_LAST_ZIP_KEY = 'lotus-engine.itch.lastZip'

/** Build itch.io Butler CLI push command from pack metadata and zip path. */
export function buildButlerPushCommand(
  meta: ExportPackMeta,
  zipPath: string,
  user = 'user',
  game = 'game',
): string {
  return `butler push ${zipPath} ${user}/${game}:${meta.kind}`
}

export function storeLastItchZipName(zipName: string): void {
  try {
    localStorage.setItem(ITCH_LAST_ZIP_KEY, zipName)
  } catch {
    /* quota / private mode */
  }
}

export function loadLastItchZipName(): string | null {
  try {
    return localStorage.getItem(ITCH_LAST_ZIP_KEY)
  } catch {
    return null
  }
}