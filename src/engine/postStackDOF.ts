import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import type { CameraProps, EnvironmentSettings } from './types'

/** Wave 21 — honest DOF stub (radial vignette blur, not full bokeh). */

const DOFStubShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    focus: { value: 0.45 },
    aperture: { value: 0.035 },
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
    uniform float focus;
    uniform float aperture;
    varying vec2 vUv;
    void main() {
      vec2 uv = vUv;
      vec2 c = uv - vec2(0.5);
      float dist = length(c);
      float blur = smoothstep(focus, focus + aperture, dist);
      vec4 col = texture2D(tDiffuse, uv);
      vec4 acc = col;
      acc += texture2D(tDiffuse, uv + vec2(0.002, 0.0) * blur);
      acc += texture2D(tDiffuse, uv - vec2(0.002, 0.0) * blur);
      acc += texture2D(tDiffuse, uv + vec2(0.0, 0.002) * blur);
      acc += texture2D(tDiffuse, uv - vec2(0.0, 0.002) * blur);
      gl_FragColor = acc / 5.0;
    }
  `,
}

export interface DOFStubSettings {
  enabled: boolean
  focus?: number
  aperture?: number
}

/** Wave 22 — TSL DepthOfFieldNode params (world units). */
export interface TSLDOFSettings {
  enabled: boolean
  focusDistance?: number
  focalLength?: number
  bokehScale?: number
}

export const DEFAULT_TSL_DOF: TSLDOFSettings = {
  enabled: true,
  focusDistance: 5,
  focalLength: 2,
  bokehScale: 1.2,
}

/** Wave 24 — optional per-camera override + cinematic focus pull (0–1 lerp). */
export function resolveCameraDOFFocusDistance(
  camera: Pick<
    CameraProps,
    'dofFocusDistance' | 'dofFocusPull' | 'dofFocusPullFrom' | 'dofFocusPullTo' | 'dofFocusPullDuration'
  >,
  envFocusDistance: number,
  focusPullT?: number,
): number {
  const base = camera.dofFocusDistance ?? envFocusDistance
  if (!camera.dofFocusPull || focusPullT == null) return base
  const from = camera.dofFocusPullFrom ?? base
  const to = camera.dofFocusPullTo ?? base
  const t = Math.max(0, Math.min(1, focusPullT))
  return from + (to - from) * t
}

/** Wave 23 — DOF settings from environment (WebGL stub + TSL bokeh parity). */
export function getDOFSettings(
  env: EnvironmentSettings,
  camera?: Pick<
    CameraProps,
    | 'dofOverride'
    | 'dofFocusDistance'
    | 'dofFocalLength'
    | 'dofBokehScale'
    | 'dofFocus'
    | 'dofAperture'
    | 'dofFocusPull'
    | 'dofFocusPullFrom'
    | 'dofFocusPullTo'
    | 'dofFocusPullDuration'
  > | null,
  focusPullT?: number,
): {
  webgl: DOFStubSettings
  tsl: TSLDOFSettings
  focusPullActive: boolean
} {
  const envEnabled = env.postDof === true
  const camOverride = camera?.dofOverride === true
  const enabled = camOverride ? true : envEnabled
  const envFocusDistance = env.postDofFocusDistance ?? 5
  const focusDistance = camera
    ? resolveCameraDOFFocusDistance(camera, envFocusDistance, focusPullT)
    : envFocusDistance
  const focusPullActive = !!(camera?.dofFocusPull && focusPullT != null && focusPullT < 1)
  return {
    focusPullActive,
    webgl: {
      enabled,
      focus: camOverride ? (camera!.dofFocus ?? env.postDofFocus ?? 0.45) : (env.postDofFocus ?? 0.45),
      aperture: camOverride ? (camera!.dofAperture ?? env.postDofAperture ?? 0.035) : (env.postDofAperture ?? 0.035),
    },
    tsl: {
      enabled,
      focusDistance,
      focalLength: camOverride
        ? (camera!.dofFocalLength ?? env.postDofFocalLength ?? 2)
        : (env.postDofFocalLength ?? 2),
      bokehScale: camOverride
        ? (camera!.dofBokehScale ?? env.postDofBokehScale ?? 1.2)
        : (env.postDofBokehScale ?? 1.2),
    },
  }
}

export function createDOFStubPass(settings: DOFStubSettings = { enabled: true }): ShaderPass | null {
  if (!settings.enabled) return null
  const pass = new ShaderPass(DOFStubShader)
  pass.enabled = true
  if (settings.focus != null) pass.material.uniforms.focus.value = settings.focus
  if (settings.aperture != null) pass.material.uniforms.aperture.value = settings.aperture
  return pass
}

export function updateDOFStubPass(pass: ShaderPass | null, settings: DOFStubSettings) {
  if (!pass) return
  pass.enabled = settings.enabled
  if (settings.focus != null) pass.material.uniforms.focus.value = settings.focus
  if (settings.aperture != null) pass.material.uniforms.aperture.value = settings.aperture
}