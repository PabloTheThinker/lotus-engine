import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'

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