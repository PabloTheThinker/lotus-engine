import * as THREE from 'three'
import type { World } from './World'

/**
 * Multiplayer — Godot MultiplayerSynchronizer-lite over a WebSocket relay
 * (scripts/relay.mjs). During Play: broadcasts the local pawn transform at
 * 10 Hz; remote peers render as ghost pawns. Co-presence v1 — actor
 * replication rides the same channel later.
 */

interface Peer {
  id: string
  ghost: THREE.Group
  lastSeen: number
  target: THREE.Vector3
}

let ws: WebSocket | null = null
let peers = new Map<string, Peer>()
let localId = ''
let sendAcc = 0
let worldRef: World | null = null

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

export function mpConnect(world: World, status: (msg: string) => void) {
  const cfg = loadMPSettings()
  if (!cfg.enabled || ws) return
  worldRef = world
  localId = Math.random().toString(36).slice(2, 8)
  try {
    ws = new WebSocket(cfg.url)
  } catch (err) {
    status(`MP connect failed: ${(err as Error).message}`)
    return
  }
  ws.onopen = () => {
    ws?.send(JSON.stringify({ t: 'join', room: cfg.room, id: localId }))
    status(`MP connected: ${cfg.room} as ${localId}`)
  }
  ws.onerror = () => status('MP: relay unreachable')
  ws.onmessage = (ev) => {
    let msg: { t: string; id: string; p?: [number, number, number]; ry?: number }
    try {
      msg = JSON.parse(String(ev.data))
    } catch {
      return
    }
    if (msg.t === 'leave') {
      const peer = peers.get(msg.id)
      if (peer) {
        peer.ghost.removeFromParent()
        peers.delete(msg.id)
      }
      return
    }
    if (msg.t === 'pose' && msg.id !== localId && msg.p && worldRef) {
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
  worldRef = null
}

export function mpTick(dt: number, pawnPos: THREE.Vector3 | null, pawnYaw: number) {
  if (!ws || ws.readyState !== 1) return
  // smooth peer ghosts toward their network targets
  for (const p of peers.values()) {
    p.ghost.position.lerp(p.target, Math.min(1, 12 * dt))
    if (performance.now() - p.lastSeen > 5000) {
      p.ghost.removeFromParent()
      peers.delete(p.id)
    }
  }
  // broadcast local pose at 10 Hz
  sendAcc += dt
  if (sendAcc >= 0.1 && pawnPos) {
    sendAcc = 0
    ws.send(JSON.stringify({ t: 'pose', id: localId, p: [pawnPos.x, pawnPos.y, pawnPos.z], ry: pawnYaw }))
  }
}

export function mpPeerCount(): number {
  return peers.size
}
