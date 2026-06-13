import { useEffect, useMemo, useRef } from 'react'
import { world } from '../../engine/World'
import {
  defaultTangentIn,
  defaultTangentOut,
  ensureBezierTangents,
  keyChannelValue,
  sampleTrack,
  setKeyChannelValue,
  type SeqKey,
  type SeqTangent,
  type SeqTrack,
} from '../../engine/sequencer'
import { runCommand, PropertyCommand } from '../commands'
import { useEditor } from '../store'

const PAD = { l: 36, r: 10, t: 10, b: 22 }
const H = 140

type DragKind = 'key' | 'tangentIn' | 'tangentOut'

interface DragState {
  kind: DragKind
  keyIndex: number
  before: string
  startX: number
  startY: number
  startT: number
  startV: number
  startTan: SeqTangent
}

interface CurveEditorProps {
  track: SeqTrack
  duration: number
  channel?: number
}

export function CurveEditor({ track, duration, channel = 0 }: CurveEditorProps) {
  const touch = useEditor((s) => s.touch)
  const seqTime = useEditor((s) => s.seqTime)
  const svgRef = useRef<SVGSVGElement>(null)
  const drag = useRef<DragState | null>(null)

  const range = useMemo(() => {
    let min = Infinity
    let max = -Infinity
    for (const k of track.keys) {
      const v = keyChannelValue(k.v, channel)
      min = Math.min(min, v)
      max = Math.max(max, v)
      if (k.tangentOut) {
        const dv = k.tangentOut.dv
        const tv = v + (typeof dv === 'number' ? dv : (dv[channel] ?? 0))
        min = Math.min(min, tv)
        max = Math.max(max, tv)
      }
      if (k.tangentIn) {
        const dv = k.tangentIn.dv
        const tv = v + (typeof dv === 'number' ? dv : (dv[channel] ?? 0))
        min = Math.min(min, tv)
        max = Math.max(max, tv)
      }
    }
    if (!Number.isFinite(min)) return { min: 0, max: 1 }
    if (min === max) {
      min -= 0.5
      max += 0.5
    }
    const pad = (max - min) * 0.12 || 0.5
    return { min: min - pad, max: max + pad }
  }, [track.keys, channel])

  const graphW = () => Math.max(80, (svgRef.current?.clientWidth ?? 400) - PAD.l - PAD.r)

  const toX = (t: number, w: number) => PAD.l + (t / duration) * w
  const toY = (v: number, h: number) => PAD.t + (1 - (v - range.min) / (range.max - range.min)) * h

  const tangentChannelDv = (tan: SeqTangent, base: number): number => {
    const dv = tan.dv
    return base + (typeof dv === 'number' ? dv : (dv[channel] ?? 0))
  }

  const setTangentChannelDv = (tan: SeqTangent, keyV: number, newAbs: number, key: SeqKey) => {
    const delta = newAbs - keyV
    if (typeof key.v === 'number') tan.dv = delta
    else {
      const arr = Array.isArray(tan.dv) ? [...tan.dv] : [0, 0, 0]
      arr[channel] = delta
      tan.dv = arr
    }
  }

  const commitDrag = () => {
    const d = drag.current
    if (!d) return
    track.keys.sort((a, b) => a.t - b.t)
    const after = JSON.stringify(world.sequence.tracks)
    runCommand(
      new PropertyCommand(
        'Edit curve',
        () => (world.sequence.tracks = JSON.parse(after)),
        () => (world.sequence.tracks = JSON.parse(d.before)),
      ),
    )
    drag.current = null
    touch()
  }

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = drag.current
      const svg = svgRef.current
      if (!d || !svg) return
      const w = graphW()
      const h = H - PAD.t - PAD.b
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      const key = track.keys[d.keyIndex]
      if (!key) return

      if (d.kind === 'key') {
        const nt = Math.max(0, Math.min(duration, d.startT + (dx / w) * duration))
        const nv = d.startV - (dy / h) * (range.max - range.min)
        const prev = track.keys[d.keyIndex - 1]
        const next = track.keys[d.keyIndex + 1]
        key.t = Math.max(prev ? prev.t + 0.01 : 0, Math.min(next ? next.t - 0.01 : duration, nt))
        key.v = setKeyChannelValue(key.v, channel, nv)
      } else if (d.kind === 'tangentOut') {
        const tan = key.tangentOut!
        tan.dt = d.startTan.dt + (dx / w) * duration
        setTangentChannelDv(tan, keyChannelValue(key.v, channel), d.startV - (dy / h) * (range.max - range.min), key)
      } else {
        const tan = key.tangentIn!
        tan.dt = d.startTan.dt + (dx / w) * duration
        setTangentChannelDv(tan, keyChannelValue(key.v, channel), d.startV - (dy / h) * (range.max - range.min), key)
      }
    }
    const onUp = () => {
      if (drag.current) commitDrag()
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [track, duration, channel, range])

  const curvePath = useMemo(() => {
    if (track.keys.length < 2) return ''
    const w = 360
    const h = H - PAD.t - PAD.b
    const steps = Math.max(32, Math.floor(w / 3))
    const pts: string[] = []
    for (let s = 0; s <= steps; s++) {
      const t = (s / steps) * duration
      const v = sampleTrack(track, t)
      if (v === null) continue
      const y = keyChannelValue(v, channel)
      const x = toX(t, w)
      const py = toY(y, h)
      pts.push(`${s === 0 ? 'M' : 'L'}${x.toFixed(1)},${py.toFixed(1)}`)
    }
    return pts.join(' ')
  }, [track.keys, duration, channel, range])

  const w = svgRef.current?.clientWidth ? graphW() : 360
  const h = H - PAD.t - PAD.b

  const beginDrag = (e: React.MouseEvent, kind: DragKind, keyIndex: number) => {
    e.preventDefault()
    e.stopPropagation()
    const key = track.keys[keyIndex]
    const prev = track.keys[keyIndex - 1]
    const next = track.keys[keyIndex + 1]
    if (kind === 'tangentOut') {
      if (!key.tangentOut) key.tangentOut = next ? defaultTangentOut(key, next) : { dt: 0.3, dv: 0 }
      key.interp = 'bezier'
      ensureBezierTangents(track.keys, keyIndex)
    }
    if (kind === 'tangentIn') {
      if (!key.tangentIn) key.tangentIn = prev ? defaultTangentIn(prev, key) : { dt: -0.3, dv: 0 }
      if (prev) {
        prev.interp = 'bezier'
        ensureBezierTangents(track.keys, keyIndex - 1)
      }
    }
    const tan = kind === 'tangentOut' ? key.tangentOut! : key.tangentIn!
    drag.current = {
      kind,
      keyIndex,
      before: JSON.stringify(world.sequence.tracks),
      startX: e.clientX,
      startY: e.clientY,
      startT: key.t,
      startV: kind === 'key' ? keyChannelValue(key.v, channel) : tangentChannelDv(tan, keyChannelValue(key.v, channel)),
      startTan: { dt: tan.dt, dv: Array.isArray(tan.dv) ? [...tan.dv] : tan.dv },
    }
  }

  const renderKey = (key: SeqKey, i: number) => {
    const kv = keyChannelValue(key.v, channel)
    const cx = toX(key.t, w)
    const cy = toY(kv, h)
    const prev = track.keys[i - 1]
    const next = track.keys[i + 1]
    const showOut = key.interp === 'bezier' && next
    const showIn = prev?.interp === 'bezier'
    const outTan = showOut ? (key.tangentOut ?? defaultTangentOut(key, next)) : null
    const inTan = showIn ? (key.tangentIn ?? defaultTangentIn(prev, key)) : null

    return (
      <g key={i}>
        {showOut && outTan && (
          <>
            <line
              x1={cx}
              y1={cy}
              x2={toX(key.t + outTan.dt, w)}
              y2={toY(tangentChannelDv(outTan, kv), h)}
              className="seq-curve-tangent"
            />
            <circle
              cx={toX(key.t + outTan.dt, w)}
              cy={toY(tangentChannelDv(outTan, kv), h)}
              r={4}
              className="seq-curve-handle"
              onMouseDown={(e) => beginDrag(e, 'tangentOut', i)}
            />
          </>
        )}
        {showIn && inTan && (
          <>
            <line
              x1={cx}
              y1={cy}
              x2={toX(key.t + inTan.dt, w)}
              y2={toY(tangentChannelDv(inTan, kv), h)}
              className="seq-curve-tangent"
            />
            <circle
              cx={toX(key.t + inTan.dt, w)}
              cy={toY(tangentChannelDv(inTan, kv), h)}
              r={4}
              className="seq-curve-handle"
              onMouseDown={(e) => beginDrag(e, 'tangentIn', i)}
            />
          </>
        )}
        <circle
          cx={cx}
          cy={cy}
          r={5}
          className="seq-curve-key"
          onMouseDown={(e) => beginDrag(e, 'key', i)}
        />
      </g>
    )
  }

  return (
    <div className="seq-curve-editor">
      <svg ref={svgRef} className="seq-curve-svg" viewBox={`0 0 ${w + PAD.l + PAD.r} ${H}`} preserveAspectRatio="none">
        <line x1={PAD.l} y1={PAD.t} x2={PAD.l} y2={PAD.t + h} className="seq-curve-axis" />
        <line x1={PAD.l} y1={PAD.t + h} x2={PAD.l + w} y2={PAD.t + h} className="seq-curve-axis" />
        <text x={4} y={PAD.t + 8} className="seq-curve-label">
          {range.max.toFixed(2)}
        </text>
        <text x={4} y={PAD.t + h} className="seq-curve-label">
          {range.min.toFixed(2)}
        </text>
        <text x={PAD.l} y={H - 4} className="seq-curve-label">
          0s
        </text>
        <text x={PAD.l + w - 16} y={H - 4} className="seq-curve-label">
          {duration}s
        </text>
        {curvePath && <path d={curvePath} className="seq-curve-path" fill="none" />}
        {track.keys.map(renderKey)}
        <line
          x1={toX(seqTime, w)}
          y1={PAD.t}
          x2={toX(seqTime, w)}
          y2={PAD.t + h}
          className="seq-curve-playhead"
        />
      </svg>
    </div>
  )
}