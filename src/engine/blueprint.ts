/**
 * Blueprints — UE5-style visual scripting. A graph of event/action/flow nodes
 * with exec-pin wiring that COMPILES to JavaScript and runs through the same
 * per-actor script slot as hand-written code (onBeginPlay/onTick).
 */

export interface BPNode {
  id: string
  type: string // key into NODE_DEFS
  x: number
  y: number
  props: Record<string, string | number | boolean>
}

/** exec edge: from "nodeId:outPort" to "nodeId:in" */
export interface BPEdge {
  from: string
  to: string
}

export interface BlueprintGraph {
  nodes: BPNode[]
  edges: BPEdge[]
}

export interface BPPropDef {
  key: string
  label: string
  kind: 'number' | 'text' | 'color' | 'check' | 'select' | 'key'
  options?: string[]
  default: string | number | boolean
}

export interface BPNodeDef {
  title: string
  category: 'Events' | 'Actions' | 'Flow'
  color: string
  hasExecIn: boolean
  execOuts: string[] // port names
  props: BPPropDef[]
  /** emit JS given the node and the compiled code of each exec-out chain */
  emit: (node: BPNode, outs: Record<string, string>) => string
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const str = (v: unknown) => JSON.stringify(String(v ?? ''))

export const NODE_DEFS: Record<string, BPNodeDef> = {
  // ───── Events ─────
  EventBeginPlay: {
    title: 'Event BeginPlay',
    category: 'Events',
    color: '#a23b3b',
    hasExecIn: false,
    execOuts: ['then'],
    props: [],
    emit: (_n, o) => o.then ?? '',
  },
  EventTick: {
    title: 'Event Tick',
    category: 'Events',
    color: '#a23b3b',
    hasExecIn: false,
    execOuts: ['then'],
    props: [],
    emit: (_n, o) => o.then ?? '',
  },
  EventKeyPress: {
    title: 'On Key Press',
    category: 'Events',
    color: '#a23b3b',
    hasExecIn: false,
    execOuts: ['then'],
    props: [{ key: 'key', label: 'Key', kind: 'key', default: 'KeyE' }],
    emit: (n, o) => `if (api.keyJustPressed(${str(n.props.key)})) {\n${o.then ?? ''}\n}`,
  },
  EventPlayerNear: {
    title: 'On Player Near',
    category: 'Events',
    color: '#a23b3b',
    hasExecIn: false,
    execOuts: ['then'],
    props: [{ key: 'distance', label: 'Distance', kind: 'number', default: 2 }],
    emit: (n, o) =>
      `{ const __p = api.pawnPosition(); if (__p && __p.distanceTo(actor.root.position) < ${num(n.props.distance)} && !__near['${n.id}']) { __near['${n.id}'] = true;\n${o.then ?? ''}\n} else if (__p && __p.distanceTo(actor.root.position) >= ${num(n.props.distance)}) { __near['${n.id}'] = false } }`,
  },

  // ───── Actions ─────
  MoveBy: {
    title: 'Move By',
    category: 'Actions',
    color: '#2f6fab',
    hasExecIn: true,
    execOuts: ['then'],
    props: [
      { key: 'x', label: 'X', kind: 'number', default: 0 },
      { key: 'y', label: 'Y', kind: 'number', default: 0 },
      { key: 'z', label: 'Z', kind: 'number', default: 0 },
      { key: 'perSecond', label: 'Per Second', kind: 'check', default: true },
    ],
    emit: (n, o) => {
      const m = n.props.perSecond ? '__dt' : '1'
      return `actor.root.position.x += ${num(n.props.x)} * ${m};\nactor.root.position.y += ${num(n.props.y)} * ${m};\nactor.root.position.z += ${num(n.props.z)} * ${m};\n${o.then ?? ''}`
    },
  },
  RotateBy: {
    title: 'Rotate By (deg)',
    category: 'Actions',
    color: '#2f6fab',
    hasExecIn: true,
    execOuts: ['then'],
    props: [
      { key: 'x', label: 'X°', kind: 'number', default: 0 },
      { key: 'y', label: 'Y°', kind: 'number', default: 90 },
      { key: 'z', label: 'Z°', kind: 'number', default: 0 },
      { key: 'perSecond', label: 'Per Second', kind: 'check', default: true },
    ],
    emit: (n, o) => {
      const m = n.props.perSecond ? '__dt' : '1'
      const r = (d: unknown) => `${(num(d) * Math.PI) / 180}`
      return `actor.root.rotation.x += ${r(n.props.x)} * ${m};\nactor.root.rotation.y += ${r(n.props.y)} * ${m};\nactor.root.rotation.z += ${r(n.props.z)} * ${m};\n${o.then ?? ''}`
    },
  },
  SetPosition: {
    title: 'Set Position',
    category: 'Actions',
    color: '#2f6fab',
    hasExecIn: true,
    execOuts: ['then'],
    props: [
      { key: 'x', label: 'X', kind: 'number', default: 0 },
      { key: 'y', label: 'Y', kind: 'number', default: 1 },
      { key: 'z', label: 'Z', kind: 'number', default: 0 },
    ],
    emit: (n, o) => `actor.root.position.set(${num(n.props.x)}, ${num(n.props.y)}, ${num(n.props.z)});\n${o.then ?? ''}`,
  },
  SetColor: {
    title: 'Set Color',
    category: 'Actions',
    color: '#2f6fab',
    hasExecIn: true,
    execOuts: ['then'],
    props: [{ key: 'color', label: 'Color', kind: 'color', default: '#e5484d' }],
    emit: (n, o) =>
      `if (actor.mesh && actor.mesh.material.color) actor.mesh.material.color.set(${str(n.props.color)});\n${o.then ?? ''}`,
  },
  SetEmissive: {
    title: 'Set Emissive',
    category: 'Actions',
    color: '#2f6fab',
    hasExecIn: true,
    execOuts: ['then'],
    props: [
      { key: 'color', label: 'Color', kind: 'color', default: '#2f80ed' },
      { key: 'intensity', label: 'Intensity', kind: 'number', default: 2 },
    ],
    emit: (n, o) =>
      `if (actor.mesh && actor.mesh.material.emissive) { actor.mesh.material.emissive.set(${str(n.props.color)}); actor.mesh.material.emissiveIntensity = ${num(n.props.intensity)}; }\n${o.then ?? ''}`,
  },
  SetVisible: {
    title: 'Set Visible',
    category: 'Actions',
    color: '#2f6fab',
    hasExecIn: true,
    execOuts: ['then'],
    props: [{ key: 'visible', label: 'Visible', kind: 'check', default: false }],
    emit: (n, o) => `actor.root.visible = ${!!n.props.visible};\n${o.then ?? ''}`,
  },
  LookAtPlayer: {
    title: 'Look At Player',
    category: 'Actions',
    color: '#2f6fab',
    hasExecIn: true,
    execOuts: ['then'],
    props: [],
    emit: (_n, o) =>
      `{ const __p = api.pawnPosition(); if (__p) { const d = new THREE.Vector3(__p.x - actor.root.position.x, 0, __p.z - actor.root.position.z); actor.root.rotation.y = Math.atan2(d.x, d.z); } }\n${o.then ?? ''}`,
  },
  MoveTowardPlayer: {
    title: 'Move Toward Player',
    category: 'Actions',
    color: '#2f6fab',
    hasExecIn: true,
    execOuts: ['then'],
    props: [
      { key: 'speed', label: 'Speed', kind: 'number', default: 2.5 },
      { key: 'stopAt', label: 'Stop At', kind: 'number', default: 1.2 },
    ],
    emit: (n, o) =>
      `{ const __p = api.pawnPosition(); if (__p) { const d = new THREE.Vector3(__p.x - actor.root.position.x, 0, __p.z - actor.root.position.z); if (d.length() > ${num(n.props.stopAt)}) { d.normalize(); actor.root.position.x += d.x * ${num(n.props.speed)} * __dt; actor.root.position.z += d.z * ${num(n.props.speed)} * __dt; } } }\n${o.then ?? ''}`,
  },
  LogMessage: {
    title: 'Log',
    category: 'Actions',
    color: '#2f6fab',
    hasExecIn: true,
    execOuts: ['then'],
    props: [{ key: 'text', label: 'Message', kind: 'text', default: 'Hello from Blueprint' }],
    emit: (n, o) => `api.log(${str(n.props.text)});\n${o.then ?? ''}`,
  },
  DestroySelf: {
    title: 'Destroy Self',
    category: 'Actions',
    color: '#2f6fab',
    hasExecIn: true,
    execOuts: [],
    props: [],
    emit: () => `actor.root.visible = false; __dead = true;`,
  },

  // ───── Flow ─────
  Branch: {
    title: 'Branch',
    category: 'Flow',
    color: '#6b7280',
    hasExecIn: true,
    execOuts: ['true', 'false'],
    props: [
      { key: 'condition', label: 'Condition', kind: 'select', options: ['key down', 'player near', 'visible'], default: 'key down' },
      { key: 'key', label: 'Key (if key)', kind: 'key', default: 'ShiftLeft' },
      { key: 'distance', label: 'Dist (if near)', kind: 'number', default: 3 },
    ],
    emit: (n, o) => {
      let cond = 'false'
      if (n.props.condition === 'key down') cond = `api.isKeyDown(${str(n.props.key)})`
      else if (n.props.condition === 'player near')
        cond = `(api.pawnPosition() && api.pawnPosition().distanceTo(actor.root.position) < ${num(n.props.distance)})`
      else if (n.props.condition === 'visible') cond = 'actor.root.visible'
      return `if (${cond}) {\n${o.true ?? ''}\n} else {\n${o.false ?? ''}\n}`
    },
  },
  Delay: {
    title: 'Delay',
    category: 'Flow',
    color: '#6b7280',
    hasExecIn: true,
    execOuts: ['then'],
    props: [{ key: 'seconds', label: 'Seconds', kind: 'number', default: 1 }],
    emit: (n, o) => `__after(${num(n.props.seconds)}, () => {\n${o.then ?? ''}\n});`,
  },
  Sequence: {
    title: 'Sequence',
    category: 'Flow',
    color: '#6b7280',
    hasExecIn: true,
    execOuts: ['first', 'second'],
    props: [],
    emit: (_n, o) => `${o.first ?? ''}\n${o.second ?? ''}`,
  },
}

let bpCounter = 0
export function newNodeId(): string {
  bpCounter += 1
  return `bp_${Date.now().toString(36)}_${bpCounter}`
}

export function emptyGraph(): BlueprintGraph {
  return {
    nodes: [{ id: newNodeId(), type: 'EventBeginPlay', x: 60, y: 60, props: {} }],
    edges: [],
  }
}

/** Compile a blueprint graph to per-actor script JS. */
export function compileBlueprint(graph: BlueprintGraph): string {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))

  const follow = (nodeId: string, port: string, depth: number): string => {
    if (depth > 64) return '/* chain too deep */'
    const edge = graph.edges.find((e) => e.from === `${nodeId}:${port}`)
    if (!edge) return ''
    const next = byId.get(edge.to.split(':')[0])
    if (!next) return ''
    return emitNode(next, depth + 1)
  }

  const emitNode = (node: BPNode, depth: number): string => {
    const def = NODE_DEFS[node.type]
    if (!def) return `/* unknown node ${node.type} */`
    const outs: Record<string, string> = {}
    for (const port of def.execOuts) outs[port] = follow(node.id, port, depth)
    return def.emit(node, outs)
  }

  const beginChains: string[] = []
  const tickChains: string[] = []
  for (const node of graph.nodes) {
    const def = NODE_DEFS[node.type]
    if (!def || def.hasExecIn) continue
    const code = emitNode(node, 0)
    if (!code.trim()) continue
    if (node.type === 'EventBeginPlay') beginChains.push(code)
    else tickChains.push(code)
  }

  return `// ── compiled from Blueprint — edits here are overwritten on next compile ──
let __dead = false
const __near = {}
const __timers = []
let __dt = 0
function __after(s, fn) { __timers.push({ t: api.time() + s, fn }) }

function onBeginPlay() {
${indent(beginChains.join('\n'))}
}

function onTick(dt) {
  if (__dead) return
  __dt = dt
  for (let i = __timers.length - 1; i >= 0; i--) {
    if (api.time() >= __timers[i].t) { const f = __timers[i].fn; __timers.splice(i, 1); f() }
  }
${indent(tickChains.join('\n'))}
}
`
}

function indent(code: string): string {
  return code
    .split('\n')
    .map((l) => (l.trim() ? `  ${l}` : l))
    .join('\n')
}
