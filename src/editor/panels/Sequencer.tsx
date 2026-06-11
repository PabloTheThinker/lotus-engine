import { useRef } from 'react'
import { world } from '../../engine/World'
import { keyableProperties, sampleSequence, setKey, type SeqKey, type SeqProperty, type SeqTrack } from '../../engine/sequencer'
import { runCommand, PropertyCommand } from '../commands'
import { useEditor } from '../store'

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

  const cycleInterp = (key: SeqKey) => {
    key.interp = key.interp === 'smooth' ? 'step' : key.interp === 'step' ? 'linear' : 'smooth'
    touch()
  }

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

  // group tracks by actor for display
  const byActor = new Map<string, SeqTrack[]>()
  for (const tr of seq.tracks) {
    if (!byActor.has(tr.actorId)) byActor.set(tr.actorId, [])
    byActor.get(tr.actorId)!.push(tr)
  }

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
                <div key={tr.property} className="seq-track-name">
                  {tr.property}
                </div>
              ))}
            </div>
          ))}
          {byActor.size === 0 && <div className="panel-empty">Select an actor, move the playhead, hit ◆ Key.</div>}
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
                <div key={tr.property} className="seq-lane">
                  {tr.keys.map((k, i) => (
                    <span
                      key={i}
                      className="seq-keyframe"
                      style={{ left: pct(k.t) }}
                      title={`${tr.property} @ ${k.t.toFixed(2)}s — click jumps · Shift+click cycles interp (◆ linear ● smooth ■ step) · right-click deletes`}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        deleteKey(tr, i)
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        if (e.shiftKey) {
                          cycleInterp(k)
                          return
                        }
                        setSeqTime(k.t)
                        sampleSequence(world, seq, k.t)
                        touch()
                      }}
                    >
                      {k.interp === 'smooth' ? '●' : k.interp === 'step' ? '■' : '◆'}
                    </span>
                  ))}
                </div>
              ))}
            </div>
          ))}
          <div className="seq-playhead" style={{ left: pct(seqTime) }} />
        </div>
      </div>
    </div>
  )
}
