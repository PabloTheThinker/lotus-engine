import { useMemo, useState } from 'react'
import {
  EXAMPLE_HELLO_PLUGIN,
  installPlugin,
  loadPluginRecords,
  removePlugin,
  setPluginEnabled,
  type PluginRecord,
  updatePluginSource,
} from './plugins'
import { useEditor } from './store'

export function PluginManagerModal({ onClose }: { onClose: () => void }) {
  const sceneVersion = useEditor((s) => s.sceneVersion)
  const records = useMemo(() => loadPluginRecords(), [sceneVersion])
  const [selectedId, setSelectedId] = useState<string | null>(records[0]?.id ?? null)
  const [draft, setDraft] = useState('')
  const [draftName, setDraftName] = useState('')

  const selected = records.find((r) => r.id === selectedId)

  const selectRecord = (rec: PluginRecord) => {
    setSelectedId(rec.id)
    setDraft(rec.source)
    setDraftName(rec.name)
  }

  const installNew = () => {
    const source = draft.trim()
    if (!source) return
    const rec = installPlugin(source, draftName.trim() || undefined)
    setDraft('')
    setDraftName('')
    selectRecord(rec)
  }

  const saveSelected = () => {
    if (!selected) return
    updatePluginSource(selected.id, draft, draftName.trim() || undefined)
  }

  const loadExample = () => {
    setDraft(EXAMPLE_HELLO_PLUGIN)
    setDraftName('Hello World')
    setSelectedId(null)
  }

  return (
    <div className="palette-backdrop" onMouseDown={onClose}>
      <div className="palette plugin-manager" onMouseDown={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <span>Plugin Manager</span>
          <button onClick={onClose}>✕</button>
        </div>
        <div className="plugin-manager-body">
          <div className="plugin-list">
            <div className="plugin-list-header">
              <span>Installed</span>
              <button onClick={loadExample} title="Load example-hello.js into editor">
                Example
              </button>
            </div>
            {records.length === 0 && <div className="panel-empty">No plugins installed.</div>}
            {records.map((rec) => (
              <div
                key={rec.id}
                className={`plugin-row ${selectedId === rec.id ? 'active' : ''}`}
                onClick={() => selectRecord(rec)}
              >
                <label className="plugin-enable" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={rec.enabled}
                    onChange={(e) => setPluginEnabled(rec.id, e.target.checked)}
                  />
                </label>
                <span className="plugin-name">{rec.name}</span>
                <button
                  className="plugin-remove"
                  title="Remove plugin"
                  onClick={(e) => {
                    e.stopPropagation()
                    removePlugin(rec.id)
                    if (selectedId === rec.id) {
                      setSelectedId(null)
                      setDraft('')
                      setDraftName('')
                    }
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          <div className="plugin-editor">
            <label className="field">
              <span>Name</span>
              <input value={draftName} onChange={(e) => setDraftName(e.target.value)} placeholder="Plugin name" spellCheck={false} />
            </label>
            <label className="field plugin-source-field">
              <span>JavaScript source</span>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="registerPlugin({ name: 'My Plugin', ... })"
                spellCheck={false}
              />
            </label>
            <div className="plugin-actions">
              {selected ? (
                <>
                  <button onClick={saveSelected} disabled={!draft.trim()}>
                    Save
                  </button>
                  <button
                    onClick={() => setPluginEnabled(selected.id, !selected.enabled)}
                    title={selected.enabled ? 'Disable without deleting' : 'Re-enable plugin'}
                  >
                    {selected.enabled ? 'Disable' : 'Enable'}
                  </button>
                </>
              ) : (
                <button onClick={installNew} disabled={!draft.trim()}>
                  Install
                </button>
              )}
            </div>
            <div className="panel-empty plugin-hint">
              Plugins use <code>registerPlugin</code>, <code>registerPanelCallback</code>, and helpers on{' '}
              <code>window.lotus</code>. See API docs in <code>src/editor/plugins.ts</code>.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}