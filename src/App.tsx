import { useEffect } from 'react'
import { MenuBar } from './editor/MenuBar'
import { Toolbar } from './editor/Toolbar'
import { StatusBar } from './editor/StatusBar'
import { Viewport } from './editor/Viewport'
import { BottomDock } from './editor/panels/BottomDock'
import { FloatingContentDrawer } from './editor/panels/ContentDrawer'
import { PlaceActors } from './editor/panels/PlaceActors'
import { Details } from './editor/panels/Details'
import { Outliner } from './editor/panels/Outliner'
import { autosave, newLevel, restoreAutosave, saveLevelToFile } from './editor/levelIO'
import { bakeAO } from './engine/lightmapBake'
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
import {
  registerConsoleCommand,
  registerImporter,
  registerNodeType,
  registerPanel,
  registerPanelCallback,
} from './editor/plugins'
import { PluginManagerModal } from './editor/PluginManager'
import { PreferencesModal, loadPrefs } from './editor/Preferences'
import { ShortcutEditor } from './editor/panels/ShortcutEditor'
import { isTypingTarget, matchesShortcutId } from './editor/shortcuts'
import { bakeNavMesh, isRecastNavReady } from './engine/nav'
import { compileBlueprint, emptyGraph } from './engine/blueprint'
import { loadMPSettings, mpEnabled } from './engine/multiplayer'

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
  registerNodeType,
  registerPanel,
  registerImporter,
  registerConsoleCommand,
  registerPanelCallback,
  getLiveSnapshot: () => {
    const s = useEditor.getState()
    return getLiveSnapshot(world, s)
  },
  /** Baked AO (approx) — hemisphere raycast, not Lightmass */
  BakeAO: (opts?: { samples?: number; radius?: number }) =>
    bakeAO(world.actors, {
      samples: opts?.samples ?? 16,
      radius: opts?.radius ?? 1,
      onProgress: (_done, _total, label) => useEditor.getState().setStatus(label),
    }).then((res) => {
      useEditor.getState().setStatus(
        res.ok
          ? `Baked AO (approx): ${res.actorsBaked} actors, ${res.verticesProcessed} verts`
          : `Bake AO failed: ${res.error ?? 'unknown'}`,
      )
      useEditor.getState().touch()
      return res
    }),
  /** E2E / devtools — bake Recast navmesh from current static + landscape geometry */
  bakeNavMesh: () => bakeNavMesh(world.actors),
  isNavMeshReady: isRecastNavReady,
  compileBlueprint,
  emptyGraph,
  multiplayer: {
    loadSettings: loadMPSettings,
    enabled: mpEnabled,
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
    // UE Content Drawer: Ctrl+Space summons floating drawer; click-outside auto-collapse when unpinned
    const onDrawerKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if (!matchesShortcutId(e, 'panels.contentDrawer')) return
      e.preventDefault()
      useEditor.getState().toggleContentDrawer()
    }
    const onDrawerCollapse = (e: MouseEvent) => {
      const st = useEditor.getState()
      if (st.contentDrawerDocked || !st.contentDrawerOpen) return
      const el = e.target as HTMLElement
      if (
        el.closest('.content-drawer-overlay') ||
        el.closest('.asset-ctx') ||
        el.closest('.status-drawer-btn')
      ) {
        return
      }
      st.closeContentDrawer()
    }
    window.addEventListener('keydown', onDrawerKey)
    window.addEventListener('mousedown', onDrawerCollapse)

    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      if (matchesShortcutId(e, 'tools.save')) {
        e.preventDefault()
        saveLevelToFile()
        return
      }
      if (matchesShortcutId(e, 'gizmo.spaceCtrl')) {
        e.preventDefault()
        useEditor.getState().toggleGizmoSpace()
        return
      }
      if (matchesShortcutId(e, 'panels.console')) {
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
      <FloatingContentDrawer />
      <CommandPalette />
      <PrefsHost />
      <ShortcutEditorHost />
      <PluginManagerHost />
    </div>
  )
}

function PrefsHost() {
  const show = useEditor((s) => s.showPrefs)
  const setShow = useEditor((s) => s.setShowPrefs)
  if (!show) return null
  return <PreferencesModal onClose={() => setShow(false)} />
}

function ShortcutEditorHost() {
  const show = useEditor((s) => s.showShortcutEditor)
  const setShow = useEditor((s) => s.setShowShortcutEditor)
  if (!show) return null
  return <ShortcutEditor onClose={() => setShow(false)} />
}

function PluginManagerHost() {
  const show = useEditor((s) => s.showPluginManager)
  const setShow = useEditor((s) => s.setShowPluginManager)
  if (!show) return null
  return <PluginManagerModal onClose={() => setShow(false)} />
}
