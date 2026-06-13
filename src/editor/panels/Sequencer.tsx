import { useRef, useState } from 'react'
import { world } from '../../engine/World'
import { getHudElement } from '../../engine/gameplay'
import {
  ensureBezierTangents,
  isHudTrack,
  keyableHudProperties,
  keyableProperties,
  sampleSequence,
  setKey,
  type SeqHudProperty,
  type SeqKey,
  type SeqProperty,
  type SeqTrack,
} from '../../engine/sequencer'
import { runCommand, PropertyCommand } from '../commands'
import { useEditor } from '../store'
import { CurveEditor } from './CurveEditor'

const RULER_STEP = 1 // seconds between ruler marks

/**
 * Sequencer — UE Sequencer / Godot AnimationPlayer v1.
 * Transform tracks with linear keys on a master timeline: key the selected
 * actor at the playhead, scrub, play in-editor, auto-play during PIE.
 */
export function Sequencer() {
  useEditor((s) => s.sceneVersion)
  const selectedId = useEditor((s) => s.selectedId)
  const select = useEditor((s) => s.select)
  const seqTime = useEditor((s) => s.seqTime)
  const setSeqTime = useEditor((s) => s.setSeqTime)
  const seqPlaying = useEditor((s) => s.seqPlaying)
  const setSeqPlaying = useEditor((s) => s.setSeqPlaying)
  const touch = useEditor((s) => s.touch)
  const timelineRef = useRef<HTMLDivElement>(null)
  const scrubbing = useRef(false)
  const [curveTrack, setCurveTrack] = useState<SeqTrack | null>(null)
  const [curveOpen, setCurveOpen] = useState(false)
  const [curveChannel, setCurveChannel] = useState(0)

  const seq = world.sequence
  const pct = (t: number) => `${(t / seq.duration) * 100}%`

  const scrubTo = (clientX: number) => {
    const rect = timelineRef.current!.getBoundingClientRect()
    const t = Math.max(0, Math.min(seq.duration, ((clientX - rect.left) / rect.width) * seq.duration))
    setSeqTime(t)
    sampleSequence(world, seq, t)
    touch()
  }

  const keySelected = () => {
    if (!selectedId) return
    const actor = world.actors.get(selectedId)
    if (!actor) return
    const before = JSON.stringify(seq.tracks)
    const t = actor.transform
    setKey(seq, actor.id, 'position', seqTime, t.position)
    setKey(seq, actor.id, 'rotation', seqTime, t.rotation)
    setKey(seq, actor.id, 'scale', seqTime, t.scale)
    const after = JSON.stringify(seq.tracks)
    runCommand(
      new PropertyCommand(
        `Key ${actor.name} @ ${seqTime.toFixed(2)}s`,
        () => (seq.tracks = JSON.parse(after)),
        () => (seq.tracks = JSON.parse(before)),
      ),
    )
  }

  const currentValueOf = (prop: SeqProperty): SeqKey['v'] | null => {
    const actor = selectedId ? world.actors.get(selectedId) : null
    if (!actor) return null
    switch (prop) {
      case 'visible': return actor.visible
      case 'color': return actor.materialProps?.color ?? `#${actor.light?.color.getHexString() ?? 'ffffff'}`
      case 'opacity': return actor.materialProps?.opacity ?? 1
      case 'emissiveIntensity': return actor.materialProps?.emissiveIntensity ?? 1
      case 'intensity': return actor.light?.intensity ?? 1
      case 'fov': return actor.camera?.fov ?? 60
      default: return null
    }
  }

  const keyProperty = (prop: SeqProperty) => {
    if (!selectedId) return
    const v = currentValueOf(prop)
    if (v === null) return
    const before = JSON.stringify(seq.tracks)
    setKey(seq, selectedId, prop, seqTime, v)
    const after = JSON.stringify(seq.tracks)
    runCommand(
      new PropertyCommand(
        `Key ${prop} @ ${seqTime.toFixed(2)}s`,
        () => (seq.tracks = JSON.parse(after)),
        () => (seq.tracks = JSON.parse(before)),
      ),
    )
  }

  const currentHudValueOf = (widgetId: string, prop: SeqHudProperty): SeqKey['v'] | null => {
    const w = world.hudWidgets.find((x) => x.id === widgetId)
    const el = getHudElement(widgetId)
    switch (prop) {
      case 'opacity':
        if (el?.style.opacity) return parseFloat(el.style.opacity)
        return 1
      case 'left':
        if (el?.style.left) return parseFloat(el.style.left)
        return w?.x ?? 16
      case 'top':
        if (el?.style.top) return parseFloat(el.style.top)
        return w?.y ?? 16
      case 'width':
        if (el?.style.width) return parseFloat(el.style.width)
        return w?.type === 'bar' ? 180 : 0
      case 'color':
        if (el?.style.color) return el.style.color
        return w?.color ?? '#ffffff'
      default:
        return null
    }
  }

  const addHudTrack = (widgetId: string, property: SeqHudProperty) => {
    const existing = seq.tracks.find(
      (tr) => isHudTrack(tr) && tr.actorId === widgetId && tr.property === property,
    )
    if (existing) {
      setCurveTrack(existing)
      setCurveOpen(true)
      return
    }
    const v = currentHudValueOf(widgetId, property)
    if (v === null) return
    const label = world.hudWidgets.find((w) => w.id === widgetId)?.text ?? widgetId
    const before = JSON.stringify(seq.tracks)
    setKey(seq, widgetId, property, seqTime, v, 'hud')
    const after = JSON.stringify(seq.tracks)
    const track = seq.tracks.find((tr) => isHudTrack(tr) && tr.actorId === widgetId && tr.property === property)
    if (track) {
      setCurveTrack(track)
      setCurveOpen(true)
    }
    runCommand(
      new PropertyCommand(
        `HUD track ${label} · ${property}`,
        () => (seq.tracks = JSON.parse(after)),
        () => (seq.tracks = JSON.parse(before)),
      ),
    )
  }

  const keyCurveTrack = () => {
    if (!curveTrack) return
    const v = isHudTrack(curveTrack)
      ? currentHudValueOf(curveTrack.actorId, curveTrack.property as SeqHudProperty)
      : currentValueOf(curveTrack.property as SeqProperty)
    if (v === null) return
    const before = JSON.stringify(seq.tracks)
    setKey(
      seq,
      curveTrack.actorId,
      curveTrack.property,
      seqTime,
      v,
      curveTrack.trackType ?? 'actor',
    )
    const after = JSON.stringify(seq.tracks)
    runCommand(
      new PropertyCommand(
        `Key ${curveTrack.property} @ ${seqTime.toFixed(2)}s`,
        () => (seq.tracks = JSON.parse(after)),
        () => (seq.tracks = JSON.parse(before)),
      ),
    )
  }

  const addCameraCut = () => {
    const actor = selectedId ? world.actors.get(selectedId) : null
    if (!actor?.camera) return
    seq.cameraCuts = seq.cameraCuts ?? []
    seq.cameraCuts.push({ t: seqTime, cameraName: actor.name })
    seq.cameraCuts.sort((a, b) => a.t - b.t)
    touch()
  }

  const addEvent = () => {
    const name = prompt('Signal name to emit?', 'cue')
    if (!name) return
    seq.events = seq.events ?? []
    seq.events.push({ t: seqTime, signal: name })
    seq.events.sort((a, b) => a.t - b.t)
    touch()
  }

  const renderMovie = () => {
    const canvas = document.querySelector<HTMLCanvasElement>('.viewport canvas')
    if (!canvas) return
    const stream = canvas.captureStream(60)
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' })
    const chunks: Blob[] = []
    rec.ondataavailable = (e) => chunks.push(e.data)
    rec.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' })
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `${useEditor.getState().levelName || 'sequence'}.webm`
      a.click()
      URL.revokeObjectURL(a.href)
      useEditor.getState().setStatus(`Rendered ${a.download} (${(blob.size / 1024 / 1024).toFixed(1)} MB)`)
    }
    // play the timeline from 0 and record one full pass
    setSeqTime(0)
    sampleSequence(world, seq, 0)
    setSeqPlaying(true)
    rec.start()
    useEditor.getState().setStatus('Rendering movie…')
    setTimeout(() => {
      rec.stop()
      setSeqPlaying(false)
    }, seq.duration * 1000 + 200)
  }

  const toggleTakeRecord = () => {
    const st = useEditor.getState()
    st.setTakeRecording(!st.takeRecording)
    st.setStatus(st.takeRecording ? 'Take recording armed off' : 'Take armed — Play/Simulate to record the selected actor')
  }
  const recording = useEditor((s) => s.takeRecording)

  const interpIcon = (interp?: SeqKey['interp']) =>
    interp === 'smooth' ? '●' : interp === 'step' ? '■' : interp === 'bezier' ? '⌇' : '◆'

  const cycleInterp = (key: SeqKey, track: SeqTrack, keyIndex: number) => {
    key.interp =
      key.interp === 'smooth' ? 'step' : key.interp === 'step' ? 'linear' : key.interp === 'linear' ? 'bezier' : 'smooth'
    if (key.interp === 'bezier') ensureBezierTangents(track.keys, keyIndex)
    touch()
  }

  const selectTrack = (tr: SeqTrack) => {
    setCurveTrack(tr)
    setCurveOpen(true)
    setCurveChannel(0)
  }

  const isVectorTrack = (tr: SeqTrack) =>
    tr.property === 'position' || tr.property === 'rotation' || tr.property === 'scale'

  const deleteKey = (track: SeqTrack, keyIndex: number) => {
    const before = JSON.stringify(seq.tracks)
    track.keys.splice(keyIndex, 1)
    if (track.keys.length === 0) seq.tracks = seq.tracks.filter((tr) => tr !== track)
    const after = JSON.stringify(seq.tracks)
    runCommand(
      new PropertyCommand(
        'Delete key',
        () => (seq.tracks = JSON.parse(after)),
        () => (seq.tracks = JSON.parse(before)),
      ),
    )
  }

  // group tracks by actor / HUD widget for display
  const byActor = new Map<string, SeqTrack[]>()
  const byWidget = new Map<string, SeqTrack[]>()
  for (const tr of seq.tracks) {
    if (isHudTrack(tr)) {
      if (!byWidget.has(tr.actorId)) byWidget.set(tr.actorId, [])
      byWidget.get(tr.actorId)!.push(tr)
    } else {
      if (!byActor.has(tr.actorId)) byActor.set(tr.actorId, [])
      byActor.get(tr.actorId)!.push(tr)
    }
  }

  const widgetLabel = (widgetId: string) =>
    world.hudWidgets.find((w) => w.id === widgetId)?.text || widgetId

  const ruler: number[] = []
  for (let t = 0; t <= seq.duration; t += RULER_STEP) ruler.push(t)

  return (
    <div className="sequencer">
      <div className="seq-toolbar">
        <button title={seqPlaying ? 'Pause' : 'Play timeline'} onClick={() => setSeqPlaying(!seqPlaying)}>
          {seqPlaying ? '⏸' : '▶'}
        </button>
        <button
          title="Stop — return to 0"
          onClick={() => {
            setSeqPlaying(false)
            setSeqTime(0)
            sampleSequence(world, seq, 0)
            touch()
          }}
        >
          ⏹
        </button>
        <span className="seq-time">{seqTime.toFixed(2)}s</span>
        <label className="field" style={{ width: 130 }}>
          <span>Length</span>
          <input
            type="number"
            min={1}
            step={1}
            value={seq.duration}
            onChange={(e) => {
              seq.duration = Math.max(1, parseFloat(e.target.value) || 10)
              touch()
            }}
          />
        </label>
        <label className="field check" style={{ width: 120 }} title="Play the sequence automatically during PIE">
          <span>Auto Play</span>
          <input
            type="checkbox"
            checked={seq.autoPlay}
            onChange={(e) => {
              seq.autoPlay = e.target.checked
              touch()
            }}
          />
        </label>
        <button className="seq-key" onClick={keySelected} disabled={!selectedId} title="Keyframe the selected actor's transform at the playhead">
          ◆ Key Selected
        </button>
        <select
          className="snap-size"
          value=""
          title="Key a property of the selected actor at the playhead"
          disabled={!selectedId}
          onChange={(e) => {
            if (e.target.value) keyProperty(e.target.value as SeqProperty)
            e.target.value = ''
          }}
        >
          <option value="">+ Property…</option>
          {(selectedId ? keyableProperties(world.actors.get(selectedId) ?? {}) : []).map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <select
          className="snap-size"
          value=""
          title="Add a HUD widget track (lists widgets from World Settings)"
          disabled={world.hudWidgets.length === 0}
          onChange={(e) => {
            const raw = e.target.value
            if (raw) {
              const [widgetId, property] = raw.split(':') as [string, SeqHudProperty]
              addHudTrack(widgetId, property)
            }
            e.target.value = ''
          }}
        >
          <option value="">+ HUD Track…</option>
          {world.hudWidgets.flatMap((w) =>
            keyableHudProperties(w).map((p) => (
              <option key={`${w.id}:${p}`} value={`${w.id}:${p}`}>
                {w.text || w.id} · {p}
              </option>
            )),
          )}
        </select>
        <button
          className="seq-key"
          onClick={keyCurveTrack}
          disabled={!curveTrack}
          title="Keyframe the selected track at the playhead"
        >
          ◆ Key Track
        </button>
        <button onClick={addCameraCut} disabled={!selectedId || !world.actors.get(selectedId ?? '')?.camera} title="Camera Cut: switch the view to the selected Camera at the playhead (PIE)">
          🎬 Cut
        </button>
        <button onClick={addEvent} title="Event key: emit a signal at the playhead (PIE)">
          ⚡ Event
        </button>
        <button onClick={renderMovie} title="Movie Render Queue: play the timeline once and export a .webm video of the viewport">
          🎥 Render
        </button>
        <button
          className={recording ? 'active' : ''}
          onClick={toggleTakeRecord}
          disabled={!selectedId}
          title="Take Recorder: while playing, sample the selected actor's transform into keyframes (toggle, then Play/Simulate)"
        >
          {recording ? '⏺ Recording…' : '⏺ Take'}
        </button>
        <button
          className={curveOpen && curveTrack ? 'active' : ''}
          disabled={!curveTrack || curveTrack.keys.length < 1}
          title="Curve editor for the selected track"
          onClick={() => setCurveOpen((o) => !o)}
        >
          ⌇ Curve
        </button>
      </div>
      <div className="seq-body">
        <div className="seq-names">
          <div className="seq-ruler-spacer" />
          {[...byActor.entries()].map(([actorId, tracks]) => (
            <div key={actorId}>
              <div className="seq-actor-row" onClick={() => select(actorId)}>
                {world.actors.get(actorId)?.name ?? '(deleted)'}
              </div>
              {tracks.map((tr) => (
                <div
                  key={tr.property}
                  className={`seq-track-name ${curveTrack === tr ? 'selected' : ''}`}
                  onClick={() => selectTrack(tr)}
                  title="Click to open curve editor"
                >
                  {tr.property}
                </div>
              ))}
            </div>
          ))}
          {[...byWidget.entries()].map(([widgetId, tracks]) => (
            <div key={`hud-${widgetId}`}>
              <div className="seq-actor-row seq-hud-row" title="HUD widget track">
                🖥 {widgetLabel(widgetId)}
              </div>
              {tracks.map((tr) => (
                <div
                  key={tr.property}
                  className={`seq-track-name ${curveTrack === tr ? 'selected' : ''}`}
                  onClick={() => selectTrack(tr)}
                  title="Click to open curve editor"
                >
                  {tr.property}
                </div>
              ))}
            </div>
          ))}
          {byActor.size === 0 && byWidget.size === 0 && (
            <div className="panel-empty">Select an actor or add a HUD track, move the playhead, hit ◆ Key.</div>
          )}
        </div>
        <div
          className="seq-timeline"
          ref={timelineRef}
          onMouseDown={(e) => {
            scrubbing.current = true
            setSeqPlaying(false)
            scrubTo(e.clientX)
          }}
          onMouseMove={(e) => {
            if (scrubbing.current) scrubTo(e.clientX)
          }}
          onMouseUp={() => (scrubbing.current = false)}
          onMouseLeave={() => (scrubbing.current = false)}
        >
          <div className="seq-ruler">
            {ruler.map((t) => (
              <span key={t} style={{ left: pct(t) }}>
                {t}s
              </span>
            ))}
            {(seq.cameraCuts ?? []).map((c, i) => (
              <span
                key={`cut${i}`}
                className="seq-cut"
                style={{ left: pct(c.t) }}
                title={`Camera Cut → ${c.cameraName} (right-click removes)`}
                onContextMenu={(e) => {
                  e.preventDefault()
                  seq.cameraCuts!.splice(i, 1)
                  touch()
                }}
              >
                🎬
              </span>
            ))}
            {(seq.events ?? []).map((ev, i) => (
              <span
                key={`ev${i}`}
                className="seq-event"
                style={{ left: pct(ev.t) }}
                title={`Event: ${ev.signal} (right-click removes)`}
                onContextMenu={(e) => {
                  e.preventDefault()
                  seq.events!.splice(i, 1)
                  touch()
                }}
              >
                ⚡
              </span>
            ))}
          </div>
          {[...byActor.entries()].map(([actorId, tracks]) => (
            <div key={actorId}>
              <div className="seq-actor-lane" />
              {tracks.map((tr) => (
                <div
                  key={tr.property}
                  className={`seq-lane ${curveTrack === tr ? 'selected' : ''}`}
                  onClick={() => selectTrack(tr)}
                >
                  {tr.keys.map((k, i) => (
                    <span
                      key={i}
                      className="seq-keyframe"
                      style={{ left: pct(k.t) }}
                      title={`${tr.property} @ ${k.t.toFixed(2)}s — click jumps · Shift+click cycles interp (◆ linear ● smooth ■ step ⌇ bezier) · right-click deletes`}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        deleteKey(tr, i)
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        selectTrack(tr)
                        if (e.shiftKey) {
                          cycleInterp(k, tr, i)
                          return
                        }
                        setSeqTime(k.t)
                        sampleSequence(world, seq, k.t)
                        touch()
                      }}
                    >
                      {interpIcon(k.interp)}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          ))}
          {[...byWidget.entries()].map(([widgetId, tracks]) => (
            <div key={`hud-lane-${widgetId}`}>
              <div className="seq-actor-lane seq-hud-lane" />
              {tracks.map((tr) => (
                <div
                  key={tr.property}
                  className={`seq-lane ${curveTrack === tr ? 'selected' : ''}`}
                  onClick={() => selectTrack(tr)}
                >
                  {tr.keys.map((k, i) => (
                    <span
                      key={i}
                      className="seq-keyframe"
                      style={{ left: pct(k.t) }}
                      title={`${tr.property} @ ${k.t.toFixed(2)}s — click jumps · Shift+click cycles interp · right-click deletes`}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        deleteKey(tr, i)
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        selectTrack(tr)
                        if (e.shiftKey) {
                          cycleInterp(k, tr, i)
                          return
                        }
                        setSeqTime(k.t)
                        sampleSequence(world, seq, k.t)
                        touch()
                      }}
                    >
                      {interpIcon(k.interp)}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          ))}
          <div className="seq-playhead" style={{ left: pct(seqTime) }} />
        </div>
      </div>
      {curveOpen && curveTrack && curveTrack.keys.length > 0 && (
        <div className="seq-curve-panel">
          <div className="seq-curve-header">
            <span>
              {isHudTrack(curveTrack)
                ? `🖥 ${widgetLabel(curveTrack.actorId)}`
                : (world.actors.get(curveTrack.actorId)?.name ?? '(deleted)')}{' '}
              · {curveTrack.property}
            </span>
            {isVectorTrack(curveTrack) && (
              <label className="seq-curve-channel">
                Channel
                <select
                  value={curveChannel}
                  onChange={(e) => setCurveChannel(parseInt(e.target.value, 10))}
                >
                  <option value={0}>X</option>
                  <option value={1}>Y</option>
                  <option value={2}>Z</option>
                </select>
              </label>
            )}
          </div>
          <CurveEditor track={curveTrack} duration={seq.duration} channel={curveChannel} />
        </div>
      )}
    </div>
  )
}
