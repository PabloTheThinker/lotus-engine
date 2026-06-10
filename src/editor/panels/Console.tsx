import { useEffect, useRef, useState } from 'react'
import {
  applyCompletion,
  executeTerminalLine,
  loadTerminalHistory,
  saveTerminalHistory,
  TERMINAL_HELP,
  terminalCompletions,
} from '../terminal'
import { useEditor } from '../store'

/**
 * Console — operational in-editor terminal (UE Output Log + ~ console).
 * Slash commands, full JS REPL with editor API, history, tab completion.
 */
export function Console() {
  const entries = useEditor((s) => s.consoleEntries)
  const push = useEditor((s) => s.pushConsole)
  const clear = useEditor((s) => s.clearConsole)
  const consoleFocusNonce = useEditor((s) => s.consoleFocusNonce)
  const [cmd, setCmd] = useState('')
  const [histIdx, setHistIdx] = useState(-1)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const history = useRef<string[]>(loadTerminalHistory())
  const bodyRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const welcomed = useRef(false)

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [entries])

  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [consoleFocusNonce])

  useEffect(() => {
    if (!welcomed.current && entries.length === 0) {
      welcomed.current = true
      push('log', 'Vektra Terminal ready — type /help or `world.actors.size`')
    }
  }, [entries.length, push])

  const run = () => {
    const source = cmd.trim()
    if (!source) return
    push('cmd', `> ${source}`)
    history.current.push(source)
    saveTerminalHistory(history.current)
    setHistIdx(-1)
    setCmd('')
    setSuggestion(null)

    const result = executeTerminalLine(source)
    if (result.error) push('error', result.error)
    else if (result.output) push('log', result.output)
  }

  const showHelp = () => {
    push('log', TERMINAL_HELP)
  }

  return (
    <div className="console">
      <div className="console-toolbar">
        <span className="console-title">Terminal</span>
        <span className="console-hint">Enter run · Shift+Enter newline · Tab complete · ` focus</span>
        <button onClick={showHelp} title="Help (/help)">
          ?
        </button>
        <button onClick={clear} title="Clear log (/clear)">
          ⌫
        </button>
      </div>
      <div className="console-body" ref={bodyRef}>
        {entries.map((e, i) => (
          <div key={i} className={`console-line ${e.level}`}>
            {e.message}
          </div>
        ))}
      </div>
      <div className="console-input-wrap">
        {suggestion && <div className="console-suggestion">Tab → {suggestion}</div>}
        <div className="console-input">
          <span>&gt;_</span>
          <textarea
            ref={inputRef}
            rows={1}
            value={cmd}
            placeholder="world.actors.size  ·  /ls  ·  spawn('box')"
            spellCheck={false}
            onChange={(e) => {
              setCmd(e.target.value)
              const comps = terminalCompletions(e.target.value)
              setSuggestion(comps[0] ?? null)
            }}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                run()
                return
              }
              if (e.key === 'Tab') {
                e.preventDefault()
                const comps = terminalCompletions(cmd)
                if (comps[0]) {
                  setCmd(applyCompletion(cmd, comps[0]))
                  setSuggestion(comps[1] ?? null)
                }
                return
              }
              if (e.key === 'ArrowUp' && !e.shiftKey) {
                e.preventDefault()
                const h = history.current
                const idx = histIdx === -1 ? h.length - 1 : Math.max(0, histIdx - 1)
                if (h[idx]) {
                  setCmd(h[idx])
                  setHistIdx(idx)
                }
                return
              }
              if (e.key === 'ArrowDown' && !e.shiftKey) {
                e.preventDefault()
                const h = history.current
                const idx = histIdx + 1
                if (idx >= h.length) {
                  setCmd('')
                  setHistIdx(-1)
                } else {
                  setCmd(h[idx])
                  setHistIdx(idx)
                }
                return
              }
              if (e.key === 'Escape') {
                setSuggestion(null)
              }
            }}
          />
          <button className="console-run" onClick={run} title="Run (Enter)">
            ↵
          </button>
        </div>
      </div>
    </div>
  )
}