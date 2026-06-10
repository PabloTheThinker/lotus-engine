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
  world.environment = { ...world.environment, skyEnabled: true, sunElevation: 35, sunAzimuth: 45 }
  world.applyEnvironment()

  // starter level: ground + sun + player start + a physics stack to knock over
  const ground = buildSerializedActor({ kind: 'mesh', geometry: 'plane' }, [0, 0, 0])
  ground.name = 'Ground'
  ground.transform.scale = [60, 60, 60]
  ground.material!.color = '#3a4148'
  ground.material!.roughness = 0.9
  ground.castShadow = false
  ground.physics = { mode: 'static', mass: 0, friction: 0.8, restitution: 0.1 }

  const sun = buildSerializedActor({ kind: 'light', type: 'DirectionalLight' }, [12, 17, 12])
  sun.name = 'Sun'
  sun.light!.intensity = 3

  // soft fill so shadowed faces read even without image-based lighting
  const fill = buildSerializedActor({ kind: 'light', type: 'AmbientLight' }, [0, 5, 0])
  fill.name = 'SkyFill'
  fill.light!.color = '#8fa6c4'
  fill.light!.intensity = 0.5

  const start = buildSerializedActor({ kind: 'playerstart' }, [0, 0, 10])
  start.name = 'PlayerStart'
  start.pawnMode = 'thirdperson'

  const actors = [ground, sun, fill, start]
  // 3×3 pyramid of dynamic crates
  const colors = ['#5b8def', '#e0673f', '#46a758', '#b08df1', '#e3b341', '#56b3c9']
  let i = 0
  for (let row = 0; row < 3; row++) {
    const count = 3 - row
    for (let col = 0; col < count; col++) {
      const crate = buildSerializedActor({ kind: 'mesh', geometry: 'box' }, [
        col - count / 2 + 0.5,
        0.55 + row * 1.05,
        0,
      ])
      crate.name = `Crate${++i}`
      crate.material!.color = colors[i % colors.length]
      crate.physics = { mode: 'dynamic', mass: 1, friction: 0.5, restitution: 0.15 }
      actors.push(crate)
    }
  }
  // one bouncy sphere overhead — instant physics proof on Play
  const ball = buildSerializedActor({ kind: 'mesh', geometry: 'sphere' }, [0.3, 7, 0.2])
  ball.name = 'Ball'
  ball.material!.color = '#e5484d'
  ball.material!.metalness = 0.4
  ball.material!.roughness = 0.25
  ball.physics = { mode: 'dynamic', mass: 2, friction: 0.4, restitution: 0.75 }
  actors.push(ball)

  for (const sa of actors) {
    const actor = world.instantiate(sa)
    world.addActor(actor, null)
  }
  // re-apply so the sun light snaps to the sky's sun direction
  world.applyEnvironment()
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
      await world.load(level)
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
export async function restoreAutosave(): Promise<boolean> {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY)
    if (!raw) return false
    const level = JSON.parse(raw) as SerializedLevel
    if (level.engine !== 'vektra' || !Array.isArray(level.actors) || level.actors.length === 0) return false
    await world.load(level)
    afterLoad(level.name)
    return true
  } catch {
    return false
  }
}
