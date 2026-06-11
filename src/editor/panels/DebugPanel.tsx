import { useEffect, useState } from 'react'
import { latest, samples } from '../../engine/profiler'

function Graph({ label, values, color, max }: { label: string; values: number[]; color: string; max: number }) {
  const w = 240
  const h = 44
  const pts = values
    .map((v, i) => `${(i / Math.max(1, values.length - 1)) * w},${h - Math.min(1, v / max) * h}`)
    .join(' ')
  const cur = values[values.length - 1] ?? 0
  return (
    <div className="dbg-graph">
      <div className="dbg-graph-label">
        {label} <em>{cur.toFixed(1)}</em>
      </div>
      <svg width={w} height={h}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
      </svg>
    </div>
  )
}

/** Debug — profiler graphs + renderer monitors (Godot debugger analog). */
export function DebugPanel() {
  const [, force] = useState(0)
  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 400)
    return () => clearInterval(t)
  }, [])

  const cur = latest()
  return (
    <div className="dbg-panel">
      <div className="dbg-graphs">
        <Graph label="FPS" values={samples.map((s) => s.fps)} color="#46a758" max={120} />
        <Graph label="Tick ms" values={samples.map((s) => s.tickMs)} color="#f5a623" max={16} />
        <Graph label="Render ms" values={samples.map((s) => s.renderMs)} color="#2f80ed" max={16} />
      </div>
      {cur && (
        <div className="dbg-stats">
          <span>Draw calls: <em>{cur.drawCalls}</em></span>
          <span>Triangles: <em>{cur.triangles.toLocaleString()}</em></span>
          <span>Actors: <em>{cur.actors}</em></span>
          <span>Frame: <em>{(cur.tickMs + cur.renderMs).toFixed(2)} ms</em></span>
        </div>
      )}
      {!cur && <div className="panel-empty">Profiling starts with the render loop…</div>}
    </div>
  )
}
