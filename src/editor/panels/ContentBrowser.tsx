import { world } from '../../engine/World'
import { deletePrefab, instantiatePrefab, listPrefabs } from '../prefabs'
import { spawnAsset, type AssetPayload } from '../spawn'
import { useEditor } from '../store'

interface AssetDef {
  label: string
  icon: string
  category: 'Shapes' | 'Lights' | 'Cameras' | 'Gameplay' | 'Volumes' | 'VFX'
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
  { label: 'Player Start', icon: '🚩', category: 'Gameplay', payload: { kind: 'playerstart' } },
  { label: 'Empty', icon: '◇', category: 'Gameplay', payload: { kind: 'empty' } },
  { label: 'Folder', icon: '📁', category: 'Gameplay', payload: { kind: 'folder' } },
  { label: 'Post Process', icon: '◫', category: 'Volumes', payload: { kind: 'postprocess' } },
  { label: 'Trigger', icon: '⏚', category: 'Volumes', payload: { kind: 'trigger' } },
  { label: 'Particles', icon: '✨', category: 'VFX', payload: { kind: 'particles' } },
  { label: 'Foliage', icon: '🌿', category: 'VFX', payload: { kind: 'foliage' } },
  { label: 'Landscape', icon: '⛰', category: 'VFX', payload: { kind: 'landscape' } },
]

const CATEGORIES = ['Shapes', 'Lights', 'Cameras', 'Gameplay', 'Volumes', 'VFX'] as const

function importGltf() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.glb,.gltf,model/gltf-binary'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const s = useEditor.getState()
    try {
      s.setStatus(`Importing ${file.name}…`)
      const buf = await file.arrayBuffer()
      let binary = ''
      const bytes = new Uint8Array(buf)
      const chunk = 0x8000
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
      }
      const assetId = await world.registerAsset(file.name, btoa(binary))
      const name = file.name.replace(/\.(glb|gltf)$/i, '')
      spawnAsset({ kind: 'imported', assetId, name }, [0, 0, 0])
      s.setStatus(`Imported ${file.name}`)
    } catch (err) {
      s.setStatus(`Import failed: ${(err as Error).message}`)
    }
  }
  input.click()
}

export function ContentBrowser() {
  useEditor((s) => s.sceneVersion)
  const imported = [...world.assets.entries()]
  const prefabs = listPrefabs()

  return (
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
      {prefabs.length > 0 && (
        <div className="asset-category">
          <div className="asset-category-label">Prefabs</div>
          <div className="asset-grid">
            {prefabs.map((p) => (
              <div
                key={p.name}
                className="asset-tile prefab"
                title={`${p.name} — ${p.actors.length} actor(s). Drag or double-click to instance; ✕ removes the prefab.`}
                draggable
                onDragStart={(e) => e.dataTransfer.setData('vektra/prefab', p.name)}
                onDoubleClick={() => instantiatePrefab(p, [0, p.actors[0].transform.position[1], 0])}
              >
                <button
                  className="prefab-delete"
                  onClick={(e) => {
                    e.stopPropagation()
                    deletePrefab(p.name)
                  }}
                >
                  ✕
                </button>
                <div className="asset-icon">🧩</div>
                <div className="asset-label">{p.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      {imported.length > 0 && (
        <div className="asset-category">
          <div className="asset-category-label">Imported</div>
          <div className="asset-grid">
            {imported.map(([id, asset]) => (
              <div
                key={id}
                className="asset-tile imported"
                title={asset.name}
                draggable
                onDragStart={(e) =>
                  e.dataTransfer.setData(
                    'vektra/asset',
                    JSON.stringify({ kind: 'imported', assetId: id, name: asset.name.replace(/\.(glb|gltf)$/i, '') }),
                  )
                }
                onDoubleClick={() =>
                  spawnAsset({ kind: 'imported', assetId: id, name: asset.name.replace(/\.(glb|gltf)$/i, '') })
                }
              >
                <div className="asset-icon">🧊</div>
                <div className="asset-label">{asset.name}</div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="asset-category">
        <div className="asset-category-label">Import</div>
        <div className="asset-grid">
          <div className="asset-tile" onClick={importGltf} title="Import a .glb/.gltf model">
            <div className="asset-icon">⭱</div>
            <div className="asset-label">glTF…</div>
          </div>
        </div>
      </div>
    </div>
  )
}
