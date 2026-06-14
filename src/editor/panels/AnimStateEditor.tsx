import { useEffect, useRef, useState } from 'react'
import { world } from '../../engine/World'
import {
  delaunayTriangulate,
  emptyAnimStateMachine,
  emptyBlendSpace1D,
  emptyBlendSpace2D,
  type AnimStateMachine,
  type AnimTransition,
  type BlendSpace1D,
  type BlendSpace2D,
} from '../../engine/animStateMachine'
import { keyableScriptExports } from '../../engine/sequencer'
import { PropertyCommand, runCommand } from '../commands'
import { useEditor } from '../store'

const NODE_W = 160
const NODE_H = 72

function edgePath(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(50, Math.abs(x2 - x1) * 0.45)
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

type EditorMode = 'fsm' | 'blend' | 'blend2d'

const BLEND2D_PAD = 48

/**
 * Animation state machine + 1D/2D blend space editor.
 * FSM: draggable state nodes with transition arrows.
 * Blend 1D: horizontal axis with clip samples lerped by a param at runtime.
 * Blend 2D: UE-style canvas with draggable samples and Delaunay triangulation.
 */
export function AnimStateEditor() {
  const selectedId = useEditor((s) => s.selectedId)
  useEditor((s) => s.sceneVersion)
  const actor = selectedId ? world.actors.get(selectedId) : null
  const clips = (actor?.animations ?? []).map((c) => c.name)

  const [mode, setMode] = useState<EditorMode>('fsm')
  const [sm, setSm] = useState<AnimStateMachine | null>(null)
  const [blend, setBlend] = useState<BlendSpace1D | null>(null)
  const [blend2d, setBlend2d] = useState<BlendSpace2D | null>(null)
  const [dirty, setDirty] = useState(false)
  const [pendingFrom, setPendingFrom] = useState<string | null>(null)
  const [selState, setSelState] = useState<string | null>(null)
  const [selTrans, setSelTrans] = useState<number | null>(null)
  const [mouse, setMouse] = useState({ x: 0, y: 0 })
  const lastActor = useRef<string | null>(null)
  const canvasRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const blendDrag = useRef<{ idx: number; startX: number; startVal: number; axisW: number; min: number; max: number } | null>(null)
  const blend2dDrag = useRef<{
    idx: number
    pad: number
    plotW: number
    plotH: number
    minX: number
    maxX: number
    minY: number
    maxY: number
  } | null>(null)

  useEffect(() => {
    if (actor && actor.id !== lastActor.current) {
      lastActor.current = actor.id
      const defaultClip = clips[0] ?? ''
      setSm(
        actor.animStateMachine
          ? (JSON.parse(JSON.stringify(actor.animStateMachine)) as AnimStateMachine)
          : emptyAnimStateMachine(defaultClip),
      )
      setBlend(
        actor.blendSpace1D
          ? (JSON.parse(JSON.stringify(actor.blendSpace1D)) as BlendSpace1D)
          : emptyBlendSpace1D('speed'),
      )
      setBlend2d(
        actor.blendSpace2D
          ? (JSON.parse(JSON.stringify(actor.blendSpace2D)) as BlendSpace2D)
          : emptyBlendSpace2D('speed', 'direction'),
      )
      setDirty(false)
      setPendingFrom(null)
      setSelState(null)
      setSelTrans(null)
    }
    if (!actor) lastActor.current = null
  }, [actor, clips.join('|')])

  if (!actor || !sm || !blend || !blend2d) {
    return (
      <div className="panel-empty">
        Select an imported mesh with glTF animation clips to edit its animation state machine or blend space.
      </div>
    )
  }
  if (clips.length === 0) {
    return <div className="panel-empty">This actor has no animation clips. Import a glTF with animations first.</div>
  }

  const mutateSm = (fn: (g: AnimStateMachine) => void) => {
    const next = JSON.parse(JSON.stringify(sm)) as AnimStateMachine
    fn(next)
    setSm(next)
    setDirty(true)
  }

  const mutateBlend = (fn: (b: BlendSpace1D) => void) => {
    const next = JSON.parse(JSON.stringify(blend)) as BlendSpace1D
    fn(next)
    setBlend(next)
    setDirty(true)
  }

  const mutateBlend2d = (fn: (b: BlendSpace2D) => void) => {
    const next = JSON.parse(JSON.stringify(blend2d)) as BlendSpace2D
    fn(next)
    setBlend2d(next)
    setDirty(true)
  }

  const apply = () => {
    const prevSm = actor.animStateMachine
    const prevBlend = actor.blendSpace1D
    const prevBlend2d = actor.blendSpace2D
    const nextSm = JSON.parse(JSON.stringify(sm)) as AnimStateMachine
    const nextBlend = JSON.parse(JSON.stringify(blend)) as BlendSpace1D
    const nextBlend2d = JSON.parse(JSON.stringify(blend2d)) as BlendSpace2D
    runCommand(
      new PropertyCommand(
        `Animation ${actor.name}`,
        () => {
          actor.animStateMachine = nextSm.states.some((s) => s.clipName) ? nextSm : undefined
          actor.blendSpace1D = nextBlend.samples.length ? nextBlend : undefined
          actor.blendSpace2D = nextBlend2d.samples.length ? nextBlend2d : undefined
        },
        () => {
          actor.animStateMachine = prevSm
          actor.blendSpace1D = prevBlend
          actor.blendSpace2D = prevBlend2d
        },
      ),
    )
    setDirty(false)
    useEditor.getState().setStatus(`Animation applied → ${actor.name}`)
  }

  const canvasPoint = (e: React.MouseEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const addState = () => {
    const n = sm.states.length + 1
    const name = `State${n}`
    mutateSm((g) => {
      g.states.push({
        name,
        clipName: clips[0] ?? '',
        loop: true,
        x: 60 + (n % 4) * 180,
        y: 40 + Math.floor(n / 4) * 100,
      })
      if (!g.initialState) g.initialState = name
    })
    setSelState(name)
  }

  const removeState = (name: string) => {
    mutateSm((g) => {
      g.states = g.states.filter((s) => s.name !== name)
      g.transitions = g.transitions.filter((t) => t.from !== name && t.to !== name)
      if (g.initialState === name) g.initialState = g.states[0]?.name ?? ''
    })
    if (selState === name) setSelState(null)
  }

  const onNodePort = (name: string) => {
    if (!pendingFrom) {
      setPendingFrom(name)
      return
    }
    if (pendingFrom !== name) {
      mutateSm((g) => {
        g.transitions.push({
          from: pendingFrom,
          to: name,
          condition: 'param_gt',
          param: 'speed',
          threshold: 0.5,
          crossfade: 0.25,
        })
      })
    }
    setPendingFrom(null)
  }

  const blendMin = blend.samples.length ? Math.min(...blend.samples.map((s) => s.value), 0) : 0
  const blendMax = blend.samples.length ? Math.max(...blend.samples.map((s) => s.value), 1) : 1
  const blendLinkExports = keyableScriptExports(actor).filter(
    (ev) =>
      ev.kind === 'range' ||
      (ev.kind === 'plain' && (typeof ev.value === 'number' || typeof ev.value === 'boolean')),
  )

  const setBlend2dLink = (axis: 'X' | 'Y', next?: string) => {
    const field = axis === 'X' ? 'blendScriptVarLinkX' : 'blendScriptVarLinkY'
    const prev = actor[field]
    runCommand(
      new PropertyCommand(
        `Blend 2D @export link ${axis} → ${actor.name}`,
        () => {
          actor[field] = next
        },
        () => {
          actor[field] = prev
        },
      ),
    )
    useEditor.getState().touch()
  }
  const blendSpan = Math.max(0.001, blendMax - blendMin)

  const valueToX = (v: number, w: number) => 40 + ((v - blendMin) / blendSpan) * (w - 80)

  const blend2dMinX = blend2d.samples.length ? Math.min(...blend2d.samples.map((s) => s.x), 0) : 0
  const blend2dMaxX = blend2d.samples.length ? Math.max(...blend2d.samples.map((s) => s.x), 1) : 1
  const blend2dMinY = blend2d.samples.length ? Math.min(...blend2d.samples.map((s) => s.y), 0) : 0
  const blend2dMaxY = blend2d.samples.length ? Math.max(...blend2d.samples.map((s) => s.y), 1) : 1
  const blend2dSpanX = Math.max(0.001, blend2dMaxX - blend2dMinX)
  const blend2dSpanY = Math.max(0.001, blend2dMaxY - blend2dMinY)

  const paramToCanvas = (px: number, py: number, plotW: number, plotH: number) => ({
    x: BLEND2D_PAD + ((px - blend2dMinX) / blend2dSpanX) * plotW,
    y: BLEND2D_PAD + plotH - ((py - blend2dMinY) / blend2dSpanY) * plotH,
  })

  const canvasToParam = (cx: number, cy: number, plotW: number, plotH: number) => ({
    x: blend2dMinX + ((cx - BLEND2D_PAD) / plotW) * blend2dSpanX,
    y: blend2dMinY + ((BLEND2D_PAD + plotH - cy) / plotH) * blend2dSpanY,
  })

  return (
    <div className="bp-editor anim-editor">
      <div className="bp-toolbar">
        <span className="script-target">
          🎬 {actor.name} {dirty && <em>· unapplied</em>}
        </span>
        <button className={mode === 'fsm' ? 'active' : ''} onClick={() => setMode('fsm')}>
          FSM
        </button>
        <button className={mode === 'blend' ? 'active' : ''} onClick={() => setMode('blend')}>
          Blend 1D
        </button>
        <button className={mode === 'blend2d' ? 'active' : ''} onClick={() => setMode('blend2d')}>
          Blend 2D
        </button>
        {mode === 'fsm' && <button onClick={addState}>+ State</button>}
        {mode === 'blend' && (
          <button
            onClick={() => {
              const v = blend.samples.length ? blendMax + 0.25 : 0
              mutateBlend((b) => b.samples.push({ value: v, clipName: clips[0] ?? '' }))
            }}
          >
            + Sample
          </button>
        )}
        {mode === 'blend2d' && (
          <button
            onClick={() => {
              const cx = (blend2dMinX + blend2dMaxX) / 2
              const cy = (blend2dMinY + blend2dMaxY) / 2
              mutateBlend2d((b) => b.samples.push({ x: cx, y: cy, clipName: clips[0] ?? '' }))
            }}
          >
            + Sample
          </button>
        )}
        <button className="apply" disabled={!dirty} onClick={apply}>
          Apply
        </button>
      </div>

      {mode === 'blend2d' ? (
        <div
          className="bp-canvas anim-blend2d-canvas"
          ref={canvasRef}
          onMouseMove={(e) => {
            if (!blend2dDrag.current || !canvasRef.current) return
            const rect = canvasRef.current.getBoundingClientRect()
            const cx = e.clientX - rect.left
            const cy = e.clientY - rect.top
            const { idx, plotW, plotH } = blend2dDrag.current
            const p = canvasToParam(cx, cy, plotW, plotH)
            mutateBlend2d((b) => {
              if (b.samples[idx]) {
                b.samples[idx].x = p.x
                b.samples[idx].y = p.y
              }
            })
          }}
          onMouseUp={() => {
            blend2dDrag.current = null
          }}
          onMouseLeave={() => {
            blend2dDrag.current = null
          }}
        >
          <div className="anim-blend-panel anim-blend2d-panel">
            <label className="field">
              <span>Param X</span>
              <input
                value={blend2d.paramX}
                onChange={(e) => mutateBlend2d((b) => (b.paramX = e.target.value))}
              />
            </label>
            <label className="field">
              <span>Param Y</span>
              <input
                value={blend2d.paramY}
                onChange={(e) => mutateBlend2d((b) => (b.paramY = e.target.value))}
              />
            </label>
            <label className="field">
              <span>@export link X</span>
              <select
                value={actor.blendScriptVarLinkX ?? ''}
                onChange={(e) => setBlend2dLink('X', e.target.value || undefined)}
                title="Drive paramX from an @export script var at runtime"
              >
                <option value="">(animParams.{blend2d.paramX})</option>
                {blendLinkExports.map((ev) => (
                  <option key={ev.name} value={ev.name}>
                    {ev.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>@export link Y</span>
              <select
                value={actor.blendScriptVarLinkY ?? ''}
                onChange={(e) => setBlend2dLink('Y', e.target.value || undefined)}
                title="Drive paramY from an @export script var at runtime"
              >
                <option value="">(animParams.{blend2d.paramY})</option>
                {blendLinkExports.map((ev) => (
                  <option key={ev.name} value={ev.name}>
                    {ev.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="panel-empty">
              Runtime:{' '}
              {actor.blendScriptVarLinkX || actor.blendScriptVarLinkY
                ? [
                    actor.blendScriptVarLinkX
                      ? `scriptVars.${actor.blendScriptVarLinkX} → "${blend2d.paramX}"`
                      : `animParams.${blend2d.paramX}`,
                    actor.blendScriptVarLinkY
                      ? `scriptVars.${actor.blendScriptVarLinkY} → "${blend2d.paramY}"`
                      : `animParams.${blend2d.paramY}`,
                  ].join(' × ')
                : `animParams.${blend2d.paramX} × animParams.${blend2d.paramY} drive barycentric blend.`}
            </div>
          </div>
          <div className="anim-blend2d-plot-wrap">
            {(() => {
              const w = canvasRef.current?.clientWidth ?? 640
              const h = Math.max(220, canvasRef.current?.clientHeight ?? 280) - 100
              const plotW = w - BLEND2D_PAD * 2
              const plotH = h - BLEND2D_PAD
              const points = blend2d.samples.map((s) => ({ x: s.x, y: s.y }))
              const tris = delaunayTriangulate(points)
              return (
                <div className="anim-blend2d-plot" style={{ width: w, height: h }}>
                  <svg className="anim-blend2d-grid" width={w} height={h}>
                    <rect
                      x={BLEND2D_PAD}
                      y={BLEND2D_PAD}
                      width={plotW}
                      height={plotH}
                      className="anim-blend2d-bounds"
                    />
                    {tris.map((tri, ti) => {
                      const [i0, i1, i2] = tri
                      const p0 = paramToCanvas(blend2d.samples[i0].x, blend2d.samples[i0].y, plotW, plotH)
                      const p1 = paramToCanvas(blend2d.samples[i1].x, blend2d.samples[i1].y, plotW, plotH)
                      const p2 = paramToCanvas(blend2d.samples[i2].x, blend2d.samples[i2].y, plotW, plotH)
                      return (
                        <polygon
                          key={ti}
                          points={`${p0.x},${p0.y} ${p1.x},${p1.y} ${p2.x},${p2.y}`}
                          className="anim-blend2d-tri"
                        />
                      )
                    })}
                    <text x={BLEND2D_PAD} y={h - 8} className="anim-blend2d-axis-label">
                      {blend2dMinX.toFixed(1)}
                    </text>
                    <text x={BLEND2D_PAD + plotW} y={h - 8} className="anim-blend2d-axis-label" textAnchor="end">
                      {blend2dMaxX.toFixed(1)} ({blend2d.paramX})
                    </text>
                    <text x={8} y={BLEND2D_PAD + 4} className="anim-blend2d-axis-label">
                      {blend2dMaxY.toFixed(1)}
                    </text>
                    <text x={8} y={BLEND2D_PAD + plotH} className="anim-blend2d-axis-label">
                      {blend2dMinY.toFixed(1)} ({blend2d.paramY})
                    </text>
                  </svg>
                  {blend2d.samples.map((s, i) => {
                    const c = paramToCanvas(s.x, s.y, plotW, plotH)
                    return (
                      <div
                        key={i}
                        className="anim-blend2d-sample"
                        style={{ left: c.x - 52, top: c.y - 8 }}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          blend2dDrag.current = {
                            idx: i,
                            pad: BLEND2D_PAD,
                            plotW,
                            plotH,
                            minX: blend2dMinX - 1,
                            maxX: blend2dMaxX + 1,
                            minY: blend2dMinY - 1,
                            maxY: blend2dMaxY + 1,
                          }
                        }}
                      >
                        <div className="anim-blend-handle" title={`(${s.x.toFixed(2)}, ${s.y.toFixed(2)})`} />
                        <select
                          value={s.clipName}
                          onChange={(e) =>
                            mutateBlend2d((b) => {
                              if (b.samples[i]) b.samples[i].clipName = e.target.value
                            })
                          }
                        >
                          {clips.map((cname) => (
                            <option key={cname} value={cname}>
                              {cname}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => mutateBlend2d((b) => b.samples.splice(i, 1))}
                          title="Remove sample"
                        >
                          ✕
                        </button>
                      </div>
                    )
                  })}
                  <div className="panel-empty anim-blend2d-hint">
                    Drag samples on the 2D canvas. Delaunay triangles show runtime barycentric blend regions.
                  </div>
                </div>
              )
            })()}
          </div>
        </div>
      ) : mode === 'fsm' ? (
        <div
          className="bp-canvas"
          ref={canvasRef}
          onMouseMove={(e) => {
            const p = canvasPoint(e)
            setMouse(p)
            if (dragState.current) {
              const { id, dx, dy } = dragState.current
              mutateSm((g) => {
                const node = g.states.find((s) => s.name === id)
                if (node) {
                  node.x = p.x - dx
                  node.y = p.y - dy
                }
              })
            }
          }}
          onMouseUp={() => {
            dragState.current = null
          }}
          onMouseLeave={() => {
            dragState.current = null
          }}
        >
          <svg className="bp-wires">
            {sm.transitions.map((t, i) => {
              const from = sm.states.find((s) => s.name === t.from)
              const to = sm.states.find((s) => s.name === t.to)
              if (!from || !to) return null
              const x1 = from.x + NODE_W
              const y1 = from.y + NODE_H / 2
              const x2 = to.x
              const y2 = to.y + NODE_H / 2
              return (
                <path
                  key={i}
                  d={edgePath(x1, y1, x2, y2)}
                  className={`bp-wire ${selTrans === i ? 'selected' : ''}`}
                  onClick={() => setSelTrans(i)}
                />
              )
            })}
            {pendingFrom && (
              (() => {
                const from = sm.states.find((s) => s.name === pendingFrom)
                if (!from) return null
                const x1 = from.x + NODE_W
                const y1 = from.y + NODE_H / 2
                return (
                  <path
                    d={edgePath(x1, y1, mouse.x, mouse.y)}
                    className="bp-wire pending"
                  />
                )
              })()
            )}
          </svg>

          {sm.states.map((st) => (
            <div
              key={st.name}
              className={`bp-node anim-node ${selState === st.name ? 'selected' : ''} ${sm.initialState === st.name ? 'initial' : ''}`}
              style={{ left: st.x, top: st.y, width: NODE_W }}
              onMouseDown={(e) => {
                if ((e.target as HTMLElement).closest('button, select, input')) return
                const p = canvasPoint(e)
                dragState.current = { id: st.name, dx: p.x - st.x, dy: p.y - st.y }
                setSelState(st.name)
                setSelTrans(null)
              }}
            >
              <div className="bp-node-header" style={{ background: '#2a4a7a' }}>
                <span>{st.name}</span>
                <button type="button" onClick={() => removeState(st.name)} title="Remove state">
                  ✕
                </button>
              </div>
              <div className="bp-node-body anim-node-body">
                <label className="field compact">
                  <span>Clip</span>
                  <select
                    value={st.clipName}
                    onChange={(e) =>
                      mutateSm((g) => {
                        const n = g.states.find((s) => s.name === st.name)
                        if (n) n.clipName = e.target.value
                      })
                    }
                  >
                    {clips.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field compact">
                  <input
                    type="checkbox"
                    checked={st.loop}
                    onChange={(e) =>
                      mutateSm((g) => {
                        const n = g.states.find((s) => s.name === st.name)
                        if (n) n.loop = e.target.checked
                      })
                    }
                  />
                  <span>Loop</span>
                </label>
                <button
                  type="button"
                  className={`bp-port out anim-port ${pendingFrom === st.name ? 'pending' : ''}`}
                  onClick={() => onNodePort(st.name)}
                  title="Click to start/finish a transition"
                >
                  →
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div
          className="bp-canvas anim-blend-canvas"
          ref={canvasRef}
          onMouseMove={(e) => {
            if (!blendDrag.current || !canvasRef.current) return
            const rect = canvasRef.current.getBoundingClientRect()
            const x = e.clientX - rect.left
            const { idx, axisW, min, max } = blendDrag.current
            const span = Math.max(0.001, max - min)
            const v = min + ((x - 40) / (axisW - 80)) * span
            mutateBlend((b) => {
              if (b.samples[idx]) b.samples[idx].value = Math.max(min, Math.min(max, v))
            })
          }}
          onMouseUp={() => {
            blendDrag.current = null
          }}
        >
          <div className="anim-blend-panel">
            <label className="field">
              <span>Param</span>
              <input
                value={blend.param}
                onChange={(e) => mutateBlend((b) => (b.param = e.target.value))}
              />
            </label>
            <label className="field">
              <span>@export link</span>
              <select
                value={actor.blendScriptVarLink ?? ''}
                onChange={(e) => {
                  const prev = actor.blendScriptVarLink
                  const next = e.target.value || undefined
                  runCommand(
                    new PropertyCommand(
                      `Blend @export link → ${actor.name}`,
                      () => {
                        actor.blendScriptVarLink = next
                      },
                      () => {
                        actor.blendScriptVarLink = prev
                      },
                    ),
                  )
                  useEditor.getState().touch()
                }}
                title="Drive this blend param from an @export script var at runtime"
              >
                <option value="">(animParams.{blend.param})</option>
                {blendLinkExports.map((ev) => (
                  <option key={ev.name} value={ev.name}>
                    {ev.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="panel-empty">
              Runtime:{' '}
              {actor.blendScriptVarLink
                ? `scriptVars.${actor.blendScriptVarLink} → blend param "${blend.param}"`
                : `animParams.${blend.param} drives blend weight during Play.`}
            </div>
          </div>
          <div className="anim-blend-axis-wrap">
            {(() => {
              const w = canvasRef.current?.clientWidth ?? 600
              return (
                <>
                  <div className="anim-blend-axis" style={{ width: w - 40 }}>
                    <div className="anim-blend-line" />
                    {[blendMin, blendMax].map((v) => (
                      <span key={v} className="anim-blend-tick" style={{ left: valueToX(v, w) - 40 }}>
                        {v.toFixed(2)}
                      </span>
                    ))}
                    {blend.samples.map((s, i) => (
                      <div
                        key={i}
                        className="anim-blend-sample"
                        style={{ left: valueToX(s.value, w) - 52 }}
                        onMouseDown={(e) => {
                          e.preventDefault()
                          blendDrag.current = {
                            idx: i,
                            startX: e.clientX,
                            startVal: s.value,
                            axisW: w,
                            min: blendMin - 1,
                            max: blendMax + 1,
                          }
                        }}
                      >
                        <div className="anim-blend-handle" />
                        <select
                          value={s.clipName}
                          onChange={(e) =>
                            mutateBlend((b) => {
                              if (b.samples[i]) b.samples[i].clipName = e.target.value
                            })
                          }
                        >
                          {clips.map((c) => (
                            <option key={c} value={c}>
                              {c}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => mutateBlend((b) => b.samples.splice(i, 1))}
                          title="Remove sample"
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                  </div>
                  <div className="panel-empty">
                    Drag samples along the axis. Adjacent clips blend by lerping weights (UE BlendSpace1D lite).
                  </div>
                </>
              )
            })()}
          </div>
        </div>
      )}

      <div className="anim-inspector">
        {mode === 'fsm' && selState && (
          <FsmStateInspector
            sm={sm}
            stateName={selState}
            clips={clips}
            onChange={mutateSm}
            onSetInitial={(name) => mutateSm((g) => (g.initialState = name))}
          />
        )}
        {mode === 'fsm' && selTrans !== null && sm.transitions[selTrans] && (
          <FsmTransInspector
            trans={sm.transitions[selTrans]}
            index={selTrans}
            onChange={mutateSm}
            onRemove={() => {
              mutateSm((g) => g.transitions.splice(selTrans, 1))
              setSelTrans(null)
            }}
          />
        )}
      </div>
    </div>
  )
}

function FsmStateInspector({
  sm,
  stateName,
  clips,
  onChange,
  onSetInitial,
}: {
  sm: AnimStateMachine
  stateName: string
  clips: string[]
  onChange: (fn: (g: AnimStateMachine) => void) => void
  onSetInitial: (name: string) => void
}) {
  const st = sm.states.find((s) => s.name === stateName)
  if (!st) return null
  return (
    <div className="anim-inspector-block">
      <strong>State: {st.name}</strong>
      <label className="field">
        <span>Name</span>
        <input
          value={st.name}
          onChange={(e) => {
            const next = e.target.value.trim()
            if (!next || sm.states.some((s) => s.name === next && s.name !== stateName)) return
            onChange((g) => {
              const n = g.states.find((s) => s.name === stateName)
              if (!n) return
              const old = n.name
              n.name = next
              if (g.initialState === old) g.initialState = next
              for (const t of g.transitions) {
                if (t.from === old) t.from = next
                if (t.to === old) t.to = next
              }
            })
          }}
        />
      </label>
      <label className="field">
        <span>Clip</span>
        <select value={st.clipName} onChange={(e) => onChange((g) => { const n = g.states.find((s) => s.name === st.name); if (n) n.clipName = e.target.value })}>
          {clips.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </label>
      <label className="field">
        <input type="checkbox" checked={st.loop} onChange={(e) => onChange((g) => { const n = g.states.find((s) => s.name === st.name); if (n) n.loop = e.target.checked })} />
        <span>Loop</span>
      </label>
      {sm.initialState !== st.name && (
        <button type="button" onClick={() => onSetInitial(st.name)}>Set as initial state</button>
      )}
    </div>
  )
}

function FsmTransInspector({
  trans,
  index,
  onChange,
  onRemove,
}: {
  trans: AnimTransition
  index: number
  onChange: (fn: (g: AnimStateMachine) => void) => void
  onRemove: () => void
}) {
  return (
    <div className="anim-inspector-block">
      <strong>
        Transition: {trans.from} → {trans.to}
      </strong>
      <label className="field">
        <span>Condition</span>
        <select
          value={trans.condition}
          onChange={(e) =>
            onChange((g) => {
              const t = g.transitions[index]
              if (t) t.condition = e.target.value as AnimTransition['condition']
            })
          }
        >
          <option value="auto">auto (on clip end)</option>
          <option value="param_gt">param &gt;</option>
          <option value="param_lt">param &lt;</option>
        </select>
      </label>
      {trans.condition !== 'auto' && (
        <>
          <label className="field">
            <span>Param</span>
            <input
              value={trans.param ?? ''}
              onChange={(e) =>
                onChange((g) => {
                  const t = g.transitions[index]
                  if (t) t.param = e.target.value
                })
              }
            />
          </label>
          <label className="field">
            <span>Threshold</span>
            <input
              type="number"
              step={0.05}
              value={trans.threshold ?? 0}
              onChange={(e) =>
                onChange((g) => {
                  const t = g.transitions[index]
                  if (t) t.threshold = parseFloat(e.target.value) || 0
                })
              }
            />
          </label>
        </>
      )}
      <label className="field">
        <span>Crossfade</span>
        <input
          type="number"
          step={0.05}
          min={0}
          value={trans.crossfade}
          onChange={(e) =>
            onChange((g) => {
              const t = g.transitions[index]
              if (t) t.crossfade = Math.max(0, parseFloat(e.target.value) || 0)
            })
          }
        />
      </label>
      <button type="button" onClick={onRemove}>Remove transition</button>
    </div>
  )
}