import { world } from '../engine/World'
import { useEditor } from './store'
import { execConsoleCommand } from './consoleCommands'
import * as THREE from 'three'
import { makeScriptApi } from '../engine/scripting'

const AUTOSAVE_WARN_SEC = 5

export function StatusBar() {
  const status = useEditor((s) => s.statusMessage)
  const saveStatus = useEditor((s) => s.saveStatus)
  const autosaveCountdownSec = useEditor((s) => s.autosaveCountdownSec)
  const bridgeConnected = useEditor((s) => s.bridgeConnected)
  const selectedId = useEditor((s) => s.selectedId)
  const selectedIds = useEditor((s) => s.selectedIds)
  const drawerOpen = useEditor((s) => s.contentDrawerOpen)
  const drawerDocked = useEditor((s) => s.contentDrawerDocked)
  const contentOpen = useEditor((s) => s.contentBrowserOpen)
  const bottomTab = useEditor((s) => s.bottomTab)
  const toggleDrawer = useEditor((s) => s.toggleContentDrawer)
  const exportPerfGate = useEditor((s) => s.exportPerfGate)
  const exportPerfFps = useEditor((s) => s.exportPerfFps)
  useEditor((s) => s.sceneVersion)
  const selected = selectedId ? world.actors.get(selectedId) : null
  const drawerActive = drawerDocked ? contentOpen && bottomTab === 'content' : drawerOpen
  const showAutosaveToast =
    saveStatus === 'dirty' && autosaveCountdownSec > 0 && autosaveCountdownSec <= AUTOSAVE_WARN_SEC

  const saveLabel =
    saveStatus === 'saving' ? 'Saving…' : saveStatus === 'dirty' ? '● Unsaved' : '✓ Saved'

  const perfGateLabel =
    exportPerfGate === 'probing'
      ? 'Export perf…'
      : exportPerfGate === 'pass'
        ? `Export perf ✓ ${exportPerfFps}fps`
        : exportPerfGate === 'fail'
          ? `Export perf ✗ ${exportPerfFps}fps`
          : null

  return (
    <div className="statusbar">
      <button
        type="button"
        className={`status-drawer-btn${drawerActive ? ' active' : ''}`}
        title="Content Drawer (Ctrl+Space)"
        onClick={toggleDrawer}
      >
        🗄 Content Drawer
      </button>
      <span className={`status-save status-save--${saveStatus}`} title="Level save status (Ctrl+S)">
        {saveLabel}
      </span>
      {showAutosaveToast && (
        <span className="status-autosave-toast" title="Autosave countdown">
          Autosaving in {autosaveCountdownSec}s
        </span>
      )}
      {perfGateLabel && (
        <span
          className={`status-perf-gate status-perf-gate--${exportPerfGate}`}
          title="Export playable perf gate (__LOTUS_EXPORT_PERF__.perfPass)"
        >
          {perfGateLabel}
        </span>
      )}
      <span className="status-message">
        {import.meta.env.DEV && (
          <span className={`bridge-dot ${bridgeConnected ? 'on' : ''}`} title={bridgeConnected ? 'CLI bridge connected' : 'CLI bridge waiting'}>
            ●
          </span>
        )}
        {status}
      </span>
      <span className="status-cmd">
        Cmd{' '}
        <input
          placeholder="Enter Console Command"
          spellCheck={false}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key !== 'Enter') return
            const el = e.target as HTMLInputElement
            const src = el.value.trim()
            if (!src) return
            const push = useEditor.getState().pushConsole
            push('cmd', `> ${src}`)
            const handled = execConsoleCommand(src)
            if (handled !== null) push('log', handled)
            else {
              try {
                const api = makeScriptApi(world.actors, () => world.playClock, () => world.pawnPosition)
                const fn = new Function('world', 'api', 'THREE', `"use strict"; return (${src})`)
                const r = fn(world, api, THREE)
                if (r !== undefined) push('log', String(r))
              } catch (err) {
                push('error', (err as Error).message)
              }
            }
            el.value = ''
          }}
        />
      </span>
      <span className="status-spacer" />
      {selected && (
        <span className="status-selection">
          {selectedIds.length > 1 ? `${selectedIds.length} selected · ` : ''}
          {selected.name} · {selected.type} · {selected.mobility}
        </span>
      )}
      <span className="status-hint">` terminal · show bufferviz &lt;mode&gt; · RMB+WASD fly · Q/W/E/R · F focus · End snap · Alt+drag dup · G game view · F8 eject</span>
    </div>
  )
}
