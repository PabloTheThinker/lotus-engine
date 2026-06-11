import { useEffect, useRef, useState } from 'react'
import { world } from '../../engine/World'
import {
  MAT_NODE_DEFS,
  emptyMaterialGraph,
  newMatNodeId,
  type MaterialGraph,
} from '../../engine/materialGraph'
import { PropertyCommand, runCommand } from '../commands'
import { useEditor } from '../store'

const NODE_W = 170
const HEADER_H = 24
const PORT_GAP = 20

function inPortY(index: number) {
  return HEADER_H + 12 + index * PORT_GAP
}

function portPos(node: { x: number; y: number; type: string }, port: string | null): { x: number; y: number } {
  if (port === null) {
    // single output, vertically centered on first row
    return { x: node.x + NODE_W, y: node.y + HEADER_H + 12 }
  }
  const def = MAT_NODE_DEFS[node.type]
  const idx = Math.max(0, def?.inputs.indexOf(port) ?? 0)
  return { x: node.x, y: node.y + inPortY(idx) }
}

function wirePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

/**
 * Material node editor — UE Material Editor v1. Dataflow graph (Color/Scalar/
 * Time/Sine/Pulse/Multiply/Add/Lerp → Output channels) evaluated per frame,
 * so Time-driven materials animate live in the viewport.
 */
