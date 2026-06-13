import * as THREE from 'three'
import type { Actor } from './Actor'
import { buildGeometry } from './factory'
import type { GeometryKind, PCGProps } from './types'

export const DEFAULT_PCG: PCGProps = {
  geometry: 'cone',
  color: '#4a6b3f',
  density: 6,
  seed: 42,
  scaleMin: 0.5,
  scaleMax: 1.6,
  maxSlopeDeg: 35,
  alignToNormal: false,
}

/**
 * PCG node graph — UE PCG analog (v0.61):
 * sample → filter → transform → spawn point pipeline with live editor regen.
 */

export type PCGNodeType = 'SampleSurface' | 'FilterSlope' | 'FilterHeight' | 'TransformJitter' | 'SpawnActor'

export interface PCGPoint {
  p: THREE.Vector3
  n: THREE.Vector3
  q: THREE.Quaternion
  s: number
}

export interface PCGNode {
  id: string
  type: PCGNodeType
  x: number
  y: number
  props: Record<string, string | number | boolean>
}

/** data edge: from node output to "nodeId:in" */
export interface PCGEdge {
  from: string
  to: string
}

export interface PCGGraph {
  nodes: PCGNode[]
  edges: PCGEdge[]
}

export interface PCGNodeDef {
  title: string
  color: string
  category: 'Sample' | 'Filter' | 'Transform' | 'Spawn'
  hasInput: boolean
  hasOutput: boolean
  props: Array<{
    key: string
    label: string
    kind: 'number' | 'color' | 'select' | 'check'
    default: string | number | boolean
    options?: string[]
  }>
}

export interface PCGExecResult {
  points: PCGPoint[]
  geometry: GeometryKind
  color: string
}

export const PCG_NODE_DEFS: Record<PCGNodeType, PCGNodeDef> = {
  SampleSurface: {
    title: 'Sample Surface',
    color: '#3b6b8a',
    category: 'Sample',
    hasInput: false,
    hasOutput: true,
    props: [
      { key: 'density', label: 'Density', kind: 'number', default: 6 },
      { key: 'seed', label: 'Seed', kind: 'number', default: 42 },
    ],
  },
  FilterSlope: {
    title: 'Filter Slope',
    color: '#6b5a3b',
    category: 'Filter',
    hasInput: true,
    hasOutput: true,
    props: [{ key: 'maxSlopeDeg', label: 'Max Slope°', kind: 'number', default: 35 }],
  },
  FilterHeight: {
    title: 'Filter Height',
    color: '#6b5a3b',
    category: 'Filter',
    hasInput: true,
    hasOutput: true,
    props: [
      { key: 'minHeight', label: 'Min Y', kind: 'number', default: -1000 },
      { key: 'maxHeight', label: 'Max Y', kind: 'number', default: 1000 },
    ],
  },
  TransformJitter: {
    title: 'Transform Jitter',
    color: '#5a3b7a',
    category: 'Transform',
    hasInput: true,
    hasOutput: true,
    props: [
      { key: 'scaleMin', label: 'Scale Min', kind: 'number', default: 0.5 },
      { key: 'scaleMax', label: 'Scale Max', kind: 'number', default: 1.6 },
      { key: 'alignToNormal', label: 'Align Normal', kind: 'check', default: false },
    ],
  },
  SpawnActor: {
    title: 'Spawn Actor',
    color: '#3b7a4d',
    category: 'Spawn',
    hasInput: true,
    hasOutput: false,
    props: [
      {
        key: 'geometry',
        label: 'Mesh',
        kind: 'select',
        default: 'cone',
        options: ['cone', 'sphere', 'box', 'cylinder', 'icosahedron', 'capsule'],
      },
      { key: 'color', label: 'Color', kind: 'color', default: '#4a6b3f' },
    ],
  },
}

let pcgNodeSeq = 1
export function newPcgNodeId() {
  return `pcg_${pcgNodeSeq++}`
}

function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function defaultProps(type: PCGNodeType): PCGNode['props'] {
  const props: PCGNode['props'] = {}
  for (const p of PCG_NODE_DEFS[type].props) props[p.key] = p.default
  return props
}

/** Default wired pipeline matching the legacy fixed scatter volume. */
export function emptyPCGGraph(): PCGGraph {
  const sample = { id: newPcgNodeId(), type: 'SampleSurface' as const, x: 40, y: 80, props: defaultProps('SampleSurface') }
  const slope = { id: newPcgNodeId(), type: 'FilterSlope' as const, x: 280, y: 80, props: defaultProps('FilterSlope') }
  const height = { id: newPcgNodeId(), type: 'FilterHeight' as const, x: 520, y: 80, props: defaultProps('FilterHeight') }
  const jitter = { id: newPcgNodeId(), type: 'TransformJitter' as const, x: 760, y: 80, props: defaultProps('TransformJitter') }
  const spawn = { id: newPcgNodeId(), type: 'SpawnActor' as const, x: 1000, y: 80, props: defaultProps('SpawnActor') }
  return {
    nodes: [sample, slope, height, jitter, spawn],
    edges: [
      { from: sample.id, to: `${slope.id}:in` },
      { from: slope.id, to: `${height.id}:in` },
      { from: height.id, to: `${jitter.id}:in` },
      { from: jitter.id, to: `${spawn.id}:in` },
    ],
  }
}

