import * as THREE from 'three'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import type { SSGISettings } from './ssgiPreset'

/** Wave 13 — honest SSGI approx pass (screen-space color bleed, hooks after SSAO). */

const SSGIShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    intensity: { value: 0.5 },
    radius: { value: 0.65 },
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
    uniform float intensity;
    uniform float radius;
    varying vec2 vUv;
    void main() {
      vec4 center = texture2D(tDiffuse, vUv);
      vec3 acc = center.rgb;
      float w = 1.0;
      vec2 px = radius / vec2(1024.0, 768.0);
      for (int i = -2; i <= 2; i++) {
        for (int j = -2; j <= 2; j++) {
          if (i == 0 && j == 0) continue;
          vec2 o = vec2(float(i), float(j)) * px;
          vec3 s = texture2D(tDiffuse, vUv + o).rgb;
          acc += s * 0.15;
          w += 0.15;
        }
      }
      vec3 gi = acc / w;
      gl_FragColor = vec4(mix(center.rgb, gi, intensity * 0.35), center.a);
    }
  `,
}

export function createSSGIPass(settings: SSGISettings): ShaderPass | null {
  if (!settings.enabled || settings.preset === 'off' || settings.intensity <= 0) return null
  const pass = new ShaderPass(SSGIShader)
  pass.enabled = true
  pass.material.uniforms.intensity.value = settings.intensity
  pass.material.uniforms.radius.value = settings.radius
  return pass
}

export function updateSSGIPass(pass: ShaderPass | null, settings: SSGISettings) {
  if (!pass) return
  pass.enabled = settings.enabled && settings.preset !== 'off'
  pass.material.uniforms.intensity.value = settings.intensity
  pass.material.uniforms.radius.value = settings.radius
}