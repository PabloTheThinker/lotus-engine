import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import {
  SHORTCUT_REGISTRY,
  clearBindingOverride,
  findConflict,
  formatBinding,
  formatShortcutLabel,
  getEffectiveBinding,
  hasOverride,
  resetAllBindings,
  setBindingOverride,
  subscribeShortcuts,
  getShortcutsVersion,
  type ShortcutCategory,
  type ShortcutDef,
} from '../shortcuts'

const CATEGORIES: ShortcutCategory[] = ['Viewport', 'Play', 'Tools', 'Panels']

export function ShortcutEditor({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [rebindingId, setRebindingId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const version = useSyncExternalStore(subscribeShortcuts, getShortcutsVersion)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return SHORTCUT_REGISTRY
    return SHORTCUT_REGISTRY.filter(
      (s) =>
        s.label.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q) ||
        formatShortcutLabel(s.id).toLowerCase().includes(q),
    )
  }, [query, version])

  const byCategory = useMemo(() => {
    const map = new Map<ShortcutCategory, ShortcutDef[]>()
    for (const cat of CATEGORIES) map.set(cat, [])
    for (const s of filtered) map.get(s.category)?.push(s)
    return map
  }, [filtered])

  useEffect(() => {
    if (!rebindingId) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.code === 'Escape') {
        setRebindingId(null)
        setMessage('')
        return
      }
      const binding: import('../shortcuts').ShortcutBinding = { code: e.code }
      if (e.ctrlKey || e.metaKey) binding.ctrl = true
      if (e.shiftKey) binding.shift = true
      if (e.altKey) binding.alt = true
      if (['ControlLeft', 'ControlRight', 'ShiftLeft', 'ShiftRight', 'AltLeft', 'AltRight', 'MetaLeft', 'MetaRight'].includes(e.code)) {
        return
      }
      const conflict = findConflict(rebindingId, binding)
      if (conflict) {
        setMessage(`Conflicts with “${conflict.label}” (${formatBinding(getEffectiveBinding(conflict.id))})`)
        return
      }
      if (setBindingOverride(rebindingId, binding)) {
        setRebindingId(null)
        setMessage('')
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [rebindingId])

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette shortcut-editor" onMouseDown={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <span>Keyboard Shortcuts</span>
          <button type="button" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="shortcut-editor-body">
          <input
            value={query}
            placeholder="Search shortcuts…"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
          />
          {message && <div className="shortcut-editor-msg">{message}</div>}
          <div className="shortcut-editor-list">
            {CATEGORIES.map((cat) => {
              const items = byCategory.get(cat) ?? []
              if (!items.length) return null
              return (
                <section key={cat} className="shortcut-editor-section">
                  <div className="shortcut-editor-cat">{cat}</div>
                  {items.map((s) => (
                    <ShortcutRow
                      key={s.id}
                      def={s}
                      rebinding={rebindingId === s.id}
                      onRebind={() => {
                        setRebindingId(s.id)
                        setMessage('Press a key combination… (Esc to cancel)')
                      }}
                      onReset={() => {
                        clearBindingOverride(s.id)
                        setMessage('')
                      }}
                    />
                  ))}
                </section>
              )
            })}
            {filtered.length === 0 && <div className="panel-empty">No matching shortcuts.</div>}
          </div>
          <div className="shortcut-editor-footer">
            <button type="button" onClick={() => { resetAllBindings(); setMessage('All shortcuts reset to defaults.') }}>
              Reset All to Defaults
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

function ShortcutRow({
  def,
  rebinding,
  onRebind,
  onReset,
}: {
  def: ShortcutDef
  rebinding: boolean
  onRebind: () => void
  onReset: () => void
}) {
  const binding = getEffectiveBinding(def.id)
  const overridden = hasOverride(def.id)
  return (
    <div className={`shortcut-row ${rebinding ? 'rebinding' : ''}`}>
      <div className="shortcut-row-label">
        <span>{def.label}</span>
        {def.description && <span className="shortcut-row-desc">{def.description}</span>}
      </div>
      <button type="button" className="shortcut-row-key" onClick={onRebind} title="Click to rebind">
        {rebinding ? '…' : formatBinding(binding)}
      </button>
      {overridden && (
        <button type="button" className="shortcut-row-reset" onClick={onReset} title="Reset to default">
          ↺
        </button>
      )}
    </div>
  )
}