/** Migrate legacy PCGProps into a graph for older levels. */
export function graphFromProps(props: PCGProps): PCGGraph {
  const g = emptyPCGGraph()
  const byType = (t: PCGNodeType) => g.nodes.find((n) => n.type === t)!
  byType('SampleSurface').props.density = props.density
  byType('SampleSurface').props.seed = props.seed
  byType('FilterSlope').props.maxSlopeDeg = props.maxSlopeDeg
  byType('TransformJitter').props.scaleMin = props.scaleMin
  byType('TransformJitter').props.scaleMax = props.scaleMax
  byType('TransformJitter').props.alignToNormal = props.alignToNormal
  byType('SpawnActor').props.geometry = props.geometry
  byType('SpawnActor').props.color = props.color
  return g
}

/** Flatten graph node props back into PCGProps for Details panel + serialization compat. */
export function syncPropsFromGraph(graph: PCGGraph): PCGProps {
  const sample = graph.nodes.find((n) => n.type === 'SampleSurface')
  const slope = graph.nodes.find((n) => n.type === 'FilterSlope')
  const jitter = graph.nodes.find((n) => n.type === 'TransformJitter')
  const spawn = graph.nodes.find((n) => n.type === 'SpawnActor')
  return {
    geometry: (spawn?.props.geometry as GeometryKind) ?? DEFAULT_PCG.geometry,
    color: String(spawn?.props.color ?? DEFAULT_PCG.color),
    density: Number(sample?.props.density ?? DEFAULT_PCG.density),
    seed: Number(sample?.props.seed ?? DEFAULT_PCG.seed),
    scaleMin: Number(jitter?.props.scaleMin ?? DEFAULT_PCG.scaleMin),
    scaleMax: Number(jitter?.props.scaleMax ?? DEFAULT_PCG.scaleMax),
    maxSlopeDeg: Number(slope?.props.maxSlopeDeg ?? DEFAULT_PCG.maxSlopeDeg),
    alignToNormal: Boolean(jitter?.props.alignToNormal ?? DEFAULT_PCG.alignToNormal),
  }
}

export function getEffectivePCGGraph(actor: Actor): PCGGraph {
  if (actor.pcgGraph?.nodes?.length) return actor.pcgGraph
  if (actor.pcgProps) return graphFromProps(actor.pcgProps)
  return emptyPCGGraph()
}

function predecessor(graph: PCGGraph, nodeId: string): string | undefined {
  const edge = graph.edges.find((e) => e.to === `${nodeId}:in`)
  return edge?.from
}

/** Topological order from sources → SpawnActor. */
function executionOrder(graph: PCGGraph): PCGNode[] {
  const spawn = graph.nodes.find((n) => n.type === 'SpawnActor')
  if (!spawn) return graph.nodes
  const chain: PCGNode[] = []
  let cur: string | undefined = spawn.id
  while (cur) {
    const node = graph.nodes.find((n) => n.id === cur)
    if (!node) break
    chain.unshift(node)
    cur = predecessor(graph, cur)
  }
  const inChain = new Set(chain.map((n) => n.id))
  for (const n of graph.nodes) {
    if (!inChain.has(n.id)) chain.unshift(n)
  }
  return chain
}

interface PCGContext {
  actor: Actor
  actors: Map<string, Actor>
  targets: THREE.Object3D[]
  origin: THREE.Vector3
  scale: THREE.Vector3
  top: number
  rand: () => number
}

function collectTargets(actor: Actor, actors: Map<string, Actor>): THREE.Object3D[] {
  const targets: THREE.Object3D[] = []
  for (const a of actors.values()) {
    if (a.id === actor.id) continue
    a.root.traverse((o) => {
      if (o instanceof THREE.Mesh && !o.userData.isHelper && !o.userData.isEditorOnly && !o.userData.isWater) {
        targets.push(o)
      }
    })
  }
  return targets
}

