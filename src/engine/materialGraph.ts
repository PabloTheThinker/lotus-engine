import * as THREE from 'three'
import type { Actor } from './Actor'
import { clearMaterialShader, installMaterialShader, updateMaterialShaderTime } from './materialShader'
import { compileMaterialGraphTSL, isTSLPreviewAvailable } from './materialGraphTSL'

/**
 * Material graph — UE Material Editor analog (v1 CPU / v2 GPU):
 * dataflow node graph driving MeshStandardMaterial channels
 * (base color, emissive, roughness, metalness, opacity, world-position offset).
 * CPU mode evaluates once per frame; GPU mode transpiles to GLSL via onBeforeCompile.
 */

export type MaterialGraphMode = 'cpu' | 'gpu'

export type MatValue = number | [number, number, number]

export interface MatNode {
  id: string
  type: string
  x: number
  y: number
  props: Record<string, string | number>
}

/** data edge: from "nodeId" (single output) to "nodeId:inputName" */
export interface MatEdge {
  from: string
  to: string
}

export interface MaterialGraph {
  nodes: MatNode[]
  edges: MatEdge[]
  /** cpu = per-object fast path; gpu = per-pixel shader (default cpu) */
  mode?: MaterialGraphMode
}

export interface MatNodeDef {
  title: string
  color: string
  inputs: string[]
  hasOutput: boolean
  props: Array<{ key: string; label: string; kind: 'number' | 'color' | 'text'; default: string | number }>
  evaluate: (inputs: Record<string, MatValue | undefined>, props: Record<string, string | number>, t: number) => MatValue
}

const toVec = (v: MatValue): [number, number, number] => (typeof v === 'number' ? [v, v, v] : v)
const toNum = (v: MatValue): number => (typeof v === 'number' ? v : (v[0] + v[1] + v[2]) / 3)
const hex = (c: string): [number, number, number] => {
  const col = new THREE.Color(c)
  return [col.r, col.g, col.b]
}

function broadcast(a: MatValue, b: MatValue, op: (x: number, y: number) => number): MatValue {
  if (typeof a === 'number' && typeof b === 'number') return op(a, b)
  const va = toVec(a)
  const vb = toVec(b)
  return [op(va[0], vb[0]), op(va[1], vb[1]), op(va[2], vb[2])]
}

