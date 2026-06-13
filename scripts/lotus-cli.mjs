#!/usr/bin/env node
/**
 * Lotus external terminal — drives the live editor over WebSocket while `npm run dev` runs.
 *
 * Usage:
 *   npm run lotus                  Interactive REPL
 *   npm run lotus -- exec "/ls"    One-shot command
 *   npm run lotus -- status        Check editor connection
 *   npm run lotus -- wait          Block until editor connects
 */
import { readFileSync, existsSync } from 'node:fs'
import readline from 'node:readline'
import { WebSocket } from 'ws'

const MANIFEST = '.lotus-dev.json'
const DEFAULT_PORT = Number(process.env.LOTUS_TERMINAL_PORT || 24679)

function resolveWsUrl() {
  if (process.env.LOTUS_TERMINAL_URL) return process.env.LOTUS_TERMINAL_URL
  if (existsSync(MANIFEST)) {
    try {
      const m = JSON.parse(readFileSync(MANIFEST, 'utf8'))
      if (m.wsUrl) return m.wsUrl
    } catch {
      /* fall through */
    }
  }
  return `ws://127.0.0.1:${DEFAULT_PORT}`
}

const HELP = `Lotus CLI — external terminal for the live editor

Usage:
  npm run lotus                     Interactive REPL
  npm run lotus -- exec "<cmd>"     Run one command and exit
  npm run lotus -- status           Show bridge + editor status
  npm run lotus -- wait [seconds]   Wait for editor (default 60s)
  npm run lotus -- help             This help

Requires: npm run dev (editor open in browser)
Bridge URL read from ${MANIFEST} (written by Vite on startup)

Commands match the in-editor terminal (/help, /ls, JS expressions).
Examples:
  npm run lotus -- exec "world.actors.size"
  npm run lotus -- exec "/select Ball"
  npm run lotus -- exec "/spawn sphere"
`

function connect(timeoutMs = 8000) {
  const URL = resolveWsUrl()
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL)
    const timer = setTimeout(() => {
      ws.terminate()
      reject(new Error(`Cannot connect to ${URL} — is npm run dev running?`))
    }, timeoutMs)
    ws.on('open', () => {
      clearTimeout(timer)
      ws.send(JSON.stringify({ type: 'register', role: 'shell' }))
      resolve({ ws, url: URL })
    })
    ws.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

function execRemote(ws, source, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    const timer = setTimeout(() => {
      ws.off('message', onMessage)
      reject(new Error('Command timed out'))
    }, timeoutMs)

    const onMessage = (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (msg.type === 'result' && msg.id === id) {
        clearTimeout(timer)
        ws.off('message', onMessage)
        resolve(msg)
      }
    }

    ws.on('message', onMessage)
    ws.send(JSON.stringify({ type: 'exec', id, source }))
  })
}

function waitForEditor(ws, timeoutMs = 60_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.off('message', onMessage)
      reject(new Error('Timed out waiting for editor'))
    }, timeoutMs)

    const onMessage = (raw) => {
      let msg
      try {
        msg = JSON.parse(raw.toString())
      } catch {
        return
      }
      if (msg.type === 'editor-status' && msg.connected) {
        clearTimeout(timer)
        ws.off('message', onMessage)
        resolve(true)
      }
    }

    ws.on('message', onMessage)
  })
}

function printResult(msg) {
  if (msg.error) {
    console.error(msg.error)
    return 1
  }
  if (msg.output) console.log(msg.output)
  return 0
}

async function cmdStatus() {
  const url = resolveWsUrl()
  try {
    const { ws } = await connect(3000)
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        console.log(`Bridge:  online (${url})`)
        console.log('Editor:  unknown (no status received)')
        ws.close()
        resolve(1)
      }, 2000)
      ws.on('message', (raw) => {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'editor-status') {
          clearTimeout(timer)
          console.log(`Bridge:  online (${url})`)
          console.log(`Editor:  ${msg.connected ? 'connected' : 'waiting — open the app in your browser'}`)
          ws.close()
          resolve(msg.connected ? 0 : 1)
        }
      })
    })
  } catch (err) {
    console.error(`Bridge:  offline (${url})`)
    console.error(err.message)
    return 1
  }
}

async function cmdWait(seconds = 60) {
  const { ws, url } = await connect()
  console.log(`Bridge: ${url}`)
  console.log(`Waiting for editor (up to ${seconds}s)…`)
  await waitForEditor(ws, seconds * 1000)
  console.log('Editor connected.')
  ws.close()
  return 0
}

async function cmdExec(source) {
  const { ws } = await connect()
  await waitForEditor(ws, 8000).catch(() => {
    throw new Error('Editor not connected — open the app in your browser first')
  })
  const result = await execRemote(ws, source)
  ws.close()
  return printResult(result)
}

async function repl() {
  const { ws, url } = await connect()
  let editorReady = false

  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString())
    if (msg.type === 'editor-status') editorReady = msg.connected
    if (msg.type === 'log' && msg.message) {
      const prefix = msg.level === 'error' ? '[error]' : msg.level === 'ai' ? '[ai]' : '[log]'
      process.stdout.write(`\r\x1b[2K${prefix} ${msg.message}\n`)
      rl?.prompt(true)
    }
  })

  console.log(`Lotus CLI → ${url}`)
  console.log('Waiting for editor…')

  try {
    await waitForEditor(ws, 120_000)
    console.log('Editor connected. Type /help or JS. Ctrl+C to exit.\n')
  } catch {
    console.warn('Editor not connected yet — commands will fail until you open the browser.')
  }

  let rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: 'vektra> ',
    terminal: true,
  })

  rl.prompt()

  rl.on('line', async (line) => {
    const source = line.trim()
    if (!source) {
      rl.prompt()
      return
    }
    if (source === '/exit' || source === '/quit') {
      ws.close()
      rl.close()
      return
    }
    if (!editorReady) {
      console.error('Editor not connected.')
      rl.prompt()
      return
    }
    try {
      const result = await execRemote(ws, source)
      printResult(result)
    } catch (err) {
      console.error(err.message)
    }
    rl.prompt()
  })

  rl.on('close', () => {
    ws.close()
    process.exit(0)
  })
}

const args = process.argv.slice(2)
const sub = args[0]

try {
  let code = 0
  if (!sub) code = await repl()
  else if (sub === 'help' || sub === '--help' || sub === '-h') {
    console.log(HELP)
  } else if (sub === 'status') {
    code = await cmdStatus()
  } else if (sub === 'wait') {
    code = await cmdWait(Number(args[1]) || 60)
  } else if (sub === 'exec') {
    const source = args.slice(1).join(' ')
    if (!source) {
      console.error('Usage: npm run lotus -- exec "<command>"')
      code = 1
    } else {
      code = await cmdExec(source)
    }
  } else {
    code = await cmdExec(args.join(' '))
  }
  process.exit(code)
} catch (err) {
  console.error(err.message)
  process.exit(1)
}