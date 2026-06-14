import * as THREE from 'three'
import type { World } from './World'
import type { SerializedActor } from './types'
import { getActorAttributes, setAttribute } from './gameplayAbilities'
import {
  DEFAULT_MP_NET,
  mpActorInInterest,
  mpExpandDelta,
  mpNetReset,
  mpPackDelta,
  mpRecordTransformHistory,
  mpSampleHistory,
  type MPNetSettings,
} from './mpNet'

/**
 * Multiplayer — Godot MultiplayerSynchronizer / MultiplayerSpawner-lite over a
 * WebSocket relay (scripts/relay.mjs).
 *
 * Protocol (JSON):
 *   join    { t, room, id }
 *   leave   { t, id }
 *   pose    { t, id, p:[x,y,z], ry }           — local pawn co-presence
 *   sync    { t, id, aid, props }               — host property deltas @ 10 Hz
 *   spawn   { t, id, actor: SerializedActor } — host spawner replication
 *   despawn { t, id, aid }                      — host removes replicated actor
 *   input   { t, id, p?, ry?, actions? }      — client input (optional v1)
 *   own     { t, id, aid, ownerId }           — host reassigns actor ownership (empty ownerId = host)
 *
 * Host = lexicographically smallest peer id in the room.
 */

interface Peer {
  id: string
  ghost: THREE.Group
  lastSeen: number
  target: THREE.Vector3
}

interface RemoteSync {
  targetPos: THREE.Vector3
  targetRot: THREE.Euler
  targetVisible: boolean | null
  targetScriptVars: Record<string, unknown>
  lastSeen: number
}

let ws: WebSocket | null = null
let peers = new Map<string, Peer>()
const remoteSync = new Map<string, RemoteSync>()
const knownPeerIds = new Set<string>()
let localId = ''
/** snap predicted transform when host sync error exceeds these thresholds */
const PREDICT_POS_THRESHOLD = 0.5
const PREDICT_ROT_THRESHOLD = 0.35
let sendAcc = 0
let worldRef: World | null = null
let scoreDeltaHandler: ((peerId: string, delta: number) => void) | null = null
let peerScoresMirrorHandler: ((scores: Record<string, number>) => void) | null = null
let gameWonRelayHandler: ((peerId: string, score: number) => void) | null = null
/** ids spawned by the network host (safe to despawn on disconnect) */
const netSpawned = new Set<string>()

export interface MPSettings {
  url: string
  room: string
  enabled: boolean
  /** Headless authoritative relay client (no local pawn uplink) */
  dedicatedServer?: boolean
  lagCompensationMs?: number
  interestRadius?: number
  deltaCompression?: boolean
}

const KEY = 'lotus-engine.multiplayer'
export function loadMPSettings(): MPSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return {
      url: raw.url ?? 'ws://localhost:24690',
      room: raw.room ?? 'default',
      enabled: !!raw.enabled,
      dedicatedServer: !!raw.dedicatedServer,
      lagCompensationMs: raw.lagCompensationMs ?? DEFAULT_MP_NET.lagCompensationMs,
      interestRadius: raw.interestRadius ?? DEFAULT_MP_NET.interestRadius,
      deltaCompression: raw.deltaCompression !== false,
    }
  } catch {
    return {
      url: 'ws://localhost:24690',
      room: 'default',
      enabled: false,
      dedicatedServer: false,
      ...DEFAULT_MP_NET,
    }
  }
}

export function mpNetSettings(): MPNetSettings {
  const s = loadMPSettings()
  return {
    lagCompensationMs: s.lagCompensationMs ?? DEFAULT_MP_NET.lagCompensationMs,
    interestRadius: s.interestRadius ?? DEFAULT_MP_NET.interestRadius,
    deltaCompression: s.deltaCompression !== false,
  }
}

export function mpIsDedicatedServer(): boolean {
  return loadMPSettings().dedicatedServer === true
}
export function saveMPSettings(s: MPSettings) {
  localStorage.setItem(KEY, JSON.stringify(s))
}

export function mpEnabled(): boolean {
  return loadMPSettings().enabled
}

export function mpConnected(): boolean {
  return !!ws && ws.readyState === 1
}

export function mpLocalId(): string {
  return localId
}

/** Other peers in the room (excludes this client). */
export function mpKnownPeerIds(): string[] {
  return [...knownPeerIds].sort()
}

function actorOwnerId(actor: import('./Actor').Actor): string {
  return actor.netOwnerId ?? ''
}

