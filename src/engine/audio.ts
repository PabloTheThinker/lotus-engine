/**
 * Audio — playback with distance attenuation and a bus mixer (master/sfx/music).
 * Sounds are base64 assets embedded in the level; api.playSound drives them.
 */

let ctx: AudioContext | null = null
let master: GainNode | null = null
const buses = new Map<string, GainNode>()
const buffers = new Map<string, AudioBuffer>()

function ensureCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.connect(ctx.destination)
    for (const name of ['sfx', 'music']) {
      const g = ctx.createGain()
      g.connect(master)
      buses.set(name, g)
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function setBusVolume(bus: 'master' | 'sfx' | 'music', volume: number) {
  ensureCtx()
  const node = bus === 'master' ? master : buses.get(bus)
  if (node) node.gain.value = Math.max(0, Math.min(1.5, volume))
}

export async function registerSound(name: string, base64: string) {
  const ac = ensureCtx()
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  buffers.set(name, await ac.decodeAudioData(bytes.buffer))
}

export function hasSound(name: string) {
  return buffers.has(name)
}

export interface PlayOpts {
  volume?: number
  bus?: 'sfx' | 'music'
  loop?: boolean
  /** world position — volume attenuates with distance to the listener */
  at?: [number, number, number]
  listener?: () => [number, number, number] | null
}

const playing: AudioBufferSourceNode[] = []

export function playSound(name: string, opts: PlayOpts = {}) {
  const buf = buffers.get(name)
  if (!buf) return
  const ac = ensureCtx()
  const src = ac.createBufferSource()
  src.buffer = buf
  src.loop = !!opts.loop
  const gain = ac.createGain()
  let vol = opts.volume ?? 1
  if (opts.at && opts.listener) {
    const l = opts.listener()
    if (l) {
      const d = Math.hypot(opts.at[0] - l[0], opts.at[1] - l[1], opts.at[2] - l[2])
      vol *= 1 / (1 + d * d * 0.04) // inverse-square-ish falloff
    }
  }
  gain.gain.value = vol
  src.connect(gain)
  gain.connect(buses.get(opts.bus ?? 'sfx') ?? master!)
  src.start()
  playing.push(src)
  src.onended = () => {
    const i = playing.indexOf(src)
    if (i >= 0) playing.splice(i, 1)
  }
}

export function stopAllSounds() {
  for (const s of [...playing]) {
    try {
      s.stop()
    } catch {
      /* already stopped */
    }
  }
  playing.length = 0
}
