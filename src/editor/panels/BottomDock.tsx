import { useEditor, type BottomTab } from '../store'
import { ContentBrowser } from './ContentBrowser'
import { ScriptEditor } from './ScriptEditor'
import { BlueprintEditor } from './BlueprintEditor'
import { Sequencer } from './Sequencer'
import { Console } from './Console'
import { AIChat } from './AIChat'
import { DebugPanel } from './DebugPanel'

const TABS: Array<{ id: BottomTab; label: string }> = [
  { id: 'content', label: '🗄 Content' },
  { id: 'script', label: '𝒇 Script' },
  { id: 'blueprint', label: '⬡ Blueprint' },
  { id: 'sequencer', label: '🎞 Sequencer' },
  { id: 'console', label: '>_ Console' },
  { id: 'ai', label: '✦ AI' },
  { id: 'debug', label: '📈 Debug' },
]

/** Bottom dock — Godot-style tabbed drawer under the viewport. */
export function BottomDock() {
  const open = useEditor((s) => s.contentBrowserOpen)
  const tab = useEditor((s) => s.bottomTab)
  const setTab = useEditor((s) => s.setBottomTab)
  const toggle = useEditor((s) => s.toggleContentBrowser)

  return (
    <div className={`bottom-dock ${open ? '' : 'closed'}`}>
      <div className="bottom-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={open && tab === t.id ? 'active' : ''}
            onClick={() => {
              if (open && tab === t.id) toggle()
              else setTab(t.id)
            }}
          >
            {t.label}
          </button>
        ))}
        <span className="bottom-tabs-spacer" />
        <button onClick={toggle} title={open ? 'Collapse' : 'Expand'}>
          {open ? '▾' : '▴'}
        </button>
      </div>
      {open && (
        <div className="bottom-body">
          {tab === 'content' && <ContentBrowser />}
          {tab === 'script' && <ScriptEditor />}
          {tab === 'blueprint' && <BlueprintEditor />}
          {tab === 'sequencer' && <Sequencer />}
          {tab === 'console' && <Console />}
          {tab === 'ai' && <AIChat />}
          {tab === 'debug' && <DebugPanel />}
        </div>
      )}
    </div>
  )
}
