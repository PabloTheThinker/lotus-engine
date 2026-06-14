import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { world } from '../../engine/World'
import {
  MAT_NODE_DEFS,
  applyMaterialGraphToMaterial,
  emptyMaterialGraph,
  getMaterialGraphMode,
  newMatNodeId,
  type MaterialGraph,
  type MaterialGraphMode,
} from '../../engine/materialGraph'
import {
  compileMaterialGraphTSL,
  isTSLPreviewAvailableAsync,
  materialGraphTSLPreviewChannels,
  previewChannelForPort,
} from '../../engine/materialGraphTSL'
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

const PORT_HIT = 10

function portAt(
  graph: MaterialGraph,
  x: number,
  y: number,
): { nodeId: string; port: string | null } | null {
  for (const node of graph.nodes) {
    const def = MAT_NODE_DEFS[node.type]
    if (!def) continue
    if (def.hasOutput) {
      const p = portPos(node, null)
      if (Math.hypot(p.x - x, p.y - y) <= PORT_HIT) return { nodeId: node.id, port: null }
    }
    for (const inp of def.inputs) {
      const p = portPos(node, inp)
      if (Math.hypot(p.x - x, p.y - y) <= PORT_HIT) return { nodeId: node.id, port: inp }
    }
  }
  return null
}

/** Wave 23 — scaled overview; Wave 24 — viewport rect + click-to-pan sync. */
function nodesInSoloChannel(graph: MaterialGraph, channel: string | null): Set<string> {
  const ids = new Set<string>()
  if (!channel) return ids
  const out = graph.nodes.find((n) => n.type === 'Output')
  if (!out) return ids
  const stack = [out.id]
  ids.add(out.id)
  while (stack.length) {
    const nodeId = stack.pop()!
    for (const edge of graph.edges) {
      const [toNode, toPort] = edge.to.split(':')
      if (toNode !== nodeId) continue
      if (nodeId === out.id && toPort !== channel) continue
      if (!ids.has(edge.from)) {
        ids.add(edge.from)
        stack.push(edge.from)
      }
    }
  }
  return ids
}

const CHANNEL_LEGEND_COLORS: Record<string, string> = {
  baseColor: '#5b8def',
  emissive: '#e87840',
  emissiveInt: '#c06030',
  roughness: '#9aa0a8',
  metalness: '#b8c0cc',
  opacity: '#7a8a9a',
  clearCoat: '#88c8ff',
  clearCoatRoughness: '#6aa8d8',
  sheen: '#d8b8ff',
  sheenRoughness: '#a888d8',
  wpo: '#66cc88',
}

