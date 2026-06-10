import { spawnAsset, type AssetPayload } from '../spawn'
import { useEditor } from '../store'

interface AssetDef {
  label: string
  icon: string
  category: 'Shapes' | 'Lights' | 'Cameras' | 'Utility'
  payload: AssetPayload
}

const ASSETS: AssetDef[] = [
  { label: 'Cube', icon: '⬛', category: 'Shapes', payload: { kind: 'mesh', geometry: 'box' } },
  { label: 'Sphere', icon: '⚫', category: 'Shapes', payload: { kind: 'mesh', geometry: 'sphere' } },
  { label: 'Cylinder', icon: '⬭', category: 'Shapes', payload: { kind: 'mesh', geometry: 'cylinder' } },
  { label: 'Cone', icon: '▲', category: 'Shapes', payload: { kind: 'mesh', geometry: 'cone' } },
  { label: 'Plane', icon: '▭', category: 'Shapes', payload: { kind: 'mesh', geometry: 'plane' } },
  { label: 'Torus', icon: '◯', category: 'Shapes', payload: { kind: 'mesh', geometry: 'torus' } },
  { label: 'Capsule', icon: '⬬', category: 'Shapes', payload: { kind: 'mesh', geometry: 'capsule' } },
  { label: 'Icosphere', icon: '◈', category: 'Shapes', payload: { kind: 'mesh', geometry: 'icosahedron' } },
  { label: 'Point Light', icon: '✦', category: 'Lights', payload: { kind: 'light', type: 'PointLight' } },
  { label: 'Spot Light', icon: '◬', category: 'Lights', payload: { kind: 'light', type: 'SpotLight' } },
  { label: 'Directional', icon: '☀', category: 'Lights', payload: { kind: 'light', type: 'DirectionalLight' } },
  { label: 'Ambient', icon: '◍', category: 'Lights', payload: { kind: 'light', type: 'AmbientLight' } },
  { label: 'Camera', icon: '🎥', category: 'Cameras', payload: { kind: 'camera' } },
  { label: 'Empty', icon: '◇', category: 'Utility', payload: { kind: 'empty' } },
]

const CATEGORIES = ['Shapes', 'Lights', 'Cameras', 'Utility'] as const

export function ContentBrowser() {
  const open = useEditor((s) => s.contentBrowserOpen)
  if (!open) return null

  return (
    <div className="panel content-browser">
      <div className="panel-header">
        <span>Content Browser</span>
        <span className="panel-meta">drag into viewport · double-click to place at origin</span>
      </div>
      <div className="content-browser-body">
        {CATEGORIES.map((cat) => (
          <div className="asset-category" key={cat}>
            <div className="asset-category-label">{cat}</div>
            <div className="asset-grid">
              {ASSETS.filter((a) => a.category === cat).map((a) => (
                <div
                  key={a.label}
                  className="asset-tile"
                  title={`Drag into viewport or double-click to place ${a.label}`}
                  draggable
                  onDragStart={(e) => e.dataTransfer.setData('vektra/asset', JSON.stringify(a.payload))}
                  onDoubleClick={() => spawnAsset(a.payload)}
                >
                  <div className="asset-icon">{a.icon}</div>
                  <div className="asset-label">{a.label}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
