import * as THREE from 'three'
import type { MaterialGraph, MatNode, MatValue } from './materialGraph'
import { MAT_NODE_DEFS, evaluateMaterialGraph } from './materialGraph'

const toVec = (v: MatValue): [number, number, number] => (typeof v === 'number' ? [v, v, v] : v)
const toNum = (v: MatValue): number => (typeof v === 'number' ? v : (v[0] + v[1] + v[2]) / 3)

/**
 * TSL material backend (Wave 11–17) — per-node TSL graph compile on MeshPhysicalNodeMaterial.
 */

export type MaterialBackend = 'glsl' | 'tsl'

type NodeMatCtor = new () => THREE.Material & {
  colorNode?: unknown
  emissiveNode?: unknown
  roughnessNode?: unknown
  metalnessNode?: unknown
  opacityNode?: unknown
}
let cachedNodeMat: NodeMatCtor | null | undefined
let cachedTsl: Record<string, unknown> | null = null

async function resolveNodeMaterialCtor(): Promise<NodeMatCtor | null> {
  if (cachedNodeMat !== undefined) return cachedNodeMat
  try {
    const m = await import('three/webgpu')
    const Ctor = (m as unknown as { MeshPhysicalNodeMaterial?: NodeMatCtor }).MeshPhysicalNodeMaterial
    cachedNodeMat = Ctor ?? null
  } catch {
    cachedNodeMat = null
  }
  return cachedNodeMat
}

void resolveNodeMaterialCtor()
void import('three/tsl').then((m) => {
  cachedTsl = m as unknown as Record<string, unknown>
})

export function isTSLPreviewAvailable(): boolean {
  return cachedNodeMat != null && cachedTsl != null
}

export async function isTSLPreviewAvailableAsync(): Promise<boolean> {
  await resolveNodeMaterialCtor()
  if (!cachedTsl) {
    try {
      cachedTsl = (await import('three/tsl')) as unknown as Record<string, unknown>
    } catch {
      cachedTsl = null
    }
  }
  return cachedNodeMat != null && cachedTsl != null
}

type TSLVal = unknown

function hexColor(tsl: Record<string, unknown>, hex: string): TSLVal {
  const c = new THREE.Color(hex)
  const color = tsl.color as (r: number, g?: number, b?: number) => TSLVal
  return color(c.r, c.g, c.b)
}

function asFloat(tsl: Record<string, unknown>, v: TSLVal): TSLVal {
  const f = tsl.float as (n: unknown) => TSLVal
  return f(v)
}