export const MAT_NODE_DEFS: Record<string, MatNodeDef> = {
  Output: {
    title: 'Material Output',
    color: '#7a3b3b',
    inputs: ['baseColor', 'emissive', 'emissiveInt', 'roughness', 'metalness', 'opacity', 'wpo'],
    hasOutput: false,
    props: [],
    evaluate: () => 0,
  },
  Color: {
    title: 'Color',
    color: '#3b5a7a',
    inputs: [],
    hasOutput: true,
    props: [{ key: 'value', label: 'Color', kind: 'color', default: '#5b8def' }],
    evaluate: (_i, p) => hex(String(p.value)),
  },
  Scalar: {
    title: 'Scalar',
    color: '#3b5a7a',
    inputs: [],
    hasOutput: true,
    props: [{ key: 'value', label: 'Value', kind: 'number', default: 1 }],
    evaluate: (_i, p) => Number(p.value),
  },
  Time: {
    title: 'Time',
    color: '#3b7a4d',
    inputs: [],
    hasOutput: true,
    props: [],
    evaluate: (_i, _p, t) => t,
  },
  Sine: {
    title: 'Sine',
    color: '#3b7a4d',
    inputs: ['in'],
    hasOutput: true,
    props: [{ key: 'frequency', label: 'Freq', kind: 'number', default: 1 }],
    evaluate: (i, p) => Math.sin(toNum(i.in ?? 0) * Number(p.frequency) * Math.PI * 2),
  },
  Pulse: {
    title: 'Pulse 0–1',
    color: '#3b7a4d',
    inputs: ['in'],
    hasOutput: true,
    props: [{ key: 'speed', label: 'Speed', kind: 'number', default: 1 }],
    evaluate: (i, p) => 0.5 + 0.5 * Math.sin(toNum(i.in ?? 0) * Number(p.speed) * Math.PI * 2),
  },
  Multiply: {
    title: 'Multiply',
    color: '#6b7280',
    inputs: ['a', 'b'],
    hasOutput: true,
    props: [],
    evaluate: (i) => broadcast(i.a ?? 1, i.b ?? 1, (x, y) => x * y),
  },
  Add: {
    title: 'Add',
    color: '#6b7280',
    inputs: ['a', 'b'],
    hasOutput: true,
    props: [],
    evaluate: (i) => broadcast(i.a ?? 0, i.b ?? 0, (x, y) => x + y),
  },
  Lerp: {
    title: 'Lerp',
    color: '#6b7280',
    inputs: ['a', 'b', 't'],
    hasOutput: true,
    props: [],
    evaluate: (i) => {
      const t = Math.max(0, Math.min(1, toNum(i.t ?? 0.5)))
      return broadcast(i.a ?? 0, i.b ?? 1, (x, y) => x + (y - x) * t)
    },
  },
  UV: {
    title: 'UV',
    color: '#5a4a7a',
    inputs: [],
    hasOutput: true,
    props: [],
    evaluate: () => [0.5, 0.5, 0] as [number, number, number],
  },
  TextureSample: {
    title: 'Texture Sample',
    color: '#5a4a7a',
    inputs: ['uv'],
    hasOutput: true,
    props: [
      { key: 'color', label: 'Fallback', kind: 'color', default: '#808080' },
      { key: 'dataUrl', label: 'Data URL', kind: 'text', default: '' },
    ],
    evaluate: (_i, p) => hex(String(p.color ?? '#808080')),
  },
  Fresnel: {
    title: 'Fresnel',
    color: '#7a5a3b',
    inputs: [],
    hasOutput: true,
    props: [
      { key: 'bias', label: 'Bias', kind: 'number', default: 0.1 },
      { key: 'power', label: 'Power', kind: 'number', default: 2 },
      { key: 'scale', label: 'Scale', kind: 'number', default: 1 },
    ],
    evaluate: (_i, p) => Number(p.scale ?? 1) * 0.5 + Number(p.bias ?? 0.1),
  },
  Noise: {
    title: 'Noise (simplex)',
    color: '#7a5a3b',
    inputs: ['uv'],
    hasOutput: true,
    props: [{ key: 'scale', label: 'Scale', kind: 'number', default: 4 }],
    evaluate: (i, p, t) => {
      const uv = toVec(i.uv ?? [0.5, 0.5, 0])
      return 0.5 + 0.5 * simplexNoise3(uv[0] * Number(p.scale ?? 4), uv[1] * Number(p.scale ?? 4), t)
    },
  },
  WorldPosition: {
    title: 'World Position',
    color: '#4a6a8a',
    inputs: [],
    hasOutput: true,
    props: [],
    /** CPU preview placeholder — GPU shader uses modelMatrix * position. */
    evaluate: () => [0, 0, 0] as [number, number, number],
  },
  ObjectPosition: {
    title: 'Object Position',
    color: '#4a6a8a',
    inputs: [],
    hasOutput: true,
    props: [],
    /** CPU preview placeholder — GPU shader uses modelMatrix origin. */
    evaluate: () => [0, 0, 0] as [number, number, number],
  },
}

