import { buildPlayableHTML, type ExportOptions } from './exportPlayable'
import { scheduleExportPerfProbe } from './exportPerfProbe'
import { spawnMiniGame, type MiniGameMode } from './starterMiniGames'
import { useEditor } from './store'

/** v2.99 — bundled PWA export presets per mini-game genre. */
export const MINIGAME_PACK_MODES: readonly MiniGameMode[] = ['platformer', 'rpg', 'fps'] as const

/** Minimal 1×1 PNG (teal) — embedded PWA manifest icon stub. */
export const MINIGAME_PACK_ICON_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

export const MINIGAME_PACK_ICON_DATA_URI = `data:image/png;base64,${MINIGAME_PACK_ICON_B64}`

const PACK_LABELS: Record<MiniGameMode, string> = {
  platformer: 'Platformer',
  rpg: 'RPG',
  fps: 'FPS',
}

export function miniGamePackTitle(mode: MiniGameMode): string {
  return `Lotus ${PACK_LABELS[mode]} Pack`
}

export function miniGamePackIconStub() {
  return [
    { src: MINIGAME_PACK_ICON_DATA_URI, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: MINIGAME_PACK_ICON_DATA_URI, sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
  ]
}

/** Build offline-capable PWA HTML for a genre preset (does not mutate the editor scene). */
export function buildMiniGamePackHTML(mode: MiniGameMode, opts: ExportOptions = {}): string {
  return buildPlayableHTML({
    ...opts,
    pwa: true,
    minigameHud: true,
    minigamePreset: mode,
    minigamePack: mode,
    pwaIcons: opts.pwaIcons ?? miniGamePackIconStub(),
    quality: opts.quality ?? 'mobile',
  })
}

function downloadPackHtml(filename: string, html: string) {
  const blob = new Blob([html], { type: 'text/html' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
  useEditor.getState().setStatus(`Exported mini-game pack: ${a.download}`)
  scheduleExportPerfProbe()
}

/** Spawn preset level for mode, then download a single-file PWA pack. */
export function exportMiniGamePack(mode: MiniGameMode, opts: ExportOptions = {}) {
  spawnMiniGame(mode)
  const html = buildMiniGamePackHTML(mode, opts)
  downloadPackHtml(`${mode}.pack.html`, html)
}