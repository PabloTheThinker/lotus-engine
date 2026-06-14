/** Wave 60 (v3.39–v3.43) — cell load progress for export + editor bridge. */

export const STREAM_PROGRESS_BAR_ID = 'lotus-stream-progress'

export interface StreamingProgressState {
  cellsLoaded: number
  cellsTotal: number
  percent: number
  active: boolean
}

let state: StreamingProgressState = {
  cellsLoaded: 0,
  cellsTotal: 0,
  percent: 0,
  active: false,
}

export function resetStreamingProgress(): void {
  state = { cellsLoaded: 0, cellsTotal: 0, percent: 0, active: false }
}

/** Start tracking a batch of cells to load (0 total → immediate 100%). */
export function beginStreamingProgress(total: number): void {
  const cellsTotal = Math.max(0, total)
  state = {
    cellsLoaded: 0,
    cellsTotal,
    percent: cellsTotal <= 0 ? 100 : 0,
    active: cellsTotal > 0,
  }
}

/** Mark one cell as loaded and refresh percent (0–100, rounded). */
export function noteStreamingCellLoaded(): void {
  if (state.cellsTotal <= 0) {
    state.percent = 100
    state.active = false
    return
  }
  state.cellsLoaded = Math.min(state.cellsTotal, state.cellsLoaded + 1)
  state.percent = Math.round((state.cellsLoaded / state.cellsTotal) * 100)
  if (state.cellsLoaded >= state.cellsTotal) {
    state.active = false
    state.percent = 100
  }
}

export function getStreamingProgress(): StreamingProgressState {
  return { ...state }
}

export function getProgress(): number {
  return state.percent
}

export function getCellsLoaded(): number {
  return state.cellsLoaded
}

export function getCellsTotal(): number {
  return state.cellsTotal
}

export function ensureStreamProgressBar(): HTMLDivElement {
  let el = document.getElementById(STREAM_PROGRESS_BAR_ID) as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = STREAM_PROGRESS_BAR_ID
    el.setAttribute('aria-hidden', 'true')
    el.style.position = 'fixed'
    el.style.left = '50%'
    el.style.bottom = '24px'
    el.style.transform = 'translateX(-50%)'
    el.style.width = 'min(320px, 80vw)'
    el.style.height = '6px'
    el.style.background = 'rgba(255,255,255,.12)'
    el.style.borderRadius = '4px'
    el.style.overflow = 'hidden'
    el.style.zIndex = '25'
    el.style.pointerEvents = 'none'
    el.style.opacity = '0'
    el.style.transition = 'opacity .2s ease'
    const fill = document.createElement('div')
    fill.className = 'lotus-stream-progress-fill'
    fill.style.height = '100%'
    fill.style.width = '0%'
    fill.style.background = 'linear-gradient(90deg,#2f80ed,#46a758)'
    fill.style.borderRadius = '4px'
    fill.style.transition = 'width .15s ease'
    el.appendChild(fill)
    document.body.appendChild(el)
  }
  return el
}

export function updateStreamProgressBar(progress = getStreamingProgress()): void {
  const el = ensureStreamProgressBar()
  const fill = el.querySelector('.lotus-stream-progress-fill') as HTMLDivElement | null
  if (!fill) return
  fill.style.width = `${progress.percent}%`
  el.style.opacity = progress.active || progress.percent < 100 ? '1' : '0'
}

export function hideStreamProgressBar(): void {
  const el = document.getElementById(STREAM_PROGRESS_BAR_ID) as HTMLDivElement | null
  if (el) el.style.opacity = '0'
  state.active = false
}

/** Show the bar and reset counters for a new batch. */
export function showStreamProgressDuringLoad(total: number): void {
  beginStreamingProgress(total)
  updateStreamProgressBar()
}

/** Increment loaded count, refresh bar, and fade out when complete. */
export function tickStreamProgressCell(): void {
  noteStreamingCellLoaded()
  updateStreamProgressBar()
  if (!state.active && state.percent >= 100) {
    window.setTimeout(() => hideStreamProgressBar(), 320)
  }
}