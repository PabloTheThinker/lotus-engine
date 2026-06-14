import * as THREE from 'three'
import type { LandscapeProps } from './types'

/** Wave 11 — landscape splat texture (replaces vertex-color paint path). */

const SPLAT_VERT = /* glsl */ `
varying vec2 vSplatUv;
void main() {
  vSplatUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const SPLAT_FRAG = /* glsl */ `
uniform sampler2D splatMap;
uniform vec3 layer0;
uniform vec3 layer1;
uniform vec3 layer2;
uniform vec3 layer3;
varying vec2 vSplatUv;
void main() {
  vec4 w = texture2D(splatMap, vSplatUv);
  float sum = w.r + w.g + w.b + w.a;
  if (sum < 0.001) w = vec4(1.0, 0.0, 0.0, 0.0);
  else w /= sum;
  vec3 col = layer0 * w.r + layer1 * w.g + layer2 * w.b + layer3 * w.a;
  gl_FragColor = vec4(col, 1.0);
}
`

export function buildSplatMapFromWeights(
  weights: number[],
  vertexCount: number,
  resolution: number,
): THREE.DataTexture {
  const res = Math.max(16, Math.min(512, resolution))
  const data = new Float32Array(res * res * 4)
  const side = Math.floor(Math.sqrt(vertexCount))
  for (let i = 0; i < vertexCount; i++) {
    const sx = i % side
    const sy = Math.floor(i / side)
    const u = Math.min(res - 1, Math.floor((sx / Math.max(1, side)) * (res - 1)))
    const v = Math.min(res - 1, Math.floor((sy / Math.max(1, side)) * (res - 1)))
    const o = (v * res + u) * 4
    data[o] = weights[i * 4] ?? 1
    data[o + 1] = weights[i * 4 + 1] ?? 0
    data[o + 2] = weights[i * 4 + 2] ?? 0
    data[o + 3] = weights[i * 4 + 3] ?? 0
  }
  const tex = new THREE.DataTexture(data, res, res, THREE.RGBAFormat, THREE.FloatType)
  tex.needsUpdate = true
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping
  tex.minFilter = THREE.LinearFilter
  tex.magFilter = THREE.LinearFilter
  return tex
}

export function createLandscapeSplatMaterial(props: LandscapeProps): THREE.ShaderMaterial {
  const layers = props.layerColors ?? ['#46553f', '#6e6e72', '#6e5239', '#dfe7ec']
  const cols = layers.map((c) => new THREE.Color(c))
  const vcount = props.weights?.length ? props.weights.length / 4 : 0
  const splatMap = buildSplatMapFromWeights(props.weights ?? [], vcount, props.splatResolution ?? 128)
  return new THREE.ShaderMaterial({
    uniforms: {
      splatMap: { value: splatMap },
      layer0: { value: cols[0] },
      layer1: { value: cols[1] },
      layer2: { value: cols[2] },
      layer3: { value: cols[3] },
    },
    vertexShader: SPLAT_VERT,
    fragmentShader: SPLAT_FRAG,
  })
}

export function refreshLandscapeSplatMaterial(mat: THREE.ShaderMaterial, props: LandscapeProps) {
  const layers = props.layerColors ?? ['#46553f', '#6e6e72', '#6e5239', '#dfe7ec']
  const cols = layers.map((c) => new THREE.Color(c))
  const vcount = props.weights?.length ? props.weights.length / 4 : 0
  const old = mat.uniforms.splatMap.value as THREE.DataTexture | undefined
  old?.dispose()
  mat.uniforms.splatMap.value = buildSplatMapFromWeights(props.weights ?? [], vcount, props.splatResolution ?? 128)
  mat.uniforms.layer0.value = cols[0]
  mat.uniforms.layer1.value = cols[1]
  mat.uniforms.layer2.value = cols[2]
  mat.uniforms.layer3.value = cols[3]
}