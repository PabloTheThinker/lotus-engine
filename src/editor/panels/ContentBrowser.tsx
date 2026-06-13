import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { world } from '../../engine/World'
import { deleteMaterial, duplicateMaterial, listMaterials, renameMaterial } from '../../engine/materialAssets'
import { createMetaSound, deleteMetaSound, duplicateMetaSound, listMetaSounds, renameMetaSound } from '../../engine/metaSoundAssets'
import { deletePrefab, duplicatePrefab, instantiatePrefab, listPrefabs, renamePrefab } from '../prefabs'
import { getPluginImporters, getPluginNodeTypes } from '../plugins'
import { dragGhost, spawnAsset, type AssetPayload } from '../spawn'
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
  { label: 'Sound Emitter', icon: '♪', category: 'Volumes', payload: { kind: 'soundemitter' } },
  { label: 'Refl. Probe', icon: '🔮', category: 'Volumes', payload: { kind: 'probe' } },
  { label: 'Particles', icon: '✨', category: 'VFX', payload: { kind: 'particles' } },
  { label: 'Foliage', icon: '🌿', category: 'VFX', payload: { kind: 'foliage' } },
  { label: 'Landscape', icon: '⛰', category: 'VFX', payload: { kind: 'landscape' } },
  { label: 'Grid Tiles', icon: '🧱', category: 'VFX', payload: { kind: 'gridmap' } },
]

const CATEGORIES = ['Shapes', 'Lights', 'Cameras', 'Gameplay', 'Volumes', 'VFX'] as const

type AssetStripe =
  | 'mesh'
  | 'light'
  | 'camera'
  | 'gameplay'
  | 'volume'
  | 'vfx'
  | 'material'
  | 'prefab'
  | 'imported'
  | 'metasound'
  | 'plugin'
  | 'import'

function stripeFromCategory(cat: AssetDef['category']): AssetStripe {
  switch (cat) {
    case 'Shapes':
      return 'mesh'
    case 'Lights':
      return 'light'
    case 'Cameras':
      return 'camera'
    case 'Gameplay':
      return 'gameplay'
    case 'Volumes':
      return 'volume'
    case 'VFX':
      return 'vfx'
  }
}

interface AssetCtxMenu {
  x: number
  y: number
  canRename: boolean
  canDuplicate: boolean
  canDelete: boolean
  onRename: () => void
  onDuplicate: () => void
  onDelete: () => void
}

interface AssetTileProps {
  assetKey: string
  label: string
  icon: ReactNode
  stripe: AssetStripe
  title?: string
  selected?: boolean
  draggable?: boolean
  renaming?: boolean
  renameValue?: string
  onSelect?: () => void
  onRenameChange?: (v: string) => void
  onRenameCommit?: () => void
  onRenameCancel?: () => void
  onDragStart?: (e: React.DragEvent) => void
  onDragEnd?: () => void
  onDoubleClick?: () => void
  onContextMenu?: (e: React.MouseEvent) => void
  onClick?: () => void
}

function AssetTile({
  assetKey,
  label,
  icon,
  stripe,
  title,
  selected,
  draggable,
  renaming,
  renameValue,
  onSelect,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
  onDragStart,
  onDragEnd,
  onDoubleClick,
  onContextMenu,
  onClick,
}: AssetTileProps) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) inputRef.current?.focus()
  }, [renaming])

  return (
    <div
      key={assetKey}
      className={`asset-tile stripe-${stripe}${selected ? ' selected' : ''}`}
      title={title}
      draggable={draggable}
      onMouseDown={() => onSelect?.()}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onClick={onClick}
    >
      {icon}
      {renaming ? (
        <input
          ref={inputRef}
          className="asset-rename-input"
          value={renameValue ?? label}
          spellCheck={false}
          onChange={(e) => onRenameChange?.(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') onRenameCommit?.()
            if (e.key === 'Escape') onRenameCancel?.()
          }}
          onBlur={onRenameCommit}
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        />
      ) : (
        <div className="asset-label">{label}</div>
      )}
      <div className="asset-type-stripe" aria-hidden />
    </div>
  )
}

