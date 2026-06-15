/** Wave 98 (v5.29–v5.33) — RPG overworld streaming export pack. */

import { captureExportScreenshot } from './captureExportScreenshot'
import { buildPlayableHTML, type ExportOptions } from './exportPlayable'
import { scheduleExportPerfProbe } from './exportPerfProbe'
import { miniGamePackIconStub } from './miniGameExportPack'
import { spawnRpgOverworldStarter } from './rpgOverworldStarter'
import { useEditor } from './store'

export const RPG_OVERWORLD_PACK_ID = 'rpgoverworld' as const

export function rpgOverworldPackTitle(): string {
  return 'Lotus RPG Overworld Pack'
}

/** Build offline-capable PWA HTML for the streaming overworld template. */
export function buildRpgOverworldPackHTML(opts: ExportOptions = {}): string {
  const screenshot = opts.packScreenshotB64 ?? captureExportScreenshot().base64
  return buildPlayableHTML({
    ...opts,
    pwa: true,
    rpgOverworld: true,
    quality: opts.quality ?? 'mobile',
    packMeta:
      opts.packMeta ?? {
        title: rpgOverworldPackTitle(),
        description: '2×2 streaming overworld with interior changeScene portals.',
        tags: ['rpg', '3d', 'streaming', 'overworld'],
        kind: 'html' as const,
        version: '1.0',
      },
    packScreenshotB64: screenshot,
    pwaIcons: opts.pwaIcons ?? miniGamePackIconStub(),
  })
}

function downloadPackHtml(filename: string, html: string) {
  const blob = new Blob([html], { type: 'text/html' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
  useEditor.getState().setStatus(`Exported RPG overworld pack: ${a.download}`)
  scheduleExportPerfProbe()
}

/** Spawn overworld preset, then download a single-file PWA pack. */
export function exportRpgOverworldPack(opts: ExportOptions = {}) {
  spawnRpgOverworldStarter()
  const html = buildRpgOverworldPackHTML(opts)
  downloadPackHtml('rpgoverworld.pack.html', html)
}