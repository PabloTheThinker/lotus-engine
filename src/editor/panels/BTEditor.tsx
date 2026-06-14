import { useEffect, useMemo, useRef, useState } from 'react'
import { world } from '../../engine/World'
import { getActiveBTGraphNodeId, getActiveBTServiceNodeIds } from '../../engine/behaviorTree'
import {
  BT_COMPOSITE_TYPES,
  BT_DECORATOR_TYPES,
  BT_MAX_DECORATOR_DEPTH,
  BT_NODE_DEFS,
  BT_SERVICE_TYPES,
  collapseBTSubtree,
  compileBTGraph,
  compileBTGraphToScript,
  emptyBTGraph,
  expandBTSubtree,
  resolveBTEditorHighlightNodeId,
  inferBlackboardTypes,
  newBTNodeId,
  summarizeBTTree,
  summarizeBTServices,
  diffBTScriptPreview,
  exportBTScriptDiffPatch,
  getBTScriptDiffGutterNodeIds,
  resolveBTScriptDiffGutterSelection,
  scrollRectForBTNode,
  getBTNodeServiceCompileHint,
  getBTServiceDecoratorHostId,
  getBTServiceHostNodeId,
  validateBTGraph,
  type BTGraph,
  type BTGraphNode,
} from '../../engine/btGraph'
import { PropertyCommand, runCommand } from '../commands'
import { useEditor } from '../store'

const NODE_W = 170
const HEADER_H = 24
const PORT_R = 6

function outPort(n: BTGraphNode): { x: number; y: number } {
  return { x: n.x + NODE_W, y: n.y + HEADER_H / 2 }
}

function inPort(n: BTGraphNode): { x: number; y: number } {
  return { x: n.x, y: n.y + HEADER_H / 2 }
}

function wirePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.5)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

function flowChildCount(graph: BTGraph, parentId: string): number {
  return graph.edges.filter((e) => e.from === parentId && e.kind !== 'service').length
}

function nearestWireParent(graph: BTGraph, x: number, y: number): string | null {
  let best: { id: string; d: number } | null = null
  for (const n of graph.nodes) {
    const def = BT_NODE_DEFS[n.type] ?? { maxChildren: 0 }
    const childCount = flowChildCount(graph, n.id)
    if (def.maxChildren <= childCount) continue
    const d = Math.hypot(n.x + NODE_W / 2 - x, n.y + HEADER_H / 2 - y)
    if (!best || d < best.d) best = { id: n.id, d }
  }
  return best?.id ?? graph.nodes.find((n) => n.type === 'Root')?.id ?? null
}

/** Behavior Tree editor — visual graph with live PIE highlight (Wave 12–13). */
export function BTEditor() {
  const selectedId = useEditor((s) => s.selectedId)
  const playing = useEditor((s) => s.playing)
  useEditor((s) => s.sceneVersion)
  const actor = selectedId ? world.actors.get(selectedId) : null
  const [graph, setGraph] = useState<BTGraph | null>(null)
  const [liveNode, setLiveNode] = useState<string | null>(null)
  const [liveServices, setLiveServices] = useState<string[]>([])
  const [selectedNode, setSelectedNode] = useState<string | null>(null)
  const [selectedDiffGutterIds, setSelectedDiffGutterIds] = useState<Set<string>>(() => new Set())
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null)
  const [pendingWire, setPendingWire] = useState<{ from: string; x: number; y: number } | null>(null)
  const [breakpointHitNode, setBreakpointHitNode] = useState<string | null>(null)
  const dragRef = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const graphRef = useRef<BTGraph | null>(null)
  const lastActor = useRef<string | null>(null)
  const breakpointHit = useEditor((s) => s.breakpointHit)

  useEffect(() => {
    graphRef.current = graph
  }, [graph])

  useEffect(() => {
    if (!breakpointHit || breakpointHit.actorId !== actor?.id) {
      setBreakpointHitNode(null)
      return
    }
    setBreakpointHitNode(breakpointHit.nodeId)
  }, [breakpointHit, actor?.id])

  const breakpointServiceHost = useMemo(() => {
    if (!breakpointHitNode || !graph) return null
    return getBTServiceHostNodeId(graph, breakpointHitNode)
  }, [breakpointHitNode, graph])

  const breakpointDecoratorHost = useMemo(() => {
    if (!breakpointHitNode || !graph) return null
    return getBTServiceDecoratorHostId(graph, breakpointHitNode)
  }, [breakpointHitNode, graph])

  useEffect(() => {
    if (!breakpointHitNode) return
    scrollNodeIntoView(breakpointHitNode)
    if (breakpointServiceHost && breakpointServiceHost !== breakpointHitNode) {
      const wrap = canvasRef.current
      const svc = graph?.nodes.find((n) => n.id === breakpointHitNode)
      const host = graph?.nodes.find((n) => n.id === breakpointServiceHost)
      if (wrap && svc && host) {
        const cx = (svc.x + host.x + NODE_W) / 2
        const cy = (svc.y + host.y + HEADER_H) / 2
        wrap.scrollTo({
          left: Math.max(0, cx - wrap.clientWidth / 2),
          top: Math.max(0, cy - wrap.clientHeight / 2),
          behavior: 'smooth',
        })
      }
    }
  }, [breakpointHitNode, breakpointServiceHost, graph])

  useEffect(() => {
    if (!actor) return
    const aid = actor.id
    const g = globalThis as typeof globalThis & {
      __btBreakpoint?: (actorId: string, nodeId: string) => boolean
    }
    g.__btBreakpoint = (actorId: string, nodeId: string) => {
      const st = useEditor.getState()
      if (!st.playing || (st.paused && st.breakpointHit)) return false
      const target = world.actors.get(actorId)
      if (!target) return false
      const liveGraph = actorId === aid ? graphRef.current : target.btGraph ?? null
      let hitId = nodeId
      let node = liveGraph?.nodes.find((n) => n.id === nodeId)
      if (!node?.breakpoint && liveGraph) {
        for (const stash of Object.values(liveGraph.subtrees ?? {})) {
          const stashed = stash.nodes.find((n) => n.id === nodeId)
          if (stashed?.breakpoint) {
            node = stashed
            hitId = resolveBTEditorHighlightNodeId(liveGraph, nodeId) ?? nodeId
            break
          }
        }
      }
      if (!node?.breakpoint) return false
      const title = BT_NODE_DEFS[node.type]?.title ?? node.type
      st.setPaused(true)
      st.setBreakpointHit({ actorId, nodeId: hitId })
      setBreakpointHitNode(hitId)
      st.setStatus(`BT breakpoint: ${title} · ${target.name}`)
      return true
    }
    return () => {
      delete g.__btBreakpoint
    }
  }, [actor?.id])

  useEffect(() => {
    if (!actor) {
      setGraph(null)
      setSelectedNode(null)
      return
    }
    if (lastActor.current !== actor.id) {
      lastActor.current = actor.id
      setGraph(actor.btGraph ? JSON.parse(JSON.stringify(actor.btGraph)) : emptyBTGraph())
      setSelectedNode(null)
    }
  }, [actor?.id, actor?.btGraph])

  useEffect(() => {
    if (!playing || !actor?.id) {
      setLiveNode(null)
      setLiveServices([])
      return
    }
    let raf = 0
    const tick = () => {
      const g = graphRef.current
      const compiled = actor.btGraph ? compileBTGraph(actor.btGraph) : null
      const runtimeId = getActiveBTGraphNodeId(actor.id, compiled?.pathIndex)
      setLiveNode(g ? resolveBTEditorHighlightNodeId(g, runtimeId) : runtimeId)
      setLiveServices(getActiveBTServiceNodeIds(actor.id))
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [playing, actor?.id, actor?.btGraph])

  const canvasBounds = useMemo(() => {
    const g = graph
    if (!g) return { w: 800, h: 320 }
    let maxX = 400
    let maxY = 280
    for (const n of g.nodes) {
      maxX = Math.max(maxX, n.x + NODE_W + 48)
      maxY = Math.max(maxY, n.y + HEADER_H + 48)
    }
    return { w: maxX, h: maxY }
  }, [graph])

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
              : type === 'Repeat'
                ? { count: 3 }
                : type === 'Cooldown'
                  ? { seconds: 2 }
                  : type === 'TimeLimit'
                    ? { seconds: 5 }
                    : type === 'BlackboardDecorator'
                      ? { key: 'flag' }
                      : type === 'SvcPlayerNear'
                        ? { key: 'hasLOS', distance: 8 }
                        : type === 'SvcSetBB'
                          ? { key: 'flag', value: 1 }
                          : {},
    }
    const parentId = nearestWireParent(graph, addMenu.x, addMenu.y)
    const edges = [...graph.edges]
    if (parentId && parentId !== n.id) edges.push({ from: parentId, to: n.id })
    commit({ ...graph, nodes: [...graph.nodes, n], edges })
    setSelectedNode(n.id)
    setAddMenu(null)
  }

  const deleteEdge = (from: string, to: string) => {
    commit({
      ...graph,
      edges: graph.edges.filter((e) => !(e.from === from && e.to === to)),
    })
  }

  const connectWire = (from: string, to: string) => {
    if (from === to) return
    if (graph.edges.some((e) => e.from === from && e.to === to)) return
    const parent = graph.nodes.find((n) => n.id === from)
    const child = graph.nodes.find((n) => n.id === to)
    if (!parent || !child) return
    const isService = BT_COMPOSITE_TYPES.has(parent.type) && BT_SERVICE_TYPES.has(child.type)
    if (isService) {
      const next = { ...graph, edges: [...graph.edges, { from, to, kind: 'service' as const }] }
      const err = validateBTGraph(next).find((i) => i.level === 'error')
      if (err) {
        useEditor.getState().setStatus(err.message)
        return
      }
      commit(next)
      return
    }
    if (BT_SERVICE_TYPES.has(child.type)) {
      useEditor.getState().setStatus('Attach services from Selector/Sequence out-port')
      return
    }
    const def = BT_NODE_DEFS[parent.type] ?? { maxChildren: 0 }
    const childCount = flowChildCount(graph, from)
    if (def.maxChildren <= childCount) {
      useEditor.getState().setStatus(`${parent.type} already has max children`)
      return
    }
    if (BT_DECORATOR_TYPES.has(child.type) && BT_DECORATOR_TYPES.has(parent.type)) {
      useEditor.getState().setStatus(`Decorator nesting limit: max ${BT_MAX_DECORATOR_DEPTH} deep`)
      return
    }
    const next = { ...graph, edges: [...graph.edges, { from, to, kind: 'flow' as const }] }
    const err = validateBTGraph(next).find((i) => i.level === 'error')
    if (err) {
      useEditor.getState().setStatus(err.message)
      return
    }
    commit(next)
  }

  const portAt = (x: number, y: number): { nodeId: string; kind: 'in' | 'out' } | null => {
    for (const n of graph.nodes) {
      const def = BT_NODE_DEFS[n.type] ?? { maxChildren: 0 }
      if (n.type !== 'Root') {
        const ip = inPort(n)
        if (Math.hypot(ip.x - x, ip.y - y) <= PORT_R + 4) return { nodeId: n.id, kind: 'in' }
      }
      if (def.maxChildren > 0) {
        const op = outPort(n)
        if (Math.hypot(op.x - x, op.y - y) <= PORT_R + 4) return { nodeId: n.id, kind: 'out' }
      }
    }
    return null
  }

  const updateNodeProp = (nodeId: string, key: string, value: string | number) => {
    const next = {
      ...graph,
      nodes: graph.nodes.map((n) =>
        n.id === nodeId ? { ...n, props: { ...n.props, [key]: value } } : n,
      ),
    }
    commit(next)
  }

  const canvasPoint = (e: React.MouseEvent) => {
    const wrap = canvasRef.current!
    const rect = wrap.getBoundingClientRect()
    return {
      x: e.clientX - rect.left + wrap.scrollLeft,
      y: e.clientY - rect.top + wrap.scrollTop,
    }
  }

  const scrollNodeIntoView = (nodeId: string) => {
    const wrap = canvasRef.current
    const target = graph?.nodes.find((n) => n.id === nodeId)
    if (!wrap || !target) return
    const { scrollLeft, scrollTop } = scrollRectForBTNode(target, wrap.clientWidth, wrap.clientHeight, NODE_W, HEADER_H)
    wrap.scrollTo({ left: scrollLeft, top: scrollTop, behavior: 'smooth' })
  }

  const node = selectedNode ? graph.nodes.find((n) => n.id === selectedNode) : null
  const bb = { ...(actor.scriptVars ?? {}) }
  const validation = validateBTGraph(graph)
  const compiledPreview = compileBTGraph(graph)
  const treePreview = compiledPreview ? summarizeBTTree(compiledPreview.tree) : ''
  const servicesPreview = summarizeBTServices(graph)
  const scriptDiff = diffBTScriptPreview(actor.script, graph)
  const diffGutterIds = new Set(getBTScriptDiffGutterNodeIds(actor.script, graph))
  const validationErrors = validation.filter((v) => v.level === 'error')
  const bbTypes = inferBlackboardTypes(graph)

  return (
    <div className="bt-editor">
      <div className="bt-toolbar">
        <button
          onClick={() => {
            if (validationErrors.length) {
              useEditor.getState().setStatus(validationErrors[0]!.message)
              return
            }
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
        <button
          onClick={() => {
            if (validationErrors.length) {
              useEditor.getState().setStatus(validationErrors[0]!.message)
              return
            }
            const code = compileBTGraphToScript(graph)
            if (!code) {
              useEditor.getState().setStatus('BT script compile failed')
              return
            }
            const prev = actor.script
            runCommand(
              new PropertyCommand(
                'BT compile to script',
                () => {
                  actor.script = code
                  actor.btAutoRun = false
                },
                () => {
                  actor.script = prev
                },
              ),
            )
            if (useEditor.getState().playing) {
              const synced = world.resyncActorScript(actor.id)
              useEditor.getState().setStatus(
                synced
                  ? 'BT compiled to script — PIE script resynced'
                  : 'BT compiled to script (PIE resync skipped)',
              )
            } else {
              useEditor.getState().setStatus('BT compiled to actor script (Auto-run disabled)')
            }
          }}
        >
          To Script
        </button>
        {diffGutterIds.size > 0 && (
          <>
            <button
              type="button"
              title="Scroll to selected (or all) script-diff gutter nodes"
              onClick={() => {
                const wrap = canvasRef.current
                if (!wrap) return
                const ids =
                  selectedDiffGutterIds.size > 0
                    ? [...selectedDiffGutterIds].filter((id) => diffGutterIds.has(id))
                    : [...diffGutterIds]
                const batch = resolveBTScriptDiffGutterSelection(
                  graph,
                  ids,
                  wrap.clientWidth,
                  wrap.clientHeight,
                )
                wrap.scrollTo({ left: batch.scrollLeft, top: batch.scrollTop, behavior: 'smooth' })
                if (batch.nodeIds[0]) setSelectedNode(batch.nodeIds[0])
                useEditor.getState().setStatus(
                  `Resolved ${batch.nodeIds.length} diff gutter node(s)${selectedDiffGutterIds.size ? ' (selection)' : ''}`,
                )
              }}
            >
              Resolve ≠{selectedDiffGutterIds.size ? ` (${selectedDiffGutterIds.size})` : ''}
            </button>
            {scriptDiff.changed && (
              <button
                type="button"
                title="Copy unified diff patch to clipboard"
                onClick={() => {
                  const patch = exportBTScriptDiffPatch(actor.script, graph)
                  void navigator.clipboard.writeText(patch)
                  useEditor.getState().setStatus('BT diff patch copied to clipboard')
                }}
              >
                Export patch
              </button>
            )}
          </>
        )}
        {breakpointHit && breakpointHit.actorId === actor.id && (
          <button
            onClick={() => useEditor.getState().continueFromBreakpoint()}
            title="Continue from breakpoint (F5)"
          >
            ▶ Continue
          </button>
        )}
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
        <span className="panel-empty">Right-click add · drag ports to wire · click wire to delete</span>
      </div>
      <div className="bt-body">
        <div
          className="bt-canvas-wrap"
          ref={canvasRef}
          onMouseDown={() => setAddMenu(null)}
          onMouseMove={(e) => {
            const p = canvasPoint(e)
            if (pendingWire) setPendingWire({ ...pendingWire, x: p.x, y: p.y })
            if (!dragRef.current) return
            const { id, dx, dy } = dragRef.current
            const next = {
              ...graph,
              nodes: graph.nodes.map((n) =>
                n.id === id ? { ...n, x: p.x - dx, y: p.y - dy } : n,
              ),
            }
            setGraph(next)
          }}
          onMouseUp={(e) => {
            if (pendingWire) {
              const p = canvasPoint(e)
              const hit = portAt(p.x, p.y)
              if (hit?.kind === 'in' && hit.nodeId !== pendingWire.from) {
                connectWire(pendingWire.from, hit.nodeId)
              }
              setPendingWire(null)
            }
            if (dragRef.current) commit(graph)
            dragRef.current = null
          }}
          onContextMenu={(e) => {
            e.preventDefault()
            const p = canvasPoint(e)
            setAddMenu(p)
          }}
        >
          <svg className="bt-canvas" width={canvasBounds.w} height={canvasBounds.h}>
            {pendingWire && (() => {
              const from = graph.nodes.find((n) => n.id === pendingWire.from)
              if (!from) return null
              const op = outPort(from)
              return (
                <path
                  d={wirePath(op.x, op.y, pendingWire.x, pendingWire.y)}
                  className="bt-wire pending"
                />
              )
            })()}
            {graph.nodes
              .filter((n) => BT_DECORATOR_TYPES.has(n.type))
              .map((dec) => {
                const childId = graph.edges.find((e) => e.from === dec.id)?.to
                const child = childId ? graph.nodes.find((n) => n.id === childId) : null
                if (!child || dec.props.collapsed) return null
                const pad = 10
                return (
                  <rect
                    key={`wrap-${dec.id}`}
                    x={child.x - pad}
                    y={child.y - pad}
                    width={NODE_W + pad * 2}
                    height={HEADER_H + 18 + pad * 2}
                    fill="none"
                    stroke="#8a7aff"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    rx={6}
                  />
                )
              })}
            {graph.edges
              .filter((edge) => {
                const a = graph.nodes.find((n) => n.id === edge.from)
                const b = graph.nodes.find((n) => n.id === edge.to)
                return !a?.props.collapsed && !b?.props.collapsed
              })
              .map((edge) => {
              const a = graph.nodes.find((n) => n.id === edge.from)
              const b = graph.nodes.find((n) => n.id === edge.to)
              if (!a || !b) return null
              const isService = edge.kind === 'service'
              const x1 = a.x + NODE_W
              const y1 = a.y + (isService ? HEADER_H + 18 : HEADER_H / 2)
              const x2 = b.x
              const y2 = b.y + HEADER_H / 2
              return (
                <path
                  key={`${edge.from}-${edge.to}-${edge.kind ?? 'flow'}`}
                  d={wirePath(x1, y1, x2, y2)}
                  className={isService ? 'bt-wire bt-wire-service' : 'bt-wire'}
                  strokeDasharray={isService ? '5 4' : undefined}
                  onClick={(e) => {
                    e.stopPropagation()
                    deleteEdge(edge.from, edge.to)
                  }}
                />
              )
            })}
            {graph.nodes
              .filter((n) => {
                if (n.props.collapsed) return true
                const parent = graph.edges.find((e) => e.to === n.id)?.from
                const pnode = parent ? graph.nodes.find((x) => x.id === parent) : null
                return !pnode?.props.collapsed
              })
              .map((n) => {
              const def = BT_NODE_DEFS[n.type] ?? { title: n.type, color: '#555', maxChildren: 0 }
              const active = liveNode === n.id
              const serviceActive = liveServices.includes(n.id)
              const selected = selectedNode === n.id
              const isBpHit = breakpointHitNode === n.id
              const isServiceBpHost =
                breakpointServiceHost === n.id && breakpointHitNode !== n.id
              const isDecoratorBpHost = breakpointDecoratorHost === n.id && breakpointHitNode !== n.id
              const showIn = n.type !== 'Root'
              const showOut = def.maxChildren > 0
              return (
                <g
                  key={n.id}
                  transform={`translate(${n.x},${n.y})`}
                  onMouseDown={(e) => {
                    e.stopPropagation()
                    setSelectedNode(n.id)
                    const p = canvasPoint(e)
                    dragRef.current = { id: n.id, dx: p.x - n.x, dy: p.y - n.y }
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    if (n.props.collapsed && graph.subtrees?.[n.id]) {
                      commit(expandBTSubtree(graph, n.id))
                    }
                  }}
                >
                  {(n.breakpoint || BT_SERVICE_TYPES.has(n.type)) && (
                    <circle
                      cx={-8}
                      cy={HEADER_H / 2}
                      r={5}
                      fill={isBpHit ? '#ff4466' : BT_SERVICE_TYPES.has(n.type) ? '#66ccaa' : '#e5484d'}
                      opacity={n.breakpoint || isBpHit ? 1 : BT_SERVICE_TYPES.has(n.type) ? 0.45 : 1}
                    />
                  )}
                  {diffGutterIds.has(n.id) && (
                    <text
                      x={-10}
                      y={HEADER_H / 2 + 14}
                      fill={selectedDiffGutterIds.has(n.id) ? '#ffe066' : '#f0c080'}
                      fontSize={10}
                      textAnchor="middle"
                      className="bt-gutter-diff"
                      style={{ cursor: 'pointer' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (e.shiftKey || e.ctrlKey || e.metaKey) {
                          setSelectedDiffGutterIds((prev) => {
                            const next = new Set(prev)
                            if (next.has(n.id)) next.delete(n.id)
                            else next.add(n.id)
                            return next
                          })
                        } else {
                          setSelectedDiffGutterIds(new Set([n.id]))
                        }
                        setSelectedNode(n.id)
                        scrollNodeIntoView(n.id)
                        const hint = getBTNodeServiceCompileHint(graph, n.id)
                        useEditor.getState().setStatus(
                          hint ??
                            `Script diff at ${def.title}${e.shiftKey || e.ctrlKey || e.metaKey ? ' (multi-select)' : ''}`,
                        )
                      }}
                    >
                      ≠
                    </text>
                  )}
                  <rect
                    width={NODE_W}
                    height={HEADER_H + 18}
                    rx={4}
                    fill={def.color}
                    stroke={
                      isBpHit
                        ? '#ff4466'
                        : isServiceBpHost
                          ? '#ff8866'
                          : isDecoratorBpHost
                            ? '#c9a878'
                            : active
                              ? '#ffe066'
                              : serviceActive
                                ? '#66ffcc'
                                : selected
                                  ? '#6eb5ff'
                                  : '#222'
                    }
                    strokeWidth={
                      isBpHit || isServiceBpHost || isDecoratorBpHost || active || serviceActive || selected ? 3 : 1
                    }
                  />
                  <text x={8} y={16} fill="#fff" fontSize={11}>
                    {n.props.collapsed ? `${def.title} (collapsed)` : def.title}
                  </text>
                  {showIn && (
                    <circle
                      className="bt-port bt-port-in"
                      cx={0}
                      cy={HEADER_H / 2}
                      r={PORT_R}
                      onMouseDown={(e) => e.stopPropagation()}
                      onMouseUp={(e) => {
                        e.stopPropagation()
                        if (pendingWire && pendingWire.from !== n.id) {
                          connectWire(pendingWire.from, n.id)
                          setPendingWire(null)
                        }
                      }}
                    />
                  )}
                  {showOut && (
                    <circle
                      className="bt-port bt-port-out"
                      cx={NODE_W}
                      cy={HEADER_H / 2}
                      r={PORT_R}
                      onMouseDown={(e) => {
                        e.stopPropagation()
                        setSelectedNode(n.id)
                        const op = outPort(n)
                        setPendingWire({ from: n.id, x: op.x, y: op.y })
                        dragRef.current = null
                      }}
                    />
                  )}
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
        <div className="bt-side">
          <details className="details-section" open>
            <summary>Validation</summary>
            <div className="bt-validation">
              {validation.length === 0 && <div className="panel-empty">Graph OK</div>}
              {validation.map((v, i) => (
                <div key={i} className={`bt-val-${v.level}`}>
                  {v.level === 'error' ? '✕' : '⚠'} {v.message}
                </div>
              ))}
            </div>
          </details>
          <details className="details-section" open={!!treePreview}>
            <summary>Compile preview</summary>
            <pre className="bt-preview">{treePreview || 'Wire nodes from Root to preview tree'}</pre>
          </details>
          <details className="details-section" open={servicesPreview.includes('←')}>
            <summary>Services compile</summary>
            <pre className="bt-preview bt-services-preview">{servicesPreview}</pre>
          </details>
          <details className="details-section" open={scriptDiff.changed}>
            <summary>Script compile diff</summary>
            <pre className={`bt-preview bt-script-diff${scriptDiff.changed ? ' changed' : ''}`}>
              {scriptDiff.entries.map((entry, i) => (
                <span
                  key={i}
                  className={entry.nodeId ? 'bt-script-diff-line jump' : 'bt-script-diff-line'}
                  role={entry.nodeId ? 'button' : undefined}
                  tabIndex={entry.nodeId ? 0 : undefined}
                  onClick={() => {
                    if (!entry.nodeId) return
                    setSelectedNode(entry.nodeId)
                    scrollNodeIntoView(entry.nodeId)
                    const hint = getBTNodeServiceCompileHint(graph, entry.nodeId)
                    useEditor.getState().setStatus(hint ?? `Jumped to diff node`)
                  }}
                  onKeyDown={(e) => {
                    if (entry.nodeId && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault()
                      setSelectedNode(entry.nodeId)
                      scrollNodeIntoView(entry.nodeId)
                    }
                  }}
                >
                  {entry.text}
                  {'\n'}
                </span>
              ))}
            </pre>
          </details>
          <details className="details-section" open>
            <summary>Blackboard</summary>
            <div className="details-grid">
              {Object.keys(bb).length === 0 && (
                <div className="panel-empty">No keys — set via script vars or SetBB node</div>
              )}
              {Object.entries(bb).map(([k, v]) => (
                <label className="field" key={k}>
                  <span>
                    {k}
                    {bbTypes[k] && <em className="bt-bb-type"> ({bbTypes[k]})</em>}
                  </span>
                  <input
                    value={String(v)}
                    onChange={(e) => {
                      const val = e.target.value
                      const parsed = Number.isFinite(parseFloat(val)) ? parseFloat(val) : val
                      actor.scriptVars = { ...(actor.scriptVars ?? {}), [k]: parsed }
                      useEditor.getState().touch()
                    }}
                  />
                </label>
              ))}
              <button
                onClick={() => {
                  const k = prompt('Blackboard key?')
                  if (!k) return
                  actor.scriptVars = { ...(actor.scriptVars ?? {}), [k]: true }
                  useEditor.getState().touch()
                }}
              >
                + Key
              </button>
            </div>
          </details>
          {node && (
            <details className="details-section" open>
              <summary>Node: {BT_NODE_DEFS[node.type]?.title ?? node.type}</summary>
              <div className="details-grid">
                <label className="field check">
                  <span>Breakpoint</span>
                  <input
                    type="checkbox"
                    checked={!!node.breakpoint}
                    onChange={() => {
                      const next = {
                        ...graph,
                        nodes: graph.nodes.map((n) =>
                          n.id === node.id ? { ...n, breakpoint: !n.breakpoint } : n,
                        ),
                      }
                      commit(next)
                    }}
                  />
                </label>
                {Object.entries(node.props).map(([k, v]) => (
                  <label className="field" key={k}>
                    <span>{k}</span>
                    <input
                      value={String(v)}
                      onChange={(e) => {
                        const raw = e.target.value
                        const num = parseFloat(raw)
                        updateNodeProp(node.id, k, Number.isFinite(num) && raw.trim() !== '' ? num : raw)
                      }}
                    />
                  </label>
                ))}
                {node.type === 'Blackboard' && (
                  <>
                    <label className="field">
                      <span>key</span>
                      <input
                        value={String(node.props.key ?? 'flag')}
                        onChange={(e) => updateNodeProp(node.id, 'key', e.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>equals</span>
                      <input
                        value={String(node.props.equals ?? '')}
                        onChange={(e) => updateNodeProp(node.id, 'equals', e.target.value)}
                      />
                    </label>
                  </>
                )}
                {node.type === 'SetBB' && (
                  <>
                    <label className="field">
                      <span>key</span>
                      <input
                        value={String(node.props.key ?? 'flag')}
                        onChange={(e) => updateNodeProp(node.id, 'key', e.target.value)}
                      />
                    </label>
                    <label className="field">
                      <span>value</span>
                      <input
                        value={String(node.props.value ?? '')}
                        onChange={(e) => updateNodeProp(node.id, 'value', e.target.value)}
                      />
                    </label>
                  </>
                )}
                {node.type === 'Emit' && (
                  <label className="field">
                    <span>signal</span>
                    <input
                      value={String(node.props.signal ?? 'ping')}
                      onChange={(e) => updateNodeProp(node.id, 'signal', e.target.value)}
                    />
                  </label>
                )}
                {node.type === 'Log' && (
                  <label className="field">
                    <span>text</span>
                    <input
                      value={String(node.props.text ?? 'BT')}
                      onChange={(e) => updateNodeProp(node.id, 'text', e.target.value)}
                    />
                  </label>
                )}
                {node.type === 'Repeat' && (
                  <label className="field">
                    <span>count</span>
                    <input
                      type="number"
                      min={1}
                      max={32}
                      value={Number(node.props.count ?? 3)}
                      onChange={(e) => updateNodeProp(node.id, 'count', parseInt(e.target.value, 10) || 1)}
                    />
                  </label>
                )}
                {node.type === 'Cooldown' && (
                  <label className="field">
                    <span>seconds</span>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={Number(node.props.seconds ?? 2)}
                      onChange={(e) => updateNodeProp(node.id, 'seconds', parseFloat(e.target.value) || 0)}
                    />
                  </label>
                )}
                {BT_DECORATOR_TYPES.has(node.type) && !node.props.collapsed && (
                  <button onClick={() => commit(collapseBTSubtree(graph, node.id))}>Collapse subtree</button>
                )}
                {node.props.collapsed && graph.subtrees?.[node.id] && (
                  <button onClick={() => commit(expandBTSubtree(graph, node.id))}>Expand subtree</button>
                )}
                {node.type !== 'Root' && (
                  <button
                    onClick={() => {
                      commit({
                        ...graph,
                        nodes: graph.nodes.filter((n) => n.id !== node.id),
                        edges: graph.edges.filter((e) => e.from !== node.id && e.to !== node.id),
                      })
                      setSelectedNode(null)
                    }}
                  >
                    Delete node
                  </button>
                )}
              </div>
            </details>
          )}
        </div>
      </div>
    </div>
  )
}