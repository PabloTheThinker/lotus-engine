import { useEffect, useRef, useState } from 'react'
import { world } from '../../engine/World'
import { getActiveBTGraphNodeId } from '../../engine/behaviorTree'
import {
  BT_NODE_DEFS,
  compileBTGraph,
  emptyBTGraph,
  newBTNodeId,
  type BTGraph,
  type BTGraphNode,
} from '../../engine/btGraph'
import { PropertyCommand, runCommand } from '../commands'
import { useEditor } from '../store'

const NODE_W = 170
const HEADER_H = 24

function wirePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

function nearestWireParent(graph: BTGraph, x: number, y: number): string | null {
  let best: { id: string; d: number } | null = null
  for (const n of graph.nodes) {
    const def = BT_NODE_DEFS[n.type] ?? { maxChildren: 0 }
    const childCount = graph.edges.filter((e) => e.from === n.id).length
    if (def.maxChildren <= childCount) continue
    const d = Math.hypot(n.x + NODE_W / 2 - x, n.y + HEADER_H / 2 - y)
    if (!best || d < best.d) best = { id: n.id, d }
  }
  return best?.id ?? graph.nodes.find((n) => n.type === 'Root')?.id ?? null
}

/** Behavior Tree editor — visual graph with live PIE highlight (Wave 12). */
export function BTEditor() {
  const selectedId = useEditor((s) => s.selectedId)
  const playing = useEditor((s) => s.playing)
  useEditor((s) => s.sceneVersion)
  const actor = selectedId ? world.actors.get(selectedId) : null
  const [graph, setGraph] = useState<BTGraph | null>(null)
  const [liveNode, setLiveNode] = useState<string | null>(null)
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null)
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const lastActor = useRef<string | null>(null)

  useEffect(() => {
    if (!actor) {
      setGraph(null)
      return
    }
    if (lastActor.current !== actor.id) {
      lastActor.current = actor.id
      setGraph(actor.btGraph ? JSON.parse(JSON.stringify(actor.btGraph)) : emptyBTGraph())
    }
  }, [actor?.id, actor?.btGraph])

  useEffect(() => {
    if (!playing || !actor?.id) {
      setLiveNode(null)
      return
    }
    let raf = 0
    const tick = () => {
      const compiled = actor.btGraph ? compileBTGraph(actor.btGraph) : null
      setLiveNode(getActiveBTGraphNodeId(actor.id, compiled?.pathIndex))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [playing, actor?.id, actor?.btGraph])

  if (!actor || !graph) {
    return <div className="panel-empty">Select an actor to edit its Behavior Tree.</div>
  }

  const commit = (next: BTGraph) => {
    setGraph(next)
    runCommand(
      new PropertyCommand(
        'BT Graph',
        () => {
          actor.btGraph = JSON.parse(JSON.stringify(next))
        },
        () => {},
      ),
    )
  }

  const addNode = (type: string) => {
    if (!addMenu) return
    const n: BTGraphNode = {
      id: newBTNodeId(),
      type,
      x: addMenu.x,
      y: addMenu.y,
      props:
        type === 'PlayerNear'
          ? { distance: 8 }
          : type === 'Wait'
            ? { seconds: 1 }
            : type === 'MoveToPlayer'
              ? { speed: 2.5, stopAt: 1.2 }
              : {},
    }
    const parentId = nearestWireParent(graph, addMenu.x, addMenu.y)
    const edges = [...graph.edges]
    if (parentId && parentId !== n.id) edges.push({ from: parentId, to: n.id })
    commit({ ...graph, nodes: [...graph.nodes, n], edges })
    setAddMenu(null)
  }

  const canvasPoint = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  return (
    <div className="bt-editor">
      <div className="bt-toolbar">
        <button
          onClick={() => {
            const compiled = compileBTGraph(graph)
            if (!compiled) {
              useEditor.getState().setStatus('BT compile failed — need a Root node')
              return
            }
            commit(graph)
            useEditor.getState().setStatus('BT graph saved — enable Auto-run or call api.runBTGraph in script')
          }}
        >
          Compile
        </button>
        <label className="field check bt-auto">
          <span>Auto-run on Play</span>
          <input
            type="checkbox"
            checked={!!actor.btAutoRun}
            onChange={(e) => {
              const v = e.target.checked
              runCommand(
                new PropertyCommand(
                  'BT Auto-run',
                  () => {
                    actor.btAutoRun = v
                  },
                  () => {},
                ),
              )
            }}
          />
        </label>
        <span className="panel-empty">Right-click canvas to add nodes. Live highlight during PIE.</span>
      </div>
      <div
        className="bt-canvas-wrap"
        ref={canvasRef}
        onMouseDown={() => setAddMenu(null)}
        onMouseMove={(e) => {
          if (!dragRef.current) return
          const p = canvasPoint(e)
          const { id, dx, dy } = dragRef.current
          const next = {
            ...graph,
            nodes: graph.nodes.map((n) =>
              n.id === id ? { ...n, x: p.x - dx, y: p.y - dy } : n,
            ),
          }
          setGraph(next)
        }}
        onMouseUp={() => {
          if (dragRef.current) commit(graph)
          dragRef.current = null
        }}
        onContextMenu={(e) => {
          e.preventDefault()
          const p = canvasPoint(e)
          setAddMenu(p)
        }}
      >
        <svg className="bt-canvas" width="100%" height="360">
          {graph.edges.map((edge) => {
            const a = graph.nodes.find((n) => n.id === edge.from)
            const b = graph.nodes.find((n) => n.id === edge.to)
            if (!a || !b) return null
            return (
              <path
                key={`${edge.from}-${edge.to}`}
                d={wirePath(a.x + NODE_W, a.y + HEADER_H / 2, b.x, b.y + HEADER_H / 2)}
                className="bt-wire"
              />
            )
          })}
          {graph.nodes.map((n) => {
            const def = BT_NODE_DEFS[n.type] ?? { title: n.type, color: '#555' }
            const active = liveNode === n.id
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  const p = canvasPoint(e)
                  dragRef.current = { id: n.id, dx: p.x - n.x, dy: p.y - n.y }
                }}
              >
                <rect
                  width={NODE_W}
                  height={HEADER_H + 18}
                  rx={4}
                  fill={def.color}
                  stroke={active ? '#ffe066' : '#222'}
                  strokeWidth={active ? 3 : 1}
                />
                <text x={8} y={16} fill="#fff" fontSize={11}>
                  {def.title}
                </text>
              </g>
            )
          })}
        </svg>
        {addMenu && (
          <div className="bt-add-menu" style={{ left: addMenu.x, top: addMenu.y }}>
            {Object.keys(BT_NODE_DEFS)
              .filter((t) => t !== 'Root')
              .map((t) => (
                <button key={t} onClick={() => addNode(t)}>
                  {BT_NODE_DEFS[t].title}
                </button>
              ))}
          </div>
        )}
      </div>
    </div>
  )
}