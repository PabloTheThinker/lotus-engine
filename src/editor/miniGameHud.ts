import type { ScriptApi } from '../engine/scripting'
import { MINIGAME_MANAGER_NAME } from './starterMiniGames'

const OVERLAY_ID = 'lotus-minigame-overlay'

export const MINIGAME_OVERLAY_CSS = `
  .lotus-minigame-overlay {
    position: fixed; inset: 0; z-index: 25; pointer-events: none;
    display: flex; align-items: center; justify-content: center;
    background: rgba(13, 15, 18, 0.55);
    animation: lotus-mg-fade-in 0.35s ease-out;
  }
  .lotus-minigame-panel {
    text-align: center; padding: 28px 48px; border-radius: 12px;
    background: rgba(13, 15, 18, 0.88); border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
  }
  .lotus-minigame-title {
    font: 800 36px system-ui, sans-serif; letter-spacing: 0.04em;
    text-shadow: 0 2px 8px rgba(0, 0, 0, 0.65);
  }
  .lotus-minigame-sub {
    margin-top: 10px; font: 600 14px system-ui, sans-serif; color: #c8d0d8;
  }
  @keyframes lotus-mg-fade-in {
    from { opacity: 0; transform: scale(0.96); }
    to { opacity: 1; transform: scale(1); }
  }
`

let overlayRoot: HTMLElement | null = null
let wired = false
let hudEnabled = false

function overlayHost(parent?: HTMLElement): HTMLElement {
  return parent ?? document.body
}

function renderOverlay(kind: 'win' | 'lose', title: string, color: string, parent?: HTMLElement) {
  hideMiniGameHud()
  const host = overlayHost(parent)
  overlayRoot = document.createElement('div')
  overlayRoot.id = OVERLAY_ID
  overlayRoot.className = `lotus-minigame-overlay lotus-minigame-${kind}`
  overlayRoot.innerHTML = `<div class="lotus-minigame-panel">
    <div class="lotus-minigame-title" style="color:${color}">${title}</div>
    <div class="lotus-minigame-sub">${kind === 'win' ? 'Great run!' : 'Try again — press Stop and Play'}</div>
  </div>`
  host.appendChild(overlayRoot)
}

/** Full-screen win overlay during PIE / export play. */
export function showWinOverlay(parent?: HTMLElement) {
  renderOverlay('win', 'YOU WIN!', '#46a758', parent)
}

/** Full-screen lose overlay during PIE / export play. */
export function showLoseOverlay(parent?: HTMLElement) {
  renderOverlay('lose', 'GAME OVER', '#e5484d', parent)
}

export function hideMiniGameHud() {
  overlayRoot?.remove()
  overlayRoot = null
}

/** Listen for game_won / game_lost and show overlays. */
export function wireMiniGameHud(api: Pick<ScriptApi, 'on'>) {
  if (wired) return
  wired = true
  api.on('game_won', () => showWinOverlay())
  api.on('game_lost', () => showLoseOverlay())
}

export function unwireMiniGameHud() {
  wired = false
  hideMiniGameHud()
}

export function hasMiniGameManager(actors: Iterable<{ name: string }>): boolean {
  for (const a of actors) {
    if (a.name === MINIGAME_MANAGER_NAME) return true
  }
  return false
}

/** Mark scene for HUD wiring on next Play (spawnMiniGame). */
export function enableMiniGameHud() {
  hudEnabled = true
}

export function isMiniGameHudEnabled() {
  return hudEnabled
}

export function resetMiniGameHudState() {
  hudEnabled = false
}

export function mountMiniGameHudForPlay(parent: HTMLElement, api: Pick<ScriptApi, 'on'>) {
  wireMiniGameHud(api)
  void parent
}

export function unmountMiniGameHudForPlay() {
  unwireMiniGameHud()
  resetMiniGameHudState()
}