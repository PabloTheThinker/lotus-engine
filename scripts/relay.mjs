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
     despawn { t:'despawn', id, aid }         — host removes replicated actor */
import { WebSocketServer } from 'ws'

const port = Number(process.argv[2] ?? 24690)
const wss = new WebSocketServer({ port })
const rooms = new Map() // room → Set<ws>

wss.on('connection', (ws) => {
  let room = null
  let id = null
  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
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
      peers.add(ws)
      ws._vid = id
      console.log(`[relay] ${id} joined ${room} (${peers.size} peers)`)
      return
    }
    if (!room) return
    // broadcast to everyone else in the room
    for (const peer of rooms.get(room) ?? []) {
      if (peer !== ws && peer.readyState === 1) peer.send(raw.toString())
    }
  })
  ws.on('close', () => {
    if (room && rooms.has(room)) {
      rooms.get(room).delete(ws)
      // notify peers of departure
      for (const peer of rooms.get(room)) {
        if (peer.readyState === 1) peer.send(JSON.stringify({ t: 'leave', id }))
      }
      console.log(`[relay] ${id} left ${room}`)
    }
  })
})

console.log(`[relay] Vektra multiplayer relay on ws://0.0.0.0:${port}`)
