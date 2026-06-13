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
  /** exec breakpoint — pauses PIE/Simulate when this node runs (v0.63) */
  breakpoint?: boolean
}

/** exec edge: from "nodeId:outPort" to "nodeId:in" */
export interface BPEdge {
  from: string
  to: string
}

export interface BPVariable {
  name: string
  value: number
}

/** Data pin on a blueprint function (macro inputs/outputs). */
export interface BPFunctionPin {
  key: string
  label: string
  default?: number
}

/** Collapsed subgraph — inlined at compile time when CallFunction is emitted. */
export interface BPFunction {
  id: string
  name: string
  nodes: BPNode[]
  edges: BPEdge[]
  dataIns: BPFunctionPin[]
  dataOuts: BPFunctionPin[]
}

export interface BlueprintGraph {
  nodes: BPNode[]
  edges: BPEdge[]
  /** typed blueprint variables (compiled as locals, set/get via nodes) */
  variables?: BPVariable[]
  /** macro/function subgraphs keyed by id */
  functions?: Record<string, BPFunction>
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
  category: 'Events' | 'Actions' | 'Flow' | 'Data' | 'Function'
  color: string
  hasExecIn: boolean
  execOuts: string[] // port names
  props: BPPropDef[]
  /** prop keys that accept data-pin wires (expression overrides the literal) */
  dataIns?: string[]
  /** optional data output port keys (CallFunction / FunctionReturn) */
  dataOuts?: string[]
  /** pure data node: no exec pins, one data output, evaluated lazily on pull */
  pure?: boolean
  /** emit JS given the node, exec-out chains, and data-input expressions */
  emit: (node: BPNode, outs: Record<string, string>, ins?: Record<string, string>) => string
  /** pure nodes: emit a JS expression given data-input expressions */
  emitExpr?: (node: BPNode, ins: Record<string, string>) => string
}

