import { spawn, type ChildProcess } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test as base } from '@playwright/test'
import WebSocket from 'ws'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
export const RELAY_PORT = 24690
export const RELAY_URL = `ws://127.0.0.1:${RELAY_PORT}`

let relayProc: ChildProcess | null = null
let relayStartedByTest = false

function portFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', () => resolve(false))
    srv.once('listening', () => srv.close(() => resolve(true)))
    srv.listen(port, '127.0.0.1')
  })
}

async function relayReachable(port: number, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      await new Promise<void>((resolve, reject) => {
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

/** Start relay subprocess if port is free; reuse existing listener when already bound. */
export async function ensureRelay(): Promise<boolean> {
  const free = await portFree(RELAY_PORT)
  if (free) {
    relayProc = spawn('node', ['scripts/relay.mjs', String(RELAY_PORT)], {
      cwd: root,
      stdio: 'pipe',
    })
    relayStartedByTest = true
    relayProc.on('exit', () => {
      relayProc = null
      relayStartedByTest = false
    })
    const ready = await relayReachable(RELAY_PORT, 8000)
    if (!ready) {
      relayProc.kill()
      relayProc = null
      relayStartedByTest = false
      return false
    }
    return true
  }
  return relayReachable(RELAY_PORT, 2000)
}

export function stopRelayIfStarted() {
  if (relayStartedByTest && relayProc) {
    relayProc.kill()
    relayProc = null
    relayStartedByTest = false
  }
}

type RelayFixtures = {
  relayAvailable: boolean
  relayUrl: string
}

export const test = base.extend<RelayFixtures>({
  relayAvailable: async ({}, use) => {
    const ok = await ensureRelay()
    await use(ok)
  },
  relayUrl: async ({ relayAvailable }, use) => {
    await use(relayAvailable ? RELAY_URL : '')
  },
})

test.afterAll(() => {
  stopRelayIfStarted()
})