/** Compact 3D simplex noise for CPU preview (matches GPU shader qualitatively). */
function simplexNoise3(x: number, y: number, z: number): number {
  const F3 = 1 / 3
  const G3 = 1 / 6
  const s = (x + y + z) * F3
  const i = Math.floor(x + s)
  const j = Math.floor(y + s)
  const k = Math.floor(z + s)
  const t = (i + j + k) * G3
  const x0 = x - (i - t)
  const y0 = y - (j - t)
  const z0 = z - (k - t)
  let i1 = 0
  let j1 = 0
  let k1 = 0
  let i2 = 0
  let j2 = 0
  let k2 = 0
  if (x0 >= y0) {
    if (y0 >= z0) {
      i1 = 1
      j2 = 1
    } else if (x0 >= z0) {
      i1 = 1
      k2 = 1
    } else {
      k1 = 1
      k2 = 1
    }
  } else if (y0 < z0) {
    j1 = 1
    k2 = 1
  } else if (x0 < z0) {
    j1 = 1
    i2 = 1
  } else {
    k1 = 1
    i2 = 1
  }
  const x1 = x0 - i1 + G3
  const y1 = y0 - j1 + G3
  const z1 = z0 - k1 + G3
  const x2 = x0 - i2 + 2 * G3
  const y2 = y0 - j2 + 2 * G3
  const z2 = z0 - k2 + 2 * G3
  const x3 = x0 - 1 + 3 * G3
  const y3 = y0 - 1 + 3 * G3
  const z3 = z0 - 1 + 3 * G3
  const grad = (gi: number, px: number, py: number, pz: number) => {
    const h = gi & 15
    const u = h < 8 ? px : py
    const v = h < 4 ? py : h === 12 || h === 14 ? px : pz
    return ((h & 1 ? -u : u) + (h & 2 ? -2 * v : 2 * v)) * 0.5
  }
  const ii = i & 255
  const jj = j & 255
  const kk = k & 255
  const n0 = Math.max(0, 0.6 - x0 * x0 - y0 * y0 - z0 * z0) ** 4 * grad(ii + jj + kk, x0, y0, z0)
  const n1 = Math.max(0, 0.6 - x1 * x1 - y1 * y1 - z1 * z1) ** 4 * grad(ii + i1 + jj + j1 + kk + k1, x1, y1, z1)
  const n2 = Math.max(0, 0.6 - x2 * x2 - y2 * y2 - z2 * z2) ** 4 * grad(ii + i2 + jj + j2 + kk + k2, x2, y2, z2)
  const n3 = Math.max(0, 0.6 - x3 * x3 - y3 * y3 - z3 * z3) ** 4 * grad(ii + jj + kk + 1, x3, y3, z3)
  return 32 * (n0 + n1 + n2 + n3)
}

let matCounter = 0
export function newMatNodeId(): string {
  matCounter += 1
  return `mn_${Date.now().toString(36)}_${matCounter}`
}

export function emptyMaterialGraph(): MaterialGraph {
  return { nodes: [{ id: newMatNodeId(), type: 'Output', x: 360, y: 60, props: {} }], edges: [] }
}

/** evaluate the graph at time t → channel values from the Output node */
export function evaluateMaterialGraph(graph: MaterialGraph, t: number): Record<string, MatValue | undefined> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  const cache = new Map<string, MatValue>()

  const evalNode = (id: string, depth: number): MatValue => {
    if (depth > 32) return 0
    if (cache.has(id)) return cache.get(id)!
    const node = byId.get(id)
    const def = node && MAT_NODE_DEFS[node.type]
    if (!node || !def) return 0
    const inputs: Record<string, MatValue | undefined> = {}
    for (const inp of def.inputs) {
      const edge = graph.edges.find((e) => e.to === `${node.id}:${inp}`)
      if (edge) inputs[inp] = evalNode(edge.from, depth + 1)
    }
    const v = def.evaluate(inputs, node.props, t)
    cache.set(id, v)
    return v
  }

  const out = graph.nodes.find((n) => n.type === 'Output')
  const result: Record<string, MatValue | undefined> = {}
  if (!out) return result
  for (const inp of MAT_NODE_DEFS.Output.inputs) {
    const edge = graph.edges.find((e) => e.to === `${out.id}:${inp}`)
    if (edge) result[inp] = evalNode(edge.from, 0)
  }
  return result
}

export function getMaterialGraphMode(graph?: MaterialGraph, actorMode?: MaterialGraphMode): MaterialGraphMode {
  return graph?.mode ?? actorMode ?? 'cpu'
}

