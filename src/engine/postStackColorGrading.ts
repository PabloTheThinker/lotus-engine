import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { applyGradingLUTTSL, type ColorGradingLUTState, type GradingLUTTslOps } from './postColorGradingLut'
import type { EnvironmentSettings } from './types'

/** Wave 25 — lift/gamma/gain color grading stub (UE post-process analog). */

export interface ColorGradingSettings {
  enabled: boolean
  lift: [number, number, number]
  gamma: [number, number, number]
  gain: [number, number, number]
}

const ColorGradingShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    lift: { value: new THREE.Vector3(0, 0, 0) },
    gamma: { value: new THREE.Vector3(1, 1, 1) },
    gain: { value: new THREE.Vector3(1, 1, 1) },
    lutMap: { value: null as THREE.Texture | null },
    lutSize: { value: 16 },
    lutEnabled: { value: 0 },
    lutStrength: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform sampler2D lutMap;
    uniform vec3 lift;
    uniform vec3 gamma;
    uniform vec3 gain;
    uniform float lutSize;
    uniform float lutEnabled;
    uniform float lutStrength;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = pow(max(c + lift, vec3(0.0)), max(gamma, vec3(0.01)));
      c *= gain;
      if (lutEnabled > 0.5) {
        float grid = lutSize * lutSize;
        float idx = (c.r * (lutSize - 1.0) + c.g * (lutSize - 1.0) * lutSize);
        vec2 lutUv = vec2((idx + 0.5) / grid, 0.5);
        vec3 lutC = texture2D(lutMap, lutUv).rgb;
        c = mix(c, lutC, clamp(lutStrength, 0.0, 1.0));
      }
      gl_FragColor = vec4(c, 1.0);
    }
  `,
}

export type ColorGradingPreset = 'off' | 'neutral' | 'cinematic' | 'highContrast'

export type ColorGradingPresetId = Exclude<ColorGradingPreset, 'off'>

const COLOR_GRADING_PRESETS: Record<
  ColorGradingPresetId,
  { lift: [number, number, number]; gamma: [number, number, number]; gain: [number, number, number] }
> = {
  neutral: { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1] },
  cinematic: { lift: [0.02, 0.01, 0], gamma: [0.95, 0.98, 1.05], gain: [1.05, 1.02, 0.98] },
  highContrast: { lift: [-0.02, -0.02, -0.02], gamma: [1.1, 1.1, 1.1], gain: [1.2, 1.15, 1.1] },
}

/** Wave 28 — CSS thumbnail swatches for preset picker. */
export const COLOR_GRADING_PRESET_THUMBNAILS: Record<
  ColorGradingPresetId,
  { label: string; gradient: string }
> = {
  neutral: {
    label: 'Neutral',
    gradient: 'linear-gradient(135deg, #6a7a8a 0%, #9aa8b8 50%, #c8d0d8 100%)',
  },
  cinematic: {
    label: 'Cinematic',
    gradient: 'linear-gradient(135deg, #3a2818 0%, #8a6040 45%, #c8a878 100%)',
  },
  highContrast: {
    label: 'High contrast',
    gradient: 'linear-gradient(135deg, #0a0c10 0%, #4a5058 50%, #e8ecf0 100%)',
  },
}

export const COLOR_GRADING_PRESET_IDS: ColorGradingPresetId[] = ['neutral', 'cinematic', 'highContrast']

/** Wave 27 — scale manual/preset LGG by scene exposure (UE post-process analog). */
export function applyExposureToColorGrading(
  settings: Pick<ColorGradingSettings, 'lift' | 'gamma' | 'gain'>,
  exposure = 0.75,
): Pick<ColorGradingSettings, 'lift' | 'gamma' | 'gain'> {
  const e = Math.max(0.25, Math.min(2, exposure))
  const gainMul = e / 0.75
  const liftBias = (e - 0.75) * 0.06
  return {
    lift: [
      settings.lift[0] + liftBias,
      settings.lift[1] + liftBias * 0.5,
      settings.lift[2] + liftBias * 0.25,
    ],
    gamma: settings.gamma,
    gain: [settings.gain[0] * gainMul, settings.gain[1] * gainMul, settings.gain[2] * gainMul],
  }
}

export function getColorGradingPreset(env: EnvironmentSettings): ColorGradingPreset {
  return (env.postColorGradingPreset as ColorGradingPreset) ?? 'off'
}

function settingsForPresetId(
  preset: ColorGradingPreset,
  env: EnvironmentSettings,
): ColorGradingSettings {
  const exposure = env.exposure ?? 0.75
  const manual = {
    lift: env.postLift ?? [0, 0, 0],
    gamma: env.postGamma ?? [1, 1, 1],
    gain: env.postGain ?? [1, 1, 1],
  }
  const base =
    preset !== 'off' && preset in COLOR_GRADING_PRESETS
      ? COLOR_GRADING_PRESETS[preset as ColorGradingPresetId]
      : manual
  const scaled = applyExposureToColorGrading(base, exposure)
  return {
    enabled: env.postColorGrading === true || preset !== 'off',
    ...scaled,
  }
}

/** Wave 29 — lerp lift/gamma/gain between two grading presets (A/B compare). */
export function blendColorGradingSettings(
  a: ColorGradingSettings,
  b: ColorGradingSettings,
  t: number,
): ColorGradingSettings {
  const u = Math.max(0, Math.min(1, t))
  const lerp3 = (x: [number, number, number], y: [number, number, number]): [number, number, number] => [
    x[0] + (y[0] - x[0]) * u,
    x[1] + (y[1] - x[1]) * u,
    x[2] + (y[2] - x[2]) * u,
  ]
  return {
    enabled: a.enabled || b.enabled,
    lift: lerp3(a.lift, b.lift),
    gamma: lerp3(a.gamma, b.gamma),
    gain: lerp3(a.gain, b.gain),
  }
}

export function getColorGradingCompareT(env: EnvironmentSettings): number {
  return Math.max(0, Math.min(1, env.postGradingCompareT ?? 0))
}

export function getColorGradingSettings(env: EnvironmentSettings): ColorGradingSettings {
  const compareT = getColorGradingCompareT(env)
  const compareA = (env.postGradingCompareA as ColorGradingPreset | undefined) ?? getColorGradingPreset(env)
  const compareB = (env.postGradingCompareB as ColorGradingPreset | undefined) ?? 'neutral'
  if (compareT > 0.001 && compareA !== 'off' && compareB !== 'off' && compareA !== compareB) {
    return blendColorGradingSettings(
      settingsForPresetId(compareA, env),
      settingsForPresetId(compareB, env),
      compareT,
    )
  }
  return settingsForPresetId(getColorGradingPreset(env), env)
}

/** Wave 27 — ACES exposure uses scene exposure with mild highlight rolloff bias. */
export function getACESExposure(env: EnvironmentSettings): number {
  const e = env.exposure ?? 0.75
  return Math.max(0.35, Math.min(1.6, e * (env.postAces ? 1.02 : 1)))
}

export function createColorGradingPass(settings: ColorGradingSettings = { enabled: true, lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1] }): ShaderPass | null {
  if (!settings.enabled) return null
  const pass = new ShaderPass(ColorGradingShader)
  updateColorGradingPass(pass, settings)
  return pass
}

export function updateColorGradingPass(
  pass: ShaderPass | null,
  settings: ColorGradingSettings,
  lut?: ColorGradingLUTState,
) {
  if (!pass) return
  pass.enabled = settings.enabled || (lut?.enabled ?? false)
  pass.material.uniforms.lift.value.set(...settings.lift)
  pass.material.uniforms.gamma.value.set(...settings.gamma)
  pass.material.uniforms.gain.value.set(...settings.gain)
  if (lut) {
    pass.material.uniforms.lutMap.value = lut.texture
    pass.material.uniforms.lutSize.value = lut.size
    pass.material.uniforms.lutEnabled.value = lut.enabled ? 1 : 0
    pass.material.uniforms.lutStrength.value = lut.strength
  }
}

/** Wave 26 — TSL lift/gamma/gain + optional ACES filmic tonemap stub. */
export interface TSLColorGradingOps {
  vec3: (x: number, y: number, z: number) => unknown
  vec4: (rgb: unknown, a: unknown) => unknown
  float: (n: number) => unknown
  add: (a: unknown, b: unknown) => unknown
  mul: (a: unknown, b: unknown) => unknown
  max: (a: unknown, b: unknown) => unknown
  pow: (a: unknown, b: unknown) => unknown
  acesFilmicToneMapping: (color: unknown, exposure: unknown) => unknown
}

export function applyColorGradingTSL(
  colorNode: unknown,
  settings: ColorGradingSettings,
  tsl: TSLColorGradingOps,
  opts: { aces?: boolean; exposure?: number; lut?: ColorGradingLUTState; lutOps?: GradingLUTTslOps } = {},
): unknown {
  if (!settings.enabled && !opts.aces) return colorNode
  const node = colorNode as { rgb?: unknown; a?: unknown }
  const zero = tsl.float(0)
    const minGamma = tsl.vec3(0.01, 0.01, 0.01)
  let rgb = node.rgb ?? colorNode
  if (settings.enabled) {
    const lift = tsl.vec3(settings.lift[0], settings.lift[1], settings.lift[2])
    const gamma = tsl.vec3(settings.gamma[0], settings.gamma[1], settings.gamma[2])
    const gain = tsl.vec3(settings.gain[0], settings.gain[1], settings.gain[2])
    rgb = tsl.pow(tsl.max(tsl.add(rgb, lift), zero), tsl.max(gamma, minGamma))
    rgb = tsl.mul(rgb, gain)
  }
  if (opts.lut?.enabled && opts.lutOps) {
    rgb = applyGradingLUTTSL(rgb, opts.lut, opts.lutOps)
  }
  if (opts.aces) {
    const exp = Math.max(0.35, opts.exposure ?? 0.75)
    rgb = tsl.acesFilmicToneMapping(rgb, tsl.float(exp))
  }
  if (node.a !== undefined) return tsl.vec4(rgb, node.a)
  return rgb
}

/** Wave 28 — per-preset ACES toggle (falls back to global postAces). */
export function getPresetACESEnabled(
  env: EnvironmentSettings,
  preset: ColorGradingPreset = getColorGradingPreset(env),
): boolean {
  if (preset === 'off') return env.postAces === true
  const per = env.postPresetAces?.[preset]
  if (per != null) return per
  return env.postAces === true
}

export function getACESPostEnabled(env: EnvironmentSettings): boolean {
  const preset = getColorGradingPreset(env)
  if (preset !== 'off') return getPresetACESEnabled(env, preset)
  return env.postAces === true
}