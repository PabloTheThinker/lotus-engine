import { useState } from 'react'
import type { Actor } from '../../engine/Actor'
import { world } from '../../engine/World'
import { AddActorCommand, DeleteActorCommand, PropertyCommand, ReparentCommand, runCommand } from '../commands'
import { isPrefabInstanceActor, runPrefabAwareCommand } from '../prefabs'
import { buildSerializedActor } from '../spawn'
import { useEditor } from '../store'

const TYPE_ICONS: Record<string, string> = {
  StaticMesh: '◼',
  ImportedMesh: '🧊',
  PointLight: '✦',
  SpotLight: '◬',
  DirectionalLight: '☀',
  AmbientLight: '◍',
  RectLight: '▤',
  Camera: '🎥',
  Label3D: '🏷',
  Widget3D: '🖥',
  PlayerStart: '🚩',
  ParticleEmitter: '✨',
  FoliageLayer: '🌿',
  Landscape: '⛰',
  TriggerVolume: '⏚',
  Timer: '⏱',
  RayCast3D: '↯',
  Path3D: '〰',
  PathFollow3D: '●',
  SoundEmitter: '♪',
  ReflectionProbe: '🔮',
  Water: '🌊',
  PCGVolume: '🎲',
  CustomMesh: '🗿',
  Empty: '◇',
  Folder: '📁',
  PostProcessVolume: '◫',
}

function matchesFilter(actor: Actor, query: string): boolean {
  if (!query) return true
  // UE Outliner operators: -term excludes, +term exact-matches, terms AND together
  const hay = [actor.name, actor.type, ...actor.tags].map((x) => x.toLowerCase())
  for (const raw of query.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (raw.startsWith('-')) {
      const t = raw.slice(1)
      if (t && hay.some((h) => h.includes(t))) return false
    } else if (raw.startsWith('+')) {
      const t = raw.slice(1)
      if (t && !hay.some((h) => h === t)) return false
    } else {
      if (!hay.some((h) => h.includes(raw))) return false
    }
  }
  return true
}

function subtreeMatches(actor: Actor, query: string): boolean {
  if (matchesFilter(actor, query)) return true
  return world.childrenOf(actor.id).some((c) => subtreeMatches(c, query))
}