function MaterialGraphMinimap({
  graph,
  isolateChannel,
  pinnedChannel,
  panOffset,
  zoom,
  viewportW,
  viewportH,
  onPanTo,
  onZoomAt,
  onFocusNode,
  focusedNodeId,
  legendDragPreview,
}: {
  graph: MaterialGraph
  isolateChannel: string | null
  pinnedChannel?: string | null
  legendDragPreview?: string | null
  panOffset: { x: number; y: number }
  zoom: number
  viewportW: number
  viewportH: number
  onPanTo: (gx: number, gy: number) => void
  onZoomAt?: (factor: number, gx: number, gy: number) => void
  onFocusNode?: (nodeId: string) => void
  focusedNodeId?: string | null
}) {
  const dragPan = useRef(false)
  const panStart = useRef<{ x: number; y: number } | null>(null)
  if (graph.nodes.length < 2) return null
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const n of graph.nodes) {
    minX = Math.min(minX, n.x)
    minY = Math.min(minY, n.y)
    maxX = Math.max(maxX, n.x + NODE_W)
    maxY = Math.max(maxY, n.y + 72)
  }
  const pad = 16
  const gw = maxX - minX + pad * 2
  const gh = maxY - minY + pad * 2
  const mw = 128
  const mh = 76
  const sx = mw / Math.max(gw, 1)
  const sy = mh / Math.max(gh, 1)
  const soloNodes = nodesInSoloChannel(graph, isolateChannel)
  const pinNodes = nodesInSoloChannel(graph, pinnedChannel ?? legendDragPreview ?? null)
  const outNode = graph.nodes.find((n) => n.type === 'Output')
  const vw = Math.max(viewportW, 320)
  const vh = Math.max(viewportH, 200)
  const viewGx = -panOffset.x / Math.max(zoom, 0.05)
  const viewGy = -panOffset.y / Math.max(zoom, 0.05)
  const viewGw = vw / Math.max(zoom, 0.05)
  const viewGh = vh / Math.max(zoom, 0.05)
  const mapMinimapPoint = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top
    return { gx: mx / sx + minX - pad, gy: my / sy + minY - pad }
  }
  return (
    <svg
      className="mat-minimap"
      width={mw}
      height={mh}
      aria-label="Material graph minimap"
      onMouseDown={(e) => {
        e.preventDefault()
        dragPan.current = true
        panStart.current = { x: e.clientX, y: e.clientY }
        const { gx, gy } = mapMinimapPoint(e)
        onPanTo(gx, gy)
      }}
      onMouseMove={(e) => {
        if (!dragPan.current) return
        const { gx, gy } = mapMinimapPoint(e)
        onPanTo(gx, gy)
      }}
      onMouseUp={(e) => {
        if (panStart.current && onFocusNode) {
          const moved = Math.hypot(e.clientX - panStart.current.x, e.clientY - panStart.current.y)
          if (moved < 5) {
            const { gx, gy } = mapMinimapPoint(e)
            let hit: string | null = null
            let best = Infinity
            for (const n of graph.nodes) {
              if (gx >= n.x && gx <= n.x + NODE_W && gy >= n.y && gy <= n.y + 72) {
                const d = Math.hypot(gx - (n.x + NODE_W / 2), gy - (n.y + 36))
                if (d < best) {
                  best = d
                  hit = n.id
                }
              }
            }
            if (hit) onFocusNode(hit)
          }
        }
        dragPan.current = false
        panStart.current = null
      }}
      onMouseLeave={() => {
        dragPan.current = false
        panStart.current = null
      }}
      onWheel={(e) => {
        if (!onZoomAt) return
        e.preventDefault()
        e.stopPropagation()
        const factor = e.deltaY < 0 ? 1.12 : 0.88
        const { gx, gy } = mapMinimapPoint(e)
        onZoomAt(factor, gx, gy)
      }}
    >
      {graph.edges.map((edge, i) => {
        const a = graph.nodes.find((n) => n.id === edge.from)
        const [tn, tp] = edge.to.split(':')
        const b = graph.nodes.find((n) => n.id === tn)
        if (!a || !b) return null
        const p1 = portPos(a, null)
        const p2 = portPos(b, tp)
        return (
          <line
            key={i}
            x1={(p1.x - minX + pad) * sx}
            y1={(p1.y - minY + pad) * sy}
            x2={(p2.x - minX + pad) * sx}
            y2={(p2.y - minY + pad) * sy}
            stroke={
              pinnedChannel && tp === pinnedChannel
                ? '#c9a8ff'
                : isolateChannel && tp === isolateChannel
                  ? '#9ec8ff'
                  : '#3a4a5a'
            }
            strokeWidth={pinnedChannel && tp === pinnedChannel ? 2 : 1}
          />
        )
      })}
      {graph.nodes.map((n) => {
        const def = MAT_NODE_DEFS[n.type]
        const soloHit = isolateChannel && soloNodes.has(n.id)
        const pinHit = pinnedChannel && pinNodes.has(n.id)
        return (
          <rect
            key={n.id}
            x={(n.x - minX + pad) * sx}
            y={(n.y - minY + pad) * sy}
            width={Math.max(8, NODE_W * sx)}
            height={10}
            rx={2}
            fill={pinHit ? '#c9a8ff' : soloHit ? '#9ec8ff' : (def?.color ?? '#444')}
            opacity={soloHit || pinHit || focusedNodeId === n.id ? 1 : 0.7}
            stroke={
              focusedNodeId === n.id ? '#ffe066' : pinHit ? '#c9a8ff' : soloHit ? '#6eb5ff' : undefined
            }
            strokeWidth={focusedNodeId === n.id ? 2 : soloHit || pinHit ? 1 : 0}
          />
        )
      })}
      {pinnedChannel && outNode && (() => {
        const p2 = portPos(outNode, pinnedChannel)
        return (
          <circle
            className="mat-minimap-pin"
            cx={(p2.x - minX + pad) * sx}
            cy={(p2.y - minY + pad) * sy}
            r={3}
            fill="#c9a8ff"
            stroke="#fff"
            strokeWidth={0.5}
          />
        )
      })()}
      <rect
          className="mat-minimap-viewport"
          x={(viewGx - minX + pad) * sx}
          y={(viewGy - minY + pad) * sy}
          width={Math.max(4, viewGw * sx)}
          height={Math.max(4, viewGh * sy)}
          fill="none"
          stroke="#6eb5ff"
          strokeWidth={1.5}
          rx={1}
        />
    </svg>
  )
}

