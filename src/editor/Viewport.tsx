import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { computeBlendedPost } from '../engine/postProcess'
import { world } from '../engine/World'
import { Input } from '../engine/Input'
import { setScriptLogSink } from '../engine/scripting'
import type { TransformSnapshot } from '../engine/types'
import { EditorCameraControls } from './EditorCameraControls'
import { PlayController } from './PlayController'
import { DeleteActorCommand, AddActorCommand, TransformCommand, redo, runCommand, undo } from './commands'
import { instantiatePrefab, listPrefabs } from './prefabs'
import { spawnAsset, type AssetPayload } from './spawn'
import { useEditor, type ViewMode } from './store'

interface CtxMenu {
  x: number
  y: number
  point: [number, number, number]
  actorId: string | null
}

export function Viewport() {
  const mountRef = useRef<HTMLDivElement>(null)
  const statsRef = useRef<HTMLDivElement>(null)
  const pipRef = useRef<HTMLDivElement>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const ctxMenuSetter = useRef(setCtxMenu)
  ctxMenuSetter.current = setCtxMenu

  useEffect(() => {
    const mount = mountRef.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.75
    renderer.outputColorSpace = THREE.SRGBColorSpace
    mount.appendChild(renderer.domElement)
    renderer.domElement.tabIndex = -1

    const editorCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 5000)
    editorCamera.position.set(8, 6, 10)
    editorCamera.lookAt(0, 0, 0)
    const controls = new EditorCameraControls(editorCamera, renderer.domElement)
    const pawn = new PlayController(renderer.domElement)
    world.scene.add(pawn.body)
    pawn.collidables = () => {
      const out: THREE.Object3D[] = []
      for (const a of world.actors.values()) {
        a.root.traverse((o) => {
          if (o instanceof THREE.Mesh && !o.userData.isHelper && !o.userData.isEditorOnly) out.push(o)
        })
      }
      return out
    }
    // route script logs into the console panel
    setScriptLogSink((level, msg) => useEditor.getState().pushConsole(level, msg))

    // post stack — RenderPass → UnrealBloom → Output (tone map + sRGB)
    // ?nofx falls back to a direct render for GPUs/drivers the stack upsets
    const usePostFx = !new URLSearchParams(location.search).has('nofx')
    // half-float render targets need float-buffer support; software GL lacks it
    const floatOk = renderer.capabilities.isWebGL2 && !!renderer.extensions.get('EXT_color_buffer_float')
    const composerTarget = new THREE.WebGLRenderTarget(1, 1, {
      type: floatOk ? THREE.HalfFloatType : THREE.UnsignedByteType,
    })
    const composer = new EffectComposer(renderer, composerTarget)
    if (import.meta.env.DEV) {
      ;(window as unknown as Record<string, unknown>).vektraGfx = { renderer, composer }
    }
    const renderPass = new RenderPass(world.scene, editorCamera)
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.35, 0.6, 0.9)
    const outputPass = new OutputPass()
    composer.addPass(renderPass)
    composer.addPass(bloomPass)
    composer.addPass(outputPass)

    // image-based lighting from the sky dome (rebuilt when environment changes)
    const pmrem = new THREE.PMREMGenerator(renderer)
    let envApplied = -1
    function syncEnvironment() {
      if (world.envVersion === envApplied) return
      envApplied = world.envVersion
      const env = world.environment
      if (env.skyEnabled) {
        const skyScene = new THREE.Scene()
        const skyClone = world.sky.clone()
        skyScene.add(skyClone)
        const rt = pmrem.fromScene(skyScene as unknown as THREE.Scene)
        world.scene.environment = rt.texture
        world.scene.environmentIntensity = 0.35
        skyScene.remove(skyClone)
      } else {
        world.scene.environment = null
      }
      applyPostSettings({
        bloomEnabled: env.bloomEnabled,
        bloomStrength: env.bloomStrength,
        bloomThreshold: env.bloomThreshold,
        bloomRadius: env.bloomRadius,
        exposure: env.exposure ?? 0.75,
      })
    }

    function applyPostSettings(post: ReturnType<typeof computeBlendedPost>) {
      bloomPass.enabled = post.bloomEnabled
      bloomPass.strength = post.bloomStrength
      bloomPass.threshold = post.bloomThreshold
      bloomPass.radius = post.bloomRadius
      renderer.toneMappingExposure = post.exposure
    }

    // editor-only chrome
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
          runCommand(new TransformCommand(actor.id, transformBefore, after))
        }
        transformBefore = null
      }
    })
    gizmo.addEventListener('objectChange', () => useEditor.getState().touch())

    // selection outlines — one pooled BoxHelper per selected actor
    const selectionBoxes = new Map<string, THREE.BoxHelper>()
    function syncSelectionBoxes(ids: string[], show: boolean) {
      for (const [id, box] of selectionBoxes) {
        if (!show || !ids.includes(id) || !world.actors.has(id)) {
          box.removeFromParent()
          box.dispose()
          selectionBoxes.delete(id)
        }
      }
      if (!show) return
      const s = useEditor.getState()
      for (const id of ids) {
        const actor = world.actors.get(id)
        if (!actor) continue
        let box = selectionBoxes.get(id)
        if (!box) {
          // primary selection is warm orange, the rest a cooler tone
          box = new THREE.BoxHelper(actor.root, id === s.selectedId ? 0xf5a623 : 0x2f80ed)
          box.userData.isHelper = true
          selectionBoxes.set(id, box)
          world.scene.add(box)
        }
        ;(box.material as THREE.LineBasicMaterial).color.set(id === s.selectedId ? 0xf5a623 : 0x2f80ed)
        box.setFromObject(actor.root)
      }
    }

    /** filter a selection down to actors whose ancestors are NOT also selected */
    function topMost(ids: string[]): string[] {
      const set = new Set(ids)
      return ids.filter((id) => {
        let p = world.actors.get(id)?.parentId ?? null
        while (p) {
          if (set.has(p)) return false
          p = world.actors.get(p)?.parentId ?? null
        }
        return true
      })
    }

    /** delete the whole selection as ONE undo step */
    function deleteSelection(ids: string[]) {
      const tops = topMost(ids).filter((id) => world.actors.has(id))
      if (!tops.length) return
      const cmds = tops.map((id) => new DeleteActorCommand(id))
      runCommand({
        label: `Delete ${tops.length > 1 ? `${tops.length} actors` : (world.actors.get(tops[0])?.name ?? 'actor')}`,
        execute() {
          for (const c of cmds) c.execute()
          useEditor.getState().select(null)
        },
        undo() {
          for (const c of [...cmds].reverse()) c.undo()
        },
      })
    }

    // ---- view modes (Lit / Unlit / Wireframe) ----
    let appliedViewMode: ViewMode = 'lit'
    let appliedViewVersion = -1
    function applyViewMode(mode: ViewMode, sceneVersion: number) {
      if (mode === appliedViewMode && sceneVersion === appliedViewVersion) return
      appliedViewMode = mode
      appliedViewVersion = sceneVersion
      for (const actor of world.actors.values()) {
        actor.root.traverse((o) => {
          if (!(o instanceof THREE.Mesh) || o.userData.isHelper || o.userData.isEditorOnly) return
          const orig = (o.userData.origMaterial as THREE.Material | undefined) ?? (o.material as THREE.Material)
          if (!o.userData.origMaterial) o.userData.origMaterial = orig
          if (mode === 'lit') {
            o.material = orig
          } else if (mode === 'unlit') {
            const std = orig as THREE.MeshStandardMaterial
            o.material = new THREE.MeshBasicMaterial({
              color: std.color ? std.color.clone() : new THREE.Color(0xcccccc),
              map: std.map ?? null,
            })
          } else if (mode === 'detail') {
            // UE Detail Lighting: neutral material, lighting + normals only
            const std = orig as THREE.MeshStandardMaterial
            o.material = new THREE.MeshStandardMaterial({
              color: 0x9a9a9a,
              roughness: 0.65,
              metalness: 0,
              normalMap: std.normalMap ?? null,
            })
          } else {
            o.material = new THREE.MeshBasicMaterial({ color: 0x8fa3bd, wireframe: true })
          }
        })
      }
    }

    // selection raycasting
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
        if (!actor.mesh) pickables.push(actor.root)
      }
      const hits = raycaster.intersectObjects(pickables, false)
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

    let altLatch = false
    let rmbDown: [number, number] | null = null
    renderer.domElement.addEventListener('mousedown', (e) => {
      altLatch = e.altKey
      if (e.button === 0) downPos = [e.clientX, e.clientY]
      if (e.button === 2) rmbDown = [e.clientX, e.clientY]
      ctxMenuSetter.current(null)
    })

    // RMB click (no drag) → context menu, UE-style
    renderer.domElement.addEventListener('mouseup', (e) => {
      if (e.button !== 2 || !rmbDown) return
      const moved = Math.hypot(e.clientX - rmbDown[0], e.clientY - rmbDown[1])
      rmbDown = null
      if (moved > 4 || useEditor.getState().playing) return
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, editorCamera)
      const hitActor = pick(e)
      let point: [number, number, number]
      const meshHit = hitActor?.mesh ? raycaster.intersectObject(hitActor.root, true)[0] : undefined
      if (meshHit) {
        point = [meshHit.point.x, meshHit.point.y, meshHit.point.z]
      } else {
        const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
        const v = new THREE.Vector3()
        point = raycaster.ray.intersectPlane(plane, v) ? [v.x, v.y, v.z] : [0, 0, 0]
      }
      ctxMenuSetter.current({ x: e.clientX - rect.left, y: e.clientY - rect.top, point, actorId: hitActor?.id ?? null })
    })

    // Alt+drag on the gizmo duplicates (UE signature gesture): clone in place,
    // keep dragging the original — net result is identical to UE's behavior
    gizmo.addEventListener('mouseDown', () => {
      if (!altLatch) return
      const s = useEditor.getState()
      const sel = s.selectedId ? world.actors.get(s.selectedId) : null
      if (!sel) return
      const copy = sel.serialize()
      copy.id = `${copy.id}_dup_${Math.floor(performance.now())}`
      copy.name = `${copy.name}_Copy`
      runCommand(new AddActorCommand(copy))
      s.select(sel.id) // keep the gizmo (and the drag) on the original
    })
    renderer.domElement.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || !downPos || e.altKey) return
      const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1])
      downPos = null
      const s = useEditor.getState()
      // selection allowed in editor, while ejected, and in simulate — not while possessed
      if (s.playing && !s.simulate && !s.ejected) return
      if (moved > 5 || (gizmo as unknown as { dragging: boolean }).dragging) return
      const actor = pick(e)
      if (actor && (e.ctrlKey || e.metaKey)) s.toggleSelect(actor.id)
      else s.select(actor?.id ?? null)
    })

    // drag & drop spawning
    renderer.domElement.addEventListener('dragover', (e) => e.preventDefault())
    renderer.domElement.addEventListener('drop', (e) => {
      e.preventDefault()
      const rect = renderer.domElement.getBoundingClientRect()
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, editorCamera)
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const hit = new THREE.Vector3()
      const onPlane = raycaster.ray.intersectPlane(plane, hit)

      const prefabName = e.dataTransfer?.getData('vektra/prefab')
      if (prefabName) {
        const prefab = listPrefabs().find((p) => p.name === prefabName)
        if (prefab) {
          const y = prefab.actors[0].transform.position[1]
          instantiatePrefab(prefab, onPlane ? [hit.x, y, hit.z] : [0, y, 0])
        }
        return
      }
      const raw = e.dataTransfer?.getData('vektra/asset')
      if (!raw) return
      const payload = JSON.parse(raw) as AssetPayload
      const pos: [number, number, number] = onPlane
        ? [hit.x, payload.kind === 'mesh' ? 0.5 : hit.y, hit.z]
        : [0, 0.5, 0]
      spawnAsset(payload, pos)
    })

    // camera bookmarks — Shift+0-9 set, 0-9 recall (Ctrl+digits is browser-reserved)
    const bookmarks: Array<{ p: THREE.Vector3; q: THREE.Quaternion } | null> = Array(10).fill(null)

    function snapToFloor(actorId: string) {
      const actor = world.actors.get(actorId)
      if (!actor) return
      const box = new THREE.Box3().setFromObject(actor.root)
      if (box.isEmpty()) return
      const origin = new THREE.Vector3()
      actor.root.getWorldPosition(origin)
      const ray = new THREE.Raycaster(new THREE.Vector3(origin.x, box.min.y - 0.001, origin.z), new THREE.Vector3(0, -1, 0))
      const others: THREE.Object3D[] = []
      for (const a of world.actors.values()) {
        if (a.id === actorId) continue
        a.root.traverse((o) => {
          if (o instanceof THREE.Mesh && !o.userData.isHelper && !o.userData.isEditorOnly) others.push(o)
        })
      }
      const hit = ray.intersectObjects(others, false)[0]
      if (!hit) return
      const before = actor.transform
      actor.root.position.y += hit.point.y - box.min.y
      runCommand(new TransformCommand(actorId, before, actor.transform))
    }

    // hotkeys
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
          // duplicate every top-most selected actor
          for (const id of topMost(s.selectedIds)) {
            const sel = world.actors.get(id)
            if (!sel) continue
            const copy = sel.serialize()
            copy.id = `${copy.id}_dup_${Math.floor(performance.now())}_${id.slice(-3)}`
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
      if (s.playing) {
        if (e.code === 'Escape') s.stopPlay()
        // F8 — eject / possess (only meaningful in PIE, not simulate)
        if (e.code === 'F8' && !s.simulate) {
          e.preventDefault()
          s.setEjected(!s.ejected)
        }
        // K — Keep Simulation Changes (UE): adopt play-time transform
        if (e.code === 'KeyK' && (s.simulate || s.ejected) && s.selectedId) {
          const sel = world.actors.get(s.selectedId)
          if (sel) {
            sel.keepSimulationChanges()
            s.setStatus(`Kept simulation changes: ${sel.name}`)
          }
        }
        // while possessed, the pawn owns the keyboard
        if (!s.simulate && !s.ejected) return
        if (e.code === 'KeyF') {
          const sel = s.selectedId ? world.actors.get(s.selectedId) : null
          if (sel) controls.focusOn(sel.root)
        }
        return
      }
      // camera bookmarks
      if (/^Digit[0-9]$/.test(e.code)) {
        const slot = parseInt(e.code.slice(5), 10)
        if (e.shiftKey) {
          bookmarks[slot] = { p: editorCamera.position.clone(), q: editorCamera.quaternion.clone() }
          s.setStatus(`Bookmark ${slot} set`)
        } else if (bookmarks[slot]) {
          editorCamera.position.copy(bookmarks[slot]!.p)
          editorCamera.quaternion.copy(bookmarks[slot]!.q)
          s.setStatus(`Bookmark ${slot}`)
        }
        return
      }
      switch (e.code) {
        case 'KeyG':
          s.toggleGameView()
          break
        case 'KeyT':
          s.toggleGizmoSpace()
          s.setStatus(`Gizmo space: ${useEditor.getState().gizmoSpace}`)
          break
        case 'End':
          if (s.selectedId) snapToFloor(s.selectedId)
          break
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
          if (s.selectedIds.length) deleteSelection(s.selectedIds)
          break
        }
        case 'Escape':
          s.select(null)
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
      composer.setSize(w, h)
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

      // PIE lifecycle
      const possessed = s.playing && !s.simulate && !s.ejected
      if (s.playing && !wasPlaying) {
        world.beginPlay()
        if (!s.simulate) {
          pawn.possess(world.playerStart(), s.pendingSpawn ?? undefined)
          s.setPendingSpawn(null)
          s.select(null)
        }
      }
      if (!s.playing && wasPlaying) {
        world.endPlay()
        pawn.unpossess()
        s.touch()
      }
      wasPlaying = s.playing
      // eject / re-possess transitions
      if (s.playing && !s.simulate) {
        if (pawn.active && !possessed) pawn.suspend()
        if (!pawn.active && possessed) pawn.resume()
      }

      syncEnvironment()
      const activeCam = possessed ? pawn.camera : editorCamera
      const camPos = new THREE.Vector3()
      activeCam.getWorldPosition(camPos)
      applyPostSettings(computeBlendedPost(camPos, world.actors.values(), world.environment))
      applyViewMode(s.viewMode, s.sceneVersion)
      controls.enabled = !possessed
      controls.update(dt)
      pawn.update(dt)
      world.tick(dt)

      // gizmo sync
      const selected = s.selectedId ? world.actors.get(s.selectedId) : null
      if (selected && s.gizmoMode !== 'select' && !s.playing) {
        if (gizmo.object !== selected.root) gizmo.attach(selected.root)
        gizmo.mode = s.gizmoMode
        gizmo.setSpace(s.gizmoSpace)
        gizmo.setTranslationSnap(s.snapEnabled ? s.translateSnap : null)
        gizmo.setRotationSnap(s.snapEnabled ? THREE.MathUtils.degToRad(s.rotateSnapDeg) : null)
        gizmo.setScaleSnap(s.snapEnabled ? s.scaleSnap : null)
      } else if (gizmo.object) {
        gizmo.detach()
      }

      // selection outlines (multi-select aware)
      syncSelectionBoxes(s.selectedIds, !possessed)

      // scripts can ask where the player is
      world.pawnPosition = s.playing && !s.simulate ? pawn.position : null

      // helpers + editor-only visuals — hidden while possessed or in Game View (G)
      const hideChrome = possessed || s.gameView
      for (const actor of world.actors.values()) {
        const h = actor.lightHelper as { update?: () => void } | undefined
        h?.update?.()
        actor.cameraHelper?.update()
        if (actor.cameraHelper) actor.cameraHelper.visible = !hideChrome && actor.visible
        if (actor.lightHelper) actor.lightHelper.visible = !hideChrome
        if (actor.type === 'PlayerStart') actor.root.visible = !hideChrome && actor.visible
        if (actor.volumeHelper) actor.volumeHelper.visible = !hideChrome && actor.visible
      }
      grid.visible = !hideChrome
      axes.visible = !hideChrome

      // render — pawn camera while possessed, editor camera otherwise
      if (possessed) {
        pawn.camera.aspect = mount.clientWidth / mount.clientHeight
        pawn.camera.updateProjectionMatrix()
      }
      renderPass.camera = activeCam
      if (usePostFx) composer.render()
      else renderer.render(world.scene, activeCam)

      // camera PiP preview when a camera actor is selected
      const showPip = !possessed && !!selected?.camera
      if (pipRef.current) pipRef.current.style.display = showPip ? 'block' : 'none'
      if (showPip && selected?.camera) {
        const W = mount.clientWidth
        const w = Math.max(Math.floor(W * 0.26), 200)
        const h = Math.floor((w * 9) / 16)
        selected.camera.aspect = w / h
        selected.camera.updateProjectionMatrix()
        const hidden: THREE.Object3D[] = []
        for (const o of [grid, axes, gizmoHelper, ...selectionBoxes.values()]) {
          if (o.visible) {
            o.visible = false
            hidden.push(o)
          }
        }
        if (selected.cameraHelper?.visible) {
          selected.cameraHelper.visible = false
          hidden.push(selected.cameraHelper)
        }
        renderer.setScissorTest(true)
        renderer.setViewport(W - w - 14, 14, w, h)
        renderer.setScissor(W - w - 14, 14, w, h)
        renderer.render(world.scene, selected.camera)
        renderer.setScissorTest(false)
        renderer.setViewport(0, 0, W, mount.clientHeight)
        for (const o of hidden) o.visible = true
        if (pipRef.current) {
          pipRef.current.style.width = `${w}px`
          pipRef.current.style.height = `${h}px`
        }
      }

      Input.endFrame()

      // stats
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
      pawn.dispose()
      gizmo.dispose()
      pmrem.dispose()
      composer.dispose()
      syncSelectionBoxes([], false)
      world.scene.remove(grid, axes, gizmoHelper, pawn.body)
      world.pawnPosition = null
      renderer.dispose()
      mount.removeChild(renderer.domElement)
    }
  }, [])

  const playing = useEditor((s) => s.playing)
  const simulate = useEditor((s) => s.simulate)
  const ejected = useEditor((s) => s.ejected)
  const viewMode = useEditor((s) => s.viewMode)
  const setViewMode = useEditor((s) => s.setViewMode)

  const banner = !playing
    ? null
    : simulate
      ? '≡ SIMULATING — Esc to stop'
      : ejected
        ? '⏏ EJECTED — F8 to possess · Esc to stop'
        : '▶ PLAYING — WASD+mouse · F8 eject · Esc stop'

  const closeMenu = () => setCtxMenu(null)

  return (
    <div className="viewport" ref={mountRef}>
      <div className="viewport-stats" ref={statsRef} />
      <div className="viewport-modes">
        {(['lit', 'detail', 'unlit', 'wireframe'] as const).map((m) => (
          <button key={m} className={viewMode === m ? 'active' : ''} onClick={() => setViewMode(m)}>
            {m}
          </button>
        ))}
      </div>
      <div className="viewport-pip" ref={pipRef}>
        <span>Camera Preview</span>
      </div>
      {banner && <div className="viewport-pie-banner">{banner}</div>}
      {ctxMenu && (
        <div className="viewport-ctx" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
          <button
            onClick={() => {
              closeMenu()
              const s = useEditor.getState()
              s.setPendingSpawn([ctxMenu.point[0], ctxMenu.point[1] + 0.1, ctxMenu.point[2]])
              s.startPlay('pie')
            }}
          >
            ▶ Play From Here
          </button>
          {ctxMenu.actorId && (
            <>
              <button
                onClick={() => {
                  closeMenu()
                  const sel = world.actors.get(ctxMenu.actorId!)
                  if (!sel) return
                  const copy = sel.serialize()
                  copy.id = `${copy.id}_dup_${Math.floor(performance.now())}`
                  copy.name = `${copy.name}_Copy`
                  copy.transform.position = [copy.transform.position[0] + 1, copy.transform.position[1], copy.transform.position[2] + 1]
                  runCommand(new AddActorCommand(copy))
                }}
              >
                ⧉ Duplicate
              </button>
              <button
                onClick={() => {
                  closeMenu()
                  if (ctxMenu.actorId) runCommand(new DeleteActorCommand(ctxMenu.actorId))
                }}
              >
                ✕ Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
