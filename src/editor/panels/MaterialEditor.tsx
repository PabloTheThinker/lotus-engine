import { useEffect, useRef, useState } from 'react'
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

/** Live preview sphere — WebGL or WebGPU (TSL) depending on material backend. */
function MaterialPreview({ graph, mode }: { graph: MaterialGraph; mode: MaterialGraphMode }) {
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
        const tslMat = compileMaterialGraphTSL(graph, 0)
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
          const next = compileMaterialGraphTSL(graph, t)
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
  }, [graphSnapshot, mode, tslBackend])

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
        <div className="mat-preview-badge" title="TSL node graph channels">
          TSL nodes · {nodeChannels.join(', ')}
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
  const lastActor = useRef<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ nodeId: string; dx: number; dy: number } | null>(null)

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
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const connectWire = (fromId: string, toNodeId: string, toPort: string) => {
    if (fromId === toNodeId) return
    mutate((g) => {
      g.edges = g.edges.filter((e) => e.to !== `${toNodeId}:${toPort}`)
      g.edges.push({ from: fromId, to: `${toNodeId}:${toPort}` })
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
      </div>
      <div className="mat-editor-body">
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
          }}
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
                          <span key={inp} className="mat-pin">
                            {inp}
                          </span>
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
        <aside className="mat-preview-panel">
          <div className="mat-preview-label">
            Preview · {mode === 'gpu' ? 'GPU (WPO displaces vertices)' : 'CPU'}
          </div>
          <MaterialPreview graph={graph} mode={mode} />
        </aside>
      </div>
    </div>
  )
}