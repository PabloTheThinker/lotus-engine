import type { BTNode } from './behaviorTree'

/** Visual behavior tree graph (Wave 12) — compiles to runtime BTNode JSON. */

export interface BTGraphNode {
  id: string
  type: string
  x: number
  y: number
  props: Record<string, string | number>
  /** PIE breakpoint — pauses when this node ticks (Wave 16) */
  breakpoint?: boolean
}

export interface BTGraphEdge {
  from: string
  to: string
  /** Wave 19 — UE-style service attachment (composite → service node, not flow child) */
  kind?: 'flow' | 'service'
}

export interface BTGraph {
  nodes: BTGraphNode[]
  edges: BTGraphEdge[]
  /** Wave 17 — collapsed decorator subtrees (node id → detached fragment) */
  subtrees?: Record<string, { nodes: BTGraphNode[]; edges: BTGraphEdge[] }>
}

export interface CompiledBTGraph {
  tree: BTNode
  /** runtime path (e.g. root/0/1) → editor node id */
  pathIndex: Record<string, string>
  /** Wave 19 — services tick while host composite path is active */
  services?: { hostPath: string; serviceNodeId: string; service: import('./behaviorTree').BTServiceNode }[]
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
  TimeLimit: { title: 'Time Limit (decorator)', color: '#8a6a5a', maxChildren: 1 },
  BlackboardDecorator: { title: 'Blackboard Gate (decorator)', color: '#5a6a8a', maxChildren: 1 },
  SvcPlayerNear: { title: 'Svc: Player Near', color: '#2a5a7a', maxChildren: 0 },
  SvcSetBB: { title: 'Svc: Set Blackboard', color: '#2a5a7a', maxChildren: 0 },
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
  return graph.edges.filter((e) => e.from === id && e.kind !== 'service').map((e) => e.to)
}

function servicesOf(graph: BTGraph, hostId: string): string[] {
  return graph.edges.filter((e) => e.from === hostId && e.kind === 'service').map((e) => e.to)
}

