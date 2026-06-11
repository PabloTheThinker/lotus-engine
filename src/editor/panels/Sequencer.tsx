import { useRef } from 'react'
import { world } from '../../engine/World'
import { sampleSequence, setKey, type SeqTrack } from '../../engine/sequencer'
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
                      title={`${tr.property} @ ${k.t.toFixed(2)}s — right-click deletes`}
                      onContextMenu={(e) => {
                        e.preventDefault()
                        deleteKey(tr, i)
                      }}
                      onClick={(e) => {
                        e.stopPropagation()
                        setSeqTime(k.t)
                        sampleSequence(world, seq, k.t)
                        touch()
                      }}
                    >
                      ◆
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
