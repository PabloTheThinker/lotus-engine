import { useEffect, useRef, useState } from 'react'
import {
  chat,
  executeAICommands,
  extractCommands,
  loadAISettings,
  saveAISettings,
  type AISettings,
  type ChatMessage,
} from '../ai'
import { useEditor } from '../store'

interface DisplayMessage extends ChatMessage {
  actions?: string[]
}

/**
 * AI copilot chatbar — talk to a model that sees the scene and edits it.
 * Every action it takes routes through the undo stack (Ctrl+Z reverts AI work).
 */
export function AIChat() {
  const [settings, setSettings] = useState<AISettings>(loadAISettings)
  const [showSettings, setShowSettings] = useState(false)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const bodyRef = useRef<HTMLDivElement>(null)
  const setStatus = useEditor((s) => s.setStatus)

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const updateSettings = (patch: Partial<AISettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    saveAISettings(next)
  }

  const send = async () => {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    const history: ChatMessage[] = [...messages.map(({ role, content }) => ({ role, content })), { role: 'user', content: text }]
    setMessages((m) => [...m, { role: 'user', content: text }])
    setBusy(true)
    try {
      const reply = await chat(history, settings)
      const commands = extractCommands(reply)
      const actions = commands.length ? executeAICommands(commands) : undefined
      const prose = reply.replace(/```(?:vektra|json)[\s\S]*?```/g, '').replace(/<think>[\s\S]*?<\/think>/g, '').trim()
      setMessages((m) => [...m, { role: 'assistant', content: prose || '(commands only)', actions }])
      if (actions?.length) setStatus(`AI: ${actions.join(' · ')}`)
    } catch (err) {
      setMessages((m) => [...m, { role: 'assistant', content: `⚠ ${(err as Error).message}` }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ai-chat">
      <div className="ai-header">
        <span>
          ✦ Copilot — {settings.provider === 'ollama' ? `Ollama · ${settings.ollamaModel}` : `Anthropic · ${settings.anthropicModel}`}
        </span>
        <button onClick={() => setShowSettings(!showSettings)}>{showSettings ? '✕' : '⚙'}</button>
      </div>
      {showSettings && (
        <div className="ai-settings">
          <label className="field">
            <span>Provider</span>
            <select value={settings.provider} onChange={(e) => updateSettings({ provider: e.target.value as AISettings['provider'] })}>
              <option value="ollama">Ollama (local)</option>
              <option value="anthropic">Anthropic</option>
            </select>
          </label>
          {settings.provider === 'ollama' ? (
            <>
              <label className="field">
                <span>URL</span>
                <input value={settings.ollamaUrl} onChange={(e) => updateSettings({ ollamaUrl: e.target.value })} placeholder="/ollama or http://parallax:11434" />
              </label>
              <label className="field">
                <span>Model</span>
                <input value={settings.ollamaModel} onChange={(e) => updateSettings({ ollamaModel: e.target.value })} />
              </label>
            </>
          ) : (
            <>
              <label className="field">
                <span>API Key</span>
                <input type="password" value={settings.anthropicKey} onChange={(e) => updateSettings({ anthropicKey: e.target.value })} placeholder="sk-ant-…" />
              </label>
              <label className="field">
                <span>Model</span>
                <input value={settings.anthropicModel} onChange={(e) => updateSettings({ anthropicModel: e.target.value })} />
              </label>
            </>
          )}
        </div>
      )}
      <div className="ai-body" ref={bodyRef}>
        {messages.length === 0 && (
          <div className="panel-empty">
            Ask the copilot to build, restyle, script, or explain the scene. It sees every actor and acts through the undo stack — Ctrl+Z reverts anything it does.
            <br />
            <br />
            Try: <em>"build a small village of colored houses with a warm sunset"</em> · <em>"make the crates explode outward when play starts"</em> · <em>"add a rotating golden torus above the pyramid"</em>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`ai-msg ${m.role}`}>
            <div className="ai-msg-text">{m.content}</div>
            {m.actions && (
              <div className="ai-msg-actions">
                {m.actions.map((a, j) => (
                  <span key={j} className={a.startsWith('✗') ? 'failed' : ''}>{a}</span>
                ))}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="ai-msg assistant"><div className="ai-msg-text thinking">thinking…</div></div>}
      </div>
      <div className="ai-input">
        <input
          value={input}
          disabled={busy}
          placeholder="Tell the engine what to build…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') send()
          }}
        />
        <button onClick={send} disabled={busy || !input.trim()}>
          {busy ? '…' : '➤'}
        </button>
      </div>
    </div>
  )
}
