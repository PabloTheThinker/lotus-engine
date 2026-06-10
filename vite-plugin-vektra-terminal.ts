/**
 * Vite dev plugin — dedicated WebSocket bridge for external CLI control.
 * Writes `.vektra-dev.json` once the socket is actually listening.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { Plugin } from 'vite'
import { WebSocket, WebSocketServer } from 'ws'

export const VEKTRA_TERMINAL_PORT = Number(process.env.VEKTRA_TERMINAL_PORT ?? 24679)
const MANIFEST = '.vektra-dev.json'

interface PendingExec {
  shell: WebSocket
  timer: ReturnType<typeof setTimeout>
}

interface WireMessage {
  type: string
  id?: string
  source?: string
  role?: string
  output?: string | null
  error?: string | null
  level?: string
  message?: string
  connected?: boolean
}

export function vektraTerminalPlugin(): Plugin {
  return {
    name: 'vektra-terminal',
    config() {
      return {
        define: {
          'import.meta.env.VITE_VEKTRA_TERMINAL_PORT': JSON.stringify(String(VEKTRA_TERMINAL_PORT)),
        },
      }
    },
    configureServer(server) {
      const wss = new WebSocketServer({ host: '127.0.0.1', port: VEKTRA_TERMINAL_PORT })
      let editor: WebSocket | null = null
      const shells = new Set<WebSocket>()
      const pending = new Map<string, PendingExec>()

      const send = (ws: WebSocket, msg: WireMessage) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
      }

      const broadcastShells = (msg: WireMessage) => {
        for (const s of shells) send(s, msg)
      }

      const onEditorGone = () => {
        editor = null
        broadcastShells({ type: 'editor-status', connected: false })
        for (const [id, p] of pending) {
          send(p.shell, { type: 'result', id, error: 'Editor disconnected', level: 'error' })
          clearTimeout(p.timer)
          pending.delete(id)
        }
      }

      const writeManifest = () => {
        const wsUrl = `ws://127.0.0.1:${VEKTRA_TERMINAL_PORT}`
        fs.writeFileSync(
          path.join(process.cwd(), MANIFEST),
          JSON.stringify({ wsUrl, port: VEKTRA_TERMINAL_PORT }, null, 2),
        )
      }

      const removeManifest = () => {
        try {
          fs.unlinkSync(path.join(process.cwd(), MANIFEST))
        } catch {
          /* ok */
        }
      }

      wss.on('connection', (ws) => {
        ws.on('message', (raw) => {
          let msg: WireMessage
          try {
            msg = JSON.parse(raw.toString()) as WireMessage
          } catch {
            send(ws, { type: 'error', message: 'Invalid JSON' })
            return
          }

          if (msg.type === 'register' && msg.role === 'editor') {
            editor = ws
            send(ws, { type: 'welcome', message: 'Editor registered' })
            broadcastShells({ type: 'editor-status', connected: true })
            return
          }

          if (msg.type === 'register' && msg.role === 'shell') {
            shells.add(ws)
            send(ws, { type: 'welcome', message: 'Shell connected' })
            send(ws, { type: 'editor-status', connected: !!(editor && editor.readyState === WebSocket.OPEN) })
            return
          }

          if (msg.type === 'exec' && msg.id && msg.source !== undefined && shells.has(ws)) {
            if (!editor || editor.readyState !== WebSocket.OPEN) {
              send(ws, {
                type: 'result',
                id: msg.id,
                error: 'Editor not connected — open http://127.0.0.1:' + (server.config.server.port ?? 5173),
                level: 'error',
              })
              return
            }
            const timer = setTimeout(() => {
              const p = pending.get(msg.id!)
              if (p) {
                send(p.shell, { type: 'result', id: msg.id, error: 'Command timed out (30s)', level: 'error' })
                pending.delete(msg.id!)
              }
            }, 30_000)
            pending.set(msg.id, { shell: ws, timer })
            send(editor, { type: 'exec', id: msg.id, source: msg.source })
            return
          }

          if (msg.type === 'result' && msg.id && ws === editor) {
            const p = pending.get(msg.id)
            if (p) {
              clearTimeout(p.timer)
              pending.delete(msg.id)
              send(p.shell, msg)
            }
            return
          }

          if (msg.type === 'log' && ws === editor) {
            broadcastShells(msg)
          }
        })

        ws.on('close', () => {
          shells.delete(ws)
          if (ws === editor) onEditorGone()
        })
      })

      wss.on('listening', () => {
        writeManifest()
        server.config.logger.info(
          `  \x1b[36mvektra terminal\x1b[0m  ws://127.0.0.1:${VEKTRA_TERMINAL_PORT}  →  npm run vektra`,
          { timestamp: true },
        )
      })

      wss.on('error', (err) => {
        server.config.logger.error(`  vektra terminal failed: ${err.message}`, { timestamp: true })
      })

      return () => {
        wss.close()
        editor = null
        shells.clear()
        pending.clear()
        removeManifest()
      }
    },
  }
}