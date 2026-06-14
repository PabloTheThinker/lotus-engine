import * as THREE from 'three'
import { LightProbeGrid } from 'three/addons/lighting/LightProbeGrid.js'
import type { EnvironmentSettings } from './types'

/** Wave 11 — SSR + LightProbeGrid (Lumen honest-skip interior GI approx). */

export interface GISettings {
  ssr: boolean
  lightProbeGrid: boolean
}

let probeGrid: LightProbeGrid | null = null
let lastProbeBake = 0

export function getGISettings(env: EnvironmentSettings): GISettings {
  return {
    ssr: env.postSsr === true,
    lightProbeGrid: env.lightProbeGrid === true,
  }
}

export function ensureLightProbeGrid(scene: THREE.Scene, env: EnvironmentSettings): LightProbeGrid | null {
  if (!getGISettings(env).lightProbeGrid) {
    disposeLightProbeGrid(scene)
    return null
  }
  if (!probeGrid) {
    const grid = new LightProbeGrid(48, 14, 48, 9, 4, 9)
    grid.position.set(0, 7, 0)
    scene.add(grid)
    probeGrid = grid
  }
  return probeGrid
}

export async function bakeLightProbeGrid(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  env: EnvironmentSettings,
): Promise<boolean> {
  const grid = ensureLightProbeGrid(scene, env)
  if (!grid) return false
  try {
    await grid.bake(renderer, scene, { near: 0.1, far: 80, cubemapSize: 64 })
    lastProbeBake = performance.now()
    return true
  } catch {
    return false
  }
}

export function disposeLightProbeGrid(scene: THREE.Scene) {
  if (!probeGrid) return
  scene.remove(probeGrid)
  probeGrid.dispose()
  probeGrid = null
}

export function lightProbeGridStatus(): { active: boolean; lastBake: number } {
  return { active: probeGrid !== null, lastBake: lastProbeBake }
}