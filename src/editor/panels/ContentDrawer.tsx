import { useEditor } from '../store'
import { ContentBrowser } from './ContentBrowser'

/** UE Content Drawer chrome — pin button + browser body. */
export function ContentDrawer({ floating = false }: { floating?: boolean }) {
  const docked = useEditor((s) => s.contentDrawerDocked)
  const toggleDock = useEditor((s) => s.toggleContentDrawerDocked)
  const close = useEditor((s) => s.closeContentDrawer)

  return (
    <div className={`content-drawer ${floating ? 'floating' : 'docked'}`} data-floating={floating || undefined}>
      <div className="content-drawer-header">
        <span className="content-drawer-title">Content Drawer</span>
        <span className="content-drawer-actions">
          <button
            type="button"
            className={`content-drawer-pin ${docked ? 'active' : ''}`}
            title={docked ? 'Undock — summon with Ctrl+Space' : 'Dock in Layout'}
            onClick={toggleDock}
          >
            📌 {docked ? 'Docked' : 'Dock in Layout'}
          </button>
          {floating && (
            <button type="button" className="content-drawer-close" title="Close (click outside)" onClick={close}>
              ✕
            </button>
          )}
        </span>
      </div>
      <ContentBrowser />
    </div>
  )
}

/** Floating overlay summoned by Ctrl+Space when unpinned. */
export function FloatingContentDrawer() {
  const open = useEditor((s) => s.contentDrawerOpen)
  const docked = useEditor((s) => s.contentDrawerDocked)
  if (docked || !open) return null
  return (
    <div className="content-drawer-overlay" onMouseDown={(e) => e.stopPropagation()}>
      <ContentDrawer floating />
    </div>
  )
}