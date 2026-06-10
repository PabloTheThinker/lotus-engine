import { useState } from 'react'
import type { Actor } from '../../engine/Actor'
import { world } from '../../engine/World'
import { DeleteActorCommand, PropertyCommand, ReparentCommand, runCommand } from '../commands'
import { useEditor } from '../store'

const TYPE_ICONS: Record<string, string> = {
  StaticMesh: '◼',
  PointLight: '✦',
  SpotLight: '◬',
  DirectionalLight: '☀',
  AmbientLight: '◍',
  Camera: '🎥',
  Empty: '◇',
}

function OutlinerRow({ actor, depth }: { actor: Actor; depth: number }) {
  const selectedId = useEditor((s) => s.selectedId)
  const select = useEditor((s) => s.select)
  const touch = useEditor((s) => s.touch)
  const [renaming, setRenaming] = useState(false)
  const children = world.childrenOf(actor.id)

  return (
    <>
      <div
        className={`outliner-row ${selectedId === actor.id ? 'selected' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => select(actor.id)}
        onDoubleClick={() => setRenaming(true)}
        draggable
        onDragStart={(e) => e.dataTransfer.setData('vektra/actor', actor.id)}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('vektra/actor')) e.preventDefault()
        }}
        onDrop={(e) => {
          const dragged = e.dataTransfer.getData('vektra/actor')
          if (dragged && dragged !== actor.id) {
            e.stopPropagation()
            runCommand(new ReparentCommand(dragged, actor.id))
          }
        }}
      >
        <span className="outliner-icon">{TYPE_ICONS[actor.type] ?? '◇'}</span>
        {renaming ? (
          <input
            autoFocus
            defaultValue={actor.name}
            onBlur={(e) => {
              const next = e.target.value.trim()
              if (next && next !== actor.name) {
                const prev = actor.name
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
        <button
          className={`eye ${actor.visible ? '' : 'off'}`}
          title="Toggle visibility"
          onClick={(e) => {
            e.stopPropagation()
            actor.setVisible(!actor.visible)
            touch()
          }}
        >
          {actor.visible ? '👁' : '–'}
        </button>
      </div>
      {children.map((c) => (
        <OutlinerRow key={c.id} actor={c} depth={depth + 1} />
      ))}
    </>
  )
}

export function Outliner() {
  useEditor((s) => s.sceneVersion) // re-render on world mutations
  const selectedId = useEditor((s) => s.selectedId)
  const roots = world.childrenOf(null)

  return (
    <div className="panel outliner">
      <div className="panel-header">
        <span>World Outliner</span>
        <span className="panel-meta">{world.actors.size} actors</span>
      </div>
      <div
        className="panel-body"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('vektra/actor')) e.preventDefault()
        }}
        onDrop={(e) => {
          // dropping on empty space un-parents
          const dragged = e.dataTransfer.getData('vektra/actor')
          if (dragged) runCommand(new ReparentCommand(dragged, null))
        }}
      >
        {roots.length === 0 && <div className="panel-empty">Empty level — drag assets in from the Content Browser.</div>}
        {roots.map((a) => (
          <OutlinerRow key={a.id} actor={a} depth={0} />
        ))}
      </div>
      {selectedId && (
        <div className="panel-footer">
          <button onClick={() => runCommand(new DeleteActorCommand(selectedId))}>Delete Selected</button>
        </div>
      )}
    </div>
  )
}
