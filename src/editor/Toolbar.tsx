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
  const setFoliagePaint = useEditor((s) => s.setFoliagePaint)
  const sculptActive = useEditor((s) => s.sculptActive)
  const setSculptActive = useEditor((s) => s.setSculptActive)
  const selectedId = useEditor((s) => s.selectedId)
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
        <button title="Save Level" onClick={saveLevelToFile}>💾 Save</button>
      </div>
      <div className="toolbar-sep" />
      <div className="toolbar-group">
        <button className={placeActorsOpen ? 'active' : ''} title="Place Actors panel" onClick={togglePlaceActors}>
          ⊞ Place
        </button>
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
        <button title="Gizmo space (T)" onClick={toggleGizmoSpace}>
          {gizmoSpace === 'world' ? '🌐 World' : '⬚ Local'}
        </button>
        <button className={gameView ? 'active' : ''} title="Game View — hide editor chrome (G)" onClick={toggleGameView}>
          👁 Game
        </button>
        <button
          className={foliagePaint ? 'active' : ''}
          title="Foliage paint — select a Foliage layer, then click-drag to paint, Shift to erase"
          onClick={() => setFoliagePaint(!foliagePaint)}
          disabled={!selectedId}
        >
          🌿 Paint
        </button>
        <button
          className={sculptActive ? 'active' : ''}
          title="Landscape sculpt — select a Landscape, then click-drag (Shift lowers)"
          onClick={() => setSculptActive(!sculptActive)}
          disabled={!selectedId}
        >
          ⛰ Sculpt
        </button>
      </div>
      <div className="toolbar-spacer" />
      <div className="toolbar-group">
        <button
          className={`play-button ${playing && !simulate ? 'stop' : ''}`}
          title={playing ? 'Stop (Esc)' : 'Play In Editor — possess pawn at PlayerStart'}
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
          title={playing && simulate ? 'Stop (Esc)' : 'Simulate — run the world, keep the editor camera'}
          onClick={() => (playing ? stopPlay() : startPlay('simulate'))}
          disabled={playing && !simulate}
        >
          {playing && simulate ? '■ Stop' : '≡ Simulate'}
        </button>
      </div>
      <div className="toolbar-sep" />
      <div className="toolbar-group">
        <button title="Toggle Content Browser" onClick={toggleContentBrowser}>🗄 Content</button>
      </div>
    </div>
  )
}
