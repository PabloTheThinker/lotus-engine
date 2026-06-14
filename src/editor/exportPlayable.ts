import runtimeSource from '../export/runtime.js?raw'
import { splitLevelByCells } from '../engine/streaming'
import { sanitizeLevelKey, world } from '../engine/World'
import type { SerializedLevel } from '../engine/types'
import { loadPrefs, type ExportQuality } from './Preferences'
import { loadProjectSettings } from './projectSettings'
import { useEditor } from './store'

export interface ExportOptions {
  /** add PWA manifest + service worker stub for offline single-file play */
  pwa?: boolean
  /** mobile: no bloom, capped pixel ratio; desktop: editor defaults */
  quality?: ExportQuality
}

function escapeJsonForScript(json: string): string {
  return json.replace(/</g, '\\u003c')
}

function applyQualityToLevel(level: SerializedLevel, quality: ExportQuality): SerializedLevel {
  if (quality !== 'mobile') return level
  return {
    ...level,
    environment: {
      ...level.environment,
      bloomEnabled: false,
      bloomStrength: 0,
    },
  }
}

function buildLevelsManifest(mainLevel: SerializedLevel): { levels: Record<string, SerializedLevel>; main: string } {
  const levels: Record<string, SerializedLevel> = { main: mainLevel }
  for (const link of world.levelLinks) {
    const key = sanitizeLevelKey(link.name)
    if (key === 'main') continue
    levels[key] = link.level
  }
  return { levels, main: 'main' }
}

function pwaHeadExtras(title: string): string {
  const manifest = {
    name: title,
    short_name: title.slice(0, 12),
    display: 'fullscreen',
    orientation: 'landscape',
    background_color: '#0d0f12',
    theme_color: '#0d0f12',
    start_url: '.',
    icons: [],
  }
  const manifestB64 = btoa(JSON.stringify(manifest))
  return `<link rel="manifest" href="data:application/manifest+json;base64,${manifestB64}" />
<meta name="theme-color" content="#0d0f12" />
<meta name="apple-mobile-web-app-capable" content="yes" />`
}

function pwaBootScript(): string {
  return `<script>
if ('serviceWorker' in navigator) {
  const sw = [
    "self.addEventListener('install', (e) => {",
    "  e.waitUntil(caches.open('lotus-v1').then((c) => c.add(self.location.href)));",
    "  self.skipWaiting();",
    "});",
    "self.addEventListener('activate', (e) => { e.waitUntil(self.clients.claim()); });",
    "self.addEventListener('fetch', (e) => {",
    "  if (e.request.method !== 'GET') return;",
    "  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));",
    "});",
  ].join('\\n');
  const blob = new Blob([sw], { type: 'application/javascript' });
  navigator.serviceWorker.register(URL.createObjectURL(blob)).catch(() => {});
}
</script>`
}

/**
 * One-click playable export (the Godot HTML5-export analog, but native):
 * a single standalone .html embedding level JSON + runtime, with
 * three.js and Rapier resolved from CDN. Open the file — play the game.
 */
export function buildPlayableHTML(opts: ExportOptions = {}): string {
  const s = useEditor.getState()
  const prefs = loadPrefs()
  const quality = opts.quality ?? prefs.exportQuality
  world.levelName = s.levelName
  let mainLevel = applyQualityToLevel(world.serialize(), quality)
  let cellsJSON = 'null'
  if (mainLevel.streaming?.exportByCell) {
    const split = splitLevelByCells(mainLevel)
    mainLevel = { ...mainLevel, actors: split.globalActors }
    cellsJSON = escapeJsonForScript(JSON.stringify(split.cells))
  }
  const { levels, main } = buildLevelsManifest(mainLevel)
  const levelsJSON = escapeJsonForScript(JSON.stringify(levels))
  const exportJSON = escapeJsonForScript(
    JSON.stringify({
      quality,
      pixelRatio: quality === 'mobile' ? 1 : undefined,
      renderBackend: mainLevel.environment.renderBackend ?? 'webgl',
    }),
  )
  const title = s.levelName || 'Lotus Level'
  const pwa = !!opts.pwa
  const branding = loadProjectSettings().showLotusBranding
  const badgeHtml = branding
    ? `<div id="badge">LOTUS ENGINE${pwa ? ' · PWA' : ''}</div>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Lotus Engine</title>
${pwa ? pwaHeadExtras(title) : ''}
<style>
  html, body { margin: 0; height: 100%; overflow: hidden; background: #0d0f12; }
  canvas { display: block; }
  #overlay {
    position: fixed; top: 14px; left: 50%; transform: translateX(-50%);
    font: 600 13px system-ui, sans-serif; color: #fff; background: rgba(13,15,18,.75);
    padding: 6px 16px; border-radius: 6px; pointer-events: none; z-index: 5;
  }
  #badge {
    position: fixed; bottom: 10px; right: 12px; font: 11px system-ui, sans-serif;
    color: #79828f; z-index: 5; pointer-events: none;
  }
</style>
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.js",
    "three/webgpu": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.webgpu.js",
    "three/tsl": "https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.tsl.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/",
    "@dimforge/rapier3d-compat": "https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.19.3/+esm"
  }
}
</script>
</head>
<body>
<div id="overlay">Loading…</div>
${badgeHtml}
<script>window.__LOTUS_LEVELS__ = ${levelsJSON}; window.__LOTUS_MAIN__ = '${main}'; window.__LOTUS_EXPORT__ = ${exportJSON}; window.__LOTUS_CELLS__ = ${cellsJSON}; window.__LOTUS_BATCHED__ = ${mainLevel.batchedMeshes?.length ? escapeJsonForScript(JSON.stringify(mainLevel.batchedMeshes)) : 'null'};</script>
${pwa ? pwaBootScript() : ''}
<script type="module">
${runtimeSource}
</script>
</body>
</html>`
}

function downloadHtml(filename: string, html: string) {
  const blob = new Blob([html], { type: 'text/html' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
  useEditor.getState().setStatus(`Exported playable: ${a.download}`)
}

export function exportPlayable(opts: ExportOptions = {}) {
  const s = useEditor.getState()
  const base = (s.levelName || 'level').replace(/[^\w-]+/g, '_')
  downloadHtml(`${base}.play.html`, buildPlayableHTML(opts))
}

export function exportPlayablePWA() {
  exportPlayable({ pwa: true })
}