/**
 * MP matchmaking — public room list + relay ping (Wave 58).
 * Room registry mirrors relay `room_registry` / `list_rooms`; ping uses Date.now roundtrip.
 */

export interface MpRoomEntry {
  room: string
  peers: number
}

let rooms: MpRoomEntry[] = []
let pingMs: number | null = null
let pendingPingTs: number | null = null
let statusSink: ((msg: string) => void) | null = null
let statusFormatter: (() => string) | null = null

export function mpMatchmakingReset() {
  rooms = []
  pingMs = null
  pendingPingTs = null
}

export function mpMatchmakingSetStatusSink(
  sink: ((msg: string) => void) | null,
  formatter: (() => string) | null = null,
) {
  statusSink = sink
  statusFormatter = formatter
}

function pushStatus() {
  if (statusSink && statusFormatter) statusSink(statusFormatter())
}

export function mpMatchmakingHandleMessage(msg: {
  t: string
  ts?: number
  rooms?: { room?: string; peers?: number }[]
}) {
  if ((msg.t === 'rooms' || msg.t === 'room_registry') && Array.isArray(msg.rooms)) {
    rooms = msg.rooms
      .map((r) => ({ room: String(r.room ?? ''), peers: Number(r.peers ?? 0) }))
      .filter((r) => r.room && r.peers > 0)
      .sort((a, b) => a.room.localeCompare(b.room))
    return true
  }
  if (msg.t === 'pong' && typeof msg.ts === 'number' && pendingPingTs === msg.ts) {
    pingMs = Math.max(0, Date.now() - msg.ts)
    pendingPingTs = null
    pushStatus()
    return true
  }
  return false
}

export function mpMatchmakingRequestRooms(send: (msg: object) => void) {
  send({ t: 'list_rooms' })
}

export function mpMatchmakingPing(send: (msg: object) => void) {
  const ts = Date.now()
  pendingPingTs = ts
  send({ t: 'ping', ts })
}

export function mpMatchmakingListRooms(): MpRoomEntry[] {
  return rooms.map((r) => ({ ...r }))
}

export function mpMatchmakingPingMs(): number | null {
  return pingMs
}