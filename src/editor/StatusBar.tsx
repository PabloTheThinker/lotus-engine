import { world } from '../engine/World'
import { useEditor } from './store'

export function StatusBar() {
  const status = useEditor((s) => s.statusMessage)
  const selectedId = useEditor((s) => s.selectedId)
  const selectedIds = useEditor((s) => s.selectedIds)
  useEditor((s) => s.sceneVersion)
  const selected = selectedId ? world.actors.get(selectedId) : null

  return (
    <div className="statusbar">
      <span className="status-message">{status}</span>
      <span className="status-spacer" />
      {selected && (
        <span className="status-selection">
          {selectedIds.length > 1 ? `${selectedIds.length} selected · ` : ''}
          {selected.name} · {selected.type}
        </span>
      )}
      <span className="status-hint">RMB+WASD fly · Q/W/E/R tools · F focus · End floor-snap · Alt+drag dup · Shift+# bookmark · G game view · F8 eject</span>
    </div>
  )
}
