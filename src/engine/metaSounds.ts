/**
 * MetaSounds-lite — procedural WebAudio node graph (UE MetaSounds analog).
 * Graph nodes compile into an AudioNode chain on each play().
 */

export interface MetaSoundNode {
  id: string
  type: string
  x: number
  y: number
  props: Record<string, string | number>
}

/** audio edge: from "nodeId" (output) to "nodeId:inputName" */
export interface MetaSoundEdge {
  from: string
  to: string
}

export interface MetaSoundGraph {
  nodes: MetaSoundNode[]
  edges: MetaSoundEdge[]
}

export interface MetaNodeDef {
  title: string
  color: string
  inputs: string[]
  hasOutput: boolean
  props: Array<{ key: string; label: string; kind: 'number' | 'text' | 'select'; default: string | number; options?: string[] }>
}

export const META_NODE_DEFS: Record<string, MetaNodeDef> = {
  Output: {
    title: 'Output',
    color: '#7a3b5a',
    inputs: ['in'],
    hasOutput: false,
    props: [],
  },
  Oscillator: {
    title: 'Oscillator',
    color: '#3b5a7a',
    inputs: [],
    hasOutput: true,
    props: [
      { key: 'wave', label: 'Wave', kind: 'select', default: 'sine', options: ['sine', 'square', 'sawtooth', 'triangle'] },
      { key: 'frequency', label: 'Hz', kind: 'number', default: 440 },
    ],
  },
  Gain: {
    title: 'Gain',
    color: '#6b7280',
    inputs: ['in'],
    hasOutput: true,
    props: [{ key: 'gain', label: 'Gain', kind: 'number', default: 0.5 }],
  },
  Filter: {
    title: 'Lowpass Filter',
    color: '#5a4b7a',
    inputs: ['in'],
    hasOutput: true,
    props: [
      { key: 'frequency', label: 'Cutoff Hz', kind: 'number', default: 1200 },
      { key: 'q', label: 'Q', kind: 'number', default: 1 },
    ],
  },
  Envelope: {
    title: 'Envelope (ADSR)',
    color: '#3b7a4d',
    inputs: ['in'],
    hasOutput: true,
    props: [
      { key: 'attack', label: 'Attack', kind: 'number', default: 0.01 },
      { key: 'decay', label: 'Decay', kind: 'number', default: 0.1 },
      { key: 'sustain', label: 'Sustain', kind: 'number', default: 0.6 },
      { key: 'release', label: 'Release', kind: 'number', default: 0.2 },
    ],
  },
  Noise: {
    title: 'Noise',
    color: '#7a6b3b',
    inputs: [],
    hasOutput: true,
    props: [{ key: 'gain', label: 'Gain', kind: 'number', default: 0.3 }],
  },
  BufferPlayer: {
    title: 'Buffer Player',
    color: '#3b7a6b',
    inputs: [],
    hasOutput: true,
    props: [
      { key: 'sound', label: 'Sound', kind: 'text', default: '' },
      { key: 'gain', label: 'Gain', kind: 'number', default: 1 },
    ],
  },
}

let metaCounter = 0
export function newMetaNodeId(): string {
  metaCounter += 1
  return `ms_${Date.now().toString(36)}_${metaCounter}`
}

export function emptyMetaSoundGraph(): MetaSoundGraph {
  return { nodes: [{ id: newMetaNodeId(), type: 'Output', x: 400, y: 80, props: {} }], edges: [] }
}

export interface MetaSoundPlayInstance {
  /** connect this node to a bus / panner / reverb send */
  output: AudioNode
  start: () => void
  stop: () => void
}

type BufferLookup = (name: string) => AudioBuffer | undefined

function num(props: Record<string, string | number>, key: string, fallback: number): number {
  const v = props[key]
  return typeof v === 'number' ? v : parseFloat(String(v ?? fallback)) || fallback
}

