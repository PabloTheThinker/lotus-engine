import { useEditor } from './store'
import { terminalExec } from './terminal'

interface BridgeMessage {
  type: string
  id?: string
  source?: string
  role?: string
  level?: string
  message?: string
  output?: string | null
  error?: string | null
}

/**
 * Dev-only WebSocket bridge — lets the external `npm run lotus` CLI drive the live editor.
 */
export function connectTerminalBridge(): () => void {
  if (!import.meta.env.DEV) return () => {}

  const port = import.meta.env.VITE_LOTUS_TERMINAL_PORT ?? '24679'
  const wsUrl = `ws://127.0.0.1:${port}`

  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let lastLogLen = 0

  const setConnected = (v: boolean) => {
    useEditor.getState().setBridgeConnected(v)
    if (v) useEditor.getState().setStatus(`Terminal bridge · ${wsUrl}`)
  }

  const send = (msg: BridgeMessage) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
  }

  const connect = () => {
    if (disposed) return
    ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      send({ type: 'register', role: 'editor' })
      setConnected(true)
      lastLogLen = useEditor.getState().consoleEntries.length
    }

    ws.onmessage = (ev) => {
      let msg: BridgeMessage
      try {
        msg = JSON.parse(ev.data as string) as BridgeMessage
      } catch {
        return
      }
      if (msg.type === 'exec' && msg.id && msg.source !== undefined) {
        const result = terminalExec(msg.source)
        ws?.send(
          JSON.stringify({
            type: 'result',
            id: msg.id,
            output: result.output,
            error: result.error,
            level: result.level,
          }),
        )
      }
    }

    ws.onclose = () => {
      setConnected(false)
      ws = null
      if (!disposed) reconnectTimer = setTimeout(connect, 2000)
    }

    ws.onerror = () => ws?.close()
  }

  const unsub = useEditor.subscribe((state) => {
    const entries = state.consoleEntries
    if (entries.length <= lastLogLen || ws?.readyState !== WebSocket.OPEN) return
    for (let i = lastLogLen; i < entries.length; i++) {
      const e = entries[i]
      if (e.level === 'cmd') continue
      send({ type: 'log', level: e.level, message: e.message })
    }
    lastLogLen = entries.length
  })

  connect()

  return () => {
    disposed = true
    if (reconnectTimer) clearTimeout(reconnectTimer)
    unsub()
    ws?.close()
    setConnected(false)
  }
}