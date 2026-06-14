/**
 * MP lobby state — room browser + ready-up before deathmatch (Wave 53).
 * Peers mirror relay room membership; ready map tracks per-peer ready flags.
 */

import { mpSpectatorPlayingPeerFilter } from './mpSpectator'

let peers: string[] = []
const ready = new Map<string, boolean>()
let started = false

export function mpLobbyReset(localId?: string) {
  peers = localId ? [localId] : []
  ready.clear()
  started = false
  if (localId) ready.set(localId, false)
}

export function mpLobbyMarkStarted() {
  started = true
}

export function mpLobbyIsStarted(): boolean {
  return started
}

export function mpLobbyAddPeer(id: string) {
  if (!id || peers.includes(id)) return
  peers.push(id)
  if (!ready.has(id)) ready.set(id, false)
}

export function mpLobbyRemovePeer(id: string) {
  peers = peers.filter((p) => p !== id)
  ready.delete(id)
}

/** All peers in the lobby room (includes local id when connected). */
export function mpLobbyPeers(): string[] {
  return [...peers].sort()
}

export function setReady(peerId: string, value: boolean) {
  ready.set(peerId, value)
}

export function mpLobbyIsReady(peerId: string): boolean {
  return ready.get(peerId) === true
}

/** True when at least two playing (non-spectator) peers are present and every one is ready. */
export function allReady(): boolean {
  const playing = mpSpectatorPlayingPeerFilter(peers)
  if (playing.length < 2) return false
  for (const id of playing) {
    if (!ready.get(id)) return false
  }
  return true
}

export function mpLobbyPeerReadyCount(): number {
  let n = 0
  for (const id of mpSpectatorPlayingPeerFilter(peers)) {
    if (ready.get(id)) n++
  }
  return n
}