function compileServiceNode(graph: BTGraph, id: string): import('./behaviorTree').BTServiceNode {
  const node = graph.nodes.find((n) => n.id === id)
  if (!node) return { service: 'log', text: 'missing service' }
  switch (node.type) {
    case 'SvcPlayerNear':
      return {
        service: 'playerNear',
        key: String(node.props.key ?? 'hasLOS'),
        distance: Number(node.props.distance ?? 8),
      }
    case 'SvcSetBB':
      return { service: 'setBB', key: String(node.props.key ?? 'flag'), value: node.props.value ?? true }
    default:
      return { service: 'log', text: `unknown service ${node.type}` }
  }
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
      return { repeat: { count, child } }
    }
    case 'Cooldown': {
      const secs = Number(node.props.seconds ?? 2)
      const child = kids[0] ?? { task: 'log', text: 'cooldown empty' }
      return { cooldown: { seconds: secs, child } }
    }
    case 'TimeLimit': {
      const secs = Number(node.props.seconds ?? 5)
      const child = kids[0] ?? { task: 'log', text: 'timelimit empty' }
      return { timeLimit: { seconds: secs, child } }
    }
    case 'BlackboardDecorator': {
      const child = kids[0] ?? { task: 'log', text: 'bb gate empty' }
      return {
        blackboardGate: {
          key: String(node.props.key ?? 'flag'),
          ...(node.props.equals !== undefined ? { equals: node.props.equals } : {}),
          ...(node.props.greaterThan !== undefined ? { greaterThan: Number(node.props.greaterThan) } : {}),
          child,
        },
      }
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

/** Wave 18 — merge collapsed subtrees for PIE compile / tick. */
export function graphForBTCompile(graph: BTGraph): BTGraph {
  const subtrees = graph.subtrees ?? {}
  const keys = Object.keys(subtrees)
  if (!keys.length) return graph
  let nodes = [...graph.nodes]
  let edges = [...graph.edges]
  for (const id of keys) {
    const stash = subtrees[id]
    if (!stash) continue
    nodes = [...nodes, ...stash.nodes]
    edges = [...edges, ...stash.edges]
  }
  return { ...graph, nodes, edges }
}

/** Map a runtime node id to a visible editor node (collapsed decorator when child is stashed). */
export function resolveBTEditorHighlightNodeId(graph: BTGraph, runtimeNodeId: string | null): string | null {
  if (!runtimeNodeId) return null
  if (graph.nodes.some((n) => n.id === runtimeNodeId)) return runtimeNodeId
  for (const [decoratorId, stash] of Object.entries(graph.subtrees ?? {})) {
    if (stash.nodes.some((n) => n.id === runtimeNodeId)) return decoratorId
  }
  return runtimeNodeId
}

function parseBTServicesFromScript(script: string | undefined): { serviceNodeId: string }[] {
  if (!script) return []
  const m = script.match(/const __btServices = (\[[\s\S]*?\]|undefined)/)
  if (!m || m[1] === 'undefined') return []
  try {
    const parsed = JSON.parse(m[1]!) as { serviceNodeId: string }[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/** Wave 25 — inline service compile hint for gutter diff marker tooltip. */
export function getBTNodeServiceCompileHint(graph: BTGraph, nodeId: string): string | null {
  const compiled = compileBTGraph(graph)
  if (!compiled?.services?.length) return null
  const svc = compiled.services.find((s) => s.serviceNodeId === nodeId)
  if (!svc) return null
  const host = graph.nodes.find((n) => n.id === nodeId)
  const title = host ? (BT_NODE_DEFS[host.type]?.title ?? host.type) : nodeId
  return `${svc.hostPath} ← ${title} (${svc.service.service})`
}

/** Wave 24 — node ids that differ between actor script and compile preview (service gutter markers). */
export function getBTScriptDiffGutterNodeIds(
  existingScript: string | undefined,
  graph: BTGraph,
): string[] {
  const preview = compileBTGraphToScript(graph)
  if (!preview) return []
  const prev = (existingScript ?? '').trim()
  if (prev === preview.trim()) return []
  const ids = new Set<string>()
  const prevSvc = parseBTServicesFromScript(prev)
  const nextSvc = parseBTServicesFromScript(preview)
  const prevIds = new Set(prevSvc.map((s) => s.serviceNodeId))
  const nextIds = new Set(nextSvc.map((s) => s.serviceNodeId))
  for (const id of nextIds) {
    if (!prevIds.has(id)) ids.add(id)
  }
  for (const id of prevIds) {
    if (!nextIds.has(id)) ids.add(id)
  }
  if (prevSvc.length !== nextSvc.length) {
    for (const s of nextSvc) ids.add(s.serviceNodeId)
  }
  const prevTree = prev.match(/const __btTree = ([\s\S]*?)\nconst __btPaths/)
  const nextTree = preview.match(/const __btTree = ([\s\S]*?)\nconst __btPaths/)
  if (prevTree?.[1] !== nextTree?.[1]) {
    for (const n of graph.nodes) {
      if (BT_SERVICE_TYPES.has(n.type) || BT_COMPOSITE_TYPES.has(n.type)) ids.add(n.id)
    }
  }
  return [...ids]
}

export interface BTScriptDiffEntry {
  text: string
  nodeId: string | null
}

/** Wave 26 — map a diff line to a BT node id when possible (services / paths). */
export function resolveBTScriptDiffLineNodeId(line: string, graph: BTGraph): string | null {
  const svcMatch = line.match(/"serviceNodeId"\s*:\s*"([^"]+)"/)
  if (svcMatch) return svcMatch[1]
  const compiled = compileBTGraph(graphForBTCompile(graph))
  if (compiled) {
    for (const [path, id] of Object.entries(compiled.pathIndex)) {
      if (line.includes(`"${path}"`) || line.includes(path)) return id
    }
    for (const svc of compiled.services ?? []) {
      if (line.includes(svc.serviceNodeId)) return svc.serviceNodeId
    }
  }
  for (const n of graph.nodes) {
    if (BT_SERVICE_TYPES.has(n.type) && line.includes(n.type)) return n.id
  }
  return null
}

/** Wave 26 — scroll offsets to center a node in the BT canvas viewport. */
export function scrollRectForBTNode(
  node: { x: number; y: number },
  wrapW: number,
  wrapH: number,
  nodeW = 170,
  headerH = 24,
): { scrollLeft: number; scrollTop: number } {
  const cx = node.x + nodeW / 2
  const cy = node.y + headerH / 2
  return {
    scrollLeft: Math.max(0, cx - wrapW / 2),
    scrollTop: Math.max(0, cy - wrapH / 2),
  }
}

/** Wave 26 — diff lines with optional node jump targets. */
export function getBTScriptDiffLineTargets(
  existingScript: string | undefined,
  graph: BTGraph,
): BTScriptDiffEntry[] {
  const { lines } = diffBTScriptPreview(existingScript, graph)
  return lines.map((text) => ({ text, nodeId: resolveBTScriptDiffLineNodeId(text, graph) }))
}

/** Wave 23 — diff actor script vs compile-to-script preview (services-aware). */
export function diffBTScriptPreview(
  existingScript: string | undefined,
  graph: BTGraph,
): { changed: boolean; lines: string[]; preview: string; entries: BTScriptDiffEntry[] } {
  const preview = compileBTGraphToScript(graph) ?? ''
  const prev = (existingScript ?? '').trim()
  const next = preview.trim()
  if (!next) return { changed: false, lines: ['(compile failed)'], preview: '', entries: [{ text: '(compile failed)', nodeId: null }] }
  if (prev === next) return { changed: false, lines: ['✓ Matches actor script'], preview, entries: [{ text: '✓ Matches actor script', nodeId: null }] }
  const prevLines = prev.split('\n')
  const nextLines = next.split('\n')
  const lines: string[] = []
  const max = Math.max(prevLines.length, nextLines.length)
  for (let i = 0; i < max; i++) {
    const a = prevLines[i]
    const b = nextLines[i]
    if (a === b) continue
    if (a !== undefined) lines.push(`- ${a}`)
    if (b !== undefined) lines.push(`+ ${b}`)
  }
  if (!lines.length) lines.push('(script differs — whitespace or length)')
  const svcLine = nextLines.find((l) => l.includes('__btServices'))
  if (svcLine) lines.push(`  services: ${svcLine.trim()}`)
  const entries = lines.map((text) => ({ text, nodeId: resolveBTScriptDiffLineNodeId(text, graph) }))
  return { changed: true, lines, preview, entries }
}

/** Wave 22 — human-readable service compile preview for BT editor panel. */
export function summarizeBTServices(graph: BTGraph): string {
  const compiled = compileBTGraph(graph)
  if (!compiled?.services?.length) return 'No service nodes attached to composites'
  return compiled.services
    .map((s) => {
      const host = graph.nodes.find((n) => n.id === s.serviceNodeId)
      const title = host ? (BT_NODE_DEFS[host.type]?.title ?? host.type) : s.serviceNodeId
      return `${s.hostPath} ← ${title} (${s.service.service})`
    })
    .join('\n')
}

export function compileBTGraph(graph: BTGraph): CompiledBTGraph | null {
  const merged = graphForBTCompile(graph)
  const root = merged.nodes.find((n) => n.type === 'Root')
  if (!root) return null
  const pathIndex: Record<string, string> = {}
  const tree = compileNode(merged, root.id, 'root', pathIndex)
  const pathByNode = Object.fromEntries(Object.entries(pathIndex).map(([p, id]) => [id, p]))
  const services: CompiledBTGraph['services'] = []
  for (const n of merged.nodes) {
    if (n.type !== 'Selector' && n.type !== 'Sequence') continue
    const hostPath = pathByNode[n.id]
    if (!hostPath) continue
    for (const sid of servicesOf(merged, n.id)) {
      services.push({ hostPath, serviceNodeId: sid, service: compileServiceNode(merged, sid) })
    }
  }
  return { tree, pathIndex, services: services.length ? services : undefined }
}

/** Wave 15 — decorator nodes that wrap a single child */
export const BT_DECORATOR_TYPES = new Set(['Invert', 'Repeat', 'Cooldown', 'TimeLimit', 'BlackboardDecorator'])
export const BT_SERVICE_TYPES = new Set(['SvcPlayerNear', 'SvcSetBB'])
export const BT_COMPOSITE_TYPES = new Set(['Selector', 'Sequence'])
export const BT_MAX_DECORATOR_DEPTH = 4

export interface BTValidationIssue {
  level: 'error' | 'warn'
  message: string
  nodeId?: string
}

function parentsOf(graph: BTGraph, childId: string): string[] {
  return graph.edges.filter((e) => e.to === childId && e.kind !== 'service').map((e) => e.from)
}

function flowChildCount(graph: BTGraph, parentId: string): number {
  return graph.edges.filter((e) => e.from === parentId && e.kind !== 'service').length
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
    const serviceParents = graph.edges.filter((e) => e.to === n.id && e.kind === 'service').map((e) => e.from)
    if (BT_SERVICE_TYPES.has(n.type)) {
      if (!serviceParents.length) {
        issues.push({ level: 'warn', message: `${n.type} is not attached to a composite`, nodeId: n.id })
      }
      continue
    }
    if (n.type !== 'Root' && parents.length === 0) {
      issues.push({ level: 'warn', message: `${n.type} is not wired to Root`, nodeId: n.id })
    }
    if (parents.length > 1) {
      issues.push({ level: 'error', message: `${n.type} has multiple parents`, nodeId: n.id })
    }
    const def = BT_NODE_DEFS[n.type] ?? { maxChildren: 0 }
    const childCount = flowChildCount(graph, n.id)
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
    for (const e of graph.edges.filter((x) => x.from === id && x.kind !== 'service')) {
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
export type BTBlackboardType = 'bool' | 'number' | 'string' | 'vec3'

function inferBBValueType(value: unknown): BTBlackboardType {
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'bool'
  if (typeof value === 'string') {
    const parts = value.split(',').map((s) => parseFloat(s.trim()))
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) return 'vec3'
    return 'string'
  }
  return 'bool'
}

function collectDescendants(graph: BTGraph, rootId: string): Set<string> {
  const out = new Set<string>()
  const stack = childrenOf(graph, rootId)
  while (stack.length) {
    const id = stack.pop()!
    if (out.has(id)) continue
    out.add(id)
    stack.push(...childrenOf(graph, id))
  }
  return out
}

/** Wave 17 — collapse a decorator subtree into graph.subtrees storage. */
export function collapseBTSubtree(graph: BTGraph, nodeId: string): BTGraph {
  const node = graph.nodes.find((n) => n.id === nodeId)
  if (!node || !BT_DECORATOR_TYPES.has(node.type)) return graph
  const desc = collectDescendants(graph, nodeId)
  if (!desc.size) return graph
  const subtreeNodes = graph.nodes.filter((n) => desc.has(n.id))
  const subtreeEdges = graph.edges.filter((e) => desc.has(e.from) || desc.has(e.to))
  const nextNodes = graph.nodes
    .filter((n) => !desc.has(n.id))
    .map((n) => (n.id === nodeId ? { ...n, props: { ...n.props, collapsed: 1 } } : n))
  const nextEdges = graph.edges.filter((e) => !desc.has(e.from) && !desc.has(e.to))
  return {
    ...graph,
    nodes: nextNodes,
    edges: nextEdges,
    subtrees: {
      ...(graph.subtrees ?? {}),
      [nodeId]: { nodes: subtreeNodes, edges: subtreeEdges },
    },
  }
}

/** Restore a previously collapsed decorator subtree. */
export function expandBTSubtree(graph: BTGraph, nodeId: string): BTGraph {
  const stash = graph.subtrees?.[nodeId]
  if (!stash) return graph
  const nextSubtrees = { ...(graph.subtrees ?? {}) }
  delete nextSubtrees[nodeId]
  const nextNodes: BTGraphNode[] = [
    ...graph.nodes.map((n) => {
      if (n.id !== nodeId) return n
      const props = { ...n.props }
      delete props.collapsed
      return { ...n, props }
    }),
    ...stash.nodes,
  ]
  return {
    ...graph,
    nodes: nextNodes,
    edges: [...graph.edges, ...stash.edges],
    subtrees: Object.keys(nextSubtrees).length ? nextSubtrees : undefined,
  }
}

/** Infer blackboard key types from SetBB / Blackboard nodes (Wave 16). */
export function inferBlackboardTypes(graph: BTGraph): Record<string, BTBlackboardType> {
  const types: Record<string, BTBlackboardType> = {}
  for (const n of graph.nodes) {
    if (n.type === 'SetBB') {
      const key = String(n.props.key ?? 'flag')
      types[key] = inferBBValueType(n.props.value ?? true)
    }
    if (n.type === 'Blackboard') {
      const key = String(n.props.key ?? 'flag')
      if (n.props.greaterThan !== undefined) types[key] = 'number'
      else if (n.props.equals !== undefined) types[key] = inferBBValueType(n.props.equals)
      else types[key] = 'bool'
    }
  }
  return types
}

/** Compile BT graph to per-actor script JS (Wave 16). */
export function compileBTGraphToScript(graph: BTGraph): string | null {
  const merged = graphForBTCompile(graph)
  const compiled = compileBTGraph(merged)
  if (!compiled) return null
  const types = inferBlackboardTypes(merged)
  const typeLines = Object.entries(types)
    .map(([k, t]) => `// bb ${k}: ${t}`)
    .join('\n')
  const treeJson = JSON.stringify(compiled.tree)
  const pathJson = JSON.stringify(compiled.pathIndex)
  const servicesJson = compiled.services?.length ? JSON.stringify(compiled.services) : 'undefined'

  return `// ── compiled from Behavior Tree — edits overwritten on next compile ──
${typeLines}
const __btTree = ${treeJson}
const __btPaths = ${pathJson}
const __btServices = ${servicesJson}

function onBeginPlay() {
  const bb = api.blackboard(actor)
  Object.assign(bb, actor.scriptVars ?? {})
  api.runBTWithPaths(actor, __btTree, __btPaths, bb, __btServices)
}
`
}

export function summarizeBTTree(tree: BTNode, depth = 0): string {
  const pad = '  '.repeat(depth)
  if ('sequence' in tree && tree.sequence) {
    return `${pad}Sequence\n${tree.sequence.map((c) => summarizeBTTree(c, depth + 1)).join('\n')}`
  }
  if ('selector' in tree && tree.selector) {
    return `${pad}Selector\n${tree.selector.map((c) => summarizeBTTree(c, depth + 1)).join('\n')}`
  }
  if ('invert' in tree && tree.invert) return `${pad}Invert\n${summarizeBTTree(tree.invert, depth + 1)}`
  if ('repeat' in tree && tree.repeat) {
    return `${pad}Repeat x${tree.repeat.count}\n${summarizeBTTree(tree.repeat.child, depth + 1)}`
  }
  if ('cooldown' in tree && tree.cooldown) {
    return `${pad}Cooldown ${tree.cooldown.seconds}s\n${summarizeBTTree(tree.cooldown.child, depth + 1)}`
  }
  if ('timeLimit' in tree && tree.timeLimit) {
    return `${pad}TimeLimit ${tree.timeLimit.seconds}s\n${summarizeBTTree(tree.timeLimit.child, depth + 1)}`
  }
  if ('blackboardGate' in tree && tree.blackboardGate) {
    return `${pad}BB Gate: ${tree.blackboardGate.key}\n${summarizeBTTree(tree.blackboardGate.child, depth + 1)}`
  }
  if ('condition' in tree && tree.condition) return `${pad}Condition: ${tree.condition}`
  if ('task' in tree && tree.task) return `${pad}Task: ${tree.task}`
  return `${pad}?`
}