export type ViewportPane = 'perspective' | 'top' | 'front' | 'side'
export type ViewportLayout = 'single' | 'quad'

export const VIEWPORT_STORAGE_KEY = 'lotus-engine.viewport'

export interface ViewportPrefs {
  layout: ViewportLayout
  maximizedPane: ViewportPane | null
}

export interface PaneRect {
  pane: ViewportPane
  /** screen-space px from canvas top-left */
  screenX: number
  screenY: number
  w: number
  h: number
}

export const PANE_LABELS: Record<ViewportPane, string> = {
  perspective: 'Perspective',
  top: 'Top',
  front: 'Front',
  side: 'Side',
}

export function loadViewportPrefs(): ViewportPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEWPORT_STORAGE_KEY) ?? '{}') as Partial<ViewportPrefs>
    const layout: ViewportLayout = raw.layout === 'quad' ? 'quad' : 'single'
    const maximizedPane =
      layout === 'quad' && raw.maximizedPane && ['perspective', 'top', 'front', 'side'].includes(raw.maximizedPane)
        ? raw.maximizedPane
        : null
    return { layout, maximizedPane }
  } catch {
    return { layout: 'single', maximizedPane: null }
  }
}

export function saveViewportPrefs(prefs: ViewportPrefs) {
  localStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify(prefs))
}

/** UE default quad: Perspective | Top / Front | Side (2×2). */
export function computePanes(
  canvasW: number,
  canvasH: number,
  layout: ViewportLayout,
  maximized: ViewportPane | null,
): PaneRect[] {
  if (layout === 'single' && !maximized) {
    return [{ pane: 'perspective', screenX: 0, screenY: 0, w: canvasW, h: canvasH }]
  }
  if (maximized) {
    return [{ pane: maximized, screenX: 0, screenY: 0, w: canvasW, h: canvasH }]
  }
  const hw = Math.floor(canvasW / 2)
  const hh = Math.floor(canvasH / 2)
  const rw = canvasW - hw
  const rh = canvasH - hh
  return [
    { pane: 'perspective', screenX: 0, screenY: 0, w: hw, h: hh },
    { pane: 'top', screenX: hw, screenY: 0, w: rw, h: hh },
    { pane: 'front', screenX: 0, screenY: hh, w: hw, h: rh },
    { pane: 'side', screenX: hw, screenY: hh, w: rw, h: rh },
  ]
}

export function paneAt(panes: PaneRect[], x: number, y: number): ViewportPane | null {
  for (const p of panes) {
    if (x >= p.screenX && x < p.screenX + p.w && y >= p.screenY && y < p.screenY + p.h) return p.pane
  }
  return null
}

/** WebGL viewport origin is bottom-left. */
export function toWebGLViewport(p: PaneRect, canvasH: number) {
  return { x: Math.floor(p.screenX), y: Math.floor(canvasH - p.screenY - p.h), w: Math.floor(p.w), h: Math.floor(p.h) }
}

export function paneFromProjection(p: 'perspective' | 'top' | 'front' | 'side'): ViewportPane {
  return p
}