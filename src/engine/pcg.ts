import * as THREE from 'three'
import { Actor, nextActorId } from './Actor'
import {
  DEFAULT_PCG,
  buildPCGMesh,
  emptyPCGGraph,
  executePCGGraph,
  getEffectivePCGGraph,
  syncPropsFromGraph,
} from './pcgGraph'

export { DEFAULT_PCG }

/**
 * PCG-lite — UE Procedural Content Generation, node-graph pipeline:
 * sample (seeded jittered grid in the volume) → filter (surface hit + slope + height)
 * → transform (scale/rotation jitter, normal alignment) → spawn (instances).
 * Regenerates live when graph/props change; graph serializes on the volume actor.
 */

export function createPCGVolumeActor(name: string, id = nextActorId()): Actor {
  const actor = new Actor(id, name, 'PCGVolume')
  actor.pcgProps = { ...DEFAULT_PCG }
  actor.pcgGraph = emptyPCGGraph()
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0xd6a839, wireframe: true, transparent: true, opacity: 0.4, depthWrite: false }),
  )
  box.userData.actorId = id
  box.userData.isEditorOnly = true
  actor.mesh = box
  actor.root.add(box)
  return actor
}

/** regenerate instances inside the volume by executing the PCG node graph */
export function regeneratePCG(actor: Actor, actors: Map<string, Actor>) {
  if (!actor.pcgProps && !actor.pcgGraph) return
  if (actor.pcgMesh) {
    actor.pcgMesh.removeFromParent()
    actor.pcgMesh.geometry.dispose()
    ;(actor.pcgMesh.material as THREE.Material).dispose()
  }
  const graph = getEffectivePCGGraph(actor)
  const result = executePCGGraph(graph, actor, actors)
  actor.pcgProps = syncPropsFromGraph(graph)
  const mesh = buildPCGMesh(result)
  actor.pcgMesh = mesh
  actor.root.parent?.add(mesh)
}