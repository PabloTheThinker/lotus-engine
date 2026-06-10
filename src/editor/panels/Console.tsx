import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { world } from '../../engine/World'
import { makeScriptApi } from '../../engine/scripting'
import { useEditor } from '../store'

/**
 * Console — output log + a live JS command line (the UE ~ console analog).
 * Evaluates with world, api, THREE in scope.
 */
export function Console() {
  const entries = useEditor((s) => s.consoleEntries)
  const push = useEditor((s) => s.pushConsole)
  const clear = useEditor((s) => s.clearConsole)
  const touch = useEditor((s) => s.touch)
  const [cmd, setCmd] = useState('')
  const [histIdx, setHistIdx] = useState(-1)
  const history = useRef<string[]>([])
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight })
  }, [entries])

  const run = () => {
    const source = cmd.trim()
    if (!source) return
    push('cmd', `> ${source}`)
    history.current.push(source)
    setHistIdx(-1)
    setCmd('')
    try {
      const api = makeScriptApi(world.actors, () => world.playClock)
      const fn = new Function('world', 'api', 'THREE', `"use strict"; return (${source})`)
      let result: unknown
      try {
        result = fn(world, api, THREE)
      } catch {
        // not an expression — run as statements
        const stmt = new Function('world', 'api', 'THREE', `"use strict"; ${source}`)
        result = stmt(world, api, THREE)
      }
      if (result !== undefined) {
        push('log', typeof result === 'object' ? JSON.stringify(result, null, 1)?.slice(0, 500) ?? String(result) : String(result))
      }
      touch()
    } catch (err) {
      push('error', (err as Error).message)
    }
  }

  return (
    <div className="console">
      <div className="console-body" ref={bodyRef}>
        {entries.length === 0 && (
          <div className="panel-empty">
            Output log + JS command line. In scope: world, api, THREE. Try: world.actors.size
          </div>
        )}
        {entries.map((e, i) => (
          <div key={i} className={`console-line ${e.level}`}>
            {e.message}
          </div>
        ))}
      </div>
      <div className="console-input">
        <span>&gt;_</span>
        <input
          value={cmd}
          placeholder="world.actors.size"
          spellCheck={false}
          onChange={(e) => setCmd(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') run()
            if (e.key === 'ArrowUp') {
              const h = history.current
              const idx = histIdx === -1 ? h.length - 1 : Math.max(0, histIdx - 1)
              if (h[idx]) { setCmd(h[idx]); setHistIdx(idx) }
            }
            if (e.key === 'ArrowDown') {
              const h = history.current
              const idx = histIdx + 1
              if (idx >= h.length) { setCmd(''); setHistIdx(-1) }
              else { setCmd(h[idx]); setHistIdx(idx) }
            }
          }}
        />
        <button onClick={clear} title="Clear log">⌫</button>
      </div>
    </div>
  )
}
