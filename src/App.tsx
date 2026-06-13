import { useEffect } from 'react'
import { MenuBar } from './editor/MenuBar'
import { Toolbar } from './editor/Toolbar'
import { StatusBar } from './editor/StatusBar'
import { Viewport } from './editor/Viewport'
import { BottomDock } from './editor/panels/BottomDock'
import { PlaceActors } from './editor/panels/PlaceActors'
import { Details } from './editor/panels/Details'
import { Outliner } from './editor/panels/Outliner'
import { autosave, newLevel, restoreAutosave, saveLevelToFile } from './editor/levelIO'
import { preloadPhysics } from './engine/physics'
import { world } from './engine/World'
import { getLiveSnapshot } from './engine/liveSnapshot'
import { executeAICommands, extractCommands } from './editor/ai'
import { buildPlayableHTML } from './editor/exportPlayable'
import { useEditor } from './editor/store'
import { terminalExec, TERMINAL_HELP } from './editor/terminal'
import { connectTerminalBridge } from './editor/terminalBridge'
import { undo, redo, runCommand } from './editor/commands'
import { CommandPalette, installPlugin, loadUserPlugins, registerPlugin } from './editor/palette'
import { PreferencesModal, loadPrefs } from './editor/Preferences'

// Global bridge — browser devtools + external tooling can drive the live editor
;(window as unknown as Record<string, unknown>).vektra = {
  world,
  useEditor,
  runCommand,
  undo,
  redo,
  terminal: {
    exec: terminalExec,
    help: () => TERMINAL_HELP,
    open: () => useEditor.getState().openConsole(),
    port: import.meta.env.VITE_VEKTRA_TERMINAL_PORT ?? '24679',
  },
  ai: { executeAICommands, extractCommands },
  buildPlayableHTML,
  registerPlugin,
  installPlugin,
  getLiveSnapshot: () => {
    const s = useEditor.getState()
    return getLiveSnapshot(world, s)
  },
}

let booted = false

export default function App() {
  useEffect(() => {
    // boot once — restore the autosaved level, or build the starter level
    if (!booted) {
      booted = true
      preloadPhysics()
      loadUserPlugins()
      restoreAutosave().then((ok) => {
        if (!ok) newLevel()
      })
    }
    const saveTimer = setInterval(autosave, loadPrefs().autosaveSeconds * 1000)
    // UE Content Drawer: Ctrl+Space summons; clicking the viewport collapses it
    let drawerMode = false
    const onDrawerKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.code === 'Space') {
        e.preventDefault()
        const st = useEditor.getState()
        if (st.contentBrowserOpen && st.bottomTab === 'content') {
          st.toggleContentBrowser()
          drawerMode = false
        } else {
          st.setBottomTab('content')
          drawerMode = true
        }
      }
    }
    const onDrawerCollapse = (e: MouseEvent) => {
      if (!drawerMode) return
      const el = e.target as HTMLElement
      if (el.closest('.viewport')) {
        const st = useEditor.getState()
        if (st.contentBrowserOpen && st.bottomTab === 'content') st.toggleContentBrowser()
        drawerMode = false
      }
    }
    window.addEventListener('keydown', onDrawerKey)
    window.addEventListener('mousedown', onDrawerCollapse)

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA' || el?.isContentEditable
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
        e.preventDefault()
        saveLevelToFile()
      }
      // ` — UE-style console focus (skip when already typing elsewhere)
      // Ctrl+Backquote — UE world/local gizmo space toggle
      if (e.code === 'Backquote' && (e.ctrlKey || e.metaKey) && !typing) {
        e.preventDefault()
        useEditor.getState().toggleGizmoSpace()
        return
      }
      if (e.code === 'Backquote' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing) {
        e.preventDefault()
        useEditor.getState().openConsole()
      }
    }
    window.addEventListener('keydown', onKey)
    const disconnectBridge = connectTerminalBridge()
    return () => {
      clearInterval(saveTimer)
      window.removeEventListener('keydown', onDrawerKey)
      window.removeEventListener('mousedown', onDrawerCollapse)
      window.removeEventListener('keydown', onKey)
      disconnectBridge()
    }
  }, [])

  return (
    <div className="editor-root">
      <MenuBar />
      <Toolbar />
      <div className="editor-main">
        <PlaceActors />
        <div className="editor-center">
          <Viewport />
          <BottomDock />
        </div>
        <div className="editor-right">
          <Outliner />
          <Details />
        </div>
      </div>
      <StatusBar />
      <CommandPalette />
      <PrefsHost />
    </div>
  )
}

function PrefsHost() {
  const show = useEditor((s) => s.showPrefs)
  const setShow = useEditor((s) => s.setShowPrefs)
  if (!show) return null
  return <PreferencesModal onClose={() => setShow(false)} />
}
