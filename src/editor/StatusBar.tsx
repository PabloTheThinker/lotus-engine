import { world } from '../engine/World'
import { useEditor } from './store'

export function StatusBar() {
  const status = useEditor((s) => s.statusMessage)
  const bridgeConnected = useEditor((s) => s.bridgeConnected)
  const selectedId = useEditor((s) => s.selectedId)
  const selectedIds = useEditor((s) => s.selectedIds)
  useEditor((s) => s.sceneVersion)
  const selected = selectedId ? world.actors.get(selectedId) : null

  return (
    <div className="statusbar">
      <span className="status-message">
        {import.meta.env.DEV && (
          <span className={`bridge-dot ${bridgeConnected ? 'on' : ''}`} title={bridgeConnected ? 'CLI bridge connected' : 'CLI bridge waiting'}>
            ●
          </span>
        )}
        {status}
      </span>
      <span className="status-spacer" />
      {selected && (
        <span className="status-selection">
          {selectedIds.length > 1 ? `${selectedIds.length} selected · ` : ''}
          {selected.name} · {selected.type} · {selected.mobility}
        </span>
      )}
      <span className="status-hint">` terminal · RMB+WASD fly · Q/W/E/R · F focus · End snap · Alt+drag dup · G game view · F8 eject</span>
    </div>
  )
}