function applyMaterialGraphCpu(mat: THREE.MeshStandardMaterial, graph: MaterialGraph, t: number) {
  const r = evaluateMaterialGraph(graph, t)
  if (r.baseColor !== undefined) {
    const [cr, cg, cb] = toVec(r.baseColor)
    mat.color.setRGB(cr, cg, cb)
  }
  if (r.emissive !== undefined) {
    const [er, eg, eb] = toVec(r.emissive)
    mat.emissive.setRGB(er, eg, eb)
  }
  if (r.emissiveInt !== undefined) mat.emissiveIntensity = Math.max(0, toNum(r.emissiveInt))
  if (r.roughness !== undefined) mat.roughness = Math.max(0, Math.min(1, toNum(r.roughness)))
  if (r.metalness !== undefined) mat.metalness = Math.max(0, Math.min(1, toNum(r.metalness)))
  if (r.opacity !== undefined) {
    mat.opacity = Math.max(0, Math.min(1, toNum(r.opacity)))
    mat.transparent = mat.opacity < 1
  }
}

const MAT_APPLY_MODE = Symbol('vektraMatApplyMode')

function applyMaterialGraphGpu(mat: THREE.MeshStandardMaterial, graph: MaterialGraph, t: number) {
  installMaterialShader(mat, graph)
  updateMaterialShaderTime(mat, t)
}

/** Push graph results onto any MeshStandardMaterial (preview sphere, etc.). */
export function applyMaterialGraphToMaterial(
  mat: THREE.MeshStandardMaterial,
  graph: MaterialGraph,
  t: number,
  mode?: MaterialGraphMode,
  materialBackend: 'glsl' | 'tsl' = 'glsl',
) {
  if (materialBackend === 'tsl' && isTSLPreviewAvailable()) {
    const tslMat = compileMaterialGraphTSL(graph, t)
    if (tslMat) {
      const src = tslMat as THREE.MeshPhysicalMaterial
      mat.color.copy(src.color)
      mat.emissive.copy(src.emissive)
      mat.emissiveIntensity = src.emissiveIntensity
      mat.roughness = src.roughness
      mat.metalness = src.metalness
      mat.opacity = src.opacity
      mat.transparent = src.transparent
      mat.userData.lotusMaterialBackend = 'tsl'
      tslMat.dispose()
      return
    }
  }
  const tagged = mat as THREE.MeshStandardMaterial & { [MAT_APPLY_MODE]?: MaterialGraphMode }
  const m = getMaterialGraphMode(graph, mode)
  if (m === 'gpu') {
    tagged[MAT_APPLY_MODE] = 'gpu'
    applyMaterialGraphGpu(mat, graph, t)
  } else {
    if (tagged[MAT_APPLY_MODE] === 'gpu') clearMaterialShader(mat)
    tagged[MAT_APPLY_MODE] = 'cpu'
    applyMaterialGraphCpu(mat, graph, t)
  }
}

/** apply evaluated channels onto an actor's material (CPU or GPU per-pixel path) */
export function applyMaterialGraph(
  actor: Actor,
  t: number,
  graph?: MaterialGraph,
  mode?: MaterialGraphMode,
) {
  const g = graph ?? actor.materialGraph
  if (!g || !actor.mesh) return
  const mat = actor.mesh.material as THREE.MeshStandardMaterial
  const tagged = mat as THREE.MeshStandardMaterial & { [MAT_APPLY_MODE]?: MaterialGraphMode }
  const m = getMaterialGraphMode(g, mode ?? actor.materialGraphMode)
  if (m === 'gpu') {
    if (tagged[MAT_APPLY_MODE] !== 'gpu') tagged[MAT_APPLY_MODE] = 'gpu'
    applyMaterialGraphGpu(mat, g, t)
  } else {
    if (tagged[MAT_APPLY_MODE] === 'gpu') {
      clearMaterialShader(mat)
    }
    tagged[MAT_APPLY_MODE] = 'cpu'
    applyMaterialGraphCpu(mat, g, t)
  }
}
