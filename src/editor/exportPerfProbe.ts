import { buildPlayableHTML } from './exportPlayable'
import { useEditor } from './store'

const PROBE_WAIT_MS = 6000
let scheduleTimer: ReturnType<typeof setTimeout> | null = null

/** Wave 25 — debounced re-probe after save/export. */
export function scheduleExportPerfProbe(delayMs = 2500) {
  if (scheduleTimer) clearTimeout(scheduleTimer)
  scheduleTimer = setTimeout(() => {
    scheduleTimer = null
    probeExportPerfGate()
  }, delayMs)
}

/** Wave 24 — boot playable export in hidden iframe and read __LOTUS_EXPORT_PERF__. */
export function probeExportPerfGate(): void {
  const st = useEditor.getState()
  if (st.exportPerfGate === 'probing') return
  st.setExportPerfGate('probing')

  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin')
  iframe.style.cssText = 'position:fixed;left:-9999px;width:640px;height:360px;opacity:0;pointer-events:none'
  document.body.appendChild(iframe)

  let done = false
  const finish = (pass: boolean, fps: number) => {
    if (done) return
    done = true
    useEditor.getState().setExportPerfGate(pass ? 'pass' : 'fail', fps)
    iframe.remove()
  }

  const timer = window.setTimeout(() => finish(false, 0), PROBE_WAIT_MS + 8000)

  iframe.onload = () => {
    window.setTimeout(() => {
      try {
        const win = iframe.contentWindow as Window & { __LOTUS_EXPORT_PERF__?: { perfPass?: boolean; fps?: number } }
        const perf = win?.__LOTUS_EXPORT_PERF__
        const fps = perf?.fps ?? 0
        const pass = perf?.perfPass === true
        window.clearTimeout(timer)
        finish(pass, fps)
      } catch {
        window.clearTimeout(timer)
        finish(false, 0)
      }
    }, PROBE_WAIT_MS)
  }

  iframe.srcdoc = buildPlayableHTML()
}