function importAudio() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'audio/*'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const s = useEditor.getState()
    const buf = await file.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    const name = file.name.replace(/\.[^.]+$/, '')
    world.sounds[name] = btoa(binary)
    const { registerSound } = await import('../../engine/audio')
    await registerSound(name, world.sounds[name])
    s.setStatus(`Sound imported: ${name} — api.playSound('${name}')`)
    s.touch()
  }
  input.click()
}

function importHdri() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.hdr'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    const s = useEditor.getState()
    const buf = await file.arrayBuffer()
    let binary = ''
    const bytes = new Uint8Array(buf)
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
    world.hdri = btoa(binary)
    s.setStatus(`HDRI environment set: ${file.name}`)
    s.touch()
  }
  input.click()
}

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

function renameImportedAsset(id: string, newName: string): boolean {
  const asset = world.assets.get(id)
  const next = newName.trim()
  if (!asset || !next) return false
  asset.name = next
  useEditor.getState().setStatus(`Renamed asset: ${next}`)
  useEditor.getState().touch()
  return true
}

function deleteImportedAsset(id: string) {
  world.assets.delete(id)
  useEditor.getState().touch()
}

async function duplicateImportedAsset(id: string): Promise<string | null> {
  const asset = world.assets.get(id)
  if (!asset) return null
  const ext = asset.name.match(/\.(glb|gltf)$/i)?.[0] ?? ''
  const base = asset.name.replace(/\.(glb|gltf)$/i, '')
  let copyName = `${base}_Copy${ext}`
  const names = new Set([...world.assets.values()].map((a) => a.name))
  let n = 2
  while (names.has(copyName)) {
    copyName = `${base}_Copy${n}${ext}`
    n += 1
  }
  const newId = await world.registerAsset(copyName, asset.data)
  useEditor.getState().setStatus(`Duplicated asset: ${copyName}`)
  useEditor.getState().touch()
  return newId
}