const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0)
const str = (v: unknown) => JSON.stringify(String(v ?? ''))
const gateStateKey = (n: BPNode) => {
  const key = String(n.props.gateKey ?? '').trim()
  return key ? str(key) : `'${n.id}'`
}

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

  EventSignal: {
    title: 'On Signal',
    category: 'Events',
    color: '#a23b3b',
    hasExecIn: false,
    execOuts: ['then'],
    props: [{ key: 'signal', label: 'Signal', kind: 'text', default: 'cue' }],
    emit: (n, o) => `api.on(${str(n.props.signal)}, () => {\n${o.then ?? ''}\n})`,
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
    dataIns: ['x', 'y', 'z'],
    emit: (n, o, ins) => {
      const m = n.props.perSecond ? '__dt' : '1'
      return `actor.root.position.x += (${ins?.x ?? num(n.props.x)}) * ${m};\nactor.root.position.y += (${ins?.y ?? num(n.props.y)}) * ${m};\nactor.root.position.z += (${ins?.z ?? num(n.props.z)}) * ${m};\n${o.then ?? ''}`
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
      { key: 'condition', label: 'Condition', kind: 'select', options: ['key down', 'player near', 'visible', 'variable >'], default: 'key down' },
      { key: 'key', label: 'Key (if key)', kind: 'key', default: 'ShiftLeft' },
      { key: 'distance', label: 'Dist (if near)', kind: 'number', default: 3 },
      { key: 'variable', label: 'Var (if var)', kind: 'text', default: 'speed' },
      { key: 'threshold', label: 'Greater Than', kind: 'number', default: 0 },
    ],
    emit: (n, o) => {
      let cond = 'false'
      if (n.props.condition === 'key down') cond = `api.isKeyDown(${str(n.props.key)})`
      else if (n.props.condition === 'player near')
        cond = `(api.pawnPosition() && api.pawnPosition().distanceTo(actor.root.position) < ${num(n.props.distance)})`
      else if (n.props.condition === 'visible') cond = 'actor.root.visible'
      else if (n.props.condition === 'variable >') cond = `((__vars[${str(n.props.variable)}] ?? 0) > ${num(n.props.threshold)})`
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
    dataIns: ['seconds'],
    emit: (n, o, ins) => `__after(${ins?.seconds ?? num(n.props.seconds)}, () => {\n${o.then ?? ''}\n});`,
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
  // ───── Data (pure — lazily pulled through data pins) ─────
  DataNumber: {
    title: 'Number',
    category: 'Data',
    color: '#2e7d6e',
    hasExecIn: false,
    execOuts: [],
    pure: true,
    props: [{ key: 'value', label: 'Value', kind: 'number', default: 1 }],
    emit: () => '',
    emitExpr: (n) => `${num(n.props.value)}`,
  },
  DataVariable: {
    title: 'Get Variable',
    category: 'Data',
    color: '#2e7d6e',
    hasExecIn: false,
    execOuts: [],
    pure: true,
    props: [{ key: 'name', label: 'Variable', kind: 'text', default: 'speed' }],
    emit: () => '',
    emitExpr: (n) => `(__vars[${str(n.props.name)}] ?? 0)`,
  },
  DataTime: {
    title: 'Game Time',
    category: 'Data',
    color: '#2e7d6e',
    hasExecIn: false,
    execOuts: [],
    pure: true,
    props: [],
    emit: () => '',
    emitExpr: () => 'api.time()',
  },
  DataRandom: {
    title: 'Random Range',
    category: 'Data',
    color: '#2e7d6e',
    hasExecIn: false,
    execOuts: [],
    pure: true,
    props: [
      { key: 'min', label: 'Min', kind: 'number', default: 0 },
      { key: 'max', label: 'Max', kind: 'number', default: 1 },
    ],
    emit: () => '',
    emitExpr: (n) => `(${num(n.props.min)} + Math.random() * ${num(n.props.max) - num(n.props.min)})`,
  },
  DataDistanceToPlayer: {
    title: 'Distance To Player',
    category: 'Data',
    color: '#2e7d6e',
    hasExecIn: false,
    execOuts: [],
    pure: true,
    props: [],
    emit: () => '',
    emitExpr: () => `(api.pawnPosition() ? api.pawnPosition().distanceTo(actor.root.position) : 9999)`,
  },
  DataAdd: {
    title: 'Add (a+b)',
    category: 'Data',
    color: '#2e7d6e',
    hasExecIn: false,
    execOuts: [],
    pure: true,
    props: [
      { key: 'a', label: 'A', kind: 'number', default: 0 },
      { key: 'b', label: 'B', kind: 'number', default: 0 },
    ],
    dataIns: ['a', 'b'],
    emit: () => '',
    emitExpr: (n, ins) => `(${ins.a ?? num(n.props.a)} + ${ins.b ?? num(n.props.b)})`,
  },
  DataMultiply: {
    title: 'Multiply (a×b)',
    category: 'Data',
    color: '#2e7d6e',
    hasExecIn: false,
    execOuts: [],
    pure: true,
    props: [
      { key: 'a', label: 'A', kind: 'number', default: 1 },
      { key: 'b', label: 'B', kind: 'number', default: 1 },
    ],
    dataIns: ['a', 'b'],
    emit: () => '',
    emitExpr: (n, ins) => `(${ins.a ?? num(n.props.a)} * ${ins.b ?? num(n.props.b)})`,
  },
  DataSine: {
    title: 'Sine',
    category: 'Data',
    color: '#2e7d6e',
    hasExecIn: false,
    execOuts: [],
    pure: true,
    props: [{ key: 'in', label: 'In', kind: 'number', default: 0 }],
    dataIns: ['in'],
    emit: () => '',
    emitExpr: (n, ins) => `Math.sin(${ins.in ?? num(n.props.in)})`,
  },

  EmitSignal: {
    title: 'Emit Signal',
    category: 'Actions',
    color: '#2f6fab',
    hasExecIn: true,
    execOuts: ['then'],
    props: [{ key: 'signal', label: 'Signal', kind: 'text', default: 'cue' }],
    emit: (n, o) => `api.emit(${str(n.props.signal)});\n${o.then ?? ''}`,
  },
  RunJS: {
    title: 'Run JS',
    category: 'Actions',
    color: '#2f6fab',
    hasExecIn: true,
    execOuts: ['then'],
    props: [{ key: 'code', label: 'Code', kind: 'text', default: 'api.log("hi")' }],
    emit: (n, o) => `{ ${String(n.props.code ?? '')} }\n${o.then ?? ''}`,
  },
  SetVariable: {
    title: 'Set Variable',
    category: 'Actions',
    color: '#2f6fab',
    hasExecIn: true,
    execOuts: ['then'],
    props: [
      { key: 'name', label: 'Variable', kind: 'text', default: 'speed' },
      { key: 'value', label: 'Value', kind: 'number', default: 1 },
    ],
    dataIns: ['value'],
    emit: (n, o, ins) => `__vars[${str(n.props.name)}] = ${ins?.value ?? num(n.props.value)};\n${o.then ?? ''}`,
  },

  ForLoop: {
    title: 'For Loop',
    category: 'Flow',
    color: '#6b7280',
    hasExecIn: true,
    execOuts: ['loop', 'completed'],
    props: [{ key: 'count', label: 'Count', kind: 'number', default: 5 }],
    emit: (n, o) =>
      `for (let __i = 0; __i < ${num(n.props.count)}; __i++) {\n${o.loop ?? ''}\n}\n${o.completed ?? ''}`,
  },
  DoOnce: {
    title: 'Do Once',
    category: 'Flow',
    color: '#6b7280',
    hasExecIn: true,
    execOuts: ['then'],
    props: [],
    emit: (n, o) => `if (!__once['${n.id}']) { __once['${n.id}'] = true;\n${o.then ?? ''}\n}`,
  },
  FlipFlop: {
    title: 'Flip Flop',
    category: 'Flow',
    color: '#6b7280',
    hasExecIn: true,
    execOuts: ['a', 'b'],
    props: [],
    emit: (n, o) => `__flip['${n.id}'] = !__flip['${n.id}'];\nif (__flip['${n.id}']) {\n${o.a ?? ''}\n} else {\n${o.b ?? ''}\n}`,
  },

  Gate: {
    title: 'Gate',
    category: 'Flow',
    color: '#6b7280',
    hasExecIn: true,
    execOuts: ['exit', 'open', 'close', 'toggle'],
    props: [
      {
        key: 'action',
        label: 'Action',
        kind: 'select',
        options: ['Enter', 'Open', 'Close', 'Toggle'],
        default: 'Enter',
      },
      { key: 'startOpen', label: 'Start Open', kind: 'check', default: true },
      { key: 'gateKey', label: 'Gate Key (shared)', kind: 'text', default: '' },
    ],
    dataOuts: ['isOpen'],
    emitExpr: (n) => {
      const k = gateStateKey(n)
      const start = !!n.props.startOpen
      return `!!(__gate[${k}] ?? ${start})`
    },
    emit: (n, o) => {
      const k = gateStateKey(n)
      const start = !!n.props.startOpen
      const init = `if (__gate[${k}] === undefined) __gate[${k}] = ${start}`
      const action = String(n.props.action ?? 'Enter')
      if (action === 'Open') return `${init};\n__gate[${k}] = true;\n${o.open ?? o.exit ?? ''}`
      if (action === 'Close') return `${init};\n__gate[${k}] = false;\n${o.close ?? o.exit ?? ''}`
      if (action === 'Toggle') return `${init};\n__gate[${k}] = !__gate[${k}];\n${o.toggle ?? o.exit ?? ''}`
      return `${init};\nif (__gate[${k}]) {\n${o.exit ?? ''}\n}`
    },
  },

  MultiGate: {
    title: 'Multi Gate',
    category: 'Flow',
    color: '#6b7280',
    hasExecIn: true,
    execOuts: ['out0', 'out1', 'out2', 'out3'],
    props: [
      { key: 'numOuts', label: 'Outputs', kind: 'number', default: 4 },
      { key: 'startIndex', label: 'Start Index', kind: 'number', default: 0 },
    ],
    emit: (n, o) => {
      const count = Math.max(1, Math.min(4, Math.floor(num(n.props.numOuts))))
      const k = `'${n.id}'`
      const start = Math.floor(num(n.props.startIndex)) % count
      let code = `if (__mg[${k}] === undefined) __mg[${k}] = ${start};\n`
      code += `switch (__mg[${k}] % ${count}) {\n`
      for (let i = 0; i < count; i++) {
        const port = `out${i}` as keyof typeof o
        code += `case ${i}: ${o[port] ?? ''} break;\n`
      }
      code += `} __mg[${k}] = (__mg[${k}] + 1) % ${count};`
      return code
    },
  },

  SwitchInt: {
    title: 'Switch on Int',
    category: 'Flow',
    color: '#6b7280',
    hasExecIn: true,
    execOuts: ['case0', 'case1', 'case2', 'case3', 'default'],
    props: [{ key: 'value', label: 'Value', kind: 'number', default: 0 }],
    dataIns: ['value'],
    emit: (n, o, ins) => {
      const v = ins?.value ?? num(n.props.value)
      return `switch (Math.floor(${v}) | 0) {\n` +
        `case 0: ${o.case0 ?? ''} break;\n` +
        `case 1: ${o.case1 ?? ''} break;\n` +
        `case 2: ${o.case2 ?? ''} break;\n` +
        `case 3: ${o.case3 ?? ''} break;\n` +
        `default: ${o.default ?? ''}\n` +
        `}`
    },
  },

  BindSignal: {
    title: 'Bind Signal',
    category: 'Flow',
    color: '#6b7280',
    hasExecIn: true,
    execOuts: ['then', 'onSignal'],
    props: [{ key: 'signal', label: 'Signal', kind: 'text', default: 'cue' }],
    emit: (n, o) => `api.on(${str(n.props.signal)}, () => {\n${o.onSignal ?? ''}\n});\n${o.then ?? ''}`,
  },

  CallSignal: {
    title: 'Call Signal',
    category: 'Actions',
    color: '#2f6fab',
    hasExecIn: true,
    execOuts: ['then'],
    props: [{ key: 'signal', label: 'Signal', kind: 'text', default: 'cue' }],
    emit: (n, o) => `api.emit(${str(n.props.signal)});\n${o.then ?? ''}`,
  },

  // ───── Functions / Macros (subgraphs inlined at compile) ─────
  FunctionEntry: {
    title: 'Function Entry',
    category: 'Function',
    color: '#8b5cf6',
    hasExecIn: false,
    execOuts: ['then'],
    props: [],
    dataOuts: ['out'],
    emit: (_n, o) => o.then ?? '',
  },
  FunctionReturn: {
    title: 'Function Return',
    category: 'Function',
    color: '#8b5cf6',
    hasExecIn: true,
    execOuts: [],
    props: [],
    dataIns: ['out'],
    emit: () => '',
  },
  CallFunction: {
    title: 'Call Function',
    category: 'Function',
    color: '#7c3aed',
    hasExecIn: true,
    execOuts: ['then'],
    props: [{ key: 'functionId', label: 'Function', kind: 'text', default: '' }],
    dataIns: [],
    dataOuts: [],
    emit: () => '/* CallFunction — inlined by compiler */',
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

/** Find a node by id in the root graph or any function subgraph. */
export function findNodeInGraph(graph: BlueprintGraph, nodeId: string): BPNode | undefined {
  const direct = graph.nodes.find((n) => n.id === nodeId)
  if (direct) return direct
  for (const fn of Object.values(graph.functions ?? {})) {
    const n = fn.nodes.find((x) => x.id === nodeId)
    if (n) return n
  }
  return undefined
}

/** True when a node participates in exec flow (eligible for breakpoints). */
export function nodeHasExec(node: BPNode): boolean {
  const def = NODE_DEFS[node.type]
  if (!def || def.pure) return false
  return def.hasExecIn || def.execOuts.length > 0
}

function execPrefix(nodeId: string): string {
  return `if (globalThis.__bpBreakpoint && globalThis.__bpBreakpoint(actor.id, '${nodeId}')) debugger;\n__pulse('${nodeId}');\n`
}

type CompileCtx = {
  nodes: BPNode[]
  edges: BPEdge[]
  byId: Map<string, BPNode>
  dataBindings?: Map<string, string>
  returnOuts?: Record<string, string>
}

/** Resolve function data pins for editor rendering / compile. */
export function getFunctionPins(graph: BlueprintGraph, functionId: string): { dataIns: BPFunctionPin[]; dataOuts: BPFunctionPin[] } {
  const fn = graph.functions?.[functionId]
  return { dataIns: fn?.dataIns ?? [], dataOuts: fn?.dataOuts ?? [] }
}

/** Collapse selected nodes into a macro function + CallFunction replacement. */
export function collapseToFunction(graph: BlueprintGraph, selectedIds: Set<string>, name: string): string | null {
  if (selectedIds.size < 1) return 'Select at least one node'
  const blocked = [...selectedIds].filter((id) => {
    const n = graph.nodes.find((x) => x.id === id)
    return n && NODE_DEFS[n.type]?.category === 'Events'
  })
  if (blocked.length) return 'Cannot collapse event nodes into a function'

  const fnId = newNodeId()
  const nodes = graph.nodes.filter((n) => selectedIds.has(n.id))
  const internalEdges = graph.edges.filter((e) => {
    const fromId = e.from.split(':')[0]
    const toId = e.to.split(':')[0]
    return selectedIds.has(fromId) && selectedIds.has(toId)
  })

  const boundaryExecIns: string[] = []
  const boundaryExecOuts: { from: string; port: string }[] = []
  const boundaryDataIns: { toNode: string; prop: string; fromNode: string }[] = []
  const boundaryDataOuts: { fromNode: string; toNode: string; prop: string }[] = []

  for (const e of graph.edges) {
    const fromId = e.from.split(':')[0]
    const toId = e.to.split(':')[0]
    const fromIn = selectedIds.has(fromId)
    const toIn = selectedIds.has(toId)
    if (!fromIn && toIn && e.to.endsWith(':in')) boundaryExecIns.push(toId)
    if (fromIn && !toIn && !e.to.includes(':prop:')) {
      const [, port] = e.from.split(':')
      boundaryExecOuts.push({ from: fromId, port })
    }
    if (!fromIn && toIn && e.to.includes(':prop:')) {
      boundaryDataIns.push({ toNode: toId, prop: e.to.split(':prop:')[1], fromNode: fromId })
    }
    if (fromIn && !toIn && e.to.includes(':prop:')) {
      boundaryDataOuts.push({ fromNode: fromId, toNode: toId, prop: e.to.split(':prop:')[1] })
    }
  }

  const dataIns: BPFunctionPin[] = boundaryDataIns.map((_, i) => ({
    key: `in${i}`,
    label: `In ${i + 1}`,
    default: 0,
  }))
  const dataOuts: BPFunctionPin[] = boundaryDataOuts.map((_, i) => ({
    key: `out${i}`,
    label: `Out ${i + 1}`,
  }))

  const entryId = newNodeId()
  const returnId = newNodeId()
  const fnNodes = nodes.map((n) => ({ ...n }))
  const fnEdges = internalEdges.map((e) => ({ ...e }))
  fnNodes.push({ id: entryId, type: 'FunctionEntry', x: 20, y: 60, props: {} })
  fnNodes.push({ id: returnId, type: 'FunctionReturn', x: 420, y: 60, props: {} })

  for (const targetId of boundaryExecIns) fnEdges.push({ from: `${entryId}:then`, to: `${targetId}:in` })
  for (const b of boundaryExecOuts) fnEdges.push({ from: `${b.from}:${b.port}`, to: `${returnId}:in` })
  for (let i = 0; i < boundaryDataIns.length; i++) {
    fnEdges.push({ from: `${entryId}:data:${dataIns[i].key}`, to: `${boundaryDataIns[i].toNode}:prop:${boundaryDataIns[i].prop}` })
  }
  for (let i = 0; i < boundaryDataOuts.length; i++) {
    fnEdges.push({ from: `${boundaryDataOuts[i].fromNode}:data`, to: `${returnId}:prop:${dataOuts[i].key}` })
  }

  graph.functions = graph.functions ?? {}
  graph.functions[fnId] = { id: fnId, name, nodes: fnNodes, edges: fnEdges, dataIns, dataOuts }

  const minX = Math.min(...nodes.map((n) => n.x))
  const minY = Math.min(...nodes.map((n) => n.y))
  const callId = newNodeId()

  const remainingEdges = graph.edges.filter((e) => {
    const fromId = e.from.split(':')[0]
    const toId = e.to.split(':')[0]
    return !selectedIds.has(fromId) && !selectedIds.has(toId)
  })

  for (const targetId of boundaryExecIns) {
    const ext = graph.edges.find((e) => e.to === `${targetId}:in` && !selectedIds.has(e.from.split(':')[0]))
    if (ext) remainingEdges.push({ from: ext.from, to: `${callId}:in` })
  }
  for (const b of boundaryExecOuts) {
    const ext = graph.edges.find((e) => e.from === `${b.from}:${b.port}`)
    if (ext) remainingEdges.push({ from: `${callId}:then`, to: ext.to })
  }
  for (let i = 0; i < boundaryDataIns.length; i++) {
    const ext = graph.edges.find(
      (e) => e.to === `${boundaryDataIns[i].toNode}:prop:${boundaryDataIns[i].prop}` && !selectedIds.has(e.from.split(':')[0]),
    )
    if (ext) remainingEdges.push({ from: ext.from, to: `${callId}:prop:${dataIns[i].key}` })
  }
  for (let i = 0; i < boundaryDataOuts.length; i++) {
    const ext = graph.edges.find(
      (e) => e.from.startsWith(`${boundaryDataOuts[i].fromNode}:`) && !selectedIds.has(e.to.split(':')[0]),
    )
    if (ext) remainingEdges.push({ from: `${callId}:data:${dataOuts[i].key}`, to: ext.to })
  }

  graph.nodes = graph.nodes.filter((n) => !selectedIds.has(n.id))
  graph.nodes.push({ id: callId, type: 'CallFunction', x: minX, y: minY, props: { functionId: fnId } })
  graph.edges = remainingEdges
  return null
}

function compileGraphBody(graph: BlueprintGraph, rootCtx?: Partial<CompileCtx>): { begin: string[]; tick: string[] } {
  const ctx: CompileCtx = {
    nodes: rootCtx?.nodes ?? graph.nodes,
    edges: rootCtx?.edges ?? graph.edges,
    byId: new Map((rootCtx?.nodes ?? graph.nodes).map((n) => [n.id, n])),
    dataBindings: rootCtx?.dataBindings,
    returnOuts: rootCtx?.returnOuts,
  }

  const compileCallDataOut = (callNode: BPNode, port: string, depth: number): string => {
    const fnId = String(callNode.props.functionId ?? '')
    const fn = graph.functions?.[fnId]
    if (!fn) return '0'
    const pin = fn.dataOuts.find((p) => p.key === port)
    if (!pin) return '0'
    const ret = fn.nodes.find((n) => n.type === 'FunctionReturn')
    if (!ret) return '0'
    const edge = fn.edges.find((e) => e.to === `${ret.id}:prop:${port}`)
    if (!edge) return '0'
    const subCtx: CompileCtx = {
      nodes: fn.nodes,
      edges: fn.edges,
      byId: new Map(fn.nodes.map((n) => [n.id, n])),
      dataBindings: new Map(),
    }
    const subDataExpr = (nodeId: string, d: number, dataPort?: string): string => {
      if (d > 32) return '0'
      const node = subCtx.byId.get(nodeId)
      if (!node) return '0'
      if (node.type === 'FunctionEntry' && dataPort) {
        const bindEdge = graph.edges.find((e) => e.to === `${callNode.id}:prop:${dataPort}`)
        return bindEdge ? dataExpr(bindEdge.from.split(':')[0], d + 1) : '0'
      }
      const def = NODE_DEFS[node.type]
      if (!def?.emitExpr) return '0'
      if (def.pure || (dataPort && def.dataOuts?.includes(dataPort)) || (!dataPort && def.dataOuts?.length)) {
        const ins: Record<string, string> = {}
        for (const key of def.dataIns ?? []) {
          const e2 = subCtx.edges.find((e) => e.to === `${node.id}:prop:${key}`)
          if (e2) {
            const [src, kind, p] = e2.from.split(':')
            ins[key] = kind === 'data' && p ? subDataExpr(src, d + 1, p) : subDataExpr(src, d + 1)
          }
        }
        return def.emitExpr(node, ins)
      }
      return '0'
    }
    const [src, kind, p] = edge.from.split(':')
    return kind === 'data' && p ? subDataExpr(src, depth + 1, p) : subDataExpr(src, depth + 1)
  }

  const dataExpr = (nodeId: string, depth: number, dataPort?: string): string => {
    if (depth > 32) return '0'
    const node = ctx.byId.get(nodeId)
    if (!node) return '0'

    if (node.type === 'FunctionEntry' && dataPort) {
      return ctx.dataBindings?.get(dataPort) ?? '0'
    }
    if (node.type === 'CallFunction' && dataPort) {
      return compileCallDataOut(node, dataPort, depth)
    }

    const def = NODE_DEFS[node.type]
    if (!def?.emitExpr) return '0'
    if (def.pure || (dataPort && def.dataOuts?.includes(dataPort)) || (!dataPort && def.dataOuts?.length)) {
      const ins: Record<string, string> = {}
      for (const key of def.dataIns ?? []) {
        const edge = ctx.edges.find((e) => e.to === `${node.id}:prop:${key}`)
        if (edge) {
          const [src, kind, port] = edge.from.split(':')
          ins[key] = kind === 'data' && port ? dataExpr(src, depth + 1, port) : dataExpr(src, depth + 1)
        }
      }
      return def.emitExpr(node, ins)
    }
    return '0'
  }

  const dataInsFor = (node: BPNode, def: BPNodeDef): Record<string, string> => {
    const ins: Record<string, string> = {}
    for (const key of def.dataIns ?? []) {
      const edge = ctx.edges.find((e) => e.to === `${node.id}:prop:${key}`)
      if (!edge) continue
      const [src, kind, port] = edge.from.split(':')
      ins[key] = kind === 'data' && port ? dataExpr(src, 0, port) : dataExpr(src, 0)
    }
    return ins
  }

  const follow = (nodeId: string, port: string, depth: number): string => {
    if (depth > 64) return '/* chain too deep */'
    const edge = ctx.edges.find((e) => e.from === `${nodeId}:${port}` && !e.to.includes(':prop:'))
    if (!edge) return ''
    const next = ctx.byId.get(edge.to.split(':')[0])
    if (!next) return ''
    return emitNode(next, depth + 1)
  }

  const inlineCallFunction = (callNode: BPNode, outerOuts: Record<string, string>, depth: number): string => {
    const fnId = String(callNode.props.functionId ?? '')
    const fn = graph.functions?.[fnId]
    if (!fn) return `/* unknown function ${fnId} */\n${outerOuts.then ?? ''}`

    const bindings = new Map<string, string>()
    for (const pin of fn.dataIns) {
      const edge = graph.edges.find((e) => e.to === `${callNode.id}:prop:${pin.key}`)
      bindings.set(pin.key, edge ? dataExpr(edge.from.split(':')[0], 0, edge.from.split(':')[2]) : `${pin.default ?? 0}`)
    }

    const entry = fn.nodes.find((n) => n.type === 'FunctionEntry')
    if (!entry) return outerOuts.then ?? ''

    const subCtx: CompileCtx = {
      nodes: fn.nodes,
      edges: fn.edges,
      byId: new Map(fn.nodes.map((n) => [n.id, n])),
      dataBindings: bindings,
      returnOuts: outerOuts,
    }

    const subDataExpr = (nodeId: string, depth: number, dataPort?: string): string => {
      if (depth > 32) return '0'
      const node = subCtx.byId.get(nodeId)
      if (!node) return '0'
      if (node.type === 'FunctionEntry' && dataPort) return bindings.get(dataPort) ?? '0'
      const def = NODE_DEFS[node.type]
      if (!def?.emitExpr) return '0'
      if (def.pure || (dataPort && def.dataOuts?.includes(dataPort)) || (!dataPort && def.dataOuts?.length)) {
        const ins: Record<string, string> = {}
        for (const key of def.dataIns ?? []) {
          const edge = subCtx.edges.find((e) => e.to === `${node.id}:prop:${key}`)
          if (edge) {
            const [src, kind, port] = edge.from.split(':')
            ins[key] = kind === 'data' && port ? subDataExpr(src, depth + 1, port) : subDataExpr(src, depth + 1)
          }
        }
        return def.emitExpr(node, ins)
      }
      return '0'
    }

    const subDataInsFor = (node: BPNode, def: BPNodeDef): Record<string, string> => {
      const ins: Record<string, string> = {}
      for (const key of def.dataIns ?? []) {
        const edge = subCtx.edges.find((e) => e.to === `${node.id}:prop:${key}`)
        if (!edge) continue
        const [src, kind, port] = edge.from.split(':')
        ins[key] = kind === 'data' && port ? subDataExpr(src, 0, port) : subDataExpr(src, 0)
      }
      return ins
    }

    const subFollow = (nodeId: string, port: string, depth: number): string => {
      if (depth > 64) return ''
      const edge = subCtx.edges.find((e) => e.from === `${nodeId}:${port}` && !e.to.includes(':prop:'))
      if (!edge) return ''
      const next = subCtx.byId.get(edge.to.split(':')[0])
      if (!next) return ''
      return subEmitNode(next, depth + 1)
    }

    const subEmitNode = (node: BPNode, depth: number): string => {
      if (node.type === 'FunctionReturn') return outerOuts.then ?? ''
      const def = NODE_DEFS[node.type]
      if (!def) return ''
      const outs: Record<string, string> = {}
      for (const p of def.execOuts) outs[p] = subFollow(node.id, p, depth)
      const body = def.emit(node, outs, subDataInsFor(node, def))
      if (!body.trim()) return body
      return `${execPrefix(node.id)}${body}`
    }

    return `${execPrefix(callNode.id)}${subEmitNode(entry, depth)}`
  }

  const emitNode = (node: BPNode, depth: number): string => {
    if (node.type === 'CallFunction') {
      const outs: Record<string, string> = {}
      for (const port of NODE_DEFS.CallFunction.execOuts) outs[port] = follow(node.id, port, depth)
      return inlineCallFunction(node, outs, depth)
    }
    if (node.type === 'FunctionReturn') return ctx.returnOuts?.then ?? ''
    const def = NODE_DEFS[node.type]
    if (!def) return `/* unknown node ${node.type} */`
    const outs: Record<string, string> = {}
    for (const port of def.execOuts) outs[port] = follow(node.id, port, depth)
    const body = def.emit(node, outs, dataInsFor(node, def))
    if (!body.trim()) return body
    return `${execPrefix(node.id)}${body}`
  }

  const beginChains: string[] = []
  const tickChains: string[] = []
  for (const node of ctx.nodes) {
    const def = NODE_DEFS[node.type]
    if (!def || def.hasExecIn) continue
    if (node.type === 'FunctionEntry' || node.type === 'FunctionReturn') continue
    const code = emitNode(node, 0)
    if (!code.trim()) continue
    if (node.type === 'EventBeginPlay' || node.type === 'EventSignal') beginChains.push(code)
    else tickChains.push(code)
  }

  return { begin: beginChains, tick: tickChains }
}

/** Compile a blueprint graph to per-actor script JS. */
export function compileBlueprint(graph: BlueprintGraph): string {
  const { begin, tick } = compileGraphBody(graph)

  const varInit = (graph.variables ?? [])
    .map((v) => `__vars[${JSON.stringify(v.name)}] = ${Number(v.value) || 0}`)
    .join('\n')

  return `// ── compiled from Blueprint — edits here are overwritten on next compile ──
let __dead = false
const __vars = {}
${varInit}
const __near = {}
const __once = {}
const __flip = {}
const __gate = {}
const __mg = {}
const __timers = []
let __dt = 0
function __after(s, fn) { __timers.push({ t: api.time() + s, fn }) }
function __pulse(id) { if (globalThis.__bpPulse) globalThis.__bpPulse(actor.id, id) }

function onBeginPlay() {
${indent(begin.join('\n'))}
}

function onTick(dt) {
  if (__dead) return
  __dt = dt
  for (let i = __timers.length - 1; i >= 0; i--) {
    if (api.time() >= __timers[i].t) { const f = __timers[i].fn; __timers.splice(i, 1); f() }
  }
${indent(tick.join('\n'))}
}
`
}

function indent(code: string): string {
  return code
    .split('\n')
    .map((l) => (l.trim() ? `  ${l}` : l))
    .join('\n')
}
