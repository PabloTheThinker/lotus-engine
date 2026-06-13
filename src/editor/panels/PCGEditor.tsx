import { useEffect, useRef, useState } from 'react'
import { world } from '../../engine/World'
import {
  PCG_NODE_DEFS,
  emptyPCGGraph,
  getEffectivePCGGraph,
  newPcgNodeId,
  syncPropsFromGraph,
  type PCGGraph,
  type PCGNodeType,
} from '../../engine/pcgGraph'
import { regeneratePCG } from '../../engine/pcg'
import { PropertyCommand, runCommand } from '../commands'
import { useEditor } from '../store'

const NODE_W = 190
const HEADER_H = 26
const PORT_GAP = 22

function inPortY(index: number) {
  return HEADER_H + 12 + index * PORT_GAP
}

function portPos(node: { x: number; y: number; type: string }, port: 'in' | 'out' | null): { x: number; y: number } {
  if (port === 'out') return { x: node.x + NODE_W, y: node.y + HEADER_H + 12 }
  return { x: node.x, y: node.y + inPortY(0) }
}

function wirePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

/**
 * PCG node graph editor — UE PCG analog. Sample → filter → transform → spawn
 * pipeline with live regen on Apply.
 */
export function PCGEditor() {
  const selectedId = useEditor((s) => s.selectedId)
  const touch = useEditor((s) => s.touch)
  useEditor((s) => s.sceneVersion)
  const actor = selectedId ? world.actors.get(selectedId) : null
  const [graph, setGraph] = useState<PCGGraph | null>(null)
  const [dirty, setDirty] = useState(false)
  const [pendingFrom, setPendingFrom] = useState<string | null>(null)
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null)
  const lastActor = useRef<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ nodeId: string; dx: number; dy: number } | null>(null)
  const panState = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })

  useEffect(() => {
    if (actor?.type === 'PCGVolume' && actor.id !== lastActor.current) {
      lastActor.current = actor.id
      const g = getEffectivePCGGraph(actor)
      setGraph(JSON.parse(JSON.stringify(g)) as PCGGraph)
      setDirty(false)
      setPendingFrom(null)
      setOffset({ x: 0, y: 0 })
    }
    if (!actor || actor.type !== 'PCGVolume') lastActor.current = null
  }, [actor])

  if (!actor || actor.type !== 'PCGVolume' || !graph) {
    return (
      <div className="panel-empty">
        Select a PCG Scatter volume to edit its node graph. Wire Sample Surface → filters → Transform Jitter → Spawn
        Actor, then Apply to regenerate instances live in the viewport.
      </div>
    )
  }

  const mutate = (fn: (g: PCGGraph) => void) => {
    const next = JSON.parse(JSON.stringify(graph)) as PCGGraph
    fn(next)
    setGraph(next)
    setDirty(true)
  }

  const apply = () => {
    const prevGraph = actor.pcgGraph
    const prevProps = actor.pcgProps
    const next = JSON.parse(JSON.stringify(graph)) as PCGGraph
    runCommand(
      new PropertyCommand(
        `PCG graph ${actor.name}`,
        () => {
          actor.pcgGraph = next
          actor.pcgProps = syncPropsFromGraph(next)
          regeneratePCG(actor, world.actors)
        },
        () => {
          actor.pcgGraph = prevGraph
          actor.pcgProps = prevProps
          regeneratePCG(actor, world.actors)
        },
      ),
    )
    setDirty(false)
    touch()
    useEditor.getState().setStatus(`PCG graph applied → ${actor.name} (${next.nodes.length} nodes)`)
  }

  const canvasPoint = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left - offset.x, y: e.clientY - rect.top - offset.y }
  }

  const onPort = (nodeId: string, port: 'in' | 'out') => {
    if (port === 'out') {
      setPendingFrom(nodeId)
      return
    }
    if (pendingFrom && pendingFrom !== nodeId) {
      mutate((g) => {
        g.edges = g.edges.filter((e) => e.to !== `${nodeId}:in`)
        g.edges.push({ from: pendingFrom, to: `${nodeId}:in` })
      })
      setPendingFrom(null)
    }
  }

  const categories = ['Sample', 'Filter', 'Transform', 'Spawn'] as const

  return (
    <div className="bp-editor pcg-editor">
      <div className="bp-toolbar">
        <span className="script-target">
          🎲 {actor.name} PCG {dirty && <em>· unapplied</em>}
        </span>
        <button onClick={(e) => { const p = canvasPoint(e as unknown as React.MouseEvent); setAddMenu({ x: p.x, y: p.y }) }}>
          + Add Node
        </button>
        <button onClick={() => { setGraph(emptyPCGGraph()); setDirty(true) }}>Reset Pipeline</button>
        <button className="apply" onClick={apply}>
          ✓ Apply
        </button>
      </div>
      <div
        className="bp-canvas"
        ref={canvasRef}
        onMouseDown={(e) => {
          if (e.target === canvasRef.current && e.button === 0) {
            panState.current = { startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y }
            setAddMenu(null)
            setPendingFrom(null)
          }
        }}
        onMouseMove={(e) => {
          const p = canvasPoint(e)
          setMouse(p)
          if (panState.current) {
            setOffset({
              x: panState.current.ox + e.clientX - panState.current.startX,
              y: panState.current.oy + e.clientY - panState.current.startY,
            })
          }
          if (dragState.current) {
            const { nodeId, dx, dy } = dragState.current
            mutate((g) => {
              const n = g.nodes.find((x) => x.id === nodeId)
              if (n) {
                n.x = p.x - dx
                n.y = p.y - dy
              }
            })
          }
        }}
        onMouseUp={() => {
          dragState.current = null
          panState.current = null
        }}
        onDoubleClick={(e) => {
          if (e.target === canvasRef.current) setAddMenu(canvasPoint(e))
        }}
      >
        <svg className="bp-wires">
          <g transform={`translate(${offset.x},${offset.y})`}>
            {graph.edges.map((edge, i) => {
              const a = graph.nodes.find((n) => n.id === edge.from)
              const [tn] = edge.to.split(':')
              const b = graph.nodes.find((n) => n.id === tn)
              if (!a || !b) return null
              const p1 = portPos(a, 'out')
              const p2 = portPos(b, 'in')
              return (
                <path
                  key={i}
                  className="bp-wire pcg"
                  d={wirePath(p1.x, p1.y, p2.x, p2.y)}
                  onClick={() => mutate((g) => { g.edges = g.edges.filter((e2) => !(e2.from === edge.from && e2.to === edge.to)) })}
                />
              )
            })}
            {pendingFrom &&
              (() => {
                const a = graph.nodes.find((n) => n.id === pendingFrom)
                if (!a) return null
                const p1 = portPos(a, 'out')
                return <path className="bp-wire pending" d={wirePath(p1.x, p1.y, mouse.x, mouse.y)} />
              })()}
          </g>
        </svg>

        {graph.nodes.map((node) => {
          const def = PCG_NODE_DEFS[node.type]
          return (
            <div
              key={node.id}
              className="bp-node"
              style={{ left: node.x + offset.x, top: node.y + offset.y, width: NODE_W }}
            >
              <div
                className="bp-node-header"
                style={{ background: def.color }}
                onMouseDown={(e) => {
                  const p = canvasPoint(e)
                  dragState.current = { nodeId: node.id, dx: p.x - node.x, dy: p.y - node.y }
                  e.stopPropagation()
                }}
              >
                <span>{def.title}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    mutate((g) => {
                      g.nodes = g.nodes.filter((n) => n.id !== node.id)
                      g.edges = g.edges.filter((ed) => ed.from !== node.id && !ed.to.startsWith(`${node.id}:`))
                    })
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="bp-node-body" style={{ minHeight: def.hasInput ? 40 : 26 }}>
                {def.hasInput && (
                  <div className="bp-port in" style={{ top: 4 }} title="points in" onClick={() => onPort(node.id, 'in')}>
                    ●<em>in</em>
                  </div>
                )}
                {def.hasOutput && (
                  <div
                    className={`bp-port out ${pendingFrom === node.id ? 'pending' : ''}`}
                    style={{ top: 8 }}
                    title="points out"
                    onClick={() => onPort(node.id, 'out')}
                  >
                    ●
                  </div>
                )}
                {def.props.map((prop) => (
                  <label className="bp-prop" key={prop.key}>
                    <span>{prop.label}</span>
                    {prop.kind === 'check' ? (
                      <input
                        type="checkbox"
                        checked={Boolean(node.props[prop.key] ?? prop.default)}
                        onChange={(e) =>
                          mutate((g) => {
                            g.nodes.find((n) => n.id === node.id)!.props[prop.key] = e.target.checked
                          })
                        }
                      />
                    ) : prop.kind === 'select' ? (
                      <select
                        value={String(node.props[prop.key] ?? prop.default)}
                        onChange={(e) =>
                          mutate((g) => {
                            g.nodes.find((n) => n.id === node.id)!.props[prop.key] = e.target.value
                          })
                        }
                      >
                        {prop.options?.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={prop.kind === 'number' ? 'number' : 'color'}
                        step={prop.kind === 'number' ? 0.1 : undefined}
                        value={String(node.props[prop.key] ?? prop.default)}
                        onChange={(e) =>
                          mutate((g) => {
                            const n = g.nodes.find((x) => x.id === node.id)!
                            n.props[prop.key] = prop.kind === 'number' ? parseFloat(e.target.value) || 0 : e.target.value
                          })
                        }
                      />
                    )}
                  </label>
                ))}
              </div>
            </div>
          )
        })}

        {addMenu && (
          <div className="bp-add-menu" style={{ left: addMenu.x + offset.x, top: addMenu.y + offset.y }}>
            {categories.map((cat) => (
              <div key={cat}>
                <div className="bp-add-cat">{cat}</div>
                {(Object.entries(PCG_NODE_DEFS) as [PCGNodeType, (typeof PCG_NODE_DEFS)[PCGNodeType]][])
                  .filter(([, d]) => d.category === cat)
                  .map(([type, d]) => (
                    <button
                      key={type}
                      onClick={() => {
                        mutate((g) => {
                          const props: Record<string, string | number | boolean> = {}
                          for (const p of d.props) props[p.key] = p.default
                          g.nodes.push({ id: newPcgNodeId(), type, x: addMenu.x, y: addMenu.y, props })
                        })
                        setAddMenu(null)
                      }}
                    >
                      {d.title}
                    </button>
                  ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}