/** Whether this client may drive the actor locally (prediction / input). */
export function mpIsLocallyOwned(actor: import('./Actor').Actor): boolean {
  if (!mpConnected()) return true
  const owner = actorOwnerId(actor)
  if (mpIsHost()) return owner === '' || owner === localId
  return owner === localId
}

function shouldPredict(actor: import('./Actor').Actor): boolean {
  return !!actor.clientPredicted && mpIsLocallyOwned(actor) && !mpIsHost()
}

function allPeerIds(): string[] {
  return [localId, ...knownPeerIds]
}

/** Lexicographically smallest peer id is the authoritative host. */
export function mpIsHost(): boolean {
  if (!mpConnected()) return false
  return localId === allPeerIds().sort()[0]
}

function hostId(): string {
  return allPeerIds().sort()[0]
}

function isFromHost(fromId: string): boolean {
  return fromId === hostId()
}

function makeGhost(id: string): THREE.Group {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: 0xb08df1, roughness: 0.5, transparent: true, opacity: 0.85 })
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.32, 0.85, 6, 12), mat)
  torso.position.y = 0.95
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), mat)
  head.position.y = 1.72
  g.add(torso, head)
  g.traverse((o) => (o.userData.isEditorOnly = true))
  g.name = `peer_${id}`
  return g
}

function trackPeer(id: string) {
  if (id && id !== localId) knownPeerIds.add(id)
}

function send(msg: object) {
  if (ws?.readyState === 1) ws.send(JSON.stringify(msg))
}

/** Collect replicated property values for one actor. */
function packSyncProps(actor: import('./Actor').Actor, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of keys) {
    if (key === 'position') out.position = actor.transform.position
    else if (key === 'rotation') out.rotation = actor.transform.rotation
    else if (key === 'visible') out.visible = actor.visible
    else if (key.startsWith('ga:')) {
      const attr = key.slice(3)
      const attrs = getActorAttributes(actor)
      if (attrs && attr in attrs) out[key] = attrs[attr]
    } else if (actor.scriptVars && key in actor.scriptVars) out[`sv:${key}`] = actor.scriptVars[key]
  }
  if (actor.replicateGAS) {
    const attrs = getActorAttributes(actor)
    if (attrs && Object.keys(attrs).length) out.ga = { ...attrs }
  }
  return out
}

/** Reconcile host-authoritative transform onto a locally-predicted actor. */
function reconcilePredictedTransform(actor: import('./Actor').Actor, props: Record<string, unknown>) {
  if (Array.isArray(props.position) && props.position.length === 3) {
    const tx = props.position[0] as number
    const ty = props.position[1] as number
    const tz = props.position[2] as number
    const err = actor.root.position.distanceTo(new THREE.Vector3(tx, ty, tz))
    if (err > PREDICT_POS_THRESHOLD) actor.root.position.set(tx, ty, tz)
  }
  if (Array.isArray(props.rotation) && props.rotation.length === 3) {
    const rx = props.rotation[0] as number
    const ry = props.rotation[1] as number
    const rz = props.rotation[2] as number
    const err = Math.max(
      Math.abs(actor.root.rotation.x - rx),
      Math.abs(actor.root.rotation.y - ry),
      Math.abs(actor.root.rotation.z - rz),
    )
    if (err > PREDICT_ROT_THRESHOLD) actor.root.rotation.set(rx, ry, rz)
  }
}

