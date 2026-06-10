import { useEffect } from 'react'
import { MenuBar } from './editor/MenuBar'
import { Toolbar } from './editor/Toolbar'
import { StatusBar } from './editor/StatusBar'
import { Viewport } from './editor/Viewport'
import { BottomDock } from './editor/panels/BottomDock'
import { Details } from './editor/panels/Details'
import { Outliner } from './editor/panels/Outliner'
import { autosave, newLevel, restoreAutosave, saveLevelToFile } from './editor/levelIO'
import { preloadPhysics } from './engine/physics'
import { world } from './engine/World'
import { executeAICommands, extractCommands } from './editor/ai'
import { useEditor } from './editor/store'

// dev console hook — inspect the live world from the browser console
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).vektra = {
    world,
    useEditor,
    ai: { executeAICommands, extractCommands },
  }
}

let booted = false

export default function App() {
  useEffect(() => {
    // boot once — restore the autosaved level, or build the starter level
    if (!booted) {
      booted = true
      preloadPhysics()
      restoreAutosave().then((ok) => {
        if (!ok) newLevel()
      })
    }
    const saveTimer = setInterval(autosave, 5000)
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'KeyS') {
        e.preventDefault()
        saveLevelToFile()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      clearInterval(saveTimer)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  return (
    <div className="editor-root">
      <MenuBar />
      <Toolbar />
      <div className="editor-main">
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
    </div>
  )
}
