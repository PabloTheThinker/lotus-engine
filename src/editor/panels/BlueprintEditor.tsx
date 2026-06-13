import { useEffect, useRef, useState } from 'react'
import { world } from '../../engine/World'
import {
  NODE_DEFS,
  collapseToFunction,
  compileBlueprint,
  emptyGraph,
  getFunctionPins,
  newNodeId,
  type BlueprintGraph,
  type BPNode,
} from '../../engine/blueprint'
import { AddActorCommand, PropertyCommand, runCommand } from '../commands'
import { buildSerializedActor } from '../spawn'
import { useEditor } from '../store'

const NODE_W = 190
const HEADER_H = 26
const PORT_GAP = 22

/** y offset of an exec-out port inside a node */
function outPortY(index: number) {
  return HEADER_H + 12 + index * PORT_GAP
}

function portPos(node: BPNode, port: string, isOut: boolean): { x: number; y: number } {
  if (!isOut) return { x: node.x, y: node.y + HEADER_H + 12 }
  const def = NODE_DEFS[node.type]
  const idx = Math.max(0, def?.execOuts.indexOf(port) ?? 0)
  return { x: node.x + NODE_W, y: node.y + outPortY(idx) }
}

function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

/**
 * Blueprint editor — UE-style exec-pin node canvas. The graph compiles to
 * JavaScript in the actor's script slot, so Play runs it like any script.
 */