export function ContentBrowser() {
  useEditor((s) => s.sceneVersion)
  const imported = [...world.assets.entries()]
  const prefabs = listPrefabs()
  const materials = listMaterials()
  const metaSounds = listMetaSounds()
  const pluginNodes = getPluginNodeTypes()
  const pluginImporters = getPluginImporters()
  const pluginCategories = [...new Set(pluginNodes.map((n) => n.category ?? 'Plugins'))]

  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [ctxMenu, setCtxMenu] = useState<AssetCtxMenu | null>(null)

  const closeCtx = useCallback(() => setCtxMenu(null), [])

  const startRename = useCallback((key: string, current: string) => {
    setSelectedKey(key)
    setRenamingKey(key)
    setRenameValue(current)
    closeCtx()
  }, [closeCtx])

  const cancelRename = useCallback(() => {
    setRenamingKey(null)
    setRenameValue('')
  }, [])

  const openCtx = useCallback(
    (
      e: React.MouseEvent,
      opts: {
        key: string
        canRename?: boolean
        canDuplicate?: boolean
        canDelete?: boolean
        onRename: () => void
        onDuplicate: () => void
        onDelete: () => void
      },
    ) => {
      e.preventDefault()
      e.stopPropagation()
      setSelectedKey(opts.key)
      setCtxMenu({
        x: e.clientX,
        y: e.clientY,
        canRename: opts.canRename ?? true,
        canDuplicate: opts.canDuplicate ?? true,
        canDelete: opts.canDelete ?? true,
        onRename: opts.onRename,
        onDuplicate: opts.onDuplicate,
        onDelete: opts.onDelete,
      })
    },
    [],
  )

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'F2' && selectedKey && !renamingKey) {
        const el = e.target as HTMLElement | null
        if (el?.tagName === 'INPUT' || el?.tagName === 'TEXTAREA') return
        e.preventDefault()
        if (selectedKey.startsWith('mat:')) {
          const id = selectedKey.slice(4)
          const m = materials.find((x) => x.id === id)
          if (m) startRename(selectedKey, m.name)
        } else if (selectedKey.startsWith('prefab:')) {
          startRename(selectedKey, selectedKey.slice(7))
        } else if (selectedKey.startsWith('ms:')) {
          const id = selectedKey.slice(3)
          const m = metaSounds.find((x) => x.id === id)
          if (m) startRename(selectedKey, m.name)
        } else if (selectedKey.startsWith('imported:')) {
          const id = selectedKey.slice(9)
          const asset = world.assets.get(id)
          if (asset) startRename(selectedKey, asset.name.replace(/\.(glb|gltf)$/i, ''))
        }
      }
      if (e.key === 'Escape') {
        closeCtx()
        cancelRename()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selectedKey, renamingKey, materials, metaSounds, startRename, closeCtx, cancelRename])

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return
      const el = e.target as HTMLElement
      if (el.closest('.asset-ctx')) return
      closeCtx()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [closeCtx])

  return (
    <div className="content-browser-body">
      {CATEGORIES.map((cat) => (
        <div className="asset-category" key={cat}>
          <div className="asset-category-label">{cat}</div>
          <div className="asset-grid">
            {ASSETS.filter((a) => a.category === cat).map((a) => {
              const key = `builtin:${a.label}`
              return (
                <AssetTile
                  key={a.label}
                  assetKey={key}
                  label={a.label}
                  stripe={stripeFromCategory(a.category)}
                  selected={selectedKey === key}
                  onSelect={() => setSelectedKey(key)}
                  title={`Drag into viewport or double-click to place ${a.label}`}
                  draggable
                  icon={<div className="asset-icon">{a.icon}</div>}
                  onDragStart={(e) => {
                    e.dataTransfer.setData('vektra/asset', JSON.stringify(a.payload))
                    dragGhost.payload = a.payload
                  }}
                  onDragEnd={() => (dragGhost.payload = null)}
                  onDoubleClick={() => spawnAsset(a.payload)}
                />
              )
            })}
          </div>
        </div>
      ))}
      {metaSounds.length > 0 && (
        <div className="asset-category">
          <div className="asset-category-label">MetaSounds</div>
          <div className="asset-grid">
            {metaSounds.map((m) => {
              const key = `ms:${m.id}`
              return (
                <AssetTile
                  key={m.id}
                  assetKey={key}
                  label={m.name}
                  stripe="metasound"
                  selected={selectedKey === key}
                  renaming={renamingKey === key}
                  renameValue={renameValue}
                  onSelect={() => setSelectedKey(key)}
                  onRenameChange={setRenameValue}
                  onRenameCommit={() => {
                    if (renamingKey === key) {
                      renameMetaSound(m.id, renameValue)
                      useEditor.getState().touch()
                    }
                    cancelRename()
                  }}
                  onRenameCancel={cancelRename}
                  title={`${m.name} — double-click to edit graph`}
                  icon={<div className="asset-icon">♪</div>}
                  onDoubleClick={() => useEditor.getState().setEditingMetaSound(m.id)}
                  onContextMenu={(e) =>
                    openCtx(e, {
                      key,
                      onRename: () => startRename(key, m.name),
                      onDuplicate: () => duplicateMetaSound(m.id),
                      onDelete: () => {
                        deleteMetaSound(m.id)
                        useEditor.getState().touch()
                        if (selectedKey === key) setSelectedKey(null)
                      },
                    })
                  }
                />
              )
            })}
          </div>
        </div>
      )}
      {materials.length > 0 && (
        <div className="asset-category">
          <div className="asset-category-label">Materials</div>
          <div className="asset-grid">
            {materials.map((m) => {
              const key = `mat:${m.id}`
              return (
                <AssetTile
                  key={m.id}
                  assetKey={key}
                  label={m.name}
                  stripe="material"
                  selected={selectedKey === key}
                  renaming={renamingKey === key}
                  renameValue={renameValue}
                  onSelect={() => setSelectedKey(key)}
                  onRenameChange={setRenameValue}
                  onRenameCommit={() => {
                    if (renamingKey === key) {
                      renameMaterial(m.id, renameValue)
                      useEditor.getState().touch()
                    }
                    cancelRename()
                  }}
                  onRenameCancel={cancelRename}
                  title={`${m.name} — drag onto a mesh actor to apply`}
                  draggable
                  icon={
                    <div
                      className="asset-icon material-swatch"
                      style={{ background: m.material.color, boxShadow: `inset 0 0 0 2px ${m.material.emissive}` }}
                    >
                      ◆
                    </div>
                  }
                  onDragStart={(e) => e.dataTransfer.setData('vektra/material', m.id)}
                  onContextMenu={(e) =>
                    openCtx(e, {
                      key,
                      onRename: () => startRename(key, m.name),
                      onDuplicate: () => duplicateMaterial(m.id),
                      onDelete: () => {
                        deleteMaterial(m.id)
                        useEditor.getState().touch()
                        if (selectedKey === key) setSelectedKey(null)
                      },
                    })
                  }
                />
              )
            })}
          </div>
        </div>
      )}
      {prefabs.length > 0 && (
        <div className="asset-category">
          <div className="asset-category-label">Prefabs</div>
          <div className="asset-grid">
            {prefabs.map((p) => {
              const key = `prefab:${p.name}`
              return (
                <AssetTile
                  key={p.name}
                  assetKey={key}
                  label={p.name}
                  stripe="prefab"
                  selected={selectedKey === key}
                  renaming={renamingKey === key}
                  renameValue={renameValue}
                  onSelect={() => setSelectedKey(key)}
                  onRenameChange={setRenameValue}
                  onRenameCommit={() => {
                    if (renamingKey === key) renamePrefab(p.name, renameValue)
                    cancelRename()
                  }}
                  onRenameCancel={cancelRename}
                  title={`${p.name} — ${p.actors.length} actor(s). Drag or double-click to instance.`}
                  draggable
                  icon={<div className="asset-icon">🧩</div>}
                  onDragStart={(e) => e.dataTransfer.setData('vektra/prefab', p.name)}
                  onDoubleClick={() => instantiatePrefab(p, [0, p.actors[0].transform.position[1], 0])}
                  onContextMenu={(e) =>
                    openCtx(e, {
                      key,
                      onRename: () => startRename(key, p.name),
                      onDuplicate: () => duplicatePrefab(p.name),
                      onDelete: () => {
                        deletePrefab(p.name)
                        if (selectedKey === key) setSelectedKey(null)
                      },
                    })
                  }
                />
              )
            })}
          </div>
        </div>
      )}
      {pluginCategories.map((cat) => {
        const nodes = pluginNodes.filter((n) => (n.category ?? 'Plugins') === cat)
        if (!nodes.length) return null
        return (
          <div className="asset-category" key={`plugin-${cat}`}>
            <div className="asset-category-label">{cat}</div>
            <div className="asset-grid">
              {nodes.map((n) => {
                const payload: AssetPayload = { kind: 'plugin-node', nodeType: n.type }
                const key = `plugin:${n.type}`
                return (
                  <AssetTile
                    key={n.type}
                    assetKey={key}
                    label={n.label}
                    stripe="plugin"
                    selected={selectedKey === key}
                    onSelect={() => setSelectedKey(key)}
                    title={`${n.label} (${n.pluginName}) — drag or double-click`}
                    draggable
                    icon={<div className="asset-icon">{n.icon ?? '🔌'}</div>}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('vektra/asset', JSON.stringify(payload))
                      dragGhost.payload = payload
                    }}
                    onDragEnd={() => (dragGhost.payload = null)}
                    onDoubleClick={() => spawnAsset(payload)}
                  />
                )
              })}
            </div>
          </div>
        )
      })}
      {imported.length > 0 && (
        <div className="asset-category">
          <div className="asset-category-label">Imported</div>
          <div className="asset-grid">
            {imported.map(([id, asset]) => {
              const key = `imported:${id}`
              const displayName = asset.name.replace(/\.(glb|gltf)$/i, '')
              return (
                <AssetTile
                  key={id}
                  assetKey={key}
                  label={displayName}
                  stripe="imported"
                  selected={selectedKey === key}
                  renaming={renamingKey === key}
                  renameValue={renameValue}
                  onSelect={() => setSelectedKey(key)}
                  onRenameChange={setRenameValue}
                  onRenameCommit={() => {
                    if (renamingKey === key) {
                      const ext = asset.name.match(/\.(glb|gltf)$/i)?.[0] ?? ''
                      renameImportedAsset(id, renameValue.includes('.') ? renameValue : `${renameValue}${ext}`)
                    }
                    cancelRename()
                  }}
                  onRenameCancel={cancelRename}
                  title={asset.name}
                  draggable
                  icon={<div className="asset-icon">🧊</div>}
                  onDragStart={(e) =>
                    e.dataTransfer.setData(
                      'vektra/asset',
                      JSON.stringify({ kind: 'imported', assetId: id, name: displayName }),
                    )
                  }
                  onDoubleClick={() => spawnAsset({ kind: 'imported', assetId: id, name: displayName })}
                  onContextMenu={(e) =>
                    openCtx(e, {
                      key,
                      onRename: () => startRename(key, displayName),
                      onDuplicate: () => void duplicateImportedAsset(id),
                      onDelete: () => {
                        deleteImportedAsset(id)
                        if (selectedKey === key) setSelectedKey(null)
                      },
                    })
                  }
                />
              )
            })}
          </div>
        </div>
      )}
      <div className="asset-category">
        <div className="asset-category-label">Import</div>
        <div className="asset-grid">
          <AssetTile
            assetKey="import:gltf"
            label="glTF…"
            stripe="import"
            title="Import a .glb/.gltf model"
            icon={<div className="asset-icon">⭱</div>}
            onClick={importGltf}
          />
          <AssetTile
            assetKey="import:audio"
            label="Audio…"
            stripe="import"
            title="Import a sound — play with api.playSound(name)"
            icon={<div className="asset-icon">🔊</div>}
            onClick={importAudio}
          />
          <AssetTile
            assetKey="import:metasound"
            label="MetaSound…"
            stripe="metasound"
            title="Create a procedural MetaSound graph"
            icon={<div className="asset-icon">♪</div>}
            onClick={() => {
              const name = prompt('MetaSound name?')
              if (!name) return
              const asset = createMetaSound(name)
              useEditor.getState().setEditingMetaSound(asset.id)
              useEditor.getState().setStatus(`MetaSound created: ${name} — api.playMetaSound('${name}')`)
              useEditor.getState().touch()
            }}
          />
          <AssetTile
            assetKey="import:hdri"
            label="HDRI…"
            stripe="import"
            title="Import an .hdr environment (replaces the sky + IBL)"
            icon={<div className="asset-icon">🌅</div>}
            onClick={importHdri}
          />
          {pluginImporters.map((imp) => (
            <AssetTile
              key={`${imp.pluginName}-${imp.ext}`}
              assetKey={`import:${imp.pluginName}-${imp.ext}`}
              label={imp.label}
              stripe="import"
              title={`${imp.label} (${imp.ext}) — or drag file onto viewport`}
              icon={<div className="asset-icon">🔌</div>}
              onClick={() => {
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = imp.ext
                input.onchange = async () => {
                  const file = input.files?.[0]
                  if (!file) return
                  try {
                    await imp.import(file)
                    useEditor.getState().setStatus(`${imp.label}: imported ${file.name}`)
                    useEditor.getState().touch()
                  } catch (err) {
                    useEditor.getState().setStatus(`${imp.label} failed: ${(err as Error).message}`)
                  }
                }
                input.click()
              }}
            />
          ))}
        </div>
      </div>
      {ctxMenu && (
        <div
          className="asset-ctx"
          style={{ left: ctxMenu.x, top: ctxMenu.y }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {ctxMenu.canRename && (
            <button type="button" onClick={ctxMenu.onRename}>
              Rename <span className="asset-ctx-kbd">F2</span>
            </button>
          )}
          {ctxMenu.canDuplicate && (
            <button type="button" onClick={() => { ctxMenu.onDuplicate(); closeCtx() }}>
              Duplicate
            </button>
          )}
          {ctxMenu.canDelete && (
            <button type="button" className="danger" onClick={() => { ctxMenu.onDelete(); closeCtx() }}>
              Delete
            </button>
          )}
        </div>
      )}
    </div>
  )
}