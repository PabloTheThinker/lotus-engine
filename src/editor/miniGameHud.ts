import type { ScriptApi } from '../engine/scripting'
import { MINIGAME_MANAGER_NAME } from './starterMiniGames'

const OVERLAY_ID = 'lotus-minigame-overlay'

export const ACHIEVEMENT_TOAST_CSS = `
  .lotus-achievement-toast {
    position: fixed; top: 18px; right: 18px; z-index: 30; pointer-events: none;
    display: flex; align-items: center; gap: 12px;
    padding: 12px 16px; border-radius: 10px;
    background: rgba(13, 15, 18, 0.92); border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 10px 28px rgba(0, 0, 0, 0.42);
    font: 600 13px system-ui, sans-serif; color: #e8edf4;
    animation: lotus-ach-toast-in 0.32s ease-out, lotus-ach-toast-out 0.35s ease-in 2.65s forwards;
  }
  .lotus-achievement-toast-icon {
    font-size: 22px; line-height: 1;
  }
  .lotus-achievement-toast-title {
    font-size: 14px; font-weight: 800; letter-spacing: 0.03em; color: #f6d365;
  }
  .lotus-achievement-toast-sub {
    margin-top: 2px; font-size: 11px; font-weight: 500; color: #9aa4b2;
  }
  @keyframes lotus-ach-toast-in {
    from { opacity: 0; transform: translateY(-8px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
  }
  @keyframes lotus-ach-toast-out {
    to { opacity: 0; transform: translateY(-6px); }
  }
`

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
let toastRoot: HTMLElement | null = null
let toastTimer: ReturnType<typeof setTimeout> | null = null
let wired = false
let achievementWired = false
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

function achievementToastHost(parent?: HTMLElement): HTMLElement {
  return parent ?? document.body
}

/** Trophy unlock toast during PIE / export play. */
export function showAchievementToast(
  title: string,
  subtitle?: string,
  icon = '🏆',
  parent?: HTMLElement,
) {
  if (toastTimer) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
  toastRoot?.remove()
  const host = achievementToastHost(parent)
  toastRoot = document.createElement('div')
  toastRoot.className = 'lotus-achievement-toast'
  toastRoot.innerHTML = `<div class="lotus-achievement-toast-icon">${icon}</div>
    <div>
      <div class="lotus-achievement-toast-title">${title}</div>
      ${subtitle ? `<div class="lotus-achievement-toast-sub">${subtitle}</div>` : ''}
    </div>`
  host.appendChild(toastRoot)
  toastTimer = setTimeout(() => {
    toastRoot?.remove()
    toastRoot = null
    toastTimer = null
  }, 3200)
}

export function hideAchievementToast() {
  if (toastTimer) {
    clearTimeout(toastTimer)
    toastTimer = null
  }
  toastRoot?.remove()
  toastRoot = null
}

function onAchievementUnlock(payload: unknown) {
  const ach =
    payload && typeof payload === 'object'
      ? (payload as { title?: string; description?: string; icon?: string })
      : null
  const title = ach?.title?.trim() || 'Achievement Unlocked'
  const subtitle = ach?.description?.trim()
  showAchievementToast(title, subtitle, ach?.icon ?? '🏆')
}

/** Listen for achievement_unlock and show trophy toast. */
export function wireAchievementToasts(api: Pick<ScriptApi, 'on'>) {
  if (achievementWired) return
  achievementWired = true
  api.on('achievement_unlock', onAchievementUnlock)
}

/** Listen for game_won / game_lost and show overlays. */
export function wireMiniGameHud(api: Pick<ScriptApi, 'on'>) {
  if (wired) return
  wired = true
  api.on('game_won', () => showWinOverlay())
  api.on('game_lost', () => showLoseOverlay())
  wireAchievementToasts(api)
}

export function unwireMiniGameHud() {
  wired = false
  achievementWired = false
  hideMiniGameHud()
  hideAchievementToast()
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