export function MaterialEditor() {
  const selectedId = useEditor((s) => s.selectedId)
  useEditor((s) => s.sceneVersion)
  const actor = selectedId ? world.actors.get(selectedId) : null
  const [graph, setGraph] = useState<MaterialGraph | null>(null)
  const [dirty, setDirty] = useState(false)
  const [pendingFrom, setPendingFrom] = useState<string | null>(null)
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null)
  const lastActor = useRef<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ nodeId: string; dx: number; dy: number } | null>(null)

  useEffect(() => {
    if (actor && actor.id !== lastActor.current) {
      lastActor.current = actor.id
      setGraph(actor.materialGraph ? (JSON.parse(JSON.stringify(actor.materialGraph)) as MaterialGraph) : emptyMaterialGraph())
      setDirty(false)
      setPendingFrom(null)
    }
    if (!actor) lastActor.current = null
  }, [actor])

  if (!actor?.mesh || !actor.materialProps) {
    return <div className="panel-empty">Select a mesh actor to edit its material graph. Wire Color/Time/math nodes into the Output channels — the material animates live.</div>
  }
  if (!graph) return null

  const mutate = (fn: (g: MaterialGraph) => void) => {
    const next = JSON.parse(JSON.stringify(graph)) as MaterialGraph
    fn(next)
    setGraph(next)
    setDirty(true)
  }

  const apply = () => {
    const prev = actor.materialGraph
    const next = JSON.parse(JSON.stringify(graph)) as MaterialGraph
    runCommand(
      new PropertyCommand(
        `Material graph ${actor.name}`,
        () => (actor.materialGraph = next),
        () => (actor.materialGraph = prev),
      ),
    )
    setDirty(false)
    useEditor.getState().setStatus(`Material graph applied → ${actor.name}`)
  }

  const canvasPoint = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const onPort = (nodeId: string, port: string | null) => {
    if (port === null) {
      setPendingFrom(nodeId)
      return
    }
    if (pendingFrom && pendingFrom !== nodeId) {
      mutate((g) => {
        g.edges = g.edges.filter((e) => e.to !== `${nodeId}:${port}`) // one wire per input
        g.edges.push({ from: pendingFrom, to: `${nodeId}:${port}` })
      })
      setPendingFrom(null)
    }
  }

  return (
    <div className="bp-editor">
      <div className="bp-toolbar">
        <span className="script-target">
          ⚛ {actor.name} material {dirty && <em>· unapplied</em>}
        </span>
        <button onClick={(e) => setAddMenu(canvasPoint(e as unknown as React.MouseEvent))}>+ Add Node</button>
        <button
          onClick={() => {
            const prev = actor.materialGraph
            runCommand(
              new PropertyCommand(
                'Remove material graph',
                () => (actor.materialGraph = undefined),
                () => (actor.materialGraph = prev),
              ),
            )
            setGraph(emptyMaterialGraph())
            setDirty(false)
          }}
        >
          Detach
        </button>
        <button className="apply" onClick={apply}>
          ✓ Apply
        </button>
      </div>
      <div
        className="bp-canvas"
        ref={canvasRef}
        onMouseDown={(e) => {
          if (e.target === canvasRef.current) {
            setAddMenu(null)
            setPendingFrom(null)
          }
        }}
        onMouseMove={(e) => {
          const p = canvasPoint(e)
          setMouse(p)
          if (dragState.current) {
            const { nodeId, dx, dy } = dragState.current
            setGraph((g) => (g ? { ...g, nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, x: p.x - dx, y: p.y - dy } : n)) } : g))
            setDirty(true)
          }
        }}
        onMouseUp={() => (dragState.current = null)}
        onDoubleClick={(e) => {
          if (e.target === canvasRef.current) setAddMenu(canvasPoint(e))
        }}
      >
        <svg className="bp-wires">
          {graph.edges.map((edge, i) => {
            const a = graph.nodes.find((n) => n.id === edge.from)
            const [tn, tp] = edge.to.split(':')
            const b = graph.nodes.find((n) => n.id === tn)
            if (!a || !b) return null
            const p1 = portPos(a, null)
            const p2 = portPos(b, tp)
            return (
              <path
                key={i}
                className="bp-wire mat"
                d={wirePath(p1.x, p1.y, p2.x, p2.y)}
                onClick={() => mutate((g) => { g.edges = g.edges.filter((e2) => !(e2.from === edge.from && e2.to === edge.to)) })}
              />
            )
          })}
          {pendingFrom &&
            (() => {
              const a = graph.nodes.find((n) => n.id === pendingFrom)
              if (!a) return null
              const p1 = portPos(a, null)
              return <path className="bp-wire pending" d={wirePath(p1.x, p1.y, mouse.x, mouse.y)} />
            })()}
        </svg>

        {graph.nodes.map((node) => {
          const def = MAT_NODE_DEFS[node.type]
          if (!def) return null
          return (
            <div key={node.id} className="bp-node" style={{ left: node.x, top: node.y, width: NODE_W }}>
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
                {node.type !== 'Output' && (
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
                )}
              </div>
              <div className="bp-node-body" style={{ minHeight: Math.max(26, def.inputs.length * PORT_GAP + 4) }}>
                {def.inputs.map((inp, i) => (
                  <div key={inp} className="bp-port in" style={{ top: inPortY(i) - HEADER_H - 4 }} onClick={() => onPort(node.id, inp)}>
                    ●<em>{inp}</em>
                  </div>
                ))}
                {def.hasOutput && (
                  <div
                    className={`bp-port out ${pendingFrom === node.id ? 'pending' : ''}`}
                    style={{ top: 8 }}
                    onClick={() => onPort(node.id, null)}
                  >
                    ●
                  </div>
                )}
                {def.props.map((prop) => (
                  <label className="bp-prop" key={prop.key} style={{ marginTop: def.inputs.length ? def.inputs.length * PORT_GAP - 12 : 0 }}>
                    <span>{prop.label}</span>
                    <input
                      type={prop.kind === 'number' ? 'number' : 'color'}
                      step={0.1}
                      value={String(node.props[prop.key] ?? prop.default)}
                      onChange={(e) =>
                        mutate((g) => {
                          const n = g.nodes.find((x) => x.id === node.id)!
                          n.props[prop.key] = prop.kind === 'number' ? parseFloat(e.target.value) || 0 : e.target.value
                        })
                      }
                    />
                  </label>
                ))}
              </div>
            </div>
          )
        })}

        {addMenu && (
          <div className="bp-add-menu" style={{ left: addMenu.x, top: addMenu.y }}>
            <div>
              <div className="bp-add-cat">Material Nodes</div>
              {Object.entries(MAT_NODE_DEFS)
                .filter(([t]) => t !== 'Output')
                .map(([type, d]) => (
                  <button
                    key={type}
                    onClick={() => {
                      mutate((g) => {
                        const props: Record<string, string | number> = {}
                        for (const p of d.props) props[p.key] = p.default
                        g.nodes.push({ id: newMatNodeId(), type, x: addMenu.x, y: addMenu.y, props })
                      })
                      setAddMenu(null)
                    }}
                  >
                    {d.title}
                  </button>
                ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