/** Wave 17 — compile a material graph node tree to TSL node values. */
export function compileMaterialGraphTSLNodes(graph: MaterialGraph): Record<string, TSLVal> | null {
  const tsl = cachedTsl
  if (!tsl) return null
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const memo = new Map<string, TSLVal>()
  const float = tsl.float as (n: number) => TSLVal
  const sin = tsl.sin as (n: TSLVal) => TSLVal
  const mul = tsl.mul as (a: TSLVal, b: TSLVal) => TSLVal
  const add = tsl.add as (a: TSLVal, b: TSLVal) => TSLVal
  const mix = tsl.mix as (a: TSLVal, b: TSLVal, t: TSLVal) => TSLVal
  const time = tsl.time as TSLVal
  const uv = tsl.uv as () => TSLVal
  const vec3n = tsl.vec3 as (a: TSLVal, b?: TSLVal, c?: TSLVal) => TSLVal

  const inputOf = (node: MatNode, port: string): TSLVal | undefined => {
    const edge = graph.edges.find((e) => e.to === `${node.id}:${port}`)
    if (!edge) return undefined
    return compileNode(edge.from, 0)
  }

  const compileNode = (id: string, depth: number): TSLVal => {
    if (memo.has(id)) return memo.get(id)!
    if (depth > 32) return float(0)
    const node = byId.get(id)
    if (!node) return float(0)
    let out: TSLVal = float(0)
    switch (node.type) {
      case 'Color':
        out = hexColor(tsl, String(node.props.value ?? '#5b8def'))
        break
      case 'Scalar':
        out = float(Number(node.props.value ?? 1))
        break
      case 'Time':
        out = time
        break
      case 'UV':
        out = uv()
        break
      case 'Sine': {
        const inp = inputOf(node, 'in') ?? time
        const freq = float(Number(node.props.frequency ?? 1) * Math.PI * 2)
        out = sin(mul(inp, freq))
        break
      }
      case 'Pulse': {
        const inp = inputOf(node, 'in') ?? time
        const spd = float(Number(node.props.speed ?? 1) * Math.PI * 2)
        const wave = sin(mul(inp, spd))
        out = add(float(0.5), mul(wave, float(0.5)))
        break
      }
      case 'Multiply':
        out = mul(inputOf(node, 'a') ?? float(1), inputOf(node, 'b') ?? float(1))
        break
      case 'Add':
        out = add(inputOf(node, 'a') ?? float(0), inputOf(node, 'b') ?? float(0))
        break
      case 'Lerp':
        out = mix(
          inputOf(node, 'a') ?? float(0),
          inputOf(node, 'b') ?? float(1),
          inputOf(node, 't') ?? float(0.5),
        )
        break
      case 'Fresnel': {
        const bias = float(Number(node.props.bias ?? 0.1))
        const scale = float(Number(node.props.scale ?? 1))
        out = mul(add(bias, float(0.4)), scale)
        break
      }
      case 'Noise': {
        const uvin = inputOf(node, 'uv') ?? uv()
        const scale = float(Number(node.props.scale ?? 4))
        out = mul(sin(mul(uvin, scale)), float(0.5))
        break
      }
      case 'TextureSample':
        out = hexColor(tsl, String(node.props.color ?? '#808080'))
        break
      case 'WorldPosition':
      case 'ObjectPosition':
        out = vec3n(float(0))
        break
      case 'ClearCoat':
        out = float(Number(node.props.amount ?? 0.8))
        break
      case 'Sheen':
        out = hexColor(tsl, String(node.props.color ?? '#ffffff'))
        break
      default:
        out = float(0)
    }
    memo.set(id, out)
    return out
  }

  const output = graph.nodes.find((n) => n.type === 'Output')
  if (!output) return null
  const channels: Record<string, TSLVal> = {}
  for (const inp of MAT_NODE_DEFS.Output.inputs) {
    const edge = graph.edges.find((e) => e.to === `${output.id}:${inp}`)
    if (edge) channels[inp] = compileNode(edge.from, 0)
  }
  return Object.keys(channels).length ? channels : null
}

/** Wave 18 — channel names compiled from live node graph (Material Editor preview badge). */
export function materialGraphTSLPreviewChannels(graph: MaterialGraph): string[] {
  const nodes = compileMaterialGraphTSLNodes(graph)
  return nodes ? Object.keys(nodes) : []
}

/** Wave 21 — preview channel label when wiring into an Output (or other) input port. */
export function previewChannelForPort(
  graph: MaterialGraph,
  toNodeId: string,
  toPort: string,
): string | null {
  const node = graph.nodes.find((n) => n.id === toNodeId)
  if (!node) return null
  if (node.type === 'Output') return toPort
  const def = MAT_NODE_DEFS[node.type]
  if (def?.inputs.includes(toPort)) return `${node.type}.${toPort}`
  return toPort
}

export function serializeMaterialGraphTSL(graph: MaterialGraph, t: number): object {
  const nodes = compileMaterialGraphTSLNodes(graph)
  const out = evaluateMaterialGraph(graph, t)
  return {
    backend: 'tsl',
    version: 2,
    nodeGraph: !!nodes,
    preview: {
      baseColor: out.baseColor,
      emissive: out.emissive,
      emissiveInt: out.emissiveInt,
      roughness: out.roughness,
      metalness: out.metalness,
      opacity: out.opacity,
      clearCoat: out.clearCoat,
      clearCoatRoughness: out.clearCoatRoughness,
      sheen: out.sheen,
      sheenRoughness: out.sheenRoughness,
    },
    nodeCount: graph.nodes.length,
    edgeCount: graph.edges.length,
  }
}

export function deserializeMaterialGraphTSL(
  blob: { preview?: Record<string, MatValue> },
  graph: MaterialGraph,
  t: number,
): THREE.Material | null {
  const mat = compileMaterialGraphTSL(graph, t)
  if (!mat || !blob.preview) return mat
  const std = mat as THREE.MeshPhysicalMaterial
  const p = blob.preview
  if (p.baseColor !== undefined) {
    const [cr, cg, cb] = toVec(p.baseColor)
    std.color.setRGB(cr, cg, cb)
  }
  if (p.emissive !== undefined) {
    const [er, eg, eb] = toVec(p.emissive)
    std.emissive.setRGB(er, eg, eb)
  }
  if (p.emissiveInt !== undefined) std.emissiveIntensity = Math.max(0, toNum(p.emissiveInt))
  if (p.roughness !== undefined) std.roughness = Math.max(0, Math.min(1, toNum(p.roughness)))
  if (p.metalness !== undefined) std.metalness = Math.max(0, Math.min(1, toNum(p.metalness)))
  if (p.opacity !== undefined) {
    const op = Math.max(0, Math.min(1, toNum(p.opacity)))
    std.opacity = op
    std.transparent = op < 0.999
  }
  return mat
}

