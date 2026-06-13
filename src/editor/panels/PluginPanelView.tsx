import { useEffect, useRef } from 'react'
import { getPluginPanelCallback } from '../plugins'

/** Mounts a plugin panel via its registerPanelCallback DOM renderer. */
export function PluginPanelView({ panelId }: { panelId: string }) {
  const hostRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    host.innerHTML = ''
    const render = getPluginPanelCallback(panelId)
    if (!render) {
      host.innerHTML = '<div class="panel-empty">Panel callback not registered.</div>'
      return
    }
    const cleanup = render(host)
    return () => {
      if (typeof cleanup === 'function') cleanup()
      host.innerHTML = ''
    }
  }, [panelId])

  return <div className="plugin-panel-host" ref={hostRef} />
}