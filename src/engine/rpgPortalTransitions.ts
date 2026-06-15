/**
 * Wave 103 (v5.54–v5.58) — Portal transition UX: loading label + fade overlay for changeScene.
 * Wave 109 (v5.84–v5.88) — Slide cinematic variant + cell preload progress ring.
 */

import { transitionIn, transitionOut } from '../editor/sceneTransitions'

export const PORTAL_LOADING_OVERLAY_ID = 'lotus-portal-loading'
export const PORTAL_PROGRESS_RING_ID = 'lotus-portal-progress-ring'
const DEFAULT_MS = 420

function ensureLoadingOverlay(): HTMLDivElement {
  let el = document.getElementById(PORTAL_LOADING_OVERLAY_ID) as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = PORTAL_LOADING_OVERLAY_ID
    el.setAttribute('aria-live', 'polite')
    el.style.cssText =
      'position:fixed;inset:0;z-index:10001;display:none;flex-direction:column;gap:18px;' +
      'align-items:center;justify-content:center;background:rgba(8,10,14,.72);color:#e8edf4;' +
      'font:700 15px system-ui,sans-serif;letter-spacing:.06em;pointer-events:auto'
    const label = document.createElement('span')
    label.id = 'lotus-portal-loading-label'
    const ring = document.createElement('div')
    ring.id = PORTAL_PROGRESS_RING_ID
    ring.style.cssText =
      'width:52px;height:52px;border-radius:50%;background:conic-gradient(#7ec8a4 var(--lotus-portal-pct,0%),rgba(255,255,255,.12) 0);' +
      'mask:radial-gradient(farthest-side,transparent calc(100% - 6px),#000 calc(100% - 5px));-webkit-mask:radial-gradient(farthest-side,transparent calc(100% - 6px),#000 calc(100% - 5px))'
    el.appendChild(label)
    el.appendChild(ring)
    document.body.appendChild(el)
  }
  return el
}

function loadingLabelEl(): HTMLSpanElement | null {
  return document.getElementById('lotus-portal-loading-label') as HTMLSpanElement | null
}

export function showPortalLoading(label: string): void {
  const el = ensureLoadingOverlay()
  const labelEl = loadingLabelEl()
  if (labelEl) labelEl.textContent = label.trim() || 'Loading…'
  el.style.display = 'flex'
}

/** Update cell preload progress ring (0–100). */
export function setPortalPreloadProgress(percent: number): void {
  ensureLoadingOverlay()
  const ring = document.getElementById(PORTAL_PROGRESS_RING_ID)
  if (!ring) return
  const pct = Math.max(0, Math.min(100, Math.floor(Number(percent) || 0)))
  ring.style.setProperty('--lotus-portal-pct', `${pct}%`)
  ring.style.display = pct > 0 && pct < 100 ? 'block' : 'none'
}

export function hidePortalLoading(): void {
  const el = document.getElementById(PORTAL_LOADING_OVERLAY_ID) as HTMLDivElement | null
  if (el) el.style.display = 'none'
}

export function portalLabelForTarget(targetLevel: string): string {
  const key = String(targetLevel ?? '').trim().toLowerCase()
  if (key.includes('interior')) return 'Entering interior…'
  if (key.includes('overworld')) return 'Returning to overworld…'
  return `Loading ${targetLevel}…`
}

export type PortalTransitionKind = 'fade' | 'slideLeft'

/** Fade or slide out + loading label before scene swap. */
export async function portalTransitionOut(
  targetLevel: string,
  ms = DEFAULT_MS,
  kind: PortalTransitionKind = 'fade',
): Promise<void> {
  showPortalLoading(portalLabelForTarget(targetLevel))
  await transitionOut(kind, ms)
}

/** Reveal scene after load completes. */
export async function portalTransitionIn(ms = DEFAULT_MS, kind: PortalTransitionKind = 'fade'): Promise<void> {
  await transitionIn(kind, ms)
  hidePortalLoading()
  setPortalPreloadProgress(0)
}

/** Slide cinematic portal out with optional preload progress simulation. */
export async function portalCinematicOut(
  targetLevel: string,
  opts?: { ms?: number; preloadSteps?: number },
): Promise<void> {
  const ms = opts?.ms ?? DEFAULT_MS
  const steps = Math.max(1, Math.floor(opts?.preloadSteps ?? 4))
  showPortalLoading(portalLabelForTarget(targetLevel))
  await transitionOut('slideLeft', ms)
  for (let i = 1; i <= steps; i++) {
    setPortalPreloadProgress(Math.round((i / steps) * 100))
    await new Promise((r) => window.setTimeout(r, 48))
  }
}

export function resetPortalTransitions(): void {
  hidePortalLoading()
  setPortalPreloadProgress(0)
}