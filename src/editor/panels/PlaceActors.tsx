import { useState } from 'react'
import { getPluginNodeTypes } from '../plugins'
import { dragGhost, spawnAsset, type AssetPayload } from '../spawn'
import { useEditor } from '../store'

interface PlaceItem {
  label: string
  icon: string
  category: string
  payload: AssetPayload
}

const ITEMS: PlaceItem[] = [
  // Basic
  { label: 'Empty Actor', icon: '◇', category: 'Basic', payload: { kind: 'empty' } },
  { label: 'Player Start', icon: '🚩', category: 'Basic', payload: { kind: 'playerstart' } },
  { label: 'Trigger Volume', icon: '⏚', category: 'Basic', payload: { kind: 'trigger' } },
  // Lights
  { label: 'Directional Light', icon: '☀', category: 'Lights', payload: { kind: 'light', type: 'DirectionalLight' } },
  { label: 'Point Light', icon: '✦', category: 'Lights', payload: { kind: 'light', type: 'PointLight' } },
  { label: 'Spot Light', icon: '◬', category: 'Lights', payload: { kind: 'light', type: 'SpotLight' } },
  { label: 'Ambient Light', icon: '◍', category: 'Lights', payload: { kind: 'light', type: 'AmbientLight' } },
  { label: 'Rect Light', icon: '▤', category: 'Lights', payload: { kind: 'light', type: 'RectLight' } },
  // Shapes
  { label: 'Cube', icon: '⬛', category: 'Shapes', payload: { kind: 'mesh', geometry: 'box' } },
  { label: 'Sphere', icon: '⚫', category: 'Shapes', payload: { kind: 'mesh', geometry: 'sphere' } },
  { label: 'Cylinder', icon: '⬭', category: 'Shapes', payload: { kind: 'mesh', geometry: 'cylinder' } },
  { label: 'Cone', icon: '▲', category: 'Shapes', payload: { kind: 'mesh', geometry: 'cone' } },
  { label: 'Plane', icon: '▭', category: 'Shapes', payload: { kind: 'mesh', geometry: 'plane' } },
  { label: 'Torus', icon: '◯', category: 'Shapes', payload: { kind: 'mesh', geometry: 'torus' } },
  { label: 'Capsule', icon: '⬬', category: 'Shapes', payload: { kind: 'mesh', geometry: 'capsule' } },
  // Cinematic
  { label: 'Camera', icon: '🎥', category: 'Cinematic', payload: { kind: 'camera' } },
  { label: '3D Label', icon: '🏷', category: 'Cinematic', payload: { kind: 'label3d' } },
  { label: '3D Widget', icon: '🖥', category: 'Cinematic', payload: { kind: 'widget3d' } },
  // Visual Effects
  { label: 'Particle Emitter', icon: '✨', category: 'Visual Effects', payload: { kind: 'particles' } },
  { label: 'Foliage Layer', icon: '🌿', category: 'Visual Effects', payload: { kind: 'foliage' } },
  { label: 'Landscape', icon: '⛰', category: 'Visual Effects', payload: { kind: 'landscape' } },
  { label: 'Grid Tiles', icon: '🧱', category: 'Visual Effects', payload: { kind: 'gridmap' } },
  { label: 'Water', icon: '🌊', category: 'Visual Effects', payload: { kind: 'water' } },
  { label: 'PCG Scatter', icon: '🎲', category: 'Visual Effects', payload: { kind: 'pcg' } },
  // Volumes
  { label: 'Post Process Volume', icon: '◫', category: 'Volumes', payload: { kind: 'postprocess' } },
  { label: 'Reflection Probe', icon: '🔮', category: 'Volumes', payload: { kind: 'probe' } },
]

const BASE_CATEGORIES = ['Recently Placed', 'Basic', 'Lights', 'Shapes', 'Cinematic', 'Visual Effects', 'Volumes']

const recentlyPlaced: PlaceItem[] = []
function notePlaced(item: PlaceItem) {
  const i = recentlyPlaced.findIndex((x) => x.label === item.label)
  if (i >= 0) recentlyPlaced.splice(i, 1)
  recentlyPlaced.unshift(item)
  if (recentlyPlaced.length > 6) recentlyPlaced.pop()
}

/** Place Actors — the UE left dock: searchable categorized actor palette. */
export function PlaceActors() {
  const open = useEditor((s) => s.placeActorsOpen)
  void useEditor((s) => s.sceneVersion)
  const [query, setQuery] = useState('')
  const [cat, setCat] = useState('Basic')
  if (!open) return null

  const pluginItems: PlaceItem[] = getPluginNodeTypes().map((n) => ({
    label: n.label,
    icon: n.icon ?? '🔌',
    category: n.category ?? 'Plugins',
    payload: { kind: 'plugin-node', nodeType: n.type },
  }))
  const allItems = [...ITEMS, ...pluginItems]
  const pluginCats = [...new Set(pluginItems.map((i) => i.category))]
  const categories = [...BASE_CATEGORIES, ...pluginCats.filter((c) => !BASE_CATEGORIES.includes(c))]

  const searching = query.trim().length > 0
  const list = searching
    ? allItems.filter((i) => i.label.toLowerCase().includes(query.toLowerCase()))
    : cat === 'Recently Placed'
      ? recentlyPlaced
      : allItems.filter((i) => i.category === cat)

  return (
    <div className="place-actors">
      <div className="panel-header">
        <span>Place Actors</span>
      </div>
      <div className="place-search">
        <input
          type="search"
          placeholder="Search Classes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="place-body">
        {!searching && (
          <div className="place-cats">
            {categories.map((c) => (
              <button key={c} className={cat === c ? 'active' : ''} onClick={() => setCat(c)} title={c}>
                {c === 'Recently Placed'
                  ? '🕘'
                  : c === 'Basic'
                    ? '◇'
                    : c === 'Lights'
                      ? '✦'
                      : c === 'Shapes'
                        ? '⬛'
                        : c === 'Cinematic'
                          ? '🎥'
                          : c === 'Visual Effects'
                            ? '✨'
                            : c === 'Volumes'
                              ? '◫'
                              : '🔌'}
              </button>
            ))}
          </div>
        )}
        <div className="place-list">
          {list.map((item) => (
            <div
              key={item.label}
              className="place-item"
              draggable
              title="Drag into the viewport or double-click to place"
              onDragStart={(e) => {
                e.dataTransfer.setData('lotus/asset', JSON.stringify(item.payload))
                dragGhost.payload = item.payload
                notePlaced(item)
              }}
              onDragEnd={() => (dragGhost.payload = null)}
              onDoubleClick={() => {
                spawnAsset(item.payload)
                notePlaced(item)
              }}
            >
              <span className="place-icon">{item.icon}</span>
              <span>{item.label}</span>
            </div>
          ))}
          {list.length === 0 && <div className="panel-empty">{searching ? 'No matching class.' : 'Nothing placed yet.'}</div>}
        </div>
      </div>
    </div>
  )
}
