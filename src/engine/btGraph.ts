import type { BTNode } from './behaviorTree'

/** Visual behavior tree graph (Wave 12) — compiles to runtime BTNode JSON. */

export interface BTGraphNode {
  id: string
  type: string
  x: number
  y: number
  props: Record<string, string | number>
}

export interface BTGraphEdge {
  from: string
  to: string
}

export interface BTGraph {
  nodes: BTGraphNode[]
  edges: BTGraphEdge[]
}

export interface CompiledBTGraph {
  tree: BTNode
  /** runtime path (e.g. root/0/1) → editor node id */
  pathIndex: Record<string, string>
}

let nodeSeq = 0
export function newBTNodeId(): string {
  return `btn_${++nodeSeq}_${Math.random().toString(36).slice(2, 6)}`
}

export function emptyBTGraph(): BTGraph {
  const root: BTGraphNode = { id: newBTNodeId(), type: 'Root', x: 80, y: 80, props: {} }
  const selector: BTGraphNode = {
    id: newBTNodeId(),
    type: 'Selector',
    x: 280,
    y: 80,
    props: {},
  }
  const near: BTGraphNode = {
    id: newBTNodeId(),
    type: 'PlayerNear',
    x: 480,
    y: 40,
    props: { distance: 8 },
  }
  const move: BTGraphNode = {
    id: newBTNodeId(),
    type: 'MoveToPlayer',
    x: 480,
    y: 140,
    props: { speed: 2.5, stopAt: 1.2 },
  }
  return {
    nodes: [root, selector, near, move],
    edges: [
      { from: root.id, to: selector.id },
      { from: selector.id, to: near.id },
      { from: selector.id, to: move.id },
    ],
  }
}

export const BT_NODE_DEFS: Record<string, { title: string; color: string; maxChildren: number }> = {
  Root: { title: 'Root', color: '#4a6a8a', maxChildren: 1 },
  Selector: { title: 'Selector (OR)', color: '#6a4a8a', maxChildren: 99 },
  Sequence: { title: 'Sequence (AND)', color: '#4a8a6a', maxChildren: 99 },
  Invert: { title: 'Invert', color: '#8a6a4a', maxChildren: 1 },
  Repeat: { title: 'Repeat (decorator)', color: '#8a5a6a', maxChildren: 1 },
  Cooldown: { title: 'Cooldown (decorator)', color: '#6a5a8a', maxChildren: 1 },
  PlayerNear: { title: 'Player Near', color: '#3a6a9a', maxChildren: 0 },
  Blackboard: { title: 'Blackboard', color: '#3a6a9a', maxChildren: 0 },
  MoveToPlayer: { title: 'Move To Player', color: '#9a5a3a', maxChildren: 0 },
  MoveTo: { title: 'Move To Point', color: '#9a5a3a', maxChildren: 0 },
  Wait: { title: 'Wait', color: '#7a7a4a', maxChildren: 0 },
  LookAtPlayer: { title: 'Look At Player', color: '#7a7a4a', maxChildren: 0 },
  SetBB: { title: 'Set Blackboard', color: '#5a5a8a', maxChildren: 0 },
  Emit: { title: 'Emit Signal', color: '#8a4a6a', maxChildren: 0 },
  Log: { title: 'Log', color: '#555', maxChildren: 0 },
}

function childrenOf(graph: BTGraph, id: string): string[] {
  return graph.edges.filter((e) => e.from === id).map((e) => e.to)
}

function compileNode(graph: BTGraph, id: string, path: string, pathIndex: Record<string, string>): BTNode {
  const node = graph.nodes.find((n) => n.id === id)
  if (!node) return { task: 'log', text: `missing node ${id}` }
  pathIndex[path] = id
  const kids = childrenOf(graph, id).map((cid, i) => compileNode(graph, cid, `${path}/${i}`, pathIndex))

  switch (node.type) {
    case 'Root':
    case 'Sequence':
      return kids.length === 1 ? kids[0] : { sequence: kids }
    case 'Selector':
      return { selector: kids }
    case 'Invert':
      return kids[0] ? { invert: kids[0] } : { task: 'log', text: 'invert missing child' }
    case 'Repeat': {
      const count = Math.max(1, Math.min(32, Number(node.props.count ?? 3)))
      const child = kids[0] ?? { task: 'log', text: 'repeat empty' }
      return {
        sequence: Array.from({ length: count }, () => JSON.parse(JSON.stringify(child)) as BTNode),
      }
    }
    case 'Cooldown': {
      const secs = Number(node.props.seconds ?? 2)
      const child = kids[0] ?? { task: 'log', text: 'cooldown empty' }
      return { sequence: [{ task: 'wait', seconds: secs }, child] }
    }
    case 'PlayerNear':
      return { condition: 'playerNear', distance: Number(node.props.distance ?? 8) }
    case 'Blackboard':
      return {
        condition: 'blackboard',
        key: String(node.props.key ?? 'flag'),
        ...(node.props.equals !== undefined ? { equals: node.props.equals } : {}),
        ...(node.props.greaterThan !== undefined ? { greaterThan: Number(node.props.greaterThan) } : {}),
      }
    case 'MoveToPlayer':
      return {
        task: 'moveToPlayer',
        speed: Number(node.props.speed ?? 2.5),
        stopAt: Number(node.props.stopAt ?? 1.2),
      }
    case 'MoveTo': {
      const raw = String(node.props.point ?? '0,0,0').split(',').map(Number)
      return {
        task: 'moveTo',
        point: [raw[0] || 0, raw[1] || 0, raw[2] || 0],
        speed: Number(node.props.speed ?? 2.5),
        stopAt: Number(node.props.stopAt ?? 0.3),
      }
    }
    case 'Wait':
      return { task: 'wait', seconds: Number(node.props.seconds ?? 1) }
    case 'LookAtPlayer':
      return { task: 'lookAtPlayer' }
    case 'SetBB':
      return { task: 'set', key: String(node.props.key ?? 'flag'), value: node.props.value ?? true }
    case 'Emit':
      return { task: 'emit', signal: String(node.props.signal ?? 'ping') }
    case 'Log':
      return { task: 'log', text: String(node.props.text ?? 'BT') }
    default:
      return { task: 'log', text: `unknown ${node.type}` }
  }
}

