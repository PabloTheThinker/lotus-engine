import * as THREE from 'three'

/**
 * MP spectator mode — observe match without spawning pawn (Wave 68).
 * Spectators announce via spectator_join; no pose/input uplink.
 */

const spectatorPeers = new Set<string>()
let localSpectator = false

export function mpSpectatorReset(localId?: string) {
  spectatorPeers.clear()
  localSpectator = false
  if (localId) spectatorPeers.delete(localId)
}

export function mpSpectatorSetLocal(enabled: boolean) {
  localSpectator = enabled
}

export function mpSpectatorIsLocal(): boolean {
  return localSpectator
}

/** Whether a peer (defaults to local) joined as spectator. */
export function mpIsSpectator(peerId?: string): boolean {
  if (!peerId) return localSpectator
  return spectatorPeers.has(peerId)
}

export function mpSpectatorMarkPeer(id: string) {
  if (id) spectatorPeers.add(id)
}

export function mpSpectatorUnmarkPeer(id: string) {
  spectatorPeers.delete(id)
}

export function mpSpectatorPeers(): string[] {
  return [...spectatorPeers].sort()
}

/** Non-spectator peers in the room (for lobby ready counts). */
export function mpSpectatorPlayingPeerFilter(peerIds: string[]): string[] {
  return peerIds.filter((id) => !spectatorPeers.has(id))
}

/** Default elevated orbit camera pose when no host pose is available yet. */
export function mpSpectatorDefaultSpawn(): THREE.Vector3 {
  return new THREE.Vector3(0, 8, 12)
}