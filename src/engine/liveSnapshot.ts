import type { Actor } from './Actor'
import type { World } from './World'
import type { TransformSnapshot } from './types'
import { getActorTickBreakdown } from './profiler'

/** Serializable live actor node for remote debugger / devtools. */
export interface LiveActorNode {
  id: string
  name: string
  type: string
  parentId: string | null
  parentName: string | null
  visible: boolean
  mobility: string
  tags: string[]
  transform: TransformSnapshot
  children: LiveActorNode[]
}

export interface LiveSnapshot {
  playing: boolean
  ejected: boolean
  simulate: boolean
  playClock: number
  actorCount: number
  selectedId: string | null
  tree: LiveActorNode[]
  tickBreakdown: Array<{ id: string; name: string; ms: number }>
}

function nodeFromActor(actor: Actor, actors: Map<string, Actor>): LiveActorNode {
  const parent = actor.parentId ? actors.get(actor.parentId) : null
  return {
    id: actor.id,
    name: actor.name,
    type: actor.type,
    parentId: actor.parentId,
    parentName: parent?.name ?? null,
    visible: actor.visible,
    mobility: actor.mobility,
    tags: [...actor.tags],
    transform: actor.transform,
    children: [],
  }
}

/** Build a hierarchical live actor tree from the world registry. */
export function buildLiveTree(actors: Map<string, Actor>): LiveActorNode[] {
  const nodes = new Map<string, LiveActorNode>()
  for (const a of actors.values()) nodes.set(a.id, nodeFromActor(a, actors))

  const roots: LiveActorNode[] = []
  for (const a of actors.values()) {
    const node = nodes.get(a.id)!
    if (a.parentId && nodes.has(a.parentId)) {
      nodes.get(a.parentId)!.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortNodes = (list: LiveActorNode[]) => {
    list.sort((x, y) => x.name.localeCompare(y.name))
    for (const n of list) sortNodes(n.children)
  }
  sortNodes(roots)
  return roots
}

/** Full serializable snapshot of the running scene — for window.vektra.getLiveSnapshot(). */
export function getLiveSnapshot(
  world: World,
  editor: { playing: boolean; ejected: boolean; simulate: boolean; selectedId: string | null },
): LiveSnapshot {
  return {
    playing: editor.playing,
    ejected: editor.ejected,
    simulate: editor.simulate,
    playClock: world.playClock,
    actorCount: world.actors.size,
    selectedId: editor.selectedId,
    tree: buildLiveTree(world.actors),
    tickBreakdown: getActorTickBreakdown(),
  }
}