export function BlueprintEditor() {
  const selectedId = useEditor((s) => s.selectedId)
  useEditor((s) => s.sceneVersion)
  const actor = selectedId ? world.actors.get(selectedId) : null
  const [graph, setGraph] = useState<BlueprintGraph | null>(null)
  const [dirty, setDirty] = useState(false)
  const [pendingFrom, setPendingFrom] = useState<string | null>(null) // "nodeId:port"
  const [mouse, setMouse] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null)
  const lastActor = useRef<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ nodeId: string; dx: number; dy: number } | null>(null)
  const panState = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null)
  const pulseRef = useRef<Record<string, number>>({})
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [pulseAt, setPulseAt] = useState<Record<string, number>>({})
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editFunctionId, setEditFunctionId] = useState<string | null>(null)

  useEffect(() => {
    if (!actor) return
    const aid = actor.id
    let throttle: ReturnType<typeof setTimeout> | null = null

    const g = globalThis as typeof globalThis & { __bpPulse?: (actorId: string, nodeId: string) => void }
    g.__bpPulse = (actorId: string, nodeId: string) => {
      if (actorId !== aid) return
      pulseRef.current[nodeId] = Date.now()
      if (!throttle) {
        throttle = setTimeout(() => {
          throttle = null
          setPulseAt({ ...pulseRef.current })
        }, 50)
      }
    }

    const tick = setInterval(() => {
      const now = Date.now()
      let changed = false
      for (const [id, t] of Object.entries(pulseRef.current)) {
        if (now - t >= 300) {
          delete pulseRef.current[id]
          changed = true
        }
      }
      if (changed) setPulseAt({ ...pulseRef.current })
    }, 80)

    return () => {
      delete g.__bpPulse
      if (throttle) clearTimeout(throttle)
      clearInterval(tick)
    }
  }, [actor?.id])

  useEffect(() => {
    if (actor && actor.id !== lastActor.current) {
      lastActor.current = actor.id
      setGraph(actor.blueprint ? (JSON.parse(JSON.stringify(actor.blueprint)) as BlueprintGraph) : emptyGraph())
      setDirty(false)
      setPendingFrom(null)
      setSelected(new Set())
      setEditFunctionId(null)
    }
    if (!actor) lastActor.current = null
  }, [actor])

  if (!actor || !graph) {
    return <div className="panel-empty">Select an actor to open its Blueprint. Events fire during Play; Compile writes the generated code into the actor's script slot.</div>
  }

  const viewNodes = editFunctionId && graph.functions?.[editFunctionId] ? graph.functions[editFunctionId].nodes : graph.nodes
  const viewEdges = editFunctionId && graph.functions?.[editFunctionId] ? graph.functions[editFunctionId].edges : graph.edges

  const mutate = (fn: (g: BlueprintGraph) => void) => {
    const next = JSON.parse(JSON.stringify(graph)) as BlueprintGraph
    if (editFunctionId && next.functions?.[editFunctionId]) {
      const slice = { nodes: next.functions[editFunctionId].nodes, edges: next.functions[editFunctionId].edges, variables: next.variables, functions: next.functions }
      fn(slice)
      next.functions[editFunctionId].nodes = slice.nodes
      next.functions[editFunctionId].edges = slice.edges
    } else {
      fn(next)
    }
    setGraph(next)
    setDirty(true)
  }

  const toggleSelect = (nodeId: string, additive: boolean) => {
    setSelected((prev) => {
      const next = new Set(additive ? prev : [])
      if (next.has(nodeId)) next.delete(nodeId)
      else next.add(nodeId)
      return next
    })
  }

  const nodeDataPins = (node: BPNode) => {
    if (node.type === 'CallFunction') {
      const fnId = String(node.props.functionId ?? '')
      return getFunctionPins(graph, fnId)
    }
    if (node.type === 'FunctionEntry' || node.type === 'FunctionReturn') {
      const fn = Object.values(graph.functions ?? {}).find((f) => f.nodes.some((n) => n.id === node.id))
      if (!fn) return { dataIns: [], dataOuts: [] }
      if (node.type === 'FunctionEntry') return { dataIns: [], dataOuts: fn.dataIns }
      return { dataIns: fn.dataOuts, dataOuts: [] }
    }
    return { dataIns: [], dataOuts: [] }
  }

  const compile = () => {
    const code = compileBlueprint(graph)
    const prevScript = actor.script
    const prevBp = actor.blueprint
    const nextBp = JSON.parse(JSON.stringify(graph)) as BlueprintGraph
    runCommand(
      new PropertyCommand(
        `Compile Blueprint ${actor.name}`,
        () => {
          actor.blueprint = nextBp
          actor.script = code
        },
        () => {
          actor.blueprint = prevBp
          actor.script = prevScript
        },
      ),
    )
    setDirty(false)
    useEditor.getState().setStatus(`Blueprint compiled → ${actor.name} (${graph.nodes.length} nodes)`)
  }

  const canvasPoint = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left - offset.x, y: e.clientY - rect.top - offset.y }
  }

  const onPortClick = (nodeId: string, port: string, isOut: boolean) => {
    if (isOut) {
      setPendingFrom(`${nodeId}:${port}`)
      return
    }
    if (pendingFrom) {
      const from = pendingFrom
      if (from.split(':')[0] !== nodeId) {
        mutate((g) => {
          // exec out drives ONE input; replace any existing edge from this port
          g.edges = g.edges.filter((e) => e.from !== from)
          g.edges.push({ from, to: `${nodeId}:in` })
        })
      }
      setPendingFrom(null)
    }
  }

  return (
    <div className="bp-editor">
      <div className="bp-toolbar">
        <span className="script-target">
          ⬡ {actor.name} {dirty && <em>· uncompiled</em>}
        </span>
        <button onClick={(e) => { const p = canvasPoint(e as unknown as React.MouseEvent); setAddMenu({ x: p.x, y: p.y }) }}>
          + Add Node
        </button>
        <button
          title="Blueprint variables (read with Get Variable, write with Set Variable)"
          onClick={() => {
            const name = prompt('Variable name?', 'speed')
            if (!name) return
            const value = parseFloat(prompt('Default value?', '1') ?? '1') || 0
            mutate((g) => {
              g.variables = g.variables ?? []
              g.variables = g.variables.filter((v) => v.name !== name)
              g.variables.push({ name, value })
            })
          }}
        >
          + Variable
        </button>
        {(graph.variables ?? []).map((v) => (
          <span key={v.name} className="bp-var" title="Right-click removes">
            <em
              onContextMenu={(e) => {
                e.preventDefault()
                mutate((g) => {
                  g.variables = (g.variables ?? []).filter((x) => x.name !== v.name)
                })
              }}
            >
              {v.name}={v.value}
            </em>
          </span>
        ))}
        <button
          title="Collapse selected nodes into a macro function (Shift+click headers to select)"
          disabled={selected.size < 1 || !!editFunctionId}
          onClick={() => {
            const name = prompt('Function name?', 'MyFunction')
            if (!name) return
            const count = selected.size
            mutate((g) => {
              const err = collapseToFunction(g, selected, name)
              if (err) useEditor.getState().setStatus(err)
              else useEditor.getState().setStatus(`Collapsed ${count} nodes → function "${name}"`)
            })
            setSelected(new Set())
          }}
        >
          ⊟ Collapse to Function
        </button>
        {editFunctionId && graph.functions?.[editFunctionId] && (
          <button onClick={() => setEditFunctionId(null)}>
            ← Back ({graph.functions[editFunctionId].name})
          </button>
        )}
        <button onClick={() => mutate((g) => Object.assign(g, emptyGraph()))}>Clear</button>
        <button
          title="Level Blueprint — Empty actor named LevelScript (UE equivalent)"
          onClick={() => {
            let level = [...world.actors.values()].find((a) => a.name === 'LevelScript')
            if (!level) {
              const sa = buildSerializedActor({ kind: 'empty' }, [0, 0, 0])
              sa.name = 'LevelScript'
              runCommand(new AddActorCommand(sa))
              level = world.actors.get(sa.id)
            }
            if (level) useEditor.getState().select(level.id)
          }}
        >
          Level BP
        </button>
        <button className="apply" onClick={compile}>
          ⚙ Compile
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
            {viewEdges.map((edge, i) => {
              const [fn, fp, fData] = edge.from.split(':')
              const toParts = edge.to.split(':')
              const tn = toParts[0]
              const a = viewNodes.find((n) => n.id === fn)
              const b = viewNodes.find((n) => n.id === tn)
              if (!a || !b) return null
              const isData = toParts[1] === 'prop'
              let p1 = portPos(a, fp, true)
              if (fp === 'data') {
                const pins = nodeDataPins(a)
                const idx = pins.dataOuts.findIndex((p) => p.key === fData)
                p1 = { x: a.x + NODE_W, y: a.y + HEADER_H + 8 + Math.max(0, idx) * 18 }
              }
              let p2 = portPos(b, 'in', false)
              if (isData) {
                const pins = nodeDataPins(b)
                const dynIdx = pins.dataIns.findIndex((p) => p.key === toParts[2])
                const bdef = NODE_DEFS[b.type]
                const propIdx = dynIdx >= 0 ? dynIdx : (bdef?.props.findIndex((pr) => pr.key === toParts[2]) ?? 0)
                const portCount = (bdef?.hasExecIn ? 1 : 0) + (bdef?.execOuts.length ?? 0)
                const dynCount = pins.dataIns.length
                p2 = { x: b.x, y: b.y + HEADER_H + 10 + Math.max(portCount - 1, 0) * 4 + dynCount * 4 + propIdx * 22 + 12 }
              }
              return (
                <path
                  key={i}
                  className={`bp-wire ${isData ? 'data' : ''}`}
                  d={edgePath(p1.x, p1.y, p2.x, p2.y)}
                  onClick={() => mutate((g) => g.edges.splice(g.edges.indexOf(g.edges.find((e2) => e2.from === edge.from && e2.to === edge.to)!), 1))}
                />
              )
            })}
            {pendingFrom &&
              (() => {
                const [fn, fp] = pendingFrom.split(':')
                const a = viewNodes.find((n) => n.id === fn)
                if (!a) return null
                const p1 = portPos(a, fp, true)
                return <path className="bp-wire pending" d={edgePath(p1.x, p1.y, mouse.x, mouse.y)} />
              })()}
          </g>
        </svg>

        {viewNodes.map((node) => {
          const def = NODE_DEFS[node.type]
          if (!def) return null
          const pins = nodeDataPins(node)
          const fnList = Object.values(graph.functions ?? {})
          return (
            <div
              key={node.id}
              className={`bp-node${selected.has(node.id) ? ' selected' : ''}`}
              style={{ left: node.x + offset.x, top: node.y + offset.y, width: NODE_W }}
              onDoubleClick={() => {
                if (node.type === 'CallFunction') {
                  const fid = String(node.props.functionId ?? '')
                  if (graph.functions?.[fid]) setEditFunctionId(fid)
                }
              }}
            >
              <div
                className={`bp-node-header${pulseAt[node.id] != null && Date.now() - pulseAt[node.id] < 300 ? ' pulsing' : ''}`}
                style={{ background: def.color }}
                onMouseDown={(e) => {
                  if (e.shiftKey) {
                    toggleSelect(node.id, true)
                    e.stopPropagation()
                    return
                  }
                  const p = canvasPoint(e)
                  dragState.current = { nodeId: node.id, dx: p.x - node.x, dy: p.y - node.y }
                  e.stopPropagation()
                }}
              >
                <span>
                  {node.type === 'CallFunction'
                    ? `Call ${graph.functions?.[String(node.props.functionId)]?.name ?? 'Function'}`
                    : def.title}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    mutate((g) => {
                      g.nodes = g.nodes.filter((n) => n.id !== node.id)
                      g.edges = g.edges.filter((ed) => !ed.from.startsWith(`${node.id}:`) && !ed.to.startsWith(`${node.id}:`))
                    })
                  }}
                >
                  ✕
                </button>
              </div>
              <div className="bp-node-body">
                {def.hasExecIn && (
                  <div className="bp-port in" title="exec in" onClick={() => onPortClick(node.id, 'in', false)}>
                    ▸
                  </div>
                )}
                {def.pure && (
                  <div
                    className={`bp-port out data ${pendingFrom === `${node.id}:data` ? 'pending' : ''}`}
                    style={{ top: 8 }}
                    title="data out — wire into a ◦ data input"
                    onClick={() => onPortClick(node.id, 'data', true)}
                  >
                    ●
                  </div>
                )}
                {pins.dataOuts.map((pin, i) => (
                  <div
                    key={pin.key}
                    className={`bp-port out data ${pendingFrom === `${node.id}:data:${pin.key}` ? 'pending' : ''}`}
                    style={{ top: 8 + i * 18 }}
                    title={`data out: ${pin.label}`}
                    onClick={() => onPortClick(node.id, `data:${pin.key}`, true)}
                  >
                    <em>{pin.label}</em>●
                  </div>
                ))}
                {def.execOuts.map((port, i) => (
                  <div
                    key={port}
                    className={`bp-port out ${pendingFrom === `${node.id}:${port}` ? 'pending' : ''}`}
                    style={{ top: outPortY(i) - 8 }}
                    title={`exec out: ${port}`}
                    onClick={() => onPortClick(node.id, port, true)}
                  >
                    {def.execOuts.length > 1 ? <em>{port}</em> : null}▸
                  </div>
                ))}
                {pins.dataIns.map((pin) => (
                  <label className="bp-prop" key={pin.key}>
                    <span>
                      <button
                        className="bp-data-in"
                        title="data input"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          if (pendingFrom) {
                            const from = pendingFrom
                            mutate((g) => {
                              g.edges = g.edges.filter((ed) => ed.to !== `${node.id}:prop:${pin.key}`)
                              g.edges.push({ from, to: `${node.id}:prop:${pin.key}` })
                            })
                            setPendingFrom(null)
                          }
                        }}
                      >
                        ◦
                      </button>
                      {pin.label}
                    </span>
                    <span className="bp-pin-type">data</span>
                  </label>
                ))}
                {def.props.map((prop) => (
                  <label className="bp-prop" key={prop.key}>
                    <span>
                      {(def.dataIns?.includes(prop.key) || pins.dataIns.some((p) => p.key === prop.key)) && (
                        <button
                          className="bp-data-in"
                          title="data input — click after picking a data out"
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            if (pendingFrom) {
                              const from = pendingFrom
                              mutate((g) => {
                                g.edges = g.edges.filter((ed) => ed.to !== `${node.id}:prop:${prop.key}`)
                                g.edges.push({ from, to: `${node.id}:prop:${prop.key}` })
                              })
                              setPendingFrom(null)
                            }
                          }}
                        >
                          ◦
                        </button>
                      )}
                      {prop.label}
                    </span>
                    {node.type === 'CallFunction' && prop.key === 'functionId' ? (
                      <select
                        value={String(node.props.functionId ?? '')}
                        onChange={(e) =>
                          mutate((g) => {
                            g.nodes.find((n) => n.id === node.id)!.props.functionId = e.target.value
                          })
                        }
                      >
                        <option value="">— pick —</option>
                        {fnList.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name}
                          </option>
                        ))}
                      </select>
                    ) : prop.kind === 'check' ? (
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
                        type={prop.kind === 'number' ? 'number' : prop.kind === 'color' ? 'color' : 'text'}
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
            {(['Events', 'Actions', 'Flow', 'Data', ...(editFunctionId ? (['Function'] as const) : [])] as const).map((cat) => (
              <div key={cat}>
                <div className="bp-add-cat">{cat}</div>
                {Object.entries(NODE_DEFS)
                  .filter(([type, d]) => {
                    if (d.category !== cat) return false
                    if (!editFunctionId && (type === 'FunctionEntry' || type === 'FunctionReturn')) return false
                    if (editFunctionId && type === 'CallFunction') return false
                    return true
                  })
                  .map(([type, d]) => (
                    <button
                      key={type}
                      onClick={() => {
                        mutate((g) => {
                          const props: BPNode['props'] = {}
                          for (const p of d.props) props[p.key] = p.default
                          g.nodes.push({ id: newNodeId(), type, x: addMenu.x, y: addMenu.y, props })
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
