import * as THREE from 'three'
import type { Actor } from './Actor'

/**
 * Behavior Trees — the UE BT + Blackboard analog. Trees are plain JSON
 * (serializable, AI-copilot-authorable); scripts attach them with
 * api.runBT(tree). Composites: selector / sequence. Leaves: conditions
 * and tasks over a per-actor blackboard.
 */

export type BTStatus = 'success' | 'failure' | 'running'

export type BTServiceNode =
  | { service: 'playerNear'; key: string; distance: number }
  | { service: 'setBB'; key: string; value: unknown }
  | { service: 'log'; text: string }

export type BTNode =
  | { selector: BTNode[] }
  | { sequence: BTNode[] }
  | { invert: BTNode }
  | { repeat: { count: number; child: BTNode } }
  | { cooldown: { seconds: number; child: BTNode } }
  | { timeLimit: { seconds: number; child: BTNode } }
  | { blackboardGate: { key: string; equals?: unknown; greaterThan?: number; child: BTNode } }
  | { condition: 'playerNear'; distance: number }
  | { condition: 'blackboard'; key: string; equals?: unknown; greaterThan?: number }
  | { task: 'moveToPlayer'; speed?: number; stopAt?: number }
  | { task: 'moveTo'; point: [number, number, number]; speed?: number; stopAt?: number }
  | { task: 'moveToBlackboard'; key: string; speed?: number; stopAt?: number }
  | { task: 'wait'; seconds: number }
  | { task: 'lookAtPlayer' }
  | { task: 'set'; key: string; value: unknown }
  | { task: 'emit'; signal: string }
  | { task: 'log'; text: string }
  | { task: 'activateAbility'; abilityId: string }

export interface BTContext {
  actor: Actor
  bb: Record<string, unknown>
  pawn: () => THREE.Vector3 | null
  emit: (signal: string, ...args: unknown[]) => void
  log: (msg: string) => void
  dt: number
  activateAbility: (abilityId: string) => boolean
  /** Maps runtime path → graph node id (Wave 12 live highlight) */
  pathPrefix?: string
  pathIndex?: Record<string, string>
}

interface BTState {
  waitUntil?: number
  elapsed: number
  repeatIndex?: number
  cooldownReady?: boolean
  timeLimitStarted?: boolean
}

const states = new WeakMap<object, BTState>()

function stateFor(node: object): BTState {
  let st = states.get(node)
  if (!st) {
    st = { elapsed: 0 }
    states.set(node, st)
  }
  return st
}

function moveToward(actor: Actor, target: THREE.Vector3, speed: number, stopAt: number, dt: number): BTStatus {
  const p = actor.root.position
  const d = new THREE.Vector3(target.x - p.x, 0, target.z - p.z)
  if (d.length() <= stopAt) return 'success'
  d.normalize()
  p.x += d.x * speed * dt
  p.z += d.z * speed * dt
  actor.root.rotation.y = Math.atan2(d.x, d.z)
  return 'running'
}

const activePaths = new Map<string, string>()

export function getActiveBTPath(actorId: string): string | null {
  return activePaths.get(actorId) ?? null
}

export function getActiveBTPaths(): Record<string, string> {
  return Object.fromEntries(activePaths)
}

/** Resolve live runtime path to editor graph node id. */
export function getActiveBTGraphNodeId(
  actorId: string,
  pathIndex?: Record<string, string>,
): string | null {
  const p = activePaths.get(actorId)
  if (!p || !pathIndex) return null
  return pathIndex[p] ?? null
}

function visit(ctx: BTContext, path: string) {
  if (!ctx.pathPrefix) return
  const full = path ? `${ctx.pathPrefix}/${path}` : ctx.pathPrefix
  activePaths.set(ctx.actor.id, full)
  if (ctx.pathIndex) {
    const nodeId = ctx.pathIndex[full]
    if (nodeId) {
      const g = globalThis as { __btBreakpoint?: (actorId: string, nodeId: string) => boolean }
      g.__btBreakpoint?.(ctx.actor.id, nodeId)
    }
  }
}

