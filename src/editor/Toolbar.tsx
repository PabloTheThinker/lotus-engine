import { redo, undo } from './commands'
import { newLevel, openLevelFromFile, saveLevelToFile } from './levelIO'
import { deriveEditorMode, useEditor, type GizmoMode } from './store'
import { formatShortcutLabel, getShortcutsVersion, subscribeShortcuts } from './shortcuts'
import { useSyncExternalStore } from 'react'

const MODES: Array<{ mode: GizmoMode; label: string; shortcutId: string }> = [
  { mode: 'select', label: '↖', shortcutId: 'gizmo.select' },
  { mode: 'translate', label: '✥', shortcutId: 'gizmo.translate' },
  { mode: 'rotate', label: '↻', shortcutId: 'gizmo.rotate' },
  { mode: 'scale', label: '⤢', shortcutId: 'gizmo.scale' },
]

export function Toolbar() {
  useSyncExternalStore(subscribeShortcuts, getShortcutsVersion)
  const gizmoMode = useEditor((s) => s.gizmoMode)
  const setGizmoMode = useEditor((s) => s.setGizmoMode)
  const snapEnabled = useEditor((s) => s.snapEnabled)
  const toggleSnap = useEditor((s) => s.toggleSnap)
  const surfaceSnap = useEditor((s) => s.surfaceSnap)
  const toggleSurfaceSnap = useEditor((s) => s.toggleSurfaceSnap)
  const translateSnap = useEditor((s) => s.translateSnap)
  const setTranslateSnap = useEditor((s) => s.setTranslateSnap)
  const rotateSnapDeg = useEditor((s) => s.rotateSnapDeg)
  const setRotateSnapDeg = useEditor((s) => s.setRotateSnapDeg)
  const scaleSnap = useEditor((s) => s.scaleSnap)
  const setScaleSnap = useEditor((s) => s.setScaleSnap)
  const paused = useEditor((s) => s.paused)
  const setPaused = useEditor((s) => s.setPaused)
  const requestStep = useEditor((s) => s.requestStep)
  const playing = useEditor((s) => s.playing)
  const simulate = useEditor((s) => s.simulate)
  const startPlay = useEditor((s) => s.startPlay)
  const stopPlay = useEditor((s) => s.stopPlay)
  const gizmoSpace = useEditor((s) => s.gizmoSpace)
  const toggleGizmoSpace = useEditor((s) => s.toggleGizmoSpace)
  const gameView = useEditor((s) => s.gameView)
  const toggleGameView = useEditor((s) => s.toggleGameView)
  const foliagePaint = useEditor((s) => s.foliagePaint)
  const sculptActive = useEditor((s) => s.sculptActive)
  const sculptTool = useEditor((s) => s.sculptTool)
  const setEditorMode = useEditor((s) => s.setEditorMode)
  const editorMode = deriveEditorMode({ foliagePaint, sculptActive, sculptTool })
  const canUndo = useEditor((s) => s.canUndo)
  const canRedo = useEditor((s) => s.canRedo)
  const toggleContentBrowser = useEditor((s) => s.toggleContentBrowser)
  const placeActorsOpen = useEditor((s) => s.placeActorsOpen)
  const togglePlaceActors = useEditor((s) => s.togglePlaceActors)

  return (
    <div className="toolbar">
      <div className="toolbar-group">
        <button title="New Level" onClick={newLevel}>🗋 New</button>
        <button title="Open Level" onClick={openLevelFromFile}>📂 Open</button>
        <button title={`Save Level (${formatShortcutLabel('tools.save')})`} onClick={saveLevelToFile}>💾 Save</button>
      </div>
      <div className="toolbar-sep" />
      <div className="toolbar-group">
        <select
          className="toolbar-modes"
          title="Editor Modes (UE: Select / Landscape / Foliage / Paint)"
          value={editorMode}
          onChange={(e) => setEditorMode(e.target.value as typeof editorMode)}
        >
          <option value="select">↖ Select</option>
          <option value="landscape">⛰ Landscape</option>
          <option value="foliage">🌿 Foliage</option>
          <option value="paint">🎨 Paint</option>
        </select>
      </div>
      <div className="toolbar-sep" />
      <div className="toolbar-group">
        <button className={placeActorsOpen ? 'active' : ''} title="Place Actors panel" onClick={togglePlaceActors}>
          ⊞ Place
        </button>
      </div>
      <div className="toolbar-sep" />
      <div className="toolbar-group">
        <button title={`Undo (${formatShortcutLabel('tools.undo')})`} disabled={!canUndo} onClick={undo}>↶</button>
        <button title={`Redo (${formatShortcutLabel('tools.redo')})`} disabled={!canRedo} onClick={redo}>↷</button>
      </div>
      <div className="toolbar-sep" />
      <div className="toolbar-group">
        {MODES.map((m) => (
          <button
            key={m.mode}
            className={gizmoMode === m.mode ? 'active' : ''}
            title={`${m.mode === 'select' ? 'Select' : m.mode === 'translate' ? 'Move' : m.mode === 'rotate' ? 'Rotate' : 'Scale'} (${formatShortcutLabel(m.shortcutId)})`}
            onClick={() => setGizmoMode(m.mode)}
          >
            {m.label}
          </button>
        ))}
        <button className={snapEnabled ? 'active' : ''} title="Toggle grid snap" onClick={toggleSnap}>
          ⌗ Snap
        </button>
        <button
          className={surfaceSnap ? 'active' : ''}
          title="Surface Snapping — released/dropped actors stick to and align with the surface below"
          onClick={toggleSurfaceSnap}
        >
          ⊥ Surf
        </button>
        <select
          className="snap-size"
          title="Grid snap size (UE: 1/5/10/50/100)"
          value={translateSnap}
          onChange={(e) => setTranslateSnap(parseFloat(e.target.value))}
        >
          {[0.01, 0.05, 0.1, 0.5, 1, 5, 10].map((v) => (
            <option key={v} value={v}>{v}m</option>
          ))}
        </select>
        <select
          className="snap-size"
          title="Rotation snap (UE: 5/10/15/30/45/60/90)"
          value={rotateSnapDeg}
          onChange={(e) => setRotateSnapDeg(parseFloat(e.target.value))}
        >
          {[5, 10, 15, 30, 45, 60, 90, 120].map((v) => (
            <option key={v} value={v}>{v}°</option>
          ))}
        </select>
        <select
          className="snap-size"
          title="Scale snap (UE: 10/1/0.5/0.25/0.125)"
          value={scaleSnap}
          onChange={(e) => setScaleSnap(parseFloat(e.target.value))}
        >
          {[10, 1, 0.5, 0.25, 0.125].map((v) => (
            <option key={v} value={v}>×{v}</option>
          ))}
        </select>
        <button title={`Gizmo space (${formatShortcutLabel('gizmo.space')})`} onClick={toggleGizmoSpace}>
          {gizmoSpace === 'world' ? '🌐 World' : '⬚ Local'}
        </button>
        <button className={gameView ? 'active' : ''} title={`Game View — hide editor chrome (${formatShortcutLabel('viewport.gameView')})`} onClick={toggleGameView}>
          👁 Game
        </button>
      </div>
      <div className="toolbar-spacer" />
      <div className="toolbar-group">
        <button
          className={`play-button ${playing && !simulate ? 'stop' : ''}`}
          title={playing ? `Stop (${formatShortcutLabel('play.stop')})` : `Play In Editor (${formatShortcutLabel('play.pie')}) — possess pawn at PlayerStart`}
          onClick={() => (playing ? stopPlay() : startPlay('pie'))}
        >
          {playing && !simulate ? '■ Stop' : '▶ Play'}
        </button>
        {playing && (
          <>
            <button className={paused ? 'active' : ''} title="Pause (UE toolbar pause)" onClick={() => setPaused(!paused)}>
              ⏸
            </button>
            {paused && (
              <button title="Advance one frame" onClick={requestStep}>
                ⏭
              </button>
            )}
          </>
        )}
        <button
          className={`play-button simulate ${playing && simulate ? 'stop' : ''}`}
          title={playing && simulate ? `Stop (${formatShortcutLabel('play.stop')})` : 'Simulate — run the world, keep the editor camera'}
          onClick={() => (playing ? stopPlay() : startPlay('simulate'))}
          disabled={playing && !simulate}
        >
          {playing && simulate ? '■ Stop' : '≡ Simulate'}
        </button>
      </div>
      <div className="toolbar-sep" />
      <div className="toolbar-group">
        <button title={`Content Drawer (${formatShortcutLabel('panels.contentDrawer')})`} onClick={toggleContentBrowser}>🗄 Content</button>
      </div>
    </div>
  )
}
