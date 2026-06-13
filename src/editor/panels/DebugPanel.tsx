import { useEffect, useState } from 'react'
import type { LiveActorNode } from '../../engine/liveSnapshot'
import { buildLiveTree } from '../../engine/liveSnapshot'
import { getActorTickBreakdown, latest, samples } from '../../engine/profiler'
import { world } from '../../engine/World'
import { useEditor } from '../store'

const TYPE_ICONS: Record<string, string> = {
  StaticMesh: '◼',
  ImportedMesh: '🧊',
  PointLight: '✦',
  SpotLight: '◬',
  DirectionalLight: '☀',
  AmbientLight: '◍',
  RectLight: '▤',
  Camera: '🎥',
  PlayerStart: '🚩',
  ParticleEmitter: '✨',
  FoliageLayer: '🌿',
  Landscape: '⛰',
  TriggerVolume: '⏚',
  ReflectionProbe: '🔮',
  Water: '🌊',
  PCGVolume: '🎲',
  CustomMesh: '🗿',
  Empty: '◇',
  Folder: '📁',
  PostProcessVolume: '◫',
}

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

function LiveTreeRow({
  node,
  depth,
  selectedId,
  onSelect,
}: {
  node: LiveActorNode
  depth: number
  selectedId: string | null
  onSelect: (id: string) => void
}) {
  const isSelected = selectedId === node.id
  return (
    <>
      <div
        className={`dbg-tree-row ${isSelected ? 'selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        title={node.parentName ? `${node.parentName} › ${node.name}` : node.name}
        onClick={() => onSelect(node.id)}
      >
        <span className="dbg-tree-icon">{TYPE_ICONS[node.type] ?? '◇'}</span>
        <span className="dbg-tree-name">{node.name}</span>
        <span className="dbg-tree-type">{node.type}</span>
        {!node.visible && <span className="dbg-tree-hidden">hidden</span>}
      </div>
      {node.children.map((c) => (
        <LiveTreeRow key={c.id} node={c} depth={depth + 1} selectedId={selectedId} onSelect={onSelect} />
      ))}
    </>
  )
}

function TickBreakdown() {
  const ticks = getActorTickBreakdown()
  if (ticks.length === 0) return null
  const max = Math.max(0.05, ...ticks.map((t) => t.ms))
  return (
    <div className="dbg-ticks">
      <div className="dbg-ticks-head">Per-actor tick (last frame)</div>
      {ticks.slice(0, 12).map((t) => (
        <div key={t.id} className="dbg-tick-row" title={`${t.name} (${t.id})`}>
          <span className="dbg-tick-name">{t.name}</span>
          <span className="dbg-tick-bar-wrap">
            <span className="dbg-tick-bar" style={{ width: `${Math.min(100, (t.ms / max) * 100)}%` }} />
          </span>
          <span className="dbg-tick-ms">{t.ms.toFixed(2)} ms</span>
        </div>
      ))}
    </div>
  )
}

/** Debug — profiler graphs + live remote scene tree (Godot debugger analog). */
export function DebugPanel() {
  const [, force] = useState(0)
  const [tab, setTab] = useState<'monitors' | 'tree'>('monitors')
  const playing = useEditor((s) => s.playing)
  const liveVersion = useEditor((s) => s.liveVersion)
  const selectedId = useEditor((s) => s.selectedId)
  const select = useEditor((s) => s.select)

  useEffect(() => {
    const t = setInterval(() => force((x) => x + 1), 400)
    return () => clearInterval(t)
  }, [])

  useEffect(() => {
    if (playing) setTab('tree')
  }, [playing])

  const cur = latest()
  const tree = buildLiveTree(world.actors)
  void liveVersion

  return (
    <div className="dbg-panel">
      <div className="dbg-subtabs">
        <button className={tab === 'monitors' ? 'active' : ''} onClick={() => setTab('monitors')}>
          Monitors
        </button>
        <button className={tab === 'tree' ? 'active' : ''} onClick={() => setTab('tree')}>
          Live Tree {playing ? '●' : ''}
        </button>
      </div>

      {tab === 'monitors' && (
        <>
          <div className="dbg-graphs">
            <Graph label="FPS" values={samples.map((s) => s.fps)} color="#46a758" max={120} />
            <Graph label="Tick ms" values={samples.map((s) => s.tickMs)} color="#f5a623" max={16} />
            <Graph label="Render ms" values={samples.map((s) => s.renderMs)} color="#2f80ed" max={16} />
          </div>
          {cur && (
            <div className="dbg-stats">
              <span>
                Draw calls: <em>{cur.drawCalls}</em>
              </span>
              <span>
                Triangles: <em>{cur.triangles.toLocaleString()}</em>
              </span>
              <span>
                Actors: <em>{cur.actors}</em>
              </span>
              <span>
                Frame: <em>{(cur.tickMs + cur.renderMs).toFixed(2)} ms</em>
              </span>
            </div>
          )}
          {playing && <TickBreakdown />}
          {!cur && <div className="panel-empty">Profiling starts with the render loop…</div>}
        </>
      )}

      {tab === 'tree' && (
        <div className="dbg-tree">
          {!playing && (
            <div className="panel-empty">Start Play (Alt+P) to mirror the live actor tree. Click any actor to inspect it in Details.</div>
          )}
          {playing && (
            <>
              <div className="dbg-tree-meta">
                <span>
                  {world.actors.size} actors · play time <em>{world.playClock.toFixed(2)}s</em>
                </span>
                <span className="dbg-tree-hint">Click → select · edit properties in Details</span>
              </div>
              <div className="dbg-tree-body">
                {tree.map((n) => (
                  <LiveTreeRow key={n.id} node={n} depth={0} selectedId={selectedId} onSelect={select} />
                ))}
                {tree.length === 0 && <div className="panel-empty">No actors in level.</div>}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}