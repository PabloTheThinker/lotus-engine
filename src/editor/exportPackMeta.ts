import { miniGamePackTitle } from './miniGameExportPack'
import type { MiniGameMode } from './starterMiniGames'

/** v3.24 — itch.io upload sidecar fields embedded as __LOTUS_PACK_META__. */
export interface ExportPackMeta {
  title: string
  description: string
  /** itch.io classification / genre tags */
  tags: string[]
  kind: 'html'
  version: string
}

const PACK_DESCRIPTIONS: Record<MiniGameMode, string> = {
  platformer: 'Jump to the goal in this Lotus Engine platformer mini-game pack.',
  rpg: 'Collect NPCs and complete the quest in this top-down RPG mini-game pack.',
  fps: 'Eliminate targets in this corridor FPS mini-game pack.',
}

const PACK_GENRE_TAGS: Record<MiniGameMode, string[]> = {
  platformer: ['platformer', 'action', 'arcade'],
  rpg: ['rpg', 'top-down', 'adventure'],
  fps: ['fps', 'shooter', 'action'],
}

/** Build itch.io JSON sidecar for a mini-game export pack genre. */
export function buildExportPackMeta(mode: MiniGameMode): ExportPackMeta {
  return {
    title: miniGamePackTitle(mode),
    description: PACK_DESCRIPTIONS[mode],
    tags: [...PACK_GENRE_TAGS[mode]],
    kind: 'html',
    version: '1.0',
  }
}

export function serializePackMetaForExport(meta: ExportPackMeta): string {
  return JSON.stringify(meta).replace(/</g, '\\u003c')
}