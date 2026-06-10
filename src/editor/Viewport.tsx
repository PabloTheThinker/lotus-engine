import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { world } from '../engine/World'
import type { TransformSnapshot } from '../engine/types'
import { EditorCameraControls } from './EditorCameraControls'
import { DeleteActorCommand, AddActorCommand, TransformCommand, redo, runCommand, undo } from './commands'
import { spawnAsset, type AssetPayload } from './spawn'
import { useEditor } from './store'

export function Viewport() {
  const mountRef = useRef<HTMLDivElement>(null)
  const statsRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const mount = mountRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)
    renderer.domElement.tabIndex = -1

    const editorCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 5000)
    editorCamera.position.set(8, 6, 10)
    editorCamera.lookAt(0, 0, 0)
    const controls = new EditorCameraControls(editorCamera, renderer.domElement)

    // editor-only chrome — grid + axes, excluded from raycasts and serialization
    const grid = new THREE.GridHelper(100, 100, 0x3a4150, 0x242a33)
    grid.userData.isHelper = true
    const axes = new THREE.AxesHelper(2)
    axes.userData.isHelper = true
    world.scene.add(grid, axes)

    // transform gizmo
    const gizmo = new TransformControls(editorCamera, renderer.domElement)
    const gizmoHelper: THREE.Object3D =
      'getHelper' in gizmo ? (gizmo as unknown as { getHelper(): THREE.Object3D }).getHelper() : (gizmo as unknown as THREE.Object3D)
    gizmoHelper.userData.isHelper = true
    world.scene.add(gizmoHelper)

    let transformBefore: TransformSnapshot | null = null
    gizmo.addEventListener('dragging-changed', (e) => {
      controls.enabled = !e.value
      const actor = gizmo.object ? world.actorFromObject(gizmo.object) : null
      if (e.value && actor) {
        transformBefore = actor.transform
      } else if (!e.value && actor && transformBefore) {
        const after = actor.transform
        if (JSON.stringify(after) !== JSON.stringify(transformBefore)) {
          // mutation already happened via the gizmo; the command records it for undo
          runCommand(new TransformCommand(actor.id, transformBefore, after))
        }
        transformBefore = null
      }
    })
    gizmo.addEventListener('objectChange', () => useEditor.getState().touch())

    // selection outline
    const selectionBox = new THREE.BoxHelper(new THREE.Object3D(), 0xf5a623)
    selectionBox.userData.isHelper = true
    selectionBox.visible = false
    world.scene.add(selectionBox)

    // selection raycasting — click without drag selects
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let downPos: [number, number] | null = null

    function pick(e: MouseEvent) {
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, editorCamera)
      const pickables: THREE.Object3D[] = []
      for (const actor of world.actors.values()) {
        actor.root.traverse((o) => {
          if (o.userData.isHelper) return
          if (o instanceof THREE.Mesh) pickables.push(o)
        })
        // lights/cameras/empties have no mesh — pick via a proxy sphere around the root
        if (!actor.mesh) pickables.push(actor.root)
      }
      const hits = raycaster.intersectObjects(pickables, false)
      // fallback proximity pick for mesh-less actors
      if (hits.length === 0) {
        let best: { id: string; d: number } | null = null
        for (const actor of world.actors.values()) {
          if (actor.mesh) continue
          const p = new THREE.Vector3()
          actor.root.getWorldPosition(p)
          const d = raycaster.ray.distanceToPoint(p)
          if (d < 0.6 && (!best || d < best.d)) best = { id: actor.id, d }
        }
        return best ? world.actors.get(best.id) ?? null : null
      }
      return world.actorFromObject(hits[0].object)
    }

    renderer.domElement.addEventListener('mousedown', (e) => {
      if (e.button === 0) downPos = [e.clientX, e.clientY]
    })
    renderer.domElement.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || !downPos || e.altKey) return
      const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1])
      downPos = null
      if (moved > 5 || (gizmo as unknown as { dragging: boolean }).dragging) return
      const actor = pick(e)
      useEditor.getState().select(actor?.id ?? null)
    })

    // drag & drop spawning from the Content Browser
    renderer.domElement.addEventListener('dragover', (e) => e.preventDefault())
    renderer.domElement.addEventListener('drop', (e) => {
      e.preventDefault()
      const raw = e.dataTransfer?.getData('vektra/asset')
      if (!raw) return
      const payload = JSON.parse(raw) as AssetPayload
      // project the drop point onto the ground plane
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, editorCamera)
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const hit = new THREE.Vector3()
      const pos: [number, number, number] = raycaster.ray.intersectPlane(plane, hit)
        ? [hit.x, payload.kind === 'mesh' ? 0.5 : hit.y, hit.z]
        : [0, 0.5, 0]
      spawnAsset(payload, pos)
    })

    // hotkeys — Unreal bindings: Q select, W move, E rotate, R scale, F focus
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return
      const s = useEditor.getState()
      if (e.ctrlKey || e.metaKey) {
        if (e.code === 'KeyZ') {
          e.preventDefault()
          if (e.shiftKey) redo()
          else undo()
        } else if (e.code === 'KeyY') {
          e.preventDefault()
          redo()
        } else if (e.code === 'KeyD') {
          e.preventDefault()
          const sel = s.selectedId ? world.actors.get(s.selectedId) : null
          if (sel) {
            const copy = sel.serialize()
            copy.id = `${copy.id}_dup_${Math.floor(performance.now())}`
            copy.name = `${copy.name}_Copy`
            copy.transform.position = [
              copy.transform.position[0] + 1,
              copy.transform.position[1],
              copy.transform.position[2] + 1,
            ]
            runCommand(new AddActorCommand(copy))
          }
        }
        return
      }
      switch (e.code) {
        case 'KeyQ':
          s.setGizmoMode('select')
          break
        case 'KeyW':
          if (!controls.isNavigating) s.setGizmoMode('translate')
          break
        case 'KeyE':
          if (!controls.isNavigating) s.setGizmoMode('rotate')
          break
        case 'KeyR':
          s.setGizmoMode('scale')
          break
        case 'KeyF': {
          const sel = s.selectedId ? world.actors.get(s.selectedId) : null
          if (sel) controls.focusOn(sel.root)
          break
        }
        case 'Delete':
        case 'Backspace': {
          if (s.selectedId) runCommand(new DeleteActorCommand(s.selectedId))
          break
        }
        case 'Escape':
          if (s.playing) s.setPlaying(false)
          else s.select(null)
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)

    // resize
    const resize = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      renderer.setSize(w, h)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      editorCamera.aspect = w / h
      editorCamera.updateProjectionMatrix()
    }
    const ro = new ResizeObserver(resize)
    ro.observe(mount)
    resize()

    // ---- main loop ----
    const clock = new THREE.Clock()
    let frames = 0
    let fpsTimer = 0
    let wasPlaying = false
    renderer.setAnimationLoop(() => {
      const dt = Math.min(clock.getDelta(), 0.1)
      const s = useEditor.getState()

      // PIE lifecycle transitions
      if (s.playing && !wasPlaying) world.beginPlay()
      if (!s.playing && wasPlaying) {
        world.endPlay()
        s.touch()
      }
      wasPlaying = s.playing

      controls.update(dt)
      world.tick(dt)

      // gizmo sync
      const selected = s.selectedId ? world.actors.get(s.selectedId) : null
      if (selected && s.gizmoMode !== 'select' && !s.playing) {
        if (gizmo.object !== selected.root) gizmo.attach(selected.root)
        gizmo.mode = s.gizmoMode
        gizmo.setTranslationSnap(s.snapEnabled ? s.translateSnap : null)
        gizmo.setRotationSnap(s.snapEnabled ? THREE.MathUtils.degToRad(s.rotateSnapDeg) : null)
        gizmo.setScaleSnap(s.snapEnabled ? s.scaleSnap : null)
      } else if (gizmo.object) {
        gizmo.detach()
      }

      // selection outline sync
      if (selected && !s.playing) {
        selectionBox.setFromObject(selected.root)
        selectionBox.visible = true
      } else {
        selectionBox.visible = false
      }

      // keep light/camera helpers honest
      for (const actor of world.actors.values()) {
        const h = actor.lightHelper as { update?: () => void } | undefined
        h?.update?.()
        actor.cameraHelper?.update()
        if (actor.cameraHelper) actor.cameraHelper.visible = !s.playing && actor.visible
        if (actor.lightHelper) actor.lightHelper.visible = !s.playing
      }
      grid.visible = !s.playing
      axes.visible = !s.playing

      // render — through the level camera during PIE when one exists
      const pieCamera = s.playing ? world.firstCamera()?.camera : undefined
      const activeCam = pieCamera ?? editorCamera
      if (pieCamera) {
        pieCamera.aspect = mount.clientWidth / mount.clientHeight
        pieCamera.updateProjectionMatrix()
      }
      renderer.render(world.scene, activeCam)

      // stats overlay
      frames += 1
      fpsTimer += dt
      if (fpsTimer >= 0.5 && statsRef.current) {
        const fps = Math.round(frames / fpsTimer)
        statsRef.current.textContent = `${fps} FPS · ${world.actors.size} actors · ${renderer.info.render.triangles.toLocaleString()} tris`
        frames = 0
        fpsTimer = 0
      }
    })

    return () => {
      renderer.setAnimationLoop(null)
      window.removeEventListener('keydown', onKeyDown)
      ro.disconnect()
      controls.dispose()
      gizmo.dispose()
      world.scene.remove(grid, axes, gizmoHelper, selectionBox)
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }
  }, [])

  const playing = useEditor((s) => s.playing)

  return (
    <div className="viewport" ref={mountRef}>
      <div className="viewport-stats" ref={statsRef} />
      {playing && <div className="viewport-pie-banner">▶ PLAYING — Esc to stop</div>}
    </div>
  )
}
