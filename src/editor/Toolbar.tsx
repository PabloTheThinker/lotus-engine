import { redo, undo } from './commands'
import { newLevel, openLevelFromFile, saveLevelToFile } from './levelIO'
import { useEditor, type GizmoMode } from './store'

const MODES: Array<{ mode: GizmoMode; label: string; key: string; title: string }> = [
  { mode: 'select', label: '↖', key: 'Q', title: 'Select (Q)' },
  { mode: 'translate', label: '✥', key: 'W', title: 'Move (W)' },
  { mode: 'rotate', label: '↻', key: 'E', title: 'Rotate (E)' },
  { mode: 'scale', label: '⤢', key: 'R', title: 'Scale (R)' },
]

export function Toolbar() {
  const gizmoMode = useEditor((s) => s.gizmoMode)
  const setGizmoMode = useEditor((s) => s.setGizmoMode)
  const snapEnabled = useEditor((s) => s.snapEnabled)
  const toggleSnap = useEditor((s) => s.toggleSnap)
  const playing = useEditor((s) => s.playing)
  const setPlaying = useEditor((s) => s.setPlaying)
  const canUndo = useEditor((s) => s.canUndo)
  const canRedo = useEditor((s) => s.canRedo)
  const toggleContentBrowser = useEditor((s) => s.toggleContentBrowser)

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button title="New Level" onClick={newLevel}>🗋 New</button>
        <button title="Open Level" onClick={openLevelFromFile}>📂 Open</button>
        <button title="Save Level" onClick={saveLevelToFile}>💾 Save</button>
      </div>
      <div className="toolbar-sep" />
      <div className="toolbar-group">
        <button title="Undo (Ctrl+Z)" disabled={!canUndo} onClick={undo}>↶</button>
        <button title="Redo (Ctrl+Y)" disabled={!canRedo} onClick={redo}>↷</button>
      </div>
      <div className="toolbar-sep" />
      <div className="toolbar-group">
        {MODES.map((m) => (
          <button
            key={m.mode}
            className={gizmoMode === m.mode ? 'active' : ''}
            title={m.title}
            onClick={() => setGizmoMode(m.mode)}
          >
            {m.label}
          </button>
        ))}
        <button className={snapEnabled ? 'active' : ''} title="Toggle grid snap" onClick={toggleSnap}>
          ⌗ Snap
        </button>
      </div>
      <div className="toolbar-spacer" />
      <div className="toolbar-group">
        <button
          className={`play-button ${playing ? 'stop' : ''}`}
          title={playing ? 'Stop (Esc)' : 'Play In Editor'}
          onClick={() => setPlaying(!playing)}
        >
          {playing ? '■ Stop' : '▶ Play'}
        </button>
      </div>
      <div className="toolbar-sep" />
      <div className="toolbar-group">
        <button title="Toggle Content Browser" onClick={toggleContentBrowser}>🗄 Content</button>
      </div>
    </div>
  )
}
