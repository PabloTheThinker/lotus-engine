import { world } from '../engine/World'
import type { SerializedLevel } from '../engine/types'
import { buildSerializedActor } from './spawn'
import { clearHistory } from './commands'
import { useEditor } from './store'

const AUTOSAVE_KEY = 'vektra-engine.autosave'

function afterLoad(name: string) {
  const s = useEditor.getState()
  s.select(null)
  s.setLevelName(name)
  clearHistory()
  s.setStatus(`Loaded level: ${name}`)
  s.touch()
}

export function newLevel() {
  world.clear()
  world.levelName = 'Untitled'
  // a sane starter: ground, key light, fill, one cube
  const ground = buildSerializedActor({ kind: 'mesh', geometry: 'plane' }, [0, 0, 0])
  ground.name = 'Ground'
  ground.transform.scale = [40, 40, 40]
  ground.material!.color = '#2e3440'
  ground.material!.roughness = 0.9
  ground.castShadow = false

  const sun = buildSerializedActor({ kind: 'light', type: 'DirectionalLight' }, [8, 12, 6])
  sun.name = 'Sun'
  const ambient = buildSerializedActor({ kind: 'light', type: 'AmbientLight' }, [0, 5, 0])
  ambient.name = 'SkyAmbient'
  ambient.light!.intensity = 0.6

  const cube = buildSerializedActor({ kind: 'mesh', geometry: 'box' }, [0, 0.5, 0])
  cube.name = 'StarterCube'
  cube.material!.color = '#5b8def'

  for (const sa of [ground, sun, ambient, cube]) {
    const actor = world.instantiate(sa)
    world.addActor(actor, null)
  }
  afterLoad('Untitled')
}

export function saveLevelToFile() {
  const s = useEditor.getState()
  world.levelName = s.levelName
  const json = JSON.stringify(world.serialize(), null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `${s.levelName.replace(/[^\w-]+/g, '_') || 'level'}.vlevel.json`
  a.click()
  URL.revokeObjectURL(a.href)
  s.setStatus(`Saved ${a.download}`)
}

export function openLevelFromFile() {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = '.json,.vlevel.json,application/json'
  input.onchange = async () => {
    const file = input.files?.[0]
    if (!file) return
    try {
      const level = JSON.parse(await file.text()) as SerializedLevel
      if (level.engine !== 'vektra') throw new Error('Not a Vektra level file')
      world.load(level)
      afterLoad(level.name)
    } catch (err) {
      useEditor.getState().setStatus(`Open failed: ${(err as Error).message}`)
    }
  }
  input.click()
}

export function autosave() {
  try {
    world.levelName = useEditor.getState().levelName
    localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(world.serialize()))
  } catch {
    // storage full or unavailable — autosave is best-effort
  }
}

/** Returns true if an autosaved level was restored. */
export function restoreAutosave(): boolean {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    if (!raw) return false
    const level = JSON.parse(raw) as SerializedLevel
    if (level.engine !== 'vektra' || !Array.isArray(level.actors) || level.actors.length === 0) return false
    world.load(level)
    afterLoad(level.name)
    return true
  } catch {
    return false
  }
}