function makeNoiseBuffer(ac: AudioContext, seconds = 2): AudioBuffer {
  const len = Math.floor(ac.sampleRate * seconds)
  const buf = ac.createBuffer(1, len, ac.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  return buf
}

/**
 * Compile a MetaSound graph into a factory that builds a fresh WebAudio chain per play.
 */
export function compileMetaSound(
  graph: MetaSoundGraph,
  getBuffer: BufferLookup,
  ac: AudioContext,
): () => MetaSoundPlayInstance {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const outputNode = graph.nodes.find((n) => n.type === 'Output')
  if (!outputNode) {
    return () => {
      const g = ac.createGain()
      g.gain.value = 0
      return { output: g, start: () => {}, stop: () => {} }
    }
  }

  // incoming edges per input: "nodeId:input" -> source nodeId
  const inputFrom = new Map<string, string>()
  for (const e of graph.edges) {
    inputFrom.set(e.to, e.from)
  }

  const resolveInput = (nodeId: string, input: string): string | undefined => inputFrom.get(`${nodeId}:${input}`)

  return () => {
    const built = new Map<string, { out: AudioNode; start?: () => void; stop?: () => void; stoppable?: AudioScheduledSourceNode[] }>()
    const stoppable: AudioScheduledSourceNode[] = []

    const build = (id: string, depth = 0): AudioNode => {
      if (built.has(id)) return built.get(id)!.out
      if (depth > 32) return ac.createGain()

      const node = byId.get(id)
      if (!node) return ac.createGain()

      switch (node.type) {
        case 'Oscillator': {
          const osc = ac.createOscillator()
          osc.type = (String(node.props.wave ?? 'sine') as OscillatorType) || 'sine'
          osc.frequency.value = num(node.props, 'frequency', 440)
          const g = ac.createGain()
          g.gain.value = 1
          osc.connect(g)
          built.set(id, {
            out: g,
            start: () => osc.start(),
            stop: () => {
              try {
                osc.stop()
              } catch {
                /* already stopped */
              }
            },
            stoppable: [osc],
          })
          stoppable.push(osc)
          return g
        }
        case 'Noise': {
          const src = ac.createBufferSource()
          src.buffer = makeNoiseBuffer(ac)
          src.loop = true
          const g = ac.createGain()
          g.gain.value = num(node.props, 'gain', 0.3)
          src.connect(g)
          built.set(id, {
            out: g,
            start: () => src.start(),
            stop: () => {
              try {
                src.stop()
              } catch {
                /* already stopped */
              }
            },
            stoppable: [src],
          })
          stoppable.push(src)
          return g
        }
        case 'BufferPlayer': {
          const soundName = String(node.props.sound ?? '')
          const buf = getBuffer(soundName)
          const g = ac.createGain()
          g.gain.value = num(node.props, 'gain', 1)
          if (buf) {
            const src = ac.createBufferSource()
            src.buffer = buf
            src.connect(g)
            built.set(id, {
              out: g,
              start: () => src.start(),
              stop: () => {
                try {
                  src.stop()
                } catch {
                  /* already stopped */
                }
              },
              stoppable: [src],
            })
            stoppable.push(src)
          } else {
            built.set(id, { out: g })
          }
          return g
        }
        case 'Gain': {
          const g = ac.createGain()
          g.gain.value = num(node.props, 'gain', 0.5)
          const srcId = resolveInput(id, 'in')
          if (srcId) build(srcId, depth + 1).connect(g)
          built.set(id, { out: g })
          return g
        }
        case 'Filter': {
          const f = ac.createBiquadFilter()
          f.type = 'lowpass'
          f.frequency.value = num(node.props, 'frequency', 1200)
          f.Q.value = num(node.props, 'q', 1)
          const srcId = resolveInput(id, 'in')
          if (srcId) build(srcId, depth + 1).connect(f)
          built.set(id, { out: f })
          return f
        }
        case 'Envelope': {
          const env = ac.createGain()
          env.gain.value = 0
          const srcId = resolveInput(id, 'in')
          if (srcId) build(srcId, depth + 1).connect(env)
          const attack = Math.max(0.001, num(node.props, 'attack', 0.01))
          const decay = Math.max(0.001, num(node.props, 'decay', 0.1))
          const sustain = Math.max(0, Math.min(1, num(node.props, 'sustain', 0.6)))
          const release = Math.max(0.001, num(node.props, 'release', 0.2))
          built.set(id, {
            out: env,
            start: () => {
              const t = ac.currentTime
              env.gain.cancelScheduledValues(t)
              env.gain.setValueAtTime(0, t)
              env.gain.linearRampToValueAtTime(1, t + attack)
              env.gain.linearRampToValueAtTime(sustain, t + attack + decay)
            },
            stop: () => {
              const t = ac.currentTime
              env.gain.cancelScheduledValues(t)
              env.gain.setValueAtTime(env.gain.value, t)
              env.gain.linearRampToValueAtTime(0, t + release)
            },
          })
          return env
        }
        case 'Output': {
          const g = ac.createGain()
          g.gain.value = 1
          const srcId = resolveInput(id, 'in')
          if (srcId) build(srcId, depth + 1).connect(g)
          built.set(id, { out: g })
          return g
        }
        default:
          return ac.createGain()
      }
    }

    const out = build(outputNode.id)

    return {
      output: out,
      start: () => {
        for (const b of built.values()) b.start?.()
      },
      stop: () => {
        for (const b of built.values()) b.stop?.()
        for (const s of stoppable) {
          try {
            s.stop()
          } catch {
            /* already stopped */
          }
        }
      },
    }
  }
}