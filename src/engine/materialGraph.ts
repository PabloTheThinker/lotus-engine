import * as THREE from 'three'
import type { Actor } from './Actor'

/**
 * Material graph — the UE Material Editor analog (v1): a dataflow node graph
 * evaluated per frame on the CPU, driving MeshStandardMaterial channels
 * (base color, emissive, roughness, metalness, opacity). Time-driven nodes
 * make materials animate live in the editor, exactly like UE's preview.
 */

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
}

export interface MatNodeDef {
  title: string
  color: string
  inputs: string[]
  hasOutput: boolean
  props: Array<{ key: string; label: string; kind: 'number' | 'color'; default: string | number }>
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
    inputs: ['baseColor', 'emissive', 'emissiveInt', 'roughness', 'metalness', 'opacity'],
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

/** apply evaluated channels onto an actor's material */
export function applyMaterialGraph(actor: Actor, t: number) {
  if (!actor.materialGraph || !actor.mesh) return
  const mat = actor.mesh.material as THREE.MeshStandardMaterial
  const r = evaluateMaterialGraph(actor.materialGraph, t)
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
