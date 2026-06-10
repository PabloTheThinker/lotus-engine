import runtimeSource from '../export/runtime.js?raw'
import { world } from '../engine/World'
import { useEditor } from './store'

/**
 * One-click playable export (the Godot HTML5-export analog, but native):
 * a single standalone .html embedding the level JSON + runtime, with
 * three.js and Rapier resolved from CDN. Open the file — play the game.
 */
export function buildPlayableHTML(): string {
  const s = useEditor.getState()
  world.levelName = s.levelName
  const level = world.serialize()
  const levelJSON = JSON.stringify(level).replace(/</g, '\\u003c')
  const title = s.levelName || 'Vektra Level'

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title} — Vektra Engine</title>
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
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.184.0/examples/jsm/",
    "@dimforge/rapier3d-compat": "https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.19.3/+esm"
  }
}
</script>
</head>
<body>
<div id="overlay">Loading…</div>
<div id="badge">VEKTRA ENGINE</div>
<script>window.__VEKTRA_LEVEL__ = ${levelJSON}</script>
<script type="module">
${runtimeSource}
</script>
</body>
</html>`
}

export function exportPlayable() {
  const s = useEditor.getState()
  const html = buildPlayableHTML()
  const blob = new Blob([html], { type: 'text/html' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${(s.levelName || 'level').replace(/[^\w-]+/g, '_')}.play.html`
  a.click()
  URL.revokeObjectURL(a.href)
  s.setStatus(`Exported playable: ${a.download}`)
}