export function compileBTGraph(graph: BTGraph): CompiledBTGraph | null {
  const root = graph.nodes.find((n) => n.type === 'Root')
  if (!root) return null
  const pathIndex: Record<string, string> = {}
  const tree = compileNode(graph, root.id, 'root', pathIndex)
  return { tree, pathIndex }
}

/** Wave 15 — decorator nodes that wrap a single child */
export const BT_DECORATOR_TYPES = new Set(['Invert', 'Repeat', 'Cooldown'])
export const BT_MAX_DECORATOR_DEPTH = 4

export interface BTValidationIssue {
  level: 'error' | 'warn'
  message: string
  nodeId?: string
}

function parentsOf(graph: BTGraph, childId: string): string[] {
  return graph.edges.filter((e) => e.to === childId).map((e) => e.from)
}

function decoratorDepth(graph: BTGraph, nodeId: string, memo = new Map<string, number>()): number {
  if (memo.has(nodeId)) return memo.get(nodeId)!
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node || !BT_DECORATOR_TYPES.has(node.type)) {
    memo.set(nodeId, 0)
    return 0
  }
  const parents = parentsOf(graph, nodeId)
  const parentDepth = parents.length
    ? Math.max(...parents.map((pid) => decoratorDepth(graph, pid, memo)))
    : 0
  const depth = parentDepth + 1
  memo.set(nodeId, depth)
  return depth
}

/** Validate BT graph structure before compile / PIE. */
export function validateBTGraph(graph: BTGraph): BTValidationIssue[] {
  const issues: BTValidationIssue[] = []
  const root = graph.nodes.find((n) => n.type === 'Root')
  if (!root) issues.push({ level: 'error', message: 'Missing Root node' })

  for (const n of graph.nodes) {
    const parents = parentsOf(graph, n.id)
    if (n.type !== 'Root' && parents.length === 0) {
      issues.push({ level: 'warn', message: `${n.type} is not wired to Root`, nodeId: n.id })
    }
    if (parents.length > 1) {
      issues.push({ level: 'error', message: `${n.type} has multiple parents`, nodeId: n.id })
    }
    const def = BT_NODE_DEFS[n.type] ?? { maxChildren: 0 }
    const childCount = graph.edges.filter((e) => e.from === n.id).length
    if (childCount > def.maxChildren) {
      issues.push({
        level: 'error',
        message: `${n.type} exceeds max children (${def.maxChildren})`,
        nodeId: n.id,
      })
    }
    if (BT_DECORATOR_TYPES.has(n.type) && decoratorDepth(graph, n.id) > BT_MAX_DECORATOR_DEPTH) {
      issues.push({
        level: 'error',
        message: `Decorator nesting exceeds ${BT_MAX_DECORATOR_DEPTH}`,
        nodeId: n.id,
      })
    }
  }

  const visiting = new Set<string>()
  const visited = new Set<string>()
  const dfs = (id: string): boolean => {
    if (visiting.has(id)) return true
    if (visited.has(id)) return false
    visiting.add(id)
    for (const e of graph.edges.filter((x) => x.from === id)) {
      if (dfs(e.to)) return true
    }
    visiting.delete(id)
    visited.add(id)
    return false
  }
  if (root && dfs(root.id)) {
    issues.push({ level: 'error', message: 'Cycle detected in graph wires' })
  }

  return issues
}

/** Summarize compiled tree for BT editor preview. */
export function summarizeBTTree(tree: BTNode, depth = 0): string {
  const pad = '  '.repeat(depth)
  if ('sequence' in tree && tree.sequence) {
    return `${pad}Sequence\n${tree.sequence.map((c) => summarizeBTTree(c, depth + 1)).join('\n')}`
  }
  if ('selector' in tree && tree.selector) {
    return `${pad}Selector\n${tree.selector.map((c) => summarizeBTTree(c, depth + 1)).join('\n')}`
  }
  if ('invert' in tree && tree.invert) return `${pad}Invert\n${summarizeBTTree(tree.invert, depth + 1)}`
  if ('condition' in tree && tree.condition) return `${pad}Condition: ${tree.condition}`
  if ('task' in tree && tree.task) return `${pad}Task: ${tree.task}`
  return `${pad}?`
}