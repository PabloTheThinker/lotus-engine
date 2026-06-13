/**
 * Audio — playback with true 3D spatialization, bus mixer, reverb zones, and MetaSounds.
 * Imported sounds are base64 assets; procedural graphs compile to WebAudio chains.
 */

import { compileMetaSound } from './metaSounds'
import { getMetaSoundByName } from './metaSoundAssets'

let ctx: AudioContext | null = null
let master: GainNode | null = null
const buses = new Map<string, GainNode>()
const buffers = new Map<string, AudioBuffer>()

/** dry path + shared reverb send */
let dryBus: GainNode | null = null
let reverbSend: GainNode | null = null
let reverbConvolver: ConvolverNode | null = null
let reverbWet = 0

const compiledMeta = new Map<string, ReturnType<typeof compileMetaSound>>()

function ensureCtx(): AudioContext {
  if (!ctx) {
    ctx = new AudioContext()
    master = ctx.createGain()
    master.connect(ctx.destination)
    dryBus = ctx.createGain()
    dryBus.connect(master)
    reverbSend = ctx.createGain()
    reverbSend.gain.value = 0
    reverbConvolver = ctx.createConvolver()
    reverbConvolver.buffer = makeImpulseResponse(ctx, 1.2, 3)
    reverbConvolver.connect(reverbSend)
    reverbSend.connect(master)
    for (const name of ['sfx', 'music']) {
      const g = ctx.createGain()
      g.connect(dryBus)
      buses.set(name, g)
    }
  }
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

export function getAudioContext(): AudioContext {
  return ensureCtx()
}

export type ReverbPreset = '' | 'room' | 'hall' | 'cave'

const REVERB_IR: Record<Exclude<ReverbPreset, ''>, { duration: number; decay: number; wet: number }> = {
  room: { duration: 0.8, decay: 4, wet: 0.25 },
  hall: { duration: 2.5, decay: 2.5, wet: 0.45 },
  cave: { duration: 3.5, decay: 1.8, wet: 0.55 },
}

function makeImpulseResponse(ac: AudioContext, duration: number, decay: number): AudioBuffer {
  const len = Math.floor(ac.sampleRate * duration)
  const buf = ac.createBuffer(2, len, ac.sampleRate)
  for (let c = 0; c < 2; c++) {
    const data = buf.getChannelData(c)
    for (let i = 0; i < len; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay)
    }
  }
  return buf
}

/** Reverb zone — TriggerVolume sets this when the pawn enters/exits. */
export function setReverbZone(preset: ReverbPreset) {
  const ac = ensureCtx()
  if (!reverbConvolver || !reverbSend) return
  if (!preset) {
    reverbWet = 0
    reverbSend.gain.setTargetAtTime(0, ac.currentTime, 0.08)
    return
  }
  const cfg = REVERB_IR[preset]
  reverbConvolver.buffer = makeImpulseResponse(ac, cfg.duration, cfg.decay)
  reverbWet = cfg.wet
  reverbSend.gain.setTargetAtTime(cfg.wet, ac.currentTime, 0.12)
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

export function getSoundBuffer(name: string): AudioBuffer | undefined {
  return buffers.get(name)
}

/** Update the WebAudio listener from the pawn / editor camera (true 3D audio). */
export function updateListener(
  pos: [number, number, number],
  forward: [number, number, number] = [0, 0, -1],
  up: [number, number, number] = [0, 1, 0],
) {
  const ac = ensureCtx()
  if (!ac.listener) return
  const l = ac.listener
  if ('positionX' in l) {
    l.positionX.value = pos[0]
    l.positionY.value = pos[1]
    l.positionZ.value = pos[2]
    l.forwardX.value = forward[0]
    l.forwardY.value = forward[1]
    l.forwardZ.value = forward[2]
    l.upX.value = up[0]
    l.upY.value = up[1]
    l.upZ.value = up[2]
  } else {
    // legacy API
    ;(l as AudioListener & { setPosition: (x: number, y: number, z: number) => void }).setPosition(pos[0], pos[1], pos[2])
    ;(l as AudioListener & { setOrientation: (fx: number, fy: number, fz: number, ux: number, uy: number, uz: number) => void }).setOrientation(
      forward[0],
      forward[1],
      forward[2],
      up[0],
      up[1],
      up[2],
    )
  }
}

export interface PlayOpts {
  volume?: number
  bus?: 'sfx' | 'music'
  loop?: boolean
  /** world position — routed through a PannerNode (HRTF) */
  at?: [number, number, number]
  listener?: () => [number, number, number] | null
}

interface ActiveVoice {
  stop: () => void
  panner?: PannerNode
  at?: [number, number, number]
}

const playing: ActiveVoice[] = []

/** Move active PannerNodes when the source position changes (optional fallback). */
export function updatePannerPositions() {
  const ac = ensureCtx()
  const t = ac.currentTime
  for (const v of playing) {
    if (v.panner && v.at) {
      v.panner.positionX.setValueAtTime(v.at[0], t)
      v.panner.positionY.setValueAtTime(v.at[1], t)
      v.panner.positionZ.setValueAtTime(v.at[2], t)
    }
  }
}

export function playSound(name: string, opts: PlayOpts = {}) {
  const buf = buffers.get(name)
  if (!buf) return
  const ac = ensureCtx()
  const src = ac.createBufferSource()
  src.buffer = buf
  src.loop = !!opts.loop

  let panner: PannerNode | undefined
  let entryGain: GainNode | undefined

  if (opts.at) {
    panner = ac.createPanner()
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'inverse'
    panner.refDistance = 1
    panner.maxDistance = 80
    panner.rolloffFactor = 1.5
    panner.positionX.value = opts.at[0]
    panner.positionY.value = opts.at[1]
    panner.positionZ.value = opts.at[2]
    entryGain = ac.createGain()
    entryGain.gain.value = opts.volume ?? 1
    src.connect(entryGain)
    entryGain.connect(panner)
    panner.connect(buses.get(opts.bus ?? 'sfx') ?? dryBus!)
    if (reverbConvolver && reverbWet > 0) {
      const send = ac.createGain()
      send.gain.value = reverbWet * 0.6
      entryGain.connect(send)
      send.connect(reverbConvolver)
    }
  } else {
    entryGain = ac.createGain()
    entryGain.gain.value = opts.volume ?? 1
    src.connect(entryGain)
    entryGain.connect(buses.get(opts.bus ?? 'sfx') ?? dryBus!)
    if (reverbConvolver && reverbWet > 0) {
      const send = ac.createGain()
      send.gain.value = reverbWet * 0.35
      entryGain.connect(send)
      send.connect(reverbConvolver)
    }
  }

  src.start()
  const voice: ActiveVoice = {
    panner,
    at: opts.at,
    stop: () => {
      try {
        src.stop()
      } catch {
        /* already stopped */
      }
      src.disconnect()
      entryGain?.disconnect()
      panner?.disconnect()
    },
  }
  playing.push(voice)
  src.onended = () => {
    const i = playing.indexOf(voice)
    if (i >= 0) playing.splice(i, 1)
    voice.stop()
  }
}

function getCompiledMeta(name: string) {
  let compiled = compiledMeta.get(name)
  if (!compiled) {
    const asset = getMetaSoundByName(name)
    if (!asset) return null
    compiled = compileMetaSound(asset.graph, (n) => buffers.get(n), ensureCtx())
    compiledMeta.set(name, compiled)
  }
  return compiled
}

/** Invalidate cached compilers after graph edits. */
export function invalidateMetaSound(name: string) {
  compiledMeta.delete(name)
}

export function playMetaSound(name: string, opts: PlayOpts = {}) {
  const factory = getCompiledMeta(name)
  if (!factory) return
  const ac = ensureCtx()
  const inst = factory()
  const vol = opts.volume ?? 1

  let panner: PannerNode | undefined
  let entryGain = ac.createGain()
  entryGain.gain.value = vol
  inst.output.connect(entryGain)

  if (opts.at) {
    panner = ac.createPanner()
    panner.panningModel = 'HRTF'
    panner.distanceModel = 'inverse'
    panner.refDistance = 1
    panner.maxDistance = 80
    panner.rolloffFactor = 1.5
    panner.positionX.value = opts.at[0]
    panner.positionY.value = opts.at[1]
    panner.positionZ.value = opts.at[2]
    entryGain.connect(panner)
    panner.connect(buses.get(opts.bus ?? 'sfx') ?? dryBus!)
  } else {
    entryGain.connect(buses.get(opts.bus ?? 'sfx') ?? dryBus!)
  }

  if (reverbConvolver && reverbWet > 0) {
    const send = ac.createGain()
    send.gain.value = reverbWet * 0.6
    entryGain.connect(send)
    send.connect(reverbConvolver)
  }

  inst.start()

  const voice: ActiveVoice = {
    panner,
    at: opts.at,
    stop: () => {
      inst.stop()
      entryGain.disconnect()
      panner?.disconnect()
    },
  }
  playing.push(voice)

  // one-shot procedural sounds auto-stop after a few seconds if not looping
  if (!opts.loop) {
    window.setTimeout(() => {
      const i = playing.indexOf(voice)
      if (i >= 0) {
        playing.splice(i, 1)
        voice.stop()
      }
    }, 8000)
  }
}

export function stopAllSounds() {
  for (const s of [...playing]) s.stop()
  playing.length = 0
}