/** Apply a property delta on a client (sets interpolation targets for transforms). */
function applySyncProps(aid: string, props: Record<string, unknown>) {
  if (!worldRef) return
  const actor = worldRef.actors.get(aid)
  if (!actor) return

  const applyGa = (ga: Record<string, unknown>) => {
    for (const [name, val] of Object.entries(ga)) {
      if (typeof val === 'number') setAttribute(actor, name, val)
    }
  }

  if (shouldPredict(actor)) {
    reconcilePredictedTransform(actor, props)
    if (typeof props.visible === 'boolean') actor.setVisible(props.visible)
    for (const [k, v] of Object.entries(props)) {
      if (k.startsWith('sv:')) {
        const name = k.slice(3)
        actor.scriptVars = { ...(actor.scriptVars ?? {}), [name]: v }
      } else if (k.startsWith('ga:') && typeof v === 'number') {
        setAttribute(actor, k.slice(3), v)
      }
    }
    if (props.ga && typeof props.ga === 'object') applyGa(props.ga as Record<string, unknown>)
    return
  }

  let state = remoteSync.get(aid)
  if (!state) {
    state = {
      targetPos: actor.root.position.clone(),
      targetRot: new THREE.Euler(actor.root.rotation.x, actor.root.rotation.y, actor.root.rotation.z),
      targetVisible: null,
      targetScriptVars: {},
      lastSeen: 0,
    }
    remoteSync.set(aid, state)
  }
  state.lastSeen = performance.now()

  if (Array.isArray(props.position) && props.position.length === 3) {
    state.targetPos.set(props.position[0] as number, props.position[1] as number, props.position[2] as number)
  }
  if (Array.isArray(props.rotation) && props.rotation.length === 3) {
    state.targetRot.set(props.rotation[0] as number, props.rotation[1] as number, props.rotation[2] as number)
  }
  if (typeof props.visible === 'boolean') {
    state.targetVisible = props.visible
    actor.setVisible(props.visible)
  }
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('sv:')) {
      const name = k.slice(3)
      state.targetScriptVars[name] = v
      actor.scriptVars = { ...(actor.scriptVars ?? {}), [name]: v }
    } else if (k.startsWith('ga:') && typeof v === 'number') {
      setAttribute(actor, k.slice(3), v)
    }
  }
  if (props.ga && typeof props.ga === 'object') applyGa(props.ga as Record<string, unknown>)
}

function applyOwnership(aid: string, ownerId: string) {
  if (!worldRef) return
  const actor = worldRef.actors.get(aid)
  if (!actor) return
  actor.netOwnerId = ownerId || undefined
  remoteSync.delete(aid)
}

function handleSpawn(fromId: string, sa: SerializedActor) {
  if (!worldRef || fromId === localId || !isFromHost(fromId)) return
  if (worldRef.actors.has(sa.id)) return
  const actor = worldRef.instantiate(sa)
  worldRef.addActor(actor, sa.parentId)
  netSpawned.add(sa.id)
  remoteSync.delete(sa.id)
}

function handleDespawn(fromId: string, aid: string) {
  if (!worldRef || fromId === localId || !isFromHost(fromId)) return
  if (!worldRef.actors.has(aid)) return
  worldRef.removeActor(aid)
  remoteSync.delete(aid)
  netSpawned.delete(aid)
}

function resolveNetOwnerId(ownerId?: string): string {
  if (!ownerId || ownerId === '__local__') return localId
  return ownerId
}

export function mpNotifySpawn(sa: SerializedActor) {
  if (!mpConnected() || !mpIsHost() || !sa.syncSpawn) return
  const ownerId = resolveNetOwnerId(sa.netOwnerId)
  const actor: SerializedActor = { ...sa, netOwnerId: ownerId || undefined }
  send({ t: 'spawn', id: localId, actor })
  send({ t: 'own', id: localId, aid: sa.id, ownerId })
}

/** Host broadcasts ownership reassignment (empty ownerId = host-owned). */
export function mpNotifyOwnership(aid: string, ownerId?: string) {
  if (!mpConnected() || !mpIsHost()) return
  send({ t: 'own', id: localId, aid, ownerId: ownerId ?? '' })
}

export function mpNotifyDespawn(aid: string) {
  if (!mpConnected() || !mpIsHost()) return
  const actor = worldRef?.actors.get(aid)
  if (!actor?.syncSpawn) return
  send({ t: 'despawn', id: localId, aid })
}

/** Register host handler for client score requests (indie MP deathmatch). */
export function mpSetScoreDeltaHandler(fn: ((peerId: string, delta: number) => void) | null) {
  scoreDeltaHandler = fn
}

/** Client mirror — host peerScores snapshot applied to local scoreboard. */
export function mpSetPeerScoresMirrorHandler(fn: ((scores: Record<string, number>) => void) | null) {
  peerScoresMirrorHandler = fn
}

/** Client relay — host mp_game_won forwarded to local playApi. */
export function mpSetGameWonRelayHandler(fn: ((peerId: string, score: number) => void) | null) {
  gameWonRelayHandler = fn
}

/** Host broadcasts authoritative peerScores (+ optional win) via score relay. */
export function mpBroadcastPeerScores(
  scores: Record<string, number>,
  gameWon?: { peerId: string; score: number },
) {
  if (!mpConnected() || !mpIsHost()) return
  send({
    t: 'score',
    id: localId,
    peerScores: scores,
    ...(gameWon ? { gameWon: [gameWon.peerId, gameWon.score] as [string, number] } : {}),
  })
}