function sampleSurface(ctx: PCGContext, props: PCGNode['props']): PCGPoint[] {
  const density = Number(props.density ?? DEFAULT_PCG.density)
  const count = Math.min(2000, Math.round((ctx.scale.x * ctx.scale.z * density) / 100))
  const ray = new THREE.Raycaster()
  const down = new THREE.Vector3(0, -1, 0)
  const out: PCGPoint[] = []
  for (let i = 0; i < count; i++) {
    const x = ctx.origin.x + (ctx.rand() - 0.5) * ctx.scale.x
    const z = ctx.origin.z + (ctx.rand() - 0.5) * ctx.scale.z
    ray.set(new THREE.Vector3(x, ctx.top, z), down)
    ray.far = ctx.scale.y + 2
    const hit = ray.intersectObjects(ctx.targets, false)[0]
    if (!hit?.face) continue
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
    out.push({
      p: hit.point.clone(),
      n,
      q: new THREE.Quaternion(),
      s: 1,
    })
  }
  return out
}

function filterSlope(points: PCGPoint[], props: PCGNode['props']): PCGPoint[] {
  const maxSlopeCos = Math.cos(THREE.MathUtils.degToRad(Number(props.maxSlopeDeg ?? DEFAULT_PCG.maxSlopeDeg)))
  return points.filter((pt) => pt.n.y >= maxSlopeCos)
}

function filterHeight(points: PCGPoint[], props: PCGNode['props']): PCGPoint[] {
  const minY = Number(props.minHeight ?? -1000)
  const maxY = Number(props.maxHeight ?? 1000)
  return points.filter((pt) => pt.p.y >= minY && pt.p.y <= maxY)
}

function transformJitter(points: PCGPoint[], props: PCGNode['props'], rand: () => number): PCGPoint[] {
  const scaleMin = Number(props.scaleMin ?? DEFAULT_PCG.scaleMin)
  const scaleMax = Number(props.scaleMax ?? DEFAULT_PCG.scaleMax)
  const align = Boolean(props.alignToNormal ?? DEFAULT_PCG.alignToNormal)
  return points.map((pt) => {
    const sc = scaleMin + rand() * (scaleMax - scaleMin)
    const q = new THREE.Quaternion()
    if (align) q.setFromUnitVectors(new THREE.Vector3(0, 1, 0), pt.n)
    q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2))
    return {
      p: pt.p.clone().add(new THREE.Vector3(0, sc * 0.5, 0)),
      n: pt.n.clone(),
      q,
      s: sc,
    }
  })
}

/** Execute the graph and return final placements + spawn mesh settings. */
export function executePCGGraph(graph: PCGGraph, actor: Actor, actors: Map<string, Actor>): PCGExecResult {
  const sample = graph.nodes.find((n) => n.type === 'SampleSurface')
  const spawn = graph.nodes.find((n) => n.type === 'SpawnActor')
  const seed = Number(sample?.props.seed ?? DEFAULT_PCG.seed)
  const scale = new THREE.Vector3()
  actor.root.getWorldScale(scale)
  const origin = new THREE.Vector3()
  actor.root.getWorldPosition(origin)
  const ctx: PCGContext = {
    actor,
    actors,
    targets: collectTargets(actor, actors),
    origin,
    scale,
    top: origin.y + scale.y / 2,
    rand: mulberry32(seed),
  }

  let points: PCGPoint[] = []
  const inputs = new Map<string, PCGPoint[]>()

  for (const node of executionOrder(graph)) {
    const prevId = predecessor(graph, node.id)
    const incoming = prevId ? inputs.get(prevId) : undefined

    switch (node.type) {
      case 'SampleSurface':
        points = sampleSurface(ctx, node.props)
        break
      case 'FilterSlope':
        points = filterSlope(incoming ?? points, node.props)
        break
      case 'FilterHeight':
        points = filterHeight(incoming ?? points, node.props)
        break
      case 'TransformJitter':
        points = transformJitter(incoming ?? points, node.props, ctx.rand)
        break
      case 'SpawnActor':
        points = incoming ?? points
        break
      default:
        break
    }
    inputs.set(node.id, points)
  }

  return {
    points,
    geometry: (spawn?.props.geometry as GeometryKind) ?? DEFAULT_PCG.geometry,
    color: String(spawn?.props.color ?? DEFAULT_PCG.color),
  }
}

/** Build an InstancedMesh from graph execution (used by regeneratePCG). */
export function buildPCGMesh(result: PCGExecResult): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(
    buildGeometry(result.geometry),
    new THREE.MeshStandardMaterial({ color: result.color, roughness: 0.85 }),
    Math.max(1, result.points.length),
  )
  mesh.castShadow = true
  mesh.userData.isEditorOnly = true
  const m4 = new THREE.Matrix4()
  const sv = new THREE.Vector3()
  result.points.forEach((pl, i) => {
    sv.setScalar(pl.s)
    m4.compose(pl.p, pl.q, sv)
    mesh.setMatrixAt(i, m4)
  })
  mesh.count = result.points.length
  return mesh
}