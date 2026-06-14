/** v3.25 — viewport canvas → PNG base64 for itch.io pack screenshots; stub for headless E2E. */

/** Minimal 1×1 teal PNG — fallback when canvas capture is unavailable. */
export const EXPORT_SCREENSHOT_STUB_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='

export interface ExportScreenshotResult {
  base64: string
  /** true when the stub was used instead of a live canvas capture */
  stub: boolean
}

/** Capture the editor viewport canvas as PNG base64; returns stub in headless / E2E. */
export function captureExportScreenshot(): ExportScreenshotResult {
  try {
    const gfx = (window as unknown as { lotusGfx?: { renderer?: { domElement?: HTMLCanvasElement } } }).lotusGfx
    const canvas = gfx?.renderer?.domElement
    if (canvas && typeof canvas.toDataURL === 'function') {
      const dataUrl = canvas.toDataURL('image/png')
      const m = dataUrl.match(/^data:image\/png;base64,(.+)$/)
      if (m?.[1]) return { base64: m[1], stub: false }
    }
  } catch {
    /* tainted canvas or headless */
  }
  return { base64: EXPORT_SCREENSHOT_STUB_B64, stub: true }
}