function OutlinerRow({
  actor,
  depth,
  filter,
  collapsed,
  toggleCollapsed,
}: {
  actor: Actor
  depth: number
  filter: string
  collapsed: Set<string>
  toggleCollapsed: (id: string) => void
}) {
  const selectedId = useEditor((s) => s.selectedId)
  const selectedIds = useEditor((s) => s.selectedIds)
  const select = useEditor((s) => s.select)
  const toggleSelect = useEditor((s) => s.toggleSelect)
  const touch = useEditor((s) => s.touch)
  const [renaming, setRenaming] = useState(false)
  const children = world.childrenOf(actor.id)
  const isSelected = selectedIds.includes(actor.id)
  const isFolder = actor.type === 'Folder'
  const isCollapsed = collapsed.has(actor.id)

  if (!subtreeMatches(actor, filter)) return null

  return (
    <>
      <div
        className={`outliner-row ${isSelected ? 'selected' : ''} ${selectedId === actor.id ? 'primary' : ''} ${isFolder ? 'folder' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={(e) => (e.ctrlKey || e.metaKey ? toggleSelect(actor.id) : select(actor.id))}
        onDoubleClick={() => setRenaming(true)}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('lotus/actor', actor.id)}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('lotus/actor')) e.preventDefault()
        }}
        onDrop={(e) => {
          const dragged = e.dataTransfer.getData('lotus/actor')
          if (dragged && dragged !== actor.id) {
            e.stopPropagation()
            runCommand(new ReparentCommand(dragged, actor.id))
          }
        }}
      >
        {isFolder ? (
          <button
            className="outliner-fold"
            onClick={(e) => {
              e.stopPropagation()
              toggleCollapsed(actor.id)
            }}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
        ) : (
          <span className="outliner-fold-spacer" />
        )}
        <span className="outliner-icon">{TYPE_ICONS[actor.type] ?? '◇'}</span>
        {renaming ? (
          <input
            autoFocus
            defaultValue={actor.name}
            onBlur={(e) => {
              const next = e.target.value.trim()
              if (next && next !== actor.name) {
                const prev = actor.name
                if (isPrefabInstanceActor(actor.id)) {
                  runPrefabAwareCommand(
                    actor.id,
                    'name',
                    `Rename to ${next}`,
                    () => {
                      actor.name = next
                      actor.root.name = next
                    },
                    () => {
                      actor.name = prev
                      actor.root.name = prev
                    },
                  )
                } else {
                  runCommand(
                    new PropertyCommand(
                      `Rename to ${next}`,
                      () => {
                        actor.name = next
                        actor.root.name = next
                      },
                      () => {
                        actor.name = prev
                        actor.root.name = prev
                      },
                    ),
                  )
                }
              }
              setRenaming(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') setRenaming(false)
            }}
          />
        ) : (
          <span className="outliner-name">{actor.name}</span>
        )}
        <span className="outliner-type">{actor.type}</span>
        {actor.tags.length > 0 && <span className="outliner-tag" title={actor.tags.join(', ')}>🏷</span>}
        <button
          className={`eye ${actor.visible ? '' : 'off'}`}
          title="Toggle visibility"
          onClick={(e) => {
            e.stopPropagation()
            const prev = actor.visible
            const next = !prev
            if (isPrefabInstanceActor(actor.id)) {
              runPrefabAwareCommand(
                actor.id,
                'visible',
                next ? 'Show actor' : 'Hide actor',
                () => actor.setVisible(next),
                () => actor.setVisible(prev),
              )
            } else {
              runCommand(
                new PropertyCommand(
                  next ? 'Show actor' : 'Hide actor',
                  () => actor.setVisible(next),
                  () => actor.setVisible(prev),
                ),
              )
            }
            touch()
          }}
        >
          {actor.visible ? '👁' : '–'}
        </button>
      </div>
      {!isCollapsed &&
        children.map((c) => (
          <OutlinerRow
            key={c.id}
            actor={c}
            depth={depth + 1}
            filter={filter}
            collapsed={collapsed}
            toggleCollapsed={toggleCollapsed}
          />
        ))}
    </>
  )
}

export function Outliner() {
  useEditor((s) => s.sceneVersion)
  const selectedId = useEditor((s) => s.selectedId)
  const roots = world.childrenOf(null)
  const [filter, setFilter] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())

  const toggleCollapsed = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const addFolder = () => {
    runCommand(new AddActorCommand(buildSerializedActor({ kind: 'folder' }, [0, 0, 0])))
  }

  return (
    <div className="panel outliner">
      <div className="panel-header">
        <span>World Outliner</span>
        <span className="panel-meta">
          <button className="outliner-add" title="Add Folder" onClick={addFolder}>
            + Folder
          </button>
          {world.actors.size} actors
        </span>
      </div>
      <div className="outliner-search">
        <input
          type="search"
          placeholder="Filter by name, type, or tag…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <div
        className="panel-body"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('lotus/actor')) e.preventDefault()
        }}
        onDrop={(e) => {
          const dragged = e.dataTransfer.getData('lotus/actor')
          if (dragged) runCommand(new ReparentCommand(dragged, null))
        }}
      >
        {roots.map((a) => (
          <OutlinerRow
            key={a.id}
            actor={a}
            depth={0}
            filter={filter}
            collapsed={collapsed}
            toggleCollapsed={toggleCollapsed}
          />
        ))}
        {roots.length === 0 && <div className="panel-empty">No actors in level.</div>}
      </div>
      {selectedId && (
        <div className="outliner-footer">
          <button onClick={() => selectedId && runCommand(new DeleteActorCommand(selectedId))}>Delete Selected</button>
        </div>
      )}
    </div>
  )
}