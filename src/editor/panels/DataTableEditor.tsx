import { useState } from 'react'
import { world } from '../../engine/World'
import {
  emptyCurve,
  emptyDataTable,
  evaluateCurve,
  isCurveAsset,
  isDataTableAsset,
  type CurveAsset,
  type DataTableAsset,
} from '../../engine/curveAssets'
import { useEditor } from '../store'

/** Data table grid + curve asset editor (Wave 12). */
export function DataTableEditor() {
  const touch = useEditor((s) => s.touch)
  useEditor((s) => s.sceneVersion)
  const names = Object.keys(world.dataTables)
  const [selected, setSelected] = useState(names[0] ?? '')

  const asset = selected ? world.dataTables[selected] : null
  const isTable = isDataTableAsset(asset)
  const isCurve = isCurveAsset(asset)

  const setAsset = (name: string, value: unknown) => {
    world.dataTables[name] = value
    touch()
  }

  return (
    <div className="data-editor">
      <div className="data-toolbar">
        <select value={selected} onChange={(e) => setSelected(e.target.value)}>
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
        <button
          onClick={() => {
            const n = prompt('Table name?')
            if (!n) return
            world.dataTables[n] = emptyDataTable(n)
            setSelected(n)
            touch()
          }}
        >
          + Table
        </button>
        <button
          onClick={() => {
            const n = prompt('Curve name?')
            if (!n) return
            world.dataTables[n] = emptyCurve(n)
            setSelected(n)
            touch()
          }}
        >
          + Curve
        </button>
      </div>

      {!selected && <div className="panel-empty">Add a data table or curve asset.</div>}

      {isTable && (
        <div className="data-grid-wrap">
          <table className="data-grid">
            <thead>
              <tr>
                {(asset as DataTableAsset).columns.map((c) => (
                  <th key={c.name}>{c.name}</th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {(asset as DataTableAsset).rows.map((row, ri) => (
                <tr key={ri}>
                  {(asset as DataTableAsset).columns.map((c) => (
                    <td key={c.name}>
                      <input
                        value={String(row[c.name] ?? '')}
                        onChange={(e) => {
                          const t = { ...(asset as DataTableAsset) }
                          const r = { ...t.rows[ri] }
                          r[c.name] = c.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value
                          t.rows[ri] = r
                          setAsset(selected, t)
                        }}
                      />
                    </td>
                  ))}
                  <td>
                    <button
                      onClick={() => {
                        const t = { ...(asset as DataTableAsset) }
                        t.rows = t.rows.filter((_, i) => i !== ri)
                        setAsset(selected, t)
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            onClick={() => {
              const t = { ...(asset as DataTableAsset) }
              const row: Record<string, string | number | boolean> = {}
              for (const c of t.columns) row[c.name] = c.type === 'number' ? 0 : ''
              t.rows.push(row)
              setAsset(selected, t)
            }}
          >
            + Row
          </button>
        </div>
      )}

      {isCurve && (
        <div className="data-curve-wrap">
          <svg viewBox="0 0 200 100" className="data-curve-svg">
            <polyline
              fill="none"
              stroke="#b08df1"
              strokeWidth="2"
              points={(asset as CurveAsset).keys
                .map((k) => `${k.t * 180 + 10},${90 - k.v * 70}`)
                .join(' ')}
            />
          </svg>
          <div className="panel-empty">Sample @ 0.5 = {evaluateCurve(asset as CurveAsset, 0.5).toFixed(2)}</div>
          {(asset as CurveAsset).keys.map((k, i) => (
            <label className="field" key={i}>
              <span>
                Key {i} (t,v)
              </span>
              <input
                type="number"
                step={0.05}
                value={k.t}
                onChange={(e) => {
                  const c = { ...(asset as CurveAsset), keys: [...(asset as CurveAsset).keys] }
                  c.keys[i] = { ...k, t: parseFloat(e.target.value) || 0 }
                  setAsset(selected, c)
                }}
              />
              <input
                type="number"
                step={0.05}
                value={k.v}
                onChange={(e) => {
                  const c = { ...(asset as CurveAsset), keys: [...(asset as CurveAsset).keys] }
                  c.keys[i] = { ...k, v: parseFloat(e.target.value) || 0 }
                  setAsset(selected, c)
                }}
              />
            </label>
          ))}
          <button
            onClick={() => {
              const c = { ...(asset as CurveAsset), keys: [...(asset as CurveAsset).keys, { t: 1, v: 1 }] }
              setAsset(selected, c)
            }}
          >
            + Key
          </button>
        </div>
      )}
    </div>
  )
}