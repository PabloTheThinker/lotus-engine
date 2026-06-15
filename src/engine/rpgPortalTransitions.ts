/**
 * Wave 103 (v5.54–v5.58) — Portal transition UX: loading label + fade overlay for changeScene.
 */

import { transitionIn, transitionOut } from '../editor/sceneTransitions'

export const PORTAL_LOADING_OVERLAY_ID = 'lotus-portal-loading'
const DEFAULT_MS = 420

function ensureLoadingOverlay(): HTMLDivElement {
  let el = document.getElementById(PORTAL_LOADING_OVERLAY_ID) as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = PORTAL_LOADING_OVERLAY_ID
    el.setAttribute('aria-live', 'polite')
    el.style.cssText =
      'position:fixed;inset:0;z-index:10001;display:none;align-items:center;justify-content:center;' +
      'background:rgba(8,10,14,.72);color:#e8edf4;font:700 15px system-ui,sans-serif;letter-spacing:.06em;pointer-events:auto'
    document.body.appendChild(el)
  }
  return el
}

export function showPortalLoading(label: string): void {
  const el = ensureLoadingOverlay()
  el.textContent = label.trim() || 'Loading…'
  el.style.display = 'flex'
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

/** Fade out + loading label before scene swap. */
export async function portalTransitionOut(targetLevel: string, ms = DEFAULT_MS): Promise<void> {
  showPortalLoading(portalLabelForTarget(targetLevel))
  await transitionOut('fade', ms)
}

/** Reveal scene after load completes. */
export async function portalTransitionIn(ms = DEFAULT_MS): Promise<void> {
  await transitionIn('fade', ms)
  hidePortalLoading()
}

export function resetPortalTransitions(): void {
  hidePortalLoading()
}