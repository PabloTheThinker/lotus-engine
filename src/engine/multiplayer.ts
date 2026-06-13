import * as THREE from 'three'
import type { World } from './World'
import type { SerializedActor } from './types'

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
let sendAcc = 0
let worldRef: World | null = null
/** ids spawned by the network host (safe to despawn on disconnect) */
const netSpawned = new Set<string>()

export interface MPSettings {
  url: string
  room: string
  enabled: boolean
}

const KEY = 'vektra-engine.multiplayer'
export function loadMPSettings(): MPSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { url: raw.url ?? 'ws://localhost:24690', room: raw.room ?? 'default', enabled: !!raw.enabled }
  } catch {
    return { url: 'ws://localhost:24690', room: 'default', enabled: false }
  }
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
    else if (actor.scriptVars && key in actor.scriptVars) out[`sv:${key}`] = actor.scriptVars[key]
  }
  return out
}

/** Apply a property delta on a client (sets interpolation targets for transforms). */
function applySyncProps(aid: string, props: Record<string, unknown>) {
  if (!worldRef) return
  const actor = worldRef.actors.get(aid)
  if (!actor) return

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
    if (!k.startsWith('sv:')) continue
    const name = k.slice(3)
    state.targetScriptVars[name] = v
    actor.scriptVars = { ...(actor.scriptVars ?? {}), [name]: v }
  }
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

export function mpNotifySpawn(sa: SerializedActor) {
  if (!mpConnected() || !mpIsHost() || !sa.syncSpawn) return
  send({ t: 'spawn', id: localId, actor: sa })
}

export function mpNotifyDespawn(aid: string) {
  if (!mpConnected() || !mpIsHost()) return
  const actor = worldRef?.actors.get(aid)
  if (!actor?.syncSpawn) return
  send({ t: 'despawn', id: localId, aid })
}

/** Optional client input uplink (host may consume later). */
export function mpSendInput(pawnPos: THREE.Vector3 | null, pawnYaw: number, actions?: string[]) {
  if (!mpConnected() || mpIsHost()) return
  send({
    t: 'input',
    id: localId,
    p: pawnPos ? [pawnPos.x, pawnPos.y, pawnPos.z] : undefined,
    ry: pawnYaw,
    actions,
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
  try {
    ws = new WebSocket(cfg.url)
  } catch (err) {
    status(`MP connect failed: ${(err as Error).message}`)
    return
  }
  ws.onopen = () => {
    send({ t: 'join', room: cfg.room, id: localId })
    status(`MP connected: ${cfg.room} as ${localId}${mpIsHost() ? ' (host)' : ''}`)
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
      applySyncProps(msg.aid, msg.props)
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
  if (worldRef) {
    for (const id of [...netSpawned]) {
      if (worldRef.actors.has(id)) worldRef.removeActor(id)
    }
  }
  netSpawned.clear()
  worldRef = null
}

export function mpTick(dt: number, pawnPos: THREE.Vector3 | null, pawnYaw: number) {
  if (!ws || ws.readyState !== 1 || !worldRef) return

  // smooth peer ghosts toward their network targets
  for (const p of peers.values()) {
    p.ghost.position.lerp(p.target, Math.min(1, 12 * dt))
    if (performance.now() - p.lastSeen > 5000) {
      p.ghost.removeFromParent()
      peers.delete(p.id)
      knownPeerIds.delete(p.id)
    }
  }

  // clients interpolate replicated actor transforms
  if (!mpIsHost()) {
    for (const [aid, state] of remoteSync) {
      const actor = worldRef.actors.get(aid)
      if (!actor) {
        remoteSync.delete(aid)
        continue
      }
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

  // pawn co-presence @ 10 Hz
  if (pawnPos) {
    if (mpIsHost()) {
      send({ t: 'pose', id: localId, p: [pawnPos.x, pawnPos.y, pawnPos.z], ry: pawnYaw })
    } else {
      mpSendInput(pawnPos, pawnYaw)
    }
  }

  // host broadcasts property deltas for actors with syncProperties
  if (!mpIsHost()) return
  for (const actor of worldRef.actors.values()) {
    const keys = actor.syncProperties
    if (!keys?.length) continue
    const props = packSyncProps(actor, keys)
    if (Object.keys(props).length) send({ t: 'sync', id: localId, aid: actor.id, props })
  }
}

export function mpPeerCount(): number {
  return peers.size
}