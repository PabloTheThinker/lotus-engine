#!/usr/bin/env node
/* Vektra MP dedicated server — headless relay host for LAN parties (Wave 63).
   Spawns scripts/relay.mjs, joins as authoritative host peer (id 000000), logs joins.

   Usage:
     npm run dedicated
     npm run dedicated -- --port 24690 --room lan-party
     node scripts/dedicated-server.mjs [port] [--room name]

   Clients: World Settings → Relay URL ws://<host-ip>:<port>, same room, Dedicated server OFF. */
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const DEDICATED_HOST_ID = '000000'
const DEFAULT_PORT = 24690
const DEFAULT_ROOM = 'default'

function parseArgs(argv) {
  let port = DEFAULT_PORT
  let room = DEFAULT_ROOM
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--port' && argv[i + 1]) {
      port = Number(argv[++i]) || DEFAULT_PORT
      continue
    }
    if (arg === '--room' && argv[i + 1]) {
      room = String(argv[++i])
      continue
    }
    if (/^\d+$/.test(arg)) port = Number(arg)
  }
  return { port, room }
}

function portFree(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

async function relayReachable(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`)
        ws.once('open', () => {
          ws.close()
          resolve()
        })
        ws.once('error', reject)
      })
      return true
    } catch {
      await new Promise((r) => setTimeout(r, 100))
    }
  }
  return false
}

function startRelay(port) {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', ['scripts/relay.mjs', String(port)], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let booted = false
    const onData = (chunk) => {
      const text = chunk.toString()
      process.stdout.write(text)
      if (!booted && text.includes('[relay]')) {
        booted = true
        resolve(proc)
      }
    }
    proc.stdout.on('data', onData)
    proc.stderr.on('data', (chunk) => process.stderr.write(chunk))
    proc.once('error', reject)
    proc.once('exit', (code) => {
      if (!booted) reject(new Error(`relay exited before ready (code ${code ?? 'unknown'})`))
    })
    setTimeout(() => {
      if (!booted) resolve(proc)
    }, 3000)
  })
}

function connectHeadlessHost(port, room) {
  const url = `ws://127.0.0.1:${port}`
  const ws = new WebSocket(url)
  const peers = new Set()

  ws.on('open', () => {
    ws.send(JSON.stringify({ t: 'join', room, id: DEDICATED_HOST_ID }))
    ws.send(JSON.stringify({ t: 'lobby_join', id: DEDICATED_HOST_ID, ready: true }))
    console.log(`[dedicated] authoritative host ${DEDICATED_HOST_ID} in room "${room}" @ ${url}`)
    console.log(`[dedicated] clients → Relay URL ${url.replace('127.0.0.1', '<lan-ip>')} · room "${room}"`)
  })

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }
    if (msg.t === 'join' && msg.id && msg.id !== DEDICATED_HOST_ID) {
      peers.add(msg.id)
      console.log(`[dedicated] peer joined: ${msg.id} (${peers.size} in room)`)
      return
    }
    if (msg.t === 'leave' && msg.id) {
      peers.delete(msg.id)
      console.log(`[dedicated] peer left: ${msg.id} (${peers.size} in room)`)
      return
    }
    if (msg.t === 'lobby_join' && msg.id && msg.id !== DEDICATED_HOST_ID) {
      console.log(`[dedicated] lobby peer: ${msg.id}${msg.ready ? ' (ready)' : ''}`)
    }
    if (msg.t === 'lobby_ready' && msg.id) {
      console.log(`[dedicated] lobby ready: ${msg.id} → ${msg.ready ? 'ready' : 'not ready'}`)
    }
    if (msg.t === 'lobby_start' && msg.id) {
      console.log(`[dedicated] match start requested by ${msg.id}`)
    }
  })

  ws.on('close', () => {
    console.log('[dedicated] headless host disconnected')
  })

  ws.on('error', (err) => {
    console.error(`[dedicated] host socket error: ${err.message}`)
  })

  return ws
}

async function main() {
  const { port, room } = parseArgs(process.argv)
  const free = await portFree(port)
  if (!free) {
    console.error(`[dedicated] port ${port} already in use — stop the other relay or pass --port`)
    process.exit(1)
  }

  console.log(`[dedicated] starting relay on ws://0.0.0.0:${port} (room "${room}")`)
  const relayProc = await startRelay(port)
  const ready = await relayReachable(port)
  if (!ready) {
    relayProc.kill()
    console.error('[dedicated] relay failed to accept connections')
    process.exit(1)
  }

  const hostWs = connectHeadlessHost(port, room)

  const shutdown = () => {
    console.log('[dedicated] shutting down…')
    hostWs.close()
    relayProc.kill()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch((err) => {
  console.error(`[dedicated] fatal: ${err.message}`)
  process.exit(1)
})