import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
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
    uniform vec3 lift;
    uniform vec3 gamma;
    uniform vec3 gain;
    varying vec2 vUv;
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = pow(max(c + lift, vec3(0.0)), max(gamma, vec3(0.01)));
      c *= gain;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
}

export function getColorGradingSettings(env: EnvironmentSettings): ColorGradingSettings {
  return {
    enabled: env.postColorGrading === true,
    lift: env.postLift ?? [0, 0, 0],
    gamma: env.postGamma ?? [1, 1, 1],
    gain: env.postGain ?? [1, 1, 1],
  }
}

export function createColorGradingPass(settings: ColorGradingSettings = { enabled: true, lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1] }): ShaderPass | null {
  if (!settings.enabled) return null
  const pass = new ShaderPass(ColorGradingShader)
  updateColorGradingPass(pass, settings)
  return pass
}

export function updateColorGradingPass(pass: ShaderPass | null, settings: ColorGradingSettings) {
  if (!pass) return
  pass.enabled = settings.enabled
  pass.material.uniforms.lift.value.set(...settings.lift)
  pass.material.uniforms.gamma.value.set(...settings.gamma)
  pass.material.uniforms.gain.value.set(...settings.gain)
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
  opts: { aces?: boolean; exposure?: number } = {},
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
  if (opts.aces) {
    rgb = tsl.acesFilmicToneMapping(rgb, tsl.float(opts.exposure ?? 0.75))
  }
  if (node.a !== undefined) return tsl.vec4(rgb, node.a)
  return rgb
}

export function getACESPostEnabled(env: EnvironmentSettings): boolean {
  return env.postAces === true
}