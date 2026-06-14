import changelogRaw from '../../CHANGELOG.md?raw'
import { buildExportPackMeta } from './exportPackMeta'
import { miniGamePackTitle } from './miniGameExportPack'
import type { MiniGameMode } from './starterMiniGames'

const LATEST_WAVES_HEADER = /^## \d{4}-\d{2}-\d{2} — Waves \d+–\d+:/

/** Parse the newest multi-wave CHANGELOG section (first dated Waves block). */
export function parseLatestWavesSection(source: string = changelogRaw): string {
  const lines = source.split('\n')
  const out: string[] = []
  let capturing = false

  for (const line of lines) {
    if (!capturing) {
      if (LATEST_WAVES_HEADER.test(line)) {
        capturing = true
        out.push(line)
      }
      continue
    }
    if (line === '---') break
    out.push(line)
  }

  return out.join('\n').trim()
}

/** Build itch.io release notes markdown for a mini-game pack genre. */
export function buildReleaseNotes(mode: MiniGameMode, source?: string): string {
  const title = miniGamePackTitle(mode)
  const { description } = buildExportPackMeta(mode)
  const waves = parseLatestWavesSection(source ?? changelogRaw)
  return [`# ${title}`, '', description, '', "## What's new", '', waves].join('\n')
}

export function serializeReleaseNotesForExport(notes: string): string {
  return JSON.stringify(notes).replace(/</g, '\\u003c')
}