/** Client requests a score delta — host applies via mpSetScoreDeltaHandler. */
export function mpRequestScoreDelta(delta: number, peerId?: string) {
  if (!mpConnected() || mpIsHost()) return
  send({ t: 'score', id: peerId ?? localId, delta })
}

/** Optional client input uplink (host may consume later). */
export function mpSendInput(pawnPos: THREE.Vector3 | null, pawnYaw: number, actions?: string[]) {
  if (!mpConnected() || mpIsHost() || mpIsDedicatedServer()) return
  send({
    t: 'input',
    id: localId,
    p: pawnPos ? [pawnPos.x, pawnPos.y, pawnPos.z] : undefined,
    ry: pawnYaw,
    actions,
    ts: performance.now(),
  })
}

export function mpConnect(world: World, status: (msg: string) => void) {
  const cfg = loadMPSettings()
  if (!cfg.enabled || ws) return
  worldRef = world
  localId = Math.random().toString(36).slice(2, 8)
  knownPeerIds.clear()
  remoteSync.clear()
  netSpawned.clear()
  mpNetReset()
  try {
    ws = new WebSocket(cfg.url)
  } catch (err) {
    status(`MP connect failed: ${(err as Error).message}`)
    return
  }
  ws.onopen = () => {
    send({ t: 'join', room: cfg.room, id: localId })
    const mode = cfg.dedicatedServer ? ' dedicated' : ''
    status(`MP connected: ${cfg.room} as ${localId}${mpIsHost() ? ' (host)' : ''}${mode}`)
  }
  ws.onerror = () => status('MP: relay unreachable')
  ws.onmessage = (ev) => {
    let msg: {
      t: string
      id: string
      room?: string
      p?: [number, number, number]
      ry?: number
      aid?: string
      props?: Record<string, unknown>
      actor?: SerializedActor
      actions?: string[]
      ownerId?: string
      ts?: number
      delta?: number
      peerScores?: Record<string, number>
      gameWon?: [string, number]
    }
    try {
      msg = JSON.parse(String(ev.data))
    } catch {
      return
    }
    if (msg.t === 'join' && msg.id !== localId) {
      trackPeer(msg.id)
      return
    }
    if (msg.t === 'leave') {
      const peer = peers.get(msg.id)
      if (peer) {
        peer.ghost.removeFromParent()
        peers.delete(msg.id)
      }
      knownPeerIds.delete(msg.id)
      return
    }
    if (msg.id === localId) return
    trackPeer(msg.id)

    if (msg.t === 'pose' && msg.p && worldRef) {
      let peer = peers.get(msg.id)
      if (!peer) {
        peer = { id: msg.id, ghost: makeGhost(msg.id), lastSeen: 0, target: new THREE.Vector3() }
        worldRef.scene.add(peer.ghost)
        peers.set(msg.id, peer)
      }
      peer.target.set(msg.p[0], msg.p[1], msg.p[2])
      peer.ghost.rotation.y = msg.ry ?? 0
      peer.lastSeen = performance.now()
      return
    }
    if (msg.t === 'sync' && msg.aid && msg.props && !mpIsHost() && isFromHost(msg.id)) {
      applySyncProps(msg.aid, mpExpandDelta(msg.props))
      return
    }
    if (msg.t === 'spawn' && msg.actor) {
      handleSpawn(msg.id, msg.actor)
      return
    }
    if (msg.t === 'despawn' && msg.aid) {
      handleDespawn(msg.id, msg.aid)
      return
    }
    if (msg.t === 'own' && msg.aid && !mpIsHost() && isFromHost(msg.id)) {
      applyOwnership(msg.aid, msg.ownerId ?? '')
      return
    }
    if (msg.t === 'score' && mpIsHost() && typeof msg.delta === 'number' && msg.id) {
      scoreDeltaHandler?.(msg.id, msg.delta)
      return
    }
    if (msg.t === 'score' && !mpIsHost() && isFromHost(msg.id) && msg.peerScores) {
      peerScoresMirrorHandler?.(msg.peerScores)
      if (Array.isArray(msg.gameWon) && msg.gameWon.length >= 2) {
        gameWonRelayHandler?.(String(msg.gameWon[0]), Number(msg.gameWon[1]))
      }
      return
    }
    if (msg.t === 'input' && msg.p && worldRef && mpIsHost()) {
      // host may mirror remote pawn input as ghost pose (co-presence v1)
      let peer = peers.get(msg.id)
      if (!peer) {
        peer = { id: msg.id, ghost: makeGhost(msg.id), lastSeen: 0, target: new THREE.Vector3() }
        worldRef.scene.add(peer.ghost)
        peers.set(msg.id, peer)
      }
      peer.target.set(msg.p[0], msg.p[1], msg.p[2])
      peer.ghost.rotation.y = msg.ry ?? 0
      peer.lastSeen = performance.now()
    }
  }
}