export function tickBT(node: BTNode, ctx: BTContext, path = ''): BTStatus {
  visit(ctx, path)
  if ('selector' in node) {
    for (let i = 0; i < node.selector.length; i++) {
      const r = tickBT(node.selector[i], ctx, `${path}/${i}`)
      if (r !== 'failure') return r
    }
    return 'failure'
  }
  if ('sequence' in node) {
    for (let i = 0; i < node.sequence.length; i++) {
      const r = tickBT(node.sequence[i], ctx, `${path}/${i}`)
      if (r !== 'success') return r
    }
    return 'success'
  }
  if ('invert' in node) {
    const r = tickBT(node.invert, ctx, `${path}/inv`)
    return r === 'running' ? 'running' : r === 'success' ? 'failure' : 'success'
  }
  if ('repeat' in node) {
    const st = stateFor(node)
    if (st.repeatIndex === undefined) st.repeatIndex = 0
    while (st.repeatIndex < node.repeat.count) {
      const r = tickBT(node.repeat.child, ctx, `${path}/r${st.repeatIndex}`)
      if (r === 'running') return 'running'
      if (r === 'failure') {
        st.repeatIndex = 0
        return 'failure'
      }
      st.repeatIndex++
    }
    st.repeatIndex = 0
    return 'success'
  }
  if ('cooldown' in node) {
    const st = stateFor(node)
    if (!st.cooldownReady) {
      st.elapsed += ctx.dt
      if (st.elapsed < node.cooldown.seconds) return 'running'
      st.cooldownReady = true
      st.elapsed = 0
    }
    const r = tickBT(node.cooldown.child, ctx, `${path}/cd`)
    if (r !== 'running') {
      st.cooldownReady = false
      st.elapsed = 0
    }
    return r
  }
  if ('timeLimit' in node) {
    const st = stateFor(node)
    if (!st.timeLimitStarted) {
      st.timeLimitStarted = true
      st.elapsed = 0
    }
    st.elapsed += ctx.dt
    if (st.elapsed >= node.timeLimit.seconds) {
      st.timeLimitStarted = false
      st.elapsed = 0
      return 'failure'
    }
    const r = tickBT(node.timeLimit.child, ctx, `${path}/tl`)
    if (r !== 'running') {
      st.timeLimitStarted = false
      st.elapsed = 0
    }
    return r
  }
  if ('blackboardGate' in node) {
    const v = ctx.bb[node.blackboardGate.key]
    let ok = false
    if (node.blackboardGate.greaterThan !== undefined) ok = Number(v) > node.blackboardGate.greaterThan
    else if (node.blackboardGate.equals !== undefined) ok = v === node.blackboardGate.equals
    else ok = !!v
    if (!ok) return 'failure'
    return tickBT(node.blackboardGate.child, ctx, `${path}/bb`)
  }
  if ('condition' in node) {
    if (node.condition === 'playerNear') {
      const p = ctx.pawn()
      return p && p.distanceTo(ctx.actor.root.position) < node.distance ? 'success' : 'failure'
    }
    const v = ctx.bb[node.key]
    if (node.greaterThan !== undefined) return Number(v) > node.greaterThan ? 'success' : 'failure'
    if (node.equals !== undefined) return v === node.equals ? 'success' : 'failure'
    return v ? 'success' : 'failure'
  }
  // tasks
  switch (node.task) {
    case 'moveToPlayer': {
      const p = ctx.pawn()
      if (!p) return 'failure'
      return moveToward(ctx.actor, p, node.speed ?? 2.5, node.stopAt ?? 1.2, ctx.dt)
    }
    case 'moveTo':
      return moveToward(ctx.actor, new THREE.Vector3(...node.point), node.speed ?? 2.5, node.stopAt ?? 0.3, ctx.dt)
    case 'moveToBlackboard': {
      const v = ctx.bb[node.key] as [number, number, number] | undefined
      if (!v) return 'failure'
      return moveToward(ctx.actor, new THREE.Vector3(...v), node.speed ?? 2.5, node.stopAt ?? 0.3, ctx.dt)
    }
    case 'wait': {
      const st = stateFor(node)
      st.elapsed += ctx.dt
      if (st.elapsed >= node.seconds) {
        st.elapsed = 0
        return 'success'
      }
      return 'running'
    }
    case 'lookAtPlayer': {
      const p = ctx.pawn()
      if (!p) return 'failure'
      const d = new THREE.Vector3(p.x - ctx.actor.root.position.x, 0, p.z - ctx.actor.root.position.z)
      ctx.actor.root.rotation.y = Math.atan2(d.x, d.z)
      return 'success'
    }
    case 'set':
      ctx.bb[node.key] = node.value
      return 'success'
    case 'emit':
      ctx.emit(node.signal, ctx.actor.name)
      return 'success'
    case 'log':
      ctx.log(node.text)
      return 'success'
    case 'activateAbility':
      return ctx.activateAbility(node.abilityId) ? 'success' : 'failure'
  }
  return 'failure'
}

function tickService(service: BTServiceNode, ctx: BTContext) {
  switch (service.service) {
    case 'playerNear': {
      const p = ctx.pawn()
      ctx.bb[service.key] = !!(p && p.distanceTo(ctx.actor.root.position) < service.distance)
      break
    }
    case 'setBB':
      ctx.bb[service.key] = service.value
      break
    case 'log':
      ctx.log(service.text)
      break
  }
}

const activeServiceNodes = new Map<string, Set<string>>()

export function getActiveBTServiceNodeIds(actorId: string): string[] {
  return [...(activeServiceNodes.get(actorId) ?? [])]
}

function tickServicesForPath(
  services: { hostPath: string; serviceNodeId?: string; service: BTServiceNode }[] | undefined,
  activePath: string | undefined,
  ctx: BTContext,
) {
  const activeSet = new Set<string>()
  if (!services?.length || !activePath) {
    activeServiceNodes.set(ctx.actor.id, activeSet)
    return
  }
  for (const s of services) {
    if (activePath === s.hostPath || activePath.startsWith(`${s.hostPath}/`)) {
      if (s.serviceNodeId) {
        const g = globalThis as { __btBreakpoint?: (actorId: string, nodeId: string) => boolean }
        g.__btBreakpoint?.(ctx.actor.id, s.serviceNodeId)
      }
      tickService(s.service, ctx)
      if (s.serviceNodeId) activeSet.add(s.serviceNodeId)
    }
  }
  activeServiceNodes.set(ctx.actor.id, activeSet)
}

// ---- per-play-session BT registry ----
interface ActiveBT {
  actor: Actor
  tree: BTNode
  bb: Record<string, unknown>
  pathIndex?: Record<string, string>
  services?: { hostPath: string; serviceNodeId?: string; service: BTServiceNode }[]
}
let active: ActiveBT[] = []

export function resetBTs() {
  active = []
  activePaths.clear()
  activeServiceNodes.clear()
}

export function runBT(
  actor: Actor,
  tree: BTNode,
  bb: Record<string, unknown>,
  pathIndex?: Record<string, string>,
  services?: { hostPath: string; service: BTServiceNode }[],
) {
  active = active.filter((a) => a.actor !== actor)
  active.push({ actor, tree, bb, pathIndex, services })
}

/** Start a compiled behavior tree graph on an actor. */
export function runBTGraph(
  actor: Actor,
  compiled: { tree: BTNode; pathIndex: Record<string, string>; services?: { hostPath: string; service: BTServiceNode }[] },
  bb: Record<string, unknown> = {},
) {
  runBT(actor, compiled.tree, bb, compiled.pathIndex, compiled.services)
}

export function tickBTs(
  dt: number,
  pawn: () => THREE.Vector3 | null,
  emit: BTContext['emit'],
  log: (m: string) => void,
  activateAbility: (actor: Actor, abilityId: string) => boolean,
) {
  for (const a of active) {
    if (!a.actor.root.visible) continue
    const ctx: BTContext = {
      actor: a.actor,
      bb: a.bb,
      pawn,
      emit,
      log: (m) => log(m),
      dt,
      activateAbility: (id) => activateAbility(a.actor, id),
      pathPrefix: a.pathIndex ? 'root' : undefined,
      pathIndex: a.pathIndex,
    }
    tickBT(a.tree, ctx)
    tickServicesForPath(a.services, getActiveBTPath(a.actor.id) ?? undefined, ctx)
  }
}
