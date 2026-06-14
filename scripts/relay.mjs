#!/usr/bin/env node
/* Vektra multiplayer relay — room-based WebSocket broadcast.
   Usage: node scripts/relay.mjs [port]   (default 24690)
   Message types (JSON, relay forwards verbatim):
     join    { t:'join', room, id }           — join a room
     leave   { t:'leave', id }                — emitted on disconnect
     pose    { t:'pose', id, p:[x,y,z], ry }  — host pawn co-presence
     input   { t:'input', id, p?, ry? }       — client pawn uplink
     sync    { t:'sync', id, aid, props }     — host property deltas (10 Hz)
     spawn   { t:'spawn', id, actor }         — host spawner replication
     despawn { t:'despawn', id, aid }         — host removes replicated actor
     lobby_join  { t:'lobby_join', id, ready? }  — lobby peer announce
     lobby_ready { t:'lobby_ready', id, ready }  — ready-up toggle
     lobby_start { t:'lobby_start', id }         — host starts match
     spectator_join { t:'spectator_join', id }   — observe without pawn/input
     list_rooms  { t:'list_rooms' }              — returns active room registry
     ping    { t:'ping', ts }                    — relay pong echo for RTT
     rooms   { t:'rooms', rooms:[{room,peers}] } — list_rooms / registry snapshot
     room_registry { t:'room_registry', rooms }  — broadcast on join/leave
     pong    { t:'pong', ts }                    — ping reply */
import { WebSocketServer } from 'ws'

const port = Number(process.argv[2] ?? 24690)
const wss = new WebSocketServer({ port })
const rooms = new Map() // room → Set<ws>
const clients = new Set()

function roomRegistry() {
  const out = []
  for (const [name, peers] of rooms) {
    if (peers.size > 0) out.push({ room: name, peers: peers.size })
  }
  return out.sort((a, b) => a.room.localeCompare(b.room))
}

function broadcastRegistry() {
  const payload = JSON.stringify({ t: 'room_registry', rooms: roomRegistry() })
  for (const peer of clients) {
    if (peer.readyState === 1) peer.send(payload)
  }
}

wss.on('connection', (ws) => {
  let room = null
  let id = null
  clients.add(ws)

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (msg.t === 'list_rooms') {
      ws.send(JSON.stringify({ t: 'rooms', rooms: roomRegistry() }))
      return
    }
    if (msg.t === 'ping') {
      ws.send(JSON.stringify({ t: 'pong', ts: msg.ts }))
      return
    }
    if (msg.t === 'join') {
      room = String(msg.room ?? 'default')
      id = String(msg.id ?? Math.random().toString(36).slice(2))
      if (!rooms.has(room)) rooms.set(room, new Set())
      const peers = rooms.get(room)
      // notify existing peers so host election can converge quickly
      for (const peer of peers) {
        if (peer !== ws && peer.readyState === 1) {
          peer.send(JSON.stringify({ t: 'join', room, id }))
        }
      }
      // tell the new joiner about peers already in the room (lobby browser sync)
      for (const peer of peers) {
        if (peer !== ws && peer.readyState === 1 && peer._vid) {
          ws.send(JSON.stringify({ t: 'join', room, id: peer._vid }))
        }
      }
      peers.add(ws)
      ws._vid = id
      console.log(`[relay] ${id} joined ${room} (${peers.size} peers)`)
      broadcastRegistry()
      return
    }
    if (!room) return
    // broadcast to everyone else in the room
    for (const peer of rooms.get(room) ?? []) {
      if (peer !== ws && peer.readyState === 1) peer.send(raw.toString())
    }
  })
  ws.on('close', () => {
    clients.delete(ws)
    if (room && rooms.has(room)) {
      rooms.get(room).delete(ws)
      // notify peers of departure
      for (const peer of rooms.get(room)) {
        if (peer.readyState === 1) peer.send(JSON.stringify({ t: 'leave', id }))
      }
      if (rooms.get(room).size === 0) rooms.delete(room)
      console.log(`[relay] ${id} left ${room}`)
      broadcastRegistry()
    }
  })
})

console.log(`[relay] Vektra multiplayer relay on ws://0.0.0.0:${port}`)