export function applyMaterialInstanceTSL(
  mat: THREE.MeshPhysicalMaterial,
  overrides: { color?: string; roughness?: number; metalness?: number; emissive?: string },
): void {
  if (overrides.color) mat.color.set(overrides.color)
  if (overrides.emissive) mat.emissive.set(overrides.emissive)
  if (overrides.roughness != null) mat.roughness = overrides.roughness
  if (overrides.metalness != null) mat.metalness = overrides.metalness
  mat.userData.lotusInstanceOverrides = overrides
}

/** Compile material graph to TSL node material (Wave 17 per-node path + CPU fallback). */
export function compileMaterialGraphTSL(
  graph: MaterialGraph,
  _t: number,
  instanceOverrides?: { color?: string; roughness?: number; metalness?: number; emissive?: string },
): THREE.Material | null {
  const NodeMaterial = cachedNodeMat
  if (!NodeMaterial) return null
  try {
    const mat = new NodeMaterial()
    const channels = compileMaterialGraphTSLNodes(graph)
    if (channels) {
      if (channels.baseColor !== undefined) mat.colorNode = channels.baseColor
      if (channels.emissive !== undefined) mat.emissiveNode = channels.emissive
      if (channels.emissiveInt !== undefined) (mat as THREE.MeshPhysicalMaterial).emissiveIntensity = 1
      if (channels.roughness !== undefined) mat.roughnessNode = asFloat(cachedTsl!, channels.roughness)
      if (channels.metalness !== undefined) mat.metalnessNode = asFloat(cachedTsl!, channels.metalness)
      if (channels.opacity !== undefined) {
        mat.opacityNode = asFloat(cachedTsl!, channels.opacity)
        mat.transparent = true
      }
      const substrate = mat as unknown as Record<string, TSLVal>
      if (channels.clearCoat !== undefined) substrate.clearcoatNode = asFloat(cachedTsl!, channels.clearCoat)
      if (channels.clearCoatRoughness !== undefined) {
        substrate.clearcoatRoughnessNode = asFloat(cachedTsl!, channels.clearCoatRoughness)
      }
      if (channels.sheen !== undefined) substrate.sheenColorNode = channels.sheen
      if (channels.sheenRoughness !== undefined) substrate.sheenRoughnessNode = asFloat(cachedTsl!, channels.sheenRoughness)
      mat.userData.lotusMaterialBackend = 'tsl'
      mat.userData.lotusGraphPreview = true
      mat.userData.lotusTSLNodeGraph = true
      if (instanceOverrides) applyMaterialInstanceTSL(mat as THREE.MeshPhysicalMaterial, instanceOverrides)
      return mat
    }

    const out = evaluateMaterialGraph(graph, _t)
    const std = mat as THREE.MeshPhysicalMaterial
    if (out.baseColor !== undefined) {
      const [cr, cg, cb] = toVec(out.baseColor)
      std.color.setRGB(cr, cg, cb)
    }
    if (out.emissive !== undefined) {
      const [er, eg, eb] = toVec(out.emissive)
      std.emissive.setRGB(er, eg, eb)
    }
    if (out.emissiveInt !== undefined) std.emissiveIntensity = Math.max(0, toNum(out.emissiveInt))
    if (out.roughness !== undefined) std.roughness = Math.max(0, Math.min(1, toNum(out.roughness)))
    if (out.metalness !== undefined) std.metalness = Math.max(0, Math.min(1, toNum(out.metalness)))
    if (out.opacity !== undefined) {
      const op = Math.max(0, Math.min(1, toNum(out.opacity)))
      std.opacity = op
      std.transparent = op < 0.999
    }
    if (instanceOverrides) applyMaterialInstanceTSL(std, instanceOverrides)
    mat.userData.lotusMaterialBackend = 'tsl'
    mat.userData.lotusGraphPreview = true
    return mat
  } catch {
    return null
  }
}