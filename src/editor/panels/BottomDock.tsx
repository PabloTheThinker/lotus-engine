import { getPluginPanels } from '../plugins'
import { useEditor, type BottomTab } from '../store'
import { ContentDrawer } from './ContentDrawer'
import { PluginPanelView } from './PluginPanelView'
import { ScriptEditor } from './ScriptEditor'
import { BlueprintEditor } from './BlueprintEditor'
import { Sequencer } from './Sequencer'
import { Console } from './Console'
import { AIChat } from './AIChat'
import { DebugPanel } from './DebugPanel'
import { MaterialEditor } from './MaterialEditor'
import { AnimStateEditor } from './AnimStateEditor'
import { MetaSoundEditor } from './MetaSoundEditor'
import { PCGEditor } from './PCGEditor'
import { BTEditor } from './BTEditor'
import { DataTableEditor } from './DataTableEditor'

const TABS: Array<{ id: BottomTab; label: string }> = [
  { id: 'content', label: '🗄 Content' },
  { id: 'script', label: '𝒇 Script' },
  { id: 'blueprint', label: '⬡ Blueprint' },
  { id: 'bt', label: '🌳 BT' },
  { id: 'data', label: '📊 Data' },
  { id: 'material', label: '⚛ Material' },
  { id: 'metasound', label: '♪ MetaSound' },
  { id: 'anim', label: '🎬 Anim' },
  { id: 'sequencer', label: '🎞 Sequencer' },
  { id: 'console', label: '>_ Console' },
  { id: 'ai', label: '✦ AI' },
  { id: 'debug', label: '📈 Debug' },
  { id: 'pcg', label: '🎲 PCG' },
]

function pluginTabId(panelId: string): BottomTab {
  return `plugin:${panelId}`
}

/** Bottom dock — Godot-style tabbed drawer under the viewport. */
export function BottomDock() {
  const open = useEditor((s) => s.contentBrowserOpen)
  const tab = useEditor((s) => s.bottomTab)
  const setTab = useEditor((s) => s.setBottomTab)
  const toggle = useEditor((s) => s.toggleContentBrowser)
  const docked = useEditor((s) => s.contentDrawerDocked)
  const openDrawer = useEditor((s) => s.openContentDrawer)
  useEditor((s) => s.sceneVersion)
  const pluginTabs = getPluginPanels().map((p) => ({ id: pluginTabId(p.id), label: p.title, panelId: p.id }))

  const selectTab = (id: BottomTab) => {
    if (id === 'content' && !docked) {
      openDrawer()
      return
    }
    if (open && tab === id) toggle()
    else setTab(id)
  }

  return (
    <div className={`bottom-dock ${open ? '' : 'closed'}`}>
      <div className="bottom-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={open && tab === t.id ? 'active' : ''}
            onClick={() => selectTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        {pluginTabs.map((t) => (
          <button
            key={t.id}
            className={open && tab === t.id ? 'active' : ''}
            onClick={() => selectTab(t.id)}
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
          {tab === 'content' && docked && <ContentDrawer />}
          {tab === 'script' && <ScriptEditor />}
          {tab === 'blueprint' && <BlueprintEditor />}
          {tab === 'bt' && <BTEditor />}
          {tab === 'data' && <DataTableEditor />}
          {tab === 'material' && <MaterialEditor />}
          {tab === 'metasound' && <MetaSoundEditor />}
          {tab === 'anim' && <AnimStateEditor />}
          {tab === 'sequencer' && <Sequencer />}
          {tab === 'console' && <Console />}
          {tab === 'ai' && <AIChat />}
          {tab === 'debug' && <DebugPanel />}
          {tab === 'pcg' && <PCGEditor />}
          {tab.startsWith('plugin:') && <PluginPanelView panelId={tab.slice('plugin:'.length)} />}
        </div>
      )}
    </div>
  )
}