/** Live preview sphere — WebGL or WebGPU (TSL) depending on material backend. */
function MaterialPreview({
  graph,
  mode,
  flashChannel,
  isolateChannel,
}: {
  graph: MaterialGraph
  mode: MaterialGraphMode
  flashChannel?: string | null
  isolateChannel?: string | null
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const graphSnapshot = JSON.stringify(graph)
  const tslBackend = world.environment.materialBackend === 'tsl'

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    let raf = 0
    let ro: ResizeObserver | null = null
    let cleanup = () => {}

    const boot = async () => {
      const scene = new THREE.Scene()
      scene.background = new THREE.Color('#1a1d24')
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 50)
      camera.position.set(0, 0.15, 2.4)

      const key = new THREE.DirectionalLight(0xffffff, 1.4)
      key.position.set(2, 3, 2)
      scene.add(key)
      scene.add(new THREE.AmbientLight(0x404860, 0.55))

      const geo = new THREE.SphereGeometry(0.85, 96, 72)
      let mesh: THREE.Mesh
      let renderer: { domElement: HTMLCanvasElement; setSize: (w: number, h: number, u?: boolean) => void; render: (s: THREE.Scene, c: THREE.Camera) => void; dispose: () => void }

      const useTSL = tslBackend && (await isTSLPreviewAvailableAsync())
      if (useTSL) {
        const webgpu = await import('three/webgpu')
        const WebGPURenderer = webgpu.WebGPURenderer as new (p: { antialias?: boolean }) => {
          domElement: HTMLCanvasElement
          setSize: (w: number, h: number, u?: boolean) => void
          render: (s: THREE.Scene, c: THREE.Camera) => void
          dispose: () => void
        }
        renderer = new WebGPURenderer({ antialias: true })
        const tslMat = compileMaterialGraphTSL(graph, 0, undefined, isolateChannel)
        mesh = new THREE.Mesh(geo, tslMat ?? new THREE.MeshStandardMaterial({ color: '#5b8def' }))
      } else {
        renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
        ;(renderer as THREE.WebGLRenderer).outputColorSpace = THREE.SRGBColorSpace
        const mat = new THREE.MeshStandardMaterial({ color: '#5b8def', roughness: 0.35, metalness: 0.1 })
        mesh = new THREE.Mesh(geo, mat)
      }

      if (disposed) {
        geo.dispose()
        mesh.geometry.dispose()
        const m = mesh.material
        if (Array.isArray(m)) m.forEach((x) => x.dispose())
        else m.dispose()
        renderer.dispose()
        return
      }

      host.appendChild(renderer.domElement)
      scene.add(mesh)

      ro = new ResizeObserver(() => {
        const w = host.clientWidth
        const h = host.clientHeight
        if (w < 8 || h < 8) return
        renderer.setSize(w, h, false)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      })
      ro.observe(host)

      const loop = () => {
        const t = performance.now() / 1000
        mesh.rotation.y = t * 0.35
        mesh.rotation.x = 0.15
        if (useTSL) {
          const next = compileMaterialGraphTSL(graph, t, undefined, isolateChannel)
          if (next) {
            const prev = mesh.material
            mesh.material = next
            if (Array.isArray(prev)) prev.forEach((x) => x.dispose())
            else prev.dispose()
          }
        } else {
          applyMaterialGraphToMaterial(
            mesh.material as THREE.MeshStandardMaterial,
            graph,
            t,
            mode,
            world.environment.materialBackend ?? 'glsl',
          )
        }
        renderer.render(scene, camera)
        raf = requestAnimationFrame(loop)
      }
      loop()

      cleanup = () => {
        cancelAnimationFrame(raf)
        ro?.disconnect()
        mesh.geometry.dispose()
        const m = mesh.material
        if (Array.isArray(m)) m.forEach((x) => x.dispose())
        else m.dispose()
        renderer.dispose()
        if (host.contains(renderer.domElement)) host.removeChild(renderer.domElement)
      }
    }

    void boot()
    return () => {
      disposed = true
      cleanup()
    }
  }, [graphSnapshot, mode, tslBackend, isolateChannel])

  const nodeChannels =
    tslBackend && graph.nodes.length ? materialGraphTSLPreviewChannels(graph) : []

  return (
    <div className="mat-preview-wrap">
      <div
        className="mat-preview-viewport"
        ref={hostRef}
        title={tslBackend ? 'Live TSL node-graph preview (WebGPU)' : 'Live material preview'}
      />
      {nodeChannels.length > 0 && (
        <div
          className={`mat-preview-badge${flashChannel ? ' mat-preview-flash' : ''}`}
          title="TSL node graph channels"
        >
          TSL nodes · {nodeChannels.join(', ')}
          {flashChannel && <span className="mat-preview-flash-label"> · wired {flashChannel}</span>}
          {isolateChannel && <span className="mat-preview-isolate-label"> · solo {isolateChannel}</span>}
        </div>
      )}
    </div>
  )
}

/**
 * Material node editor — UE Material Editor v2. Dataflow graph with CPU (fast)
 * and GPU (per-pixel onBeforeCompile) modes plus live preview sphere.
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
  const [previewFlash, setPreviewFlash] = useState<string | null>(null)
  const [isolateChannel, setIsolateChannel] = useState<string | null>(null)
  const [pinnedMinimapChannel, setPinnedMinimapChannel] = useState<string | null>(null)
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null)
  const [legendDragPreview, setLegendDragPreview] = useState<string | null>(null)
  const [upstreamFlashIds, setUpstreamFlashIds] = useState<Set<string>>(() => new Set())
  const [channelOrder, setChannelOrder] = useState<string[]>([])
  const legendDrag = useRef<string | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const upstreamFlashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastActor = useRef<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ nodeId: string; dx: number; dy: number } | null>(null)
  const panState = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null)
  const panAnim = useRef<number | null>(null)
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      setViewportSize({ w: el.clientWidth, h: el.clientHeight })
    })
    ro.observe(el)
    setViewportSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [actor?.id])

  useEffect(() => {
    if (actor && actor.id !== lastActor.current) {
      lastActor.current = actor.id
      const g = actor.materialGraph
        ? (JSON.parse(JSON.stringify(actor.materialGraph)) as MaterialGraph)
        : emptyMaterialGraph()
      if (!g.mode) g.mode = actor.materialGraphMode ?? 'cpu'
      setGraph(g)
      setDirty(false)
      setPendingFrom(null)
    }
    if (!actor) lastActor.current = null
  }, [actor])

  const wiredChannels = useMemo(() => {
    if (!graph) return []
    const out = graph.nodes.find((n) => n.type === 'Output')
    if (!out) return []
    return MAT_NODE_DEFS.Output.inputs.filter((inp) =>
      graph.edges.some((e) => e.to === `${out.id}:${inp}`),
    )
  }, [graph])

  const orderedChannels = channelOrder.length ? channelOrder : wiredChannels

  useEffect(() => {
    setChannelOrder((prev) => {
      const next = prev.filter((ch) => wiredChannels.includes(ch))
      for (const ch of wiredChannels) {
        if (!next.includes(ch)) next.push(ch)
      }
      return next.length ? next : [...wiredChannels]
    })
  }, [wiredChannels])

  useEffect(() => {
    if (!graph || !isolateChannel) {
      setUpstreamFlashIds(new Set())
      return
    }
    const ids = nodesInSoloChannel(graph, isolateChannel)
    setUpstreamFlashIds(ids)
    if (upstreamFlashTimer.current) clearTimeout(upstreamFlashTimer.current)
    upstreamFlashTimer.current = setTimeout(() => setUpstreamFlashIds(new Set()), 900)
    return () => {
      if (upstreamFlashTimer.current) clearTimeout(upstreamFlashTimer.current)
    }
  }, [graph, isolateChannel])

  useEffect(() => {
    if (!graph) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsolateChannel(null)
        setPinnedMinimapChannel(null)
        setFocusedNodeId(null)
        return
      }
      if (e.key === 'Tab' && graph.nodes.length > 0) {
        e.preventDefault()
        const ids = graph.nodes.map((n) => n.id)
        const idx = focusedNodeId ? ids.indexOf(focusedNodeId) : -1
        const nextIdx = e.shiftKey
          ? idx <= 0
            ? ids.length - 1
            : idx - 1
          : (idx + 1) % ids.length
        const nextId = ids[nextIdx]!
        const n = graph.nodes.find((x) => x.id === nextId)
        if (!n) return
        setFocusedNodeId(nextId)
        const z = Math.max(zoom, 0.05)
        setPanOffset({
          x: viewportSize.w / 2 - (n.x + NODE_W / 2) * z,
          y: viewportSize.h / 2 - (n.y + 36) * z,
        })
      }
      if (world.environment.materialBackend === 'tsl' && e.altKey && e.key >= '1' && e.key <= '9') {
        const ch = orderedChannels[parseInt(e.key, 10) - 1]
        if (ch) setIsolateChannel((prev) => (prev === ch ? null : ch))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [graph, orderedChannels, focusedNodeId, viewportSize, panOffset, zoom])

  if (!actor?.mesh || !actor.materialProps) {
    return (
      <div className="panel-empty">
        Select a mesh actor to edit its material graph. Wire Color/Time/math nodes into the Output channels — CPU mode
        animates per-object; GPU mode compiles per-pixel shaders (UV, Fresnel, Noise, Texture Sample) and WPO vertex
        displacement (World/Object Position, Time, Sine, Noise).
      </div>
    )
  }
  if (!graph) return null

  const mode = getMaterialGraphMode(graph, actor.materialGraphMode)

  const mutate = (fn: (g: MaterialGraph) => void) => {
    const next = JSON.parse(JSON.stringify(graph)) as MaterialGraph
    fn(next)
    setGraph(next)
    setDirty(true)
  }

  const setMode = (nextMode: MaterialGraphMode) => {
    mutate((g) => {
      g.mode = nextMode
    })
  }

  const apply = () => {
    const prevGraph = actor.materialGraph
    const prevMode = actor.materialGraphMode
    const next = JSON.parse(JSON.stringify(graph)) as MaterialGraph
    runCommand(
      new PropertyCommand(
        `Material graph ${actor.name}`,
        () => {
          actor.materialGraph = next
          actor.materialGraphMode = next.mode ?? 'cpu'
        },
        () => {
          actor.materialGraph = prevGraph
          actor.materialGraphMode = prevMode
        },
      ),
    )
    setDirty(false)
    useEditor.getState().setStatus(`Material graph applied → ${actor.name} (${next.mode ?? 'cpu'})`)
  }

  const canvasPoint = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    const z = Math.max(zoom, 0.05)
    return {
      x: (e.clientX - rect.left - panOffset.x) / z,
      y: (e.clientY - rect.top - panOffset.y) / z,
    }
  }

  const panToGraph = (gx: number, gy: number) => {
    const z = Math.max(zoom, 0.05)
    setPanOffset({
      x: viewportSize.w / 2 - gx * z,
      y: viewportSize.h / 2 - gy * z,
    })
  }

  const focusGraphNode = (nodeId: string) => {
    const n = graph?.nodes.find((x) => x.id === nodeId)
    if (!n) return
    setFocusedNodeId(nodeId)
    const z = Math.max(zoom, 0.05)
    const target = {
      x: viewportSize.w / 2 - (n.x + NODE_W / 2) * z,
      y: viewportSize.h / 2 - (n.y + 36) * z,
    }
    const start = { ...panOffset }
    const t0 = performance.now()
    const duration = 220
    const tick = (now: number) => {
      const u = Math.min(1, (now - t0) / duration)
      const ease = 1 - (1 - u) ** 3
      setPanOffset({
        x: start.x + (target.x - start.x) * ease,
        y: start.y + (target.y - start.y) * ease,
      })
      if (u < 1) panAnim.current = requestAnimationFrame(tick)
      else panAnim.current = null
    }
    if (panAnim.current) cancelAnimationFrame(panAnim.current)
    panAnim.current = requestAnimationFrame(tick)
  }

  const syncChannelPin = (ch: string) => {
    setIsolateChannel(ch)
    setPinnedMinimapChannel(ch)
  }

  const zoomAtGraph = (factor: number, gx: number, gy: number) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return
    const mx = viewportSize.w / 2
    const my = viewportSize.h / 2
    const nextZoom = Math.max(0.25, Math.min(2.5, zoom * factor))
    setZoom(nextZoom)
    setPanOffset({ x: mx - gx * nextZoom, y: my - gy * nextZoom })
  }

  const reorderLegendChannel = (from: string, to: string) => {
    if (from === to) return
    setChannelOrder((prev) => {
      const base = prev.length ? [...prev] : [...wiredChannels]
      const fi = base.indexOf(from)
      const ti = base.indexOf(to)
      if (fi < 0 || ti < 0) return base
      base.splice(fi, 1)
      base.splice(ti, 0, from)
      return base
    })
  }

  const connectWire = (fromId: string, toNodeId: string, toPort: string) => {
    if (fromId === toNodeId) return
    mutate((g) => {
      g.edges = g.edges.filter((e) => e.to !== `${toNodeId}:${toPort}`)
      g.edges.push({ from: fromId, to: `${toNodeId}:${toPort}` })
      if (world.environment.materialBackend === 'tsl') {
        const ch = previewChannelForPort(g, toNodeId, toPort)
        if (ch) {
          if (flashTimer.current) clearTimeout(flashTimer.current)
          setPreviewFlash(ch)
          flashTimer.current = setTimeout(() => setPreviewFlash(null), 900)
        }
      }
    })
    setPendingFrom(null)
  }

  const onPortDown = (nodeId: string, port: string | null, e: React.MouseEvent) => {
    e.stopPropagation()
    if (port === null) setPendingFrom(nodeId)
  }

  const onPortUp = (nodeId: string, port: string | null, e: React.MouseEvent) => {
    e.stopPropagation()
    if (port !== null && pendingFrom && pendingFrom !== nodeId) {
      connectWire(pendingFrom, nodeId, port)
    }
  }

  return (
    <div className="bp-editor mat-editor-v2">
      <div className="bp-toolbar">
        <span className="script-target">
          ⚛ {actor.name} material {dirty && <em>· unapplied</em>}
        </span>
        <label className="mat-mode-toggle">
          <span>Mode</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as MaterialGraphMode)}>
            <option value="cpu">CPU (fast)</option>
            <option value="gpu">GPU (per-pixel)</option>
          </select>
        </label>
        <button onClick={(e) => setAddMenu(canvasPoint(e as unknown as React.MouseEvent))}>+ Add Node</button>
        <button
          onClick={() => {
            const prev = actor.materialGraph
            const prevMode = actor.materialGraphMode
            runCommand(
              new PropertyCommand(
                'Remove material graph',
                () => {
                  actor.materialGraph = undefined
                  actor.materialGraphMode = undefined
                },
                () => {
                  actor.materialGraph = prev
                  actor.materialGraphMode = prevMode
                },
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
        <span className="mat-zoom-hint" title="Minimap wheel zoom · canvas Ctrl+wheel zoom">
          Minimap wheel · Ctrl+wheel zoom
        </span>
      </div>
      <div className="mat-editor-body">
        <MaterialGraphMinimap
          graph={graph}
          isolateChannel={isolateChannel}
          pinnedChannel={pinnedMinimapChannel}
          panOffset={panOffset}
          zoom={zoom}
          viewportW={viewportSize.w}
          viewportH={viewportSize.h}
          focusedNodeId={focusedNodeId}
          legendDragPreview={legendDragPreview}
          onPanTo={panToGraph}
          onZoomAt={zoomAtGraph}
          onFocusNode={focusGraphNode}
        />
        {orderedChannels.length > 0 && (
          <div className="mat-channel-legend" aria-label="Wired material channels">
            {orderedChannels.map((ch) => (
              <button
                key={ch}
                type="button"
                draggable
                className={`mat-legend-chip${isolateChannel === ch ? ' active' : ''}${pinnedMinimapChannel === ch ? ' pinned' : ''}${legendDragPreview === ch ? ' preview' : ''}`}
                style={{ '--legend-color': CHANNEL_LEGEND_COLORS[ch] ?? '#6eb5ff' } as React.CSSProperties}
                title={`Solo ${ch} (Alt+${orderedChannels.indexOf(ch) + 1}) · Shift+click pin minimap · drag to reorder`}
                onClick={(e) => {
                  if (e.shiftKey) {
                    if (isolateChannel === ch && pinnedMinimapChannel === ch) {
                      setIsolateChannel(null)
                      setPinnedMinimapChannel(null)
                    } else {
                      syncChannelPin(ch)
                    }
                    return
                  }
                  if (isolateChannel === ch && !pinnedMinimapChannel) {
                    setIsolateChannel(null)
                    return
                  }
                  syncChannelPin(ch)
                }}
                onDragStart={() => {
                  legendDrag.current = ch
                  setLegendDragPreview(ch)
                }}
                onDragOver={(e) => {
                  e.preventDefault()
                  if (legendDrag.current) setLegendDragPreview(ch)
                }}
                onDrop={() => {
                  if (legendDrag.current) reorderLegendChannel(legendDrag.current, ch)
                  legendDrag.current = null
                  setLegendDragPreview(null)
                }}
                onDragEnd={() => {
                  legendDrag.current = null
                  setLegendDragPreview(null)
                }}
              >
                <span className="mat-legend-swatch" />
                {ch}
              </button>
            ))}
          </div>
        )}
        <div
          className="bp-canvas mat-canvas-pan"
          ref={canvasRef}
          onWheel={(e) => {
            if (!e.ctrlKey && !e.metaKey) return
            e.preventDefault()
            const rect = canvasRef.current!.getBoundingClientRect()
            const mx = e.clientX - rect.left
            const my = e.clientY - rect.top
            const factor = e.deltaY < 0 ? 1.1 : 0.9
            const nextZoom = Math.max(0.25, Math.min(2.5, zoom * factor))
            const z0 = Math.max(zoom, 0.05)
            const gx = (mx - panOffset.x) / z0
            const gy = (my - panOffset.y) / z0
            setZoom(nextZoom)
            setPanOffset({ x: mx - gx * nextZoom, y: my - gy * nextZoom })
          }}
          onMouseDown={(e) => {
            if (e.target === canvasRef.current) {
              panState.current = { startX: e.clientX, startY: e.clientY, ox: panOffset.x, oy: panOffset.y }
              setAddMenu(null)
              setPendingFrom(null)
            }
          }}
          onMouseMove={(e) => {
            const p = canvasPoint(e)
            setMouse(p)
            if (panState.current) {
              setPanOffset({
                x: panState.current.ox + e.clientX - panState.current.startX,
                y: panState.current.oy + e.clientY - panState.current.startY,
              })
            }
            if (dragState.current) {
              const { nodeId, dx, dy } = dragState.current
              setGraph((g) =>
                g ? { ...g, nodes: g.nodes.map((n) => (n.id === nodeId ? { ...n, x: p.x - dx, y: p.y - dy } : n)) } : g,
              )
              setDirty(true)
            }
          }}
          onMouseUp={(e) => {
            if (pendingFrom) {
              const p = canvasPoint(e)
              const hit = portAt(graph, p.x, p.y)
              if (hit && hit.port != null && hit.nodeId !== pendingFrom) {
                connectWire(pendingFrom, hit.nodeId, hit.port)
              } else {
                setPendingFrom(null)
              }
            }
            dragState.current = null
            panState.current = null
          }}
          onDoubleClick={(e) => {
            if (e.target === canvasRef.current) setAddMenu(canvasPoint(e))
          }}
        >
          <div
            className="mat-canvas-layer"
            style={{
              transform: `translate(${panOffset.x}px, ${panOffset.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
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
              const pinPreview = !!legendDragPreview && tp === legendDragPreview
              return (
                <path
                  key={i}
                  className={`bp-wire mat${pinPreview ? ' mat-wire-pin-preview' : ''}`}
                  d={wirePath(p1.x, p1.y, p2.x, p2.y)}
                  onClick={() =>
                    mutate((g) => {
                      g.edges = g.edges.filter((e2) => !(e2.from === edge.from && e2.to === edge.to))
                    })
                  }
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
              <div
                key={node.id}
                className={`bp-node${upstreamFlashIds.has(node.id) ? ' mat-node-upstream-flash' : ''}`}
                style={{ left: node.x, top: node.y, width: NODE_W }}
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
                  {def.inputs.map((inp, i) => {
                    const wired = graph.edges.some((ed) => ed.to === `${node.id}:${inp}`)
                    return (
                      <div
                        key={inp}
                        className={`bp-port in ${wired ? 'wired' : ''}`}
                        style={{ top: inPortY(i) - HEADER_H - 4 }}
                        onMouseDown={(e) => onPortUp(node.id, inp, e)}
                        onMouseUp={(e) => onPortUp(node.id, inp, e)}
                        title={wired ? `${inp} (wired)` : inp}
                      >
                        ●<em>{inp}</em>
                      </div>
                    )
                  })}
                  {def.hasOutput && (
                    <div
                      className={`bp-port out ${pendingFrom === node.id ? 'pending' : ''}`}
                      style={{ top: 8 }}
                      onMouseDown={(e) => onPortDown(node.id, null, e)}
                    >
                      ●
                    </div>
                  )}
                  {node.type === 'Output' && (
                    <div className="mat-channel-pins">
                      {MAT_NODE_DEFS.Output.inputs
                        .filter((inp) => graph.edges.some((ed) => ed.to === `${node.id}:${inp}`))
                        .map((inp) => (
                          <button
                            key={inp}
                            type="button"
                            className={`mat-pin${isolateChannel === inp ? ' mat-pin-active' : ''}${pinnedMinimapChannel === inp ? ' mat-pin-pinned' : ''}`}
                            title={`Solo + pin minimap ${inp}`}
                            onClick={(e) => {
                              e.stopPropagation()
                              if (isolateChannel === inp && pinnedMinimapChannel === inp) {
                                setIsolateChannel(null)
                                setPinnedMinimapChannel(null)
                              } else {
                                syncChannelPin(inp)
                              }
                            }}
                          >
                            {inp}
                          </button>
                        ))}
                    </div>
                  )}
                  {def.props.map((prop) => (
                    <label
                      className="bp-prop"
                      key={prop.key}
                      style={{ marginTop: def.inputs.length ? def.inputs.length * PORT_GAP - 12 : 0 }}
                    >
                      <span>{prop.label}</span>
                      {prop.kind === 'text' ? (
                        <input
                          type="text"
                          placeholder="data:image/…"
                          value={String(node.props[prop.key] ?? prop.default)}
                          onChange={(e) =>
                            mutate((g) => {
                              const n = g.nodes.find((x) => x.id === node.id)!
                              n.props[prop.key] = e.target.value
                            })
                          }
                        />
                      ) : (
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
                      )}
                    </label>
                  ))}
                </div>
              </div>
            )
          })}

          {addMenu && (
            <div className="bp-add-menu" style={{ left: addMenu.x, top: addMenu.y }}>
              <div>
                <div className="bp-add-cat">Constants</div>
                {['Color', 'Scalar', 'UV', 'TextureSample'].map((type) => {
                  const d = MAT_NODE_DEFS[type]
                  return (
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
                  )
                })}
                <div className="bp-add-cat">Time / Wave</div>
                {['Time', 'Sine', 'Pulse'].map((type) => {
                  const d = MAT_NODE_DEFS[type]
                  return (
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
                  )
                })}
                <div className="bp-add-cat">Math</div>
                {['Multiply', 'Add', 'Lerp'].map((type) => {
                  const d = MAT_NODE_DEFS[type]
                  return (
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
                  )
                })}
                <div className="bp-add-cat">Substrate (Wave 19)</div>
                {['ClearCoat', 'Sheen'].map((type) => {
                  const d = MAT_NODE_DEFS[type]
                  return (
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
                  )
                })}
                <div className="bp-add-cat">Shader (GPU)</div>
                {['Fresnel', 'Noise'].map((type) => {
                  const d = MAT_NODE_DEFS[type]
                  return (
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
                  )
                })}
                <div className="bp-add-cat">WPO (GPU vertex)</div>
                {['WorldPosition', 'ObjectPosition'].map((type) => {
                  const d = MAT_NODE_DEFS[type]
                  return (
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
                  )
                })}
              </div>
            </div>
          )}
          </div>
        </div>
        <aside className="mat-preview-panel">
          <div className="mat-preview-label">
            Preview · {mode === 'gpu' ? 'GPU (WPO displaces vertices)' : 'CPU'}
          </div>
          <MaterialPreview
            graph={graph}
            mode={mode}
            flashChannel={previewFlash}
            isolateChannel={isolateChannel}
          />
        </aside>
      </div>
    </div>
  )
}