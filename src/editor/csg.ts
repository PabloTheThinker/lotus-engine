import * as THREE from 'three'
import { Brush, Evaluator, ADDITION, SUBTRACTION, INTERSECTION } from 'three-bvh-csg'
import { world } from '../engine/World'
import { nextActorId } from '../engine/Actor'
import { DeleteActorCommand, runCommand, type Command } from './commands'
import { AddActorCommand } from './commands'
import { useEditor } from './store'
import type { SerializedActor } from '../engine/types'
import { DEFAULT_MATERIAL, DEFAULT_PHYSICS } from '../engine/types'

/**
 * CSG — UE Modeling-mode booleans / Godot CSG nodes, via three-bvh-csg.
 * Select two mesh actors, run Union/Subtract/Intersect; the originals are
 * replaced by one CustomMesh actor (single undo step).
 */

export type CSGOp = 'union' | 'subtract' | 'intersect'

export function runCSG(op: CSGOp) {
  const s = useEditor.getState()
  const ids = s.selectedIds
  if (ids.length !== 2) {
    s.setStatus('CSG needs exactly two mesh actors selected (Ctrl+click).')
    return
  }
  const [a, b] = ids.map((id) => world.actors.get(id))
  if (!a?.mesh || !b?.mesh || !a.mesh.geometry.attributes.position || !b.mesh.geometry.attributes.position) {
    s.setStatus('CSG: both selections must be mesh actors.')
    return
  }

  a.root.updateWorldMatrix(true, true)
  b.root.updateWorldMatrix(true, true)
  const brushA = new Brush(a.mesh.geometry.clone().applyMatrix4(a.mesh.matrixWorld))
  const brushB = new Brush(b.mesh.geometry.clone().applyMatrix4(b.mesh.matrixWorld))
  brushA.updateMatrixWorld()
  brushB.updateMatrixWorld()

  const evaluator = new Evaluator()
  const opMap = { union: ADDITION, subtract: SUBTRACTION, intersect: INTERSECTION } as const
  let result: THREE.Mesh
  try {
    result = evaluator.evaluate(brushA, brushB, opMap[op])
  } catch (err) {
    s.setStatus(`CSG failed: ${(err as Error).message}`)
    return
  }

  const geom = result.geometry
  geom.computeVertexNormals()
  const positions = Array.from(geom.attributes.position.array as Float32Array).map((v) => Math.round(v * 1000) / 1000)
  const normals = Array.from(geom.attributes.normal.array as Float32Array).map((v) => Math.round(v * 1000) / 1000)
  const index = geom.index ? Array.from(geom.index.array as Uint32Array | Uint16Array) : undefined

  const sa: SerializedActor = {
    id: nextActorId(),
    name: `${a.name}_${op}_${b.name}`.slice(0, 48),
    type: 'CustomMesh',
    parentId: null,
    visible: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
    behaviors: [],
    customGeometry: { positions, normals, index },
    material: { ...DEFAULT_MATERIAL, color: a.materialProps?.color ?? DEFAULT_MATERIAL.color },
    physics: { ...DEFAULT_PHYSICS },
  }

  // one undo step: delete both sources, add the result
  const dels: Command[] = [new DeleteActorCommand(a.id), new DeleteActorCommand(b.id)]
  const add = new AddActorCommand(sa)
  runCommand({
    label: `CSG ${op}`,
    execute() {
      for (const d of dels) d.execute()
      add.execute()
    },
    undo() {
      add.undo()
      for (const d of [...dels].reverse()) d.undo()
    },
  })
  s.setStatus(`CSG ${op}: ${sa.name} (${positions.length / 3} verts)`)
}
