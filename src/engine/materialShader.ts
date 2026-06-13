import * as THREE from 'three'
import type { MaterialGraph } from './materialGraph'
import { MAT_NODE_DEFS } from './materialGraph'

/** GLSL simplex noise (Ashima / Ian McEwan) — injected once when a Noise node is used. */
const SIMPLEX_GLSL = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`

export interface CompiledMaterialShader {
  uniforms: Record<string, THREE.IUniform>
  /** snippet assignments for output channels (GLSL expr strings) */
  channels: Partial<Record<string, string>>
  helperFunctions: string
  graphKey: string
}

type ShaderType = 'float' | 'vec3'
interface ShaderExpr {
  expr: string
  type: ShaderType
}

function hexToVec3GLSL(hex: string): string {
  const c = new THREE.Color(hex)
  return `vec3(${c.r.toFixed(6)}, ${c.g.toFixed(6)}, ${c.b.toFixed(6)})`
}

function graphKey(graph: MaterialGraph): string {
  return JSON.stringify(graph)
}

function makeSolidTexture(color: string): THREE.DataTexture {
  const c = new THREE.Color(color)
  const data = new Uint8Array([Math.round(c.r * 255), Math.round(c.g * 255), Math.round(c.b * 255), 255])
  const tex = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat)
  tex.needsUpdate = true
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

function makeDataTextureFromImageData(imageData: ImageData): THREE.DataTexture {
  const tex = new THREE.DataTexture(imageData.data, imageData.width, imageData.height, THREE.RGBAFormat)
  tex.needsUpdate = true
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
}

/** Build a 64×64 canvas preview from a data URL (async-safe fallback to solid color). */
function textureFromProps(
  nodeId: string,
  props: Record<string, string | number>,
  uniforms: Record<string, THREE.IUniform>,
  textures: THREE.Texture[],
): string {
  const uniformName = `uMatTex_${nodeId.replace(/[^a-zA-Z0-9]/g, '_')}`
  const fallback = String(props.color ?? '#808080')
  let tex: THREE.Texture = makeSolidTexture(fallback)
  const dataUrl = String(props.dataUrl ?? '')
  if (dataUrl.startsWith('data:image')) {
    try {
      const img = new Image()
      img.src = dataUrl
      if (img.complete && img.width > 0) {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height
        const ctx = canvas.getContext('2d')!
        ctx.drawImage(img, 0, 0)
        const id = ctx.getImageData(0, 0, canvas.width, canvas.height)
        tex = makeDataTextureFromImageData(id)
      }
    } catch {
      /* solid fallback */
    }
  }
  uniforms[uniformName] = { value: tex }
  textures.push(tex)
  return uniformName
}

function toVec3Expr(v: ShaderExpr): string {
  return v.type === 'vec3' ? v.expr : `vec3(${v.expr})`
}

function toFloatExpr(v: ShaderExpr): string {
  return v.type === 'float' ? v.expr : `(${v.expr}.x + ${v.expr}.y + ${v.expr}.z) / 3.0`
}

function broadcastGLSL(a: ShaderExpr, b: ShaderExpr, op: string): ShaderExpr {
  if (a.type === 'float' && b.type === 'float') return { expr: `(${a.expr} ${op} ${b.expr})`, type: 'float' }
  const va = toVec3Expr(a)
  const vb = toVec3Expr(b)
  return { expr: `(${va} ${op} ${vb})`, type: 'vec3' }
}

/**
 * Transpile a material graph into GLSL channel expressions + uniforms.
 * Injected into MeshStandardMaterial via onBeforeCompile (three.js r184).
 */
export function compileMaterialShader(graph: MaterialGraph): CompiledMaterialShader {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const cache = new Map<string, ShaderExpr>()
  const uniforms: Record<string, THREE.IUniform> = {
    uMatTime: { value: 0 },
  }
  const textures: THREE.Texture[] = []
  const needsNoise = graph.nodes.some((n) => n.type === 'Noise')
  const needsUv = graph.nodes.some((n) => n.type === 'UV' || n.type === 'TextureSample' || n.type === 'Noise')

  const compileNode = (id: string, depth: number): ShaderExpr => {
    if (depth > 48) return { expr: '0.0', type: 'float' }
    if (cache.has(id)) return cache.get(id)!
    const node = byId.get(id)
    const def = node && MAT_NODE_DEFS[node.type]
    if (!node || !def) return { expr: '0.0', type: 'float' }

    const inputs: Record<string, ShaderExpr> = {}
    for (const inp of def.inputs) {
      const edge = graph.edges.find((e) => e.to === `${node.id}:${inp}`)
      if (edge) inputs[inp] = compileNode(edge.from, depth + 1)
    }

    let result: ShaderExpr
    const p = node.props
    switch (node.type) {
      case 'Color':
        result = { expr: hexToVec3GLSL(String(p.value ?? '#5b8def')), type: 'vec3' }
        break
      case 'Scalar':
        result = { expr: `${Number(p.value ?? 1).toFixed(6)}`, type: 'float' }
        break
      case 'Time':
        result = { expr: 'uMatTime', type: 'float' }
        break
      case 'Sine': {
        const inn = toFloatExpr(inputs.in ?? { expr: '0.0', type: 'float' })
        const freq = Number(p.frequency ?? 1)
        result = { expr: `sin((${inn}) * ${freq.toFixed(6)} * 6.28318530718)`, type: 'float' }
        break
      }
      case 'Pulse': {
        const inn = toFloatExpr(inputs.in ?? { expr: '0.0', type: 'float' })
        const speed = Number(p.speed ?? 1)
        result = { expr: `(0.5 + 0.5 * sin((${inn}) * ${speed.toFixed(6)} * 6.28318530718))`, type: 'float' }
        break
      }
      case 'Multiply':
        result = broadcastGLSL(inputs.a ?? { expr: '1.0', type: 'float' }, inputs.b ?? { expr: '1.0', type: 'float' }, '*')
        break
      case 'Add':
        result = broadcastGLSL(inputs.a ?? { expr: '0.0', type: 'float' }, inputs.b ?? { expr: '0.0', type: 'float' }, '+')
        break
      case 'Lerp': {
        const tExpr = `clamp(${toFloatExpr(inputs.t ?? { expr: '0.5', type: 'float' })}, 0.0, 1.0)`
        const a = inputs.a ?? { expr: '0.0', type: 'float' }
        const b = inputs.b ?? { expr: '1.0', type: 'float' }
        if (a.type === 'float' && b.type === 'float') {
          result = { expr: `mix(${a.expr}, ${b.expr}, ${tExpr})`, type: 'float' }
        } else {
          result = { expr: `mix(${toVec3Expr(a)}, ${toVec3Expr(b)}, ${tExpr})`, type: 'vec3' }
        }
        break
      }
      case 'UV':
        result = { expr: 'vMatGraphUv', type: 'vec3' }
        break
      case 'TextureSample': {
        const uv = inputs.uv ?? { expr: 'vMatGraphUv', type: 'vec3' }
        const uv2 = uv.type === 'vec3' ? `${uv.expr}.xy` : `vec2(${uv.expr})`
        const texUniform = textureFromProps(node.id, p, uniforms, textures)
        result = { expr: `texture2D(${texUniform}, ${uv2}).rgb`, type: 'vec3' }
        break
      }
      case 'Fresnel': {
        const bias = Number(p.bias ?? 0.1)
        const power = Number(p.power ?? 2)
        const scale = Number(p.scale ?? 1)
        result = {
          expr: `(${scale.toFixed(6)} * pow(1.0 - max(dot(normalize(vViewPosition), normal), 0.0) + ${bias.toFixed(6)}, ${power.toFixed(6)}))`,
          type: 'float',
        }
        break
      }
      case 'Noise': {
        const uv = inputs.uv ?? { expr: 'vMatGraphUv', type: 'vec3' }
        const scale = Number(p.scale ?? 4)
        const uv3 =
          uv.type === 'vec3'
            ? `vec3(${uv.expr}.xy * ${scale.toFixed(6)}, uMatTime)`
            : `vec3(${uv.expr} * ${scale.toFixed(6)}, uMatTime)`
        result = { expr: `(0.5 + 0.5 * snoise(${uv3}))`, type: 'float' }
        break
      }
      default:
        result = { expr: '0.0', type: 'float' }
    }
    cache.set(id, result)
    return result
  }

  const out = graph.nodes.find((n) => n.type === 'Output')
  const channels: Partial<Record<string, string>> = {}
  if (out) {
    for (const inp of MAT_NODE_DEFS.Output.inputs) {
      const edge = graph.edges.find((e) => e.to === `${out.id}:${inp}`)
      if (!edge) continue
      const v = compileNode(edge.from, 0)
      if (inp === 'baseColor' || inp === 'emissive') channels[inp] = toVec3Expr(v)
      else channels[inp] = toFloatExpr(v)
    }
  }

  let helperFunctions = ''
  if (needsNoise) helperFunctions += SIMPLEX_GLSL
  if (needsUv) {
    helperFunctions += 'varying vec2 vMatGraphUv;\n'
  }

  // touch textures array so callers can dispose
  void textures

  return {
    uniforms,
    channels,
    helperFunctions,
    graphKey: graphKey(graph) + (needsUv ? ':uv' : '') + (needsNoise ? ':noise' : ''),
  }
}

export interface GpuMaterialState {
  graphKey: string
  uniforms: Record<string, THREE.IUniform>
  textures: THREE.Texture[]
}

const GPU_STATE = Symbol('vektraGpuMat')

function getGpuState(mat: THREE.Material): GpuMaterialState | undefined {
  return (mat as THREE.Material & { [GPU_STATE]?: GpuMaterialState })[GPU_STATE]
}

function setGpuState(mat: THREE.Material, state: GpuMaterialState | undefined) {
  ;(mat as THREE.Material & { [GPU_STATE]?: GpuMaterialState })[GPU_STATE] = state
}

function disposeGpuState(mat: THREE.Material) {
  const st = getGpuState(mat)
  if (!st) return
  for (const t of st.textures) t.dispose()
  setGpuState(mat, undefined)
}

/** Install onBeforeCompile on a MeshStandardMaterial from a compiled graph. */
export function installMaterialShader(
  material: THREE.MeshStandardMaterial,
  graph: MaterialGraph,
  compiled?: CompiledMaterialShader,
): GpuMaterialState {
  const c = compiled ?? compileMaterialShader(graph)
  const prev = getGpuState(material)
  if (prev?.graphKey === c.graphKey) return prev

  disposeGpuState(material)

  const textures: THREE.Texture[] = []
  for (const u of Object.values(c.uniforms)) {
    if (u.value instanceof THREE.Texture) textures.push(u.value)
  }

  const state: GpuMaterialState = { graphKey: c.graphKey, uniforms: c.uniforms, textures }
  setGpuState(material, state)

  const { channels, helperFunctions } = c
  const cacheKey = `vektra_mat_${c.graphKey.length}_${c.graphKey.slice(0, 32)}`

  material.customProgramCacheKey = () => cacheKey
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, state.uniforms)

    if (helperFunctions.includes('vMatGraphUv')) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec2 vMatGraphUv;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>\nvMatGraphUv = uv;`)
    }

    const fragHeader =
      (helperFunctions.includes('vMatGraphUv') ? 'varying vec2 vMatGraphUv;\n' : '') +
      helperFunctions.replace('varying vec2 vMatGraphUv;\n', '')
    if (fragHeader.trim()) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\n${fragHeader}`)
    }

    let colorPatch = '#include <color_fragment>'
    if (channels.baseColor) colorPatch += `\ndiffuseColor.rgb = ${channels.baseColor};`
    if (channels.opacity) colorPatch += `\ndiffuseColor.a = clamp(${channels.opacity}, 0.0, 1.0);`
    if (channels.baseColor || channels.opacity) {
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', colorPatch)
    }
    if (channels.emissive || channels.emissiveInt) {
      const em = channels.emissive ?? 'diffuseColor.rgb'
      const ei = channels.emissiveInt ?? '1.0'
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>\ntotalEmissiveRadiance = ${em} * ${ei};`,
      )
    }
    if (channels.roughness) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>\nroughnessFactor = clamp(${channels.roughness}, 0.0, 1.0);`,
      )
    }
    if (channels.metalness) {
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>\nmetalnessFactor = clamp(${channels.metalness}, 0.0, 1.0);`,
      )
    }
  }

  material.needsUpdate = true
  return state
}

/** Remove GPU graph injection and restore default shading. */
export function clearMaterialShader(material: THREE.MeshStandardMaterial) {
  disposeGpuState(material)
  material.onBeforeCompile = () => {}
  material.customProgramCacheKey = () => 'vektra_std'
  material.needsUpdate = true
}

/** Update time uniform on an installed GPU material graph. */
export function updateMaterialShaderTime(material: THREE.MeshStandardMaterial, t: number) {
  const st = getGpuState(material)
  if (st?.uniforms.uMatTime) st.uniforms.uMatTime.value = t
}