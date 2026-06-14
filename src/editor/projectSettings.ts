/** Project Settings (Wave 12) — global editor/project prefs, not per-level. */

export interface ProjectSettings {
  projectName: string
  defaultRenderBackend: 'webgl' | 'webgpu'
  defaultPhysicsHz: number
  defaultMaterialBackend: 'glsl' | 'tsl'
  /** Show Lotus branding on export playable banner */
  showLotusBranding: boolean
  /** SSGI quality preset default for new levels */
  defaultPostSsgi: boolean
}

const KEY = 'lotus-engine.project'

export const DEFAULT_PROJECT: ProjectSettings = {
  projectName: 'Untitled Project',
  defaultRenderBackend: 'webgl',
  defaultPhysicsHz: 60,
  defaultMaterialBackend: 'glsl',
  showLotusBranding: true,
  defaultPostSsgi: false,
}

export function loadProjectSettings(): ProjectSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}')
    return { ...DEFAULT_PROJECT, ...raw }
  } catch {
    return { ...DEFAULT_PROJECT }
  }
}

export function saveProjectSettings(s: ProjectSettings) {
  localStorage.setItem(KEY, JSON.stringify(s))
}

/** Apply project defaults onto a fresh level environment (non-destructive merge). */
export function applyProjectDefaultsToEnvironment(
  env: import('../engine/types').EnvironmentSettings,
): import('../engine/types').EnvironmentSettings {
  const proj = loadProjectSettings()
  return {
    ...env,
    renderBackend: env.renderBackend ?? proj.defaultRenderBackend,
    fixedPhysicsHz: env.fixedPhysicsHz ?? proj.defaultPhysicsHz,
    materialBackend: env.materialBackend ?? proj.defaultMaterialBackend,
    postSsgi: env.postSsgi ?? proj.defaultPostSsgi,
  }
}