export function mpDisconnect() {
  ws?.close()
  ws = null
  for (const p of peers.values()) p.ghost.removeFromParent()
  peers = new Map()
  knownPeerIds.clear()
  remoteSync.clear()
  mpNetReset()
  if (worldRef) {
    for (const id of [...netSpawned]) {
      if (worldRef.actors.has(id)) worldRef.removeActor(id)
    }
  }
  netSpawned.clear()
  worldRef = null
}

function peerInterestPositions(pawnPos: THREE.Vector3 | null): THREE.Vector3[] {
  const out: THREE.Vector3[] = []
  if (pawnPos && !mpIsDedicatedServer()) out.push(pawnPos)
  for (const p of peers.values()) out.push(p.target)
  return out
}

/** Lag-compensated actor transform sample for host hit tests. */
export function mpLagCompensatedTransform(
  aid: string,
  clientTs: number,
): { position: THREE.Vector3; rotation: THREE.Euler } | null {
  if (!mpIsHost()) return null
  const net = mpNetSettings()
  return mpSampleHistory(aid, clientTs - net.lagCompensationMs)
}

export function mpTick(dt: number, pawnPos: THREE.Vector3 | null, pawnYaw: number) {
  if (!ws || ws.readyState !== 1 || !worldRef) return
  const net = mpNetSettings()
  const interestPeers = peerInterestPositions(pawnPos)

  // smooth peer ghosts toward their network targets
  for (const p of peers.values()) {
    p.ghost.position.lerp(p.target, Math.min(1, 12 * dt))
    if (performance.now() - p.lastSeen > 5000) {
      p.ghost.removeFromParent()
      peers.delete(p.id)
      knownPeerIds.delete(p.id)
    }
  }

  // clients interpolate replicated actor transforms (skip locally-predicted owned actors)
  if (!mpIsHost()) {
    for (const [aid, state] of remoteSync) {
      const actor = worldRef.actors.get(aid)
      if (!actor) {
        remoteSync.delete(aid)
        continue
      }
      if (shouldPredict(actor)) continue
      const t = Math.min(1, 12 * dt)
      actor.root.position.lerp(state.targetPos, t)
      actor.root.rotation.x = THREE.MathUtils.lerp(actor.root.rotation.x, state.targetRot.x, t)
      actor.root.rotation.y = THREE.MathUtils.lerp(actor.root.rotation.y, state.targetRot.y, t)
      actor.root.rotation.z = THREE.MathUtils.lerp(actor.root.rotation.z, state.targetRot.z, t)
      if (performance.now() - state.lastSeen > 5000) remoteSync.delete(aid)
    }
  }

  sendAcc += dt
  if (sendAcc < 0.1) return
  sendAcc = 0

  // pawn co-presence @ 10 Hz (dedicated server skips local pawn uplink)
  if (pawnPos && !mpIsDedicatedServer()) {
    if (mpIsHost()) {
      send({ t: 'pose', id: localId, p: [pawnPos.x, pawnPos.y, pawnPos.z], ry: pawnYaw, ts: performance.now() })
    } else {
      mpSendInput(pawnPos, pawnYaw)
    }
  }

  // host broadcasts property deltas for actors with syncProperties
  if (!mpIsHost()) return
  const now = performance.now()
  for (const actor of worldRef.actors.values()) {
    const keys = actor.syncProperties
    if (!keys?.length) continue
    if (!mpActorInInterest(actor.root.position, interestPeers, net.interestRadius)) continue
    mpRecordTransformHistory(actor.id, actor.root.position, actor.root.rotation, now)
    const props = packSyncProps(actor, keys)
    const delta = mpPackDelta(actor.id, props, net.deltaCompression)
    if (delta && Object.keys(delta).length) send({ t: 'sync', id: localId, aid: actor.id, props: delta, ts: now })
  }
}

export function mpPeerCount(): number {
  return peers.size
}