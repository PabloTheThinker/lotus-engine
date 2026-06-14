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