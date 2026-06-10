import { world } from '../engine/World'
import { useEditor } from './store'

export function StatusBar() {
  const status = useEditor((s) => s.statusMessage)
  const selectedId = useEditor((s) => s.selectedId)
  useEditor((s) => s.sceneVersion)
  const selected = selectedId ? world.actors.get(selectedId) : null

  return (
    <div className="statusbar">
      <span className="status-message">{status}</span>
      <span className="status-spacer" />
      {selected && (
        <span className="status-selection">
          {selected.name} · {selected.type}
        </span>
      )}
      <span className="status-hint">RMB+WASD fly · LMB select · Q/W/E/R tools · F focus · Ctrl+D duplicate</span>
    </div>
  )
}
