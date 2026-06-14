import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import * as THREE from 'three'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js'
import { configureAssetLoaders } from '../engine/assetPipeline'
import { createWebGLPostStack } from '../engine/postStackWebGL'
import {
  getEffectiveRenderBackend,
  getPostFxSettings,
  isWebGPUAvailable,
} from '../engine/renderBackend'
import { createLotusRenderer, rendererTriangleCount, type LotusRendererBundle } from '../engine/lotusRenderer'
import { getSSGISettings, ssgiStatusLabel } from '../engine/ssgiPreset'
import { getTSLPostState } from '../engine/postStackTSL'
import { createTSLRenderPipeline, type TSLPipelineStack } from '../engine/postStackTSLPipeline'
import { ensureLightProbeGrid } from '../engine/ssrProbeGI'
import { WebGLPathTracer } from 'three-gpu-pathtracer'
import { computeBlendedPost } from '../engine/postProcess'
import { world } from '../engine/World'
import { rebuildFoliage, updateLabel3DBillboards } from '../engine/factory'
import { Widget3DLayer } from './Widget3DLayer'
import { sculptStamp, syncLandscapeColors, syncLandscapeHeights } from '../engine/landscape'
import { hasAudioTracks, hasHudTracks, sampleSequence, setKey } from '../engine/sequencer'
import { Input } from '../engine/Input'
import { applyShake, getViewCamera, isHudMounted, mountHud, syncAuthoredHud, unmountHud } from '../engine/gameplay'
import { mpConnect, mpDisconnect, mpTick } from '../engine/multiplayer'
import { runConstructScript, setScriptLogSink } from '../engine/scripting'
import { pushSample, latest } from '../engine/profiler'
import { getNavMesh } from '../engine/nav'
import { NavMeshHelper } from '@recast-navigation/three'
import { applyActorStreamingVisibility, updateStreamingGridHelper } from '../engine/streaming'
import { consoleState } from './consoleCommands'
import type { TransformSnapshot } from '../engine/types'
import { EditorCameraControls } from './EditorCameraControls'
import { PlayController } from './PlayController'
import { DeleteActorCommand, AddActorCommand, TransformCommand, redo, runCommand, undo } from './commands'
import { assignMaterialAsset } from './materialCommands'
import { instantiatePrefab, listPrefabs, savePrefab } from './prefabs'
import { handlePluginFileDrop } from './plugins'
import { dragGhost, spawnAsset, type AssetPayload } from './spawn'
import { updateListener } from '../engine/audio'
import { useEditor, type BufferViz, type ViewMode } from './store'
import { isTypingTarget, matchesShortcutId } from './shortcuts'
import {
  computePanes,
  paneAt,
  PANE_LABELS,
  toWebGLViewport,
  type PaneRect,
  type ViewportLayout,
  type ViewportPane,
} from './viewportLayout'

function Projection() {
  const proj = useEditor((s) => s.viewProjection)
  const layout = useEditor((s) => s.viewportLayout)
  const activePane = useEditor((s) => s.activeViewportPane)
  const setProj = useEditor((s) => s.setViewProjection)
  const setActivePane = useEditor((s) => s.setActiveViewportPane)
  const value = layout === 'quad' ? activePane : proj
  return (
    <select
      className="cam-speed"
      title={layout === 'quad' ? 'Active pane (Alt+G/H/J/K)' : 'Projection (Alt+G/H/J/K)'}
      value={value}
      onChange={(e) => {
        const p = e.target.value as ViewportPane
        if (layout === 'quad') setActivePane(p)
        else setProj(p)
      }}
    >
      <option value="perspective">Perspective</option>
      <option value="top">Top</option>
      <option value="front">Front</option>
      <option value="side">Side</option>
    </select>
  )
}

function paneChromeStyle(pane: ViewportPane, maximized: ViewportPane | null): CSSProperties {
  if (maximized) {
    if (pane !== maximized) return { display: 'none' }
    return { left: 0, top: 0, width: '100%', height: '100%' }
  }
  switch (pane) {
    case 'perspective':
      return { left: 0, top: 0, width: '50%', height: '50%' }
    case 'top':
      return { left: '50%', top: 0, width: '50%', height: '50%' }
    case 'front':
      return { left: 0, top: '50%', width: '50%', height: '50%' }
    default:
      return { left: '50%', top: '50%', width: '50%', height: '50%' }
  }
}

function ViewportPaneChrome() {
  const layout = useEditor((s) => s.viewportLayout)
  const playing = useEditor((s) => s.playing)
  const activePane = useEditor((s) => s.activeViewportPane)
  const maximizedPane = useEditor((s) => s.maximizedPane)
  const setActivePane = useEditor((s) => s.setActiveViewportPane)
  const setMaximizedPane = useEditor((s) => s.setMaximizedPane)
  if (layout !== 'quad' || playing) return null

  const panes: ViewportPane[] = maximizedPane ? [maximizedPane] : ['perspective', 'top', 'front', 'side']

  return (
    <div className="viewport-pane-overlay" aria-hidden>
      {panes.map((pane) => (
        <div
          key={pane}
          className={`viewport-pane-chrome${activePane === pane ? ' active' : ''}${maximizedPane === pane ? ' maximized' : ''}`}
          style={paneChromeStyle(pane, maximizedPane)}
          onMouseDown={() => setActivePane(pane)}
        >
          <span className="viewport-pane-label">{PANE_LABELS[pane]}</span>
          <button
            type="button"
            className="viewport-pane-maximize"
            title={maximizedPane === pane ? 'Restore layout (double-click)' : 'Maximize pane (double-click)'}
            onDoubleClick={(e) => {
              e.stopPropagation()
              setMaximizedPane(maximizedPane === pane ? null : pane)
            }}
          >
            {maximizedPane === pane ? '⧉' : '⬚'}
          </button>
        </div>
      ))}
    </div>
  )
}

function ViewportLayoutSelect() {
  const layout = useEditor((s) => s.viewportLayout)
  const setLayout = useEditor((s) => s.setViewportLayout)
  return (
    <select
      className="cam-speed"
      title="Viewport Layout (UE: 1 or 4 panes)"
      value={layout}
      onChange={(e) => setLayout(e.target.value as ViewportLayout)}
    >
      <option value="single">Layout: Single</option>
      <option value="quad">Layout: Quad</option>
    </select>
  )
}

function CameraSpeed() {
  const speed = useEditor((s) => s.cameraSpeed)
  const setSpeed = useEditor((s) => s.setCameraSpeed)
  return (
    <select
      className="cam-speed"
      title="Camera speed (UE: 1–8; scroll while flying also adjusts)"
      value={speed}
      onChange={(e) => setSpeed(parseInt(e.target.value))}
    >
      {[1, 2, 3, 4, 5, 6, 7, 8].map((v) => (
        <option key={v} value={v}>🎥 {v}</option>
      ))}
    </select>
  )
}

const VIEW_MODE_LABELS: Record<ViewMode, string> = {
  lit: 'Lit',
  detail: 'Detail Lighting',
  unlit: 'Unlit',
  wireframe: 'Wireframe',
  pathtraced: 'Path Traced',
}

const BUFFER_VIZ_LABELS: Record<Exclude<BufferViz, 'none'>, string> = {
  baseColor: 'Base Color',
  worldNormal: 'World Normal',
  depth: 'Scene Depth',
  roughness: 'Roughness',
  metallic: 'Metallic',
  ao: 'Ambient Occlusion',
  emissive: 'Emissive',
}

function ViewModeSelect() {
  const viewMode = useEditor((s) => s.viewMode)
  const bufferViz = useEditor((s) => s.bufferViz)
  const setViewMode = useEditor((s) => s.setViewMode)
  const setBufferViz = useEditor((s) => s.setBufferViz)
  const selectValue = bufferViz !== 'none' ? `buffer:${bufferViz}` : viewMode
  return (
    <select
      className="cam-speed view-mode-select"
      title="View Mode (Alt+2–5) · Buffer Viz: show bufferviz <mode>"
      value={selectValue}
      onChange={(e) => {
        const v = e.target.value
        if (v.startsWith('buffer:')) {
          setBufferViz(v.slice(7) as BufferViz)
        } else {
          setBufferViz('none')
          setViewMode(v as ViewMode)
        }
      }}
    >
      {(Object.keys(VIEW_MODE_LABELS) as ViewMode[]).map((m) => (
        <option key={m} value={m}>{VIEW_MODE_LABELS[m]}</option>
      ))}
      <optgroup label="Buffer Visualization">
        {(Object.keys(BUFFER_VIZ_LABELS) as Exclude<BufferViz, 'none'>[]).map((bv) => (
          <option key={bv} value={`buffer:${bv}`}>{BUFFER_VIZ_LABELS[bv]}</option>
        ))}
      </optgroup>
    </select>
  )
}

interface CtxMenu {
  x: number
  y: number
  point: [number, number, number]
  actorId: string | null
}

interface PickMenu {
  x: number
  y: number
  hits: { id: string; name: string; distance: number }[]
}

export function Viewport() {
  const mountRef = useRef<HTMLDivElement>(null)
  const statsRef = useRef<HTMLDivElement>(null)
  const statHudRef = useRef<HTMLDivElement>(null)
  const pipRef = useRef<HTMLDivElement>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null)
  const [pickMenu, setPickMenu] = useState<PickMenu | null>(null)
  const ctxMenuSetter = useRef(setCtxMenu)
  const pickMenuSetter = useRef(setPickMenu)
  ctxMenuSetter.current = setCtxMenu
  pickMenuSetter.current = setPickMenu

  useEffect(() => {
    const mount = mountRef.current!
    let disposed = false
    let teardown: (() => void) | null = null

    void (async () => {
    RectAreaLightUniformsLib.init()
    const bundle: LotusRendererBundle = await createLotusRenderer(
      mount,
      world.environment.renderBackend ?? 'webgl',
    )
    if (disposed) {
      bundle.dispose()
      return
    }
    const renderer = bundle.webgl
    const primaryRenderer = bundle.primary
    const webgpuActive = bundle.webgpuActive
    const domElement = primaryRenderer.domElement
    configureAssetLoaders(renderer)
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.75
    renderer.outputColorSpace = THREE.SRGBColorSpace
    if (webgpuActive) {
      primaryRenderer.setSize(mount.clientWidth, mount.clientHeight, false)
    }
    domElement.tabIndex = -1

    const widget3dLayer = new Widget3DLayer()
    widget3dLayer.attach(mount)
    widget3dLayer.syncAll(world.actors.values(), world.hudWidgets)

    const editorCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 5000)
    editorCamera.position.set(8, 6, 10)
    editorCamera.lookAt(0, 0, 0)
    const controls = new EditorCameraControls(editorCamera, domElement)

    const topCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 5000)
    const frontCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 5000)
    const sideCamera = new THREE.PerspectiveCamera(70, 1, 0.05, 5000)
    const topControls = new EditorCameraControls(topCamera, domElement)
    const frontControls = new EditorCameraControls(frontCamera, domElement)
    const sideControls = new EditorCameraControls(sideCamera, domElement)
    topControls.setProjection('top')
    frontControls.setProjection('front')
    sideControls.setProjection('side')
    for (const oc of [topControls, frontControls, sideControls]) oc.pivot.copy(controls.pivot)

    const paneCameras: Record<ViewportPane, THREE.PerspectiveCamera> = {
      perspective: editorCamera,
      top: topCamera,
      front: frontCamera,
      side: sideCamera,
    }
    const paneControls: Record<ViewportPane, EditorCameraControls> = {
      perspective: controls,
      top: topControls,
      front: frontControls,
      side: sideControls,
    }

    function canvasPaneRects(): PaneRect[] {
      const w = mount.clientWidth
      const h = mount.clientHeight
      const st = useEditor.getState()
      return computePanes(w, h, st.viewportLayout, st.maximizedPane)
    }

    function paneRectFor(pane: ViewportPane): PaneRect {
      const panes = canvasPaneRects()
      return panes.find((p) => p.pane === pane) ?? panes[0]
    }

    function activePane(): ViewportPane {
      const st = useEditor.getState()
      if (st.playing || st.viewportLayout === 'single') return 'perspective'
      return st.activeViewportPane
    }

    function activeCamera(): THREE.PerspectiveCamera {
      const st = useEditor.getState()
      if (st.playing) return editorCamera
      if (st.viewportLayout === 'single') return editorCamera
      return paneCameras[st.activeViewportPane]
    }

    function activeControls(): EditorCameraControls {
      const st = useEditor.getState()
      if (st.viewportLayout === 'single') return controls
      return paneControls[st.activeViewportPane]
    }

    function pointerInPane(e: MouseEvent | { clientX: number; clientY: number }, pane?: PaneRect): void {
      const rect = domElement.getBoundingClientRect()
      const pr = pane ?? paneRectFor(activePane())
      pointer.set(
        ((e.clientX - rect.left - pr.screenX) / Math.max(pr.w, 1)) * 2 - 1,
        -((e.clientY - rect.top - pr.screenY) / Math.max(pr.h, 1)) * 2 + 1,
      )
    }

    function syncOrthoPivots() {
      for (const oc of [topControls, frontControls, sideControls]) oc.pivot.copy(controls.pivot)
    }

    function syncPaneControlEnabled() {
      const st = useEditor.getState()
      if (st.playing || st.viewportLayout === 'single') {
        controls.enabled = !st.playing
        topControls.enabled = false
        frontControls.enabled = false
        sideControls.enabled = false
        return
      }
      for (const pane of ['perspective', 'top', 'front', 'side'] as const) {
        paneControls[pane].enabled = pane === st.activeViewportPane
      }
    }
    const pawn = new PlayController(domElement)
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
    controls.onSpeedChange = (sp) => useEditor.getState().setCameraSpeed(Math.round(THREE.MathUtils.clamp(sp / 2, 1, 8)))

    // post stack — RenderPass → UnrealBloom → Output (tone map + sRGB)
    // ?nofx falls back to a direct render for GPUs/drivers the stack upsets
    const usePostFx = !new URLSearchParams(location.search).has('nofx')
    let webgpuOk = false
    void isWebGPUAvailable().then((ok) => {
      webgpuOk = ok
    })
    const postFx = getPostFxSettings(world.environment)
    const ssgiSettings = getSSGISettings(world.environment)
    const postStack = createWebGLPostStack(
      renderer,
      world.scene,
      editorCamera,
      mount.clientWidth,
      mount.clientHeight,
      postFx,
      ssgiSettings,
    )
    const composer = postStack.composer
    const renderPass = postStack.renderPass
    let tslPipeline: TSLPipelineStack | null = null
    if (webgpuActive) {
      tslPipeline = await createTSLRenderPipeline(
        primaryRenderer,
        world.scene,
        editorCamera,
        mount.clientWidth,
        mount.clientHeight,
        {
          bloomEnabled: world.environment.bloomEnabled,
          bloomStrength: world.environment.bloomStrength,
          bloomThreshold: world.environment.bloomThreshold,
          bloomRadius: world.environment.bloomRadius,
          ssao: postFx.ssao,
          fxaa: postFx.fxaa,
          ssr: postFx.ssr,
          ssgi: ssgiSettings,
        },
      )
    }
    if (import.meta.env.DEV) {
      const winGfx = window as unknown as Record<string, unknown>
      winGfx.lotusGfx = { renderer, composer }
      winGfx.vektraGfx = winGfx.lotusGfx
    }

    // Path Traced preview — three-gpu-pathtracer (honest label, not Lumen)
    const pathTracer = new WebGLPathTracer(renderer)
    pathTracer.bounces = 6
    pathTracer.tiles.set(2, 2)
    pathTracer.renderDelay = 32
    pathTracer.dynamicLowRes = true
    pathTracer.lowResScale = 0.15
    pathTracer.minSamples = 2

    // image-based lighting from the sky dome (rebuilt when environment changes)
    const pmrem = new THREE.PMREMGenerator(renderer)
    let envApplied = -1
    let hdriApplied: string | null = null
    function syncEnvironment() {
      // HDRI backdrop overrides the sky (UE HDRI Backdrop)
      if (world.hdri && world.hdri !== hdriApplied) {
        hdriApplied = world.hdri
        const bytes = Uint8Array.from(atob(world.hdri), (c) => c.charCodeAt(0))
        void import('three/addons/loaders/RGBELoader.js').then(({ RGBELoader }) => {
          const tex = new RGBELoader().parse(bytes.buffer)
          const dt = new THREE.DataTexture(tex.data, tex.width, tex.height, THREE.RGBAFormat, tex.type)
          dt.mapping = THREE.EquirectangularReflectionMapping
          dt.needsUpdate = true
          const rt = pmrem.fromEquirectangular(dt)
          world.scene.environment = rt.texture
          world.scene.background = dt
          world.sky.removeFromParent()
        })
        envApplied = world.envVersion
        return
      }
      if (!world.hdri && hdriApplied) {
        hdriApplied = null
        world.scene.background = null
        envApplied = -1 // force sky rebuild
      }
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
      ensureLightProbeGrid(world.scene, env)
    }

    function applyPostSettings(post: ReturnType<typeof computeBlendedPost>) {
      postStack.applySettings(post)
      postStack.applySSGI(getSSGISettings(world.environment))
      tslPipeline?.applyPostFx(
        getPostFxSettings(world.environment),
        {
          bloomEnabled: post.bloomEnabled,
          bloomStrength: post.bloomStrength,
          bloomThreshold: post.bloomThreshold,
          bloomRadius: post.bloomRadius,
        },
        getSSGISettings(world.environment),
      )
    }

    // editor-only chrome
    const grid = new THREE.GridHelper(100, 100, 0x3a4150, 0x242a33)
    grid.userData.isHelper = true
    const axes = new THREE.AxesHelper(2)
    axes.userData.isHelper = true
    world.scene.add(grid, axes)

    // transform gizmo
    const gizmo = new TransformControls(editorCamera, domElement)
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
        // UE Surface Snapping: on release, stick to the surface below + align to its normal
        const st = useEditor.getState()
        if (st.surfaceSnap && st.gizmoMode === 'translate') {
          const origin = new THREE.Vector3()
          actor.root.getWorldPosition(origin)
          const ray = new THREE.Raycaster(origin.clone().add(new THREE.Vector3(0, 0.05, 0)), new THREE.Vector3(0, -1, 0))
          ray.far = 50
          const targets: THREE.Object3D[] = []
          for (const a2 of world.actors.values()) {
            if (a2.id === actor.id) continue
            a2.root.traverse((o) => {
              if (o instanceof THREE.Mesh && !o.userData.isHelper && !o.userData.isEditorOnly) targets.push(o)
            })
          }
          const hit = ray.intersectObjects(targets, false)[0]
          if (hit && hit.face) {
            const box = new THREE.Box3().setFromObject(actor.root)
            const lift = origin.y - box.min.y
            actor.root.position.y = hit.point.y + lift
            const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
            const align = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), n)
            actor.root.quaternion.premultiply(align)
          }
        }
        const after = actor.transform
        if (JSON.stringify(after) !== JSON.stringify(transformBefore)) {
          runCommand(new TransformCommand(actor.id, transformBefore, after))
          runConstructScript(actor, world.actors, (lvl, msg) => useEditor.getState().pushConsole(lvl, msg))
        }
        transformBefore = null
      }
    })
    gizmo.addEventListener('objectChange', () => useEditor.getState().touch())

    // selection outlines — one pooled BoxHelper per selected actor
    const selectionBoxes = new Map<string, THREE.BoxHelper>()
    const collisionHelpers = new Map<string, THREE.BoxHelper>()
    let navMeshHelper: NavMeshHelper | null = null
    let streamingGridHelper: THREE.LineSegments | null = null
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

    // ---- view modes (Lit / Unlit / Wireframe / Path Traced / Buffer Viz) ----
    let appliedEffectiveMode = 'lit'
    let appliedViewVersion = -1
    let ptSceneVersion = -1
    let ptEnvVersion = -1
    const ptCamPos = new THREE.Vector3()
    const ptCamQuat = new THREE.Quaternion()

    const depthVizVert = /* glsl */`
      varying vec3 vViewPosition;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        vViewPosition = -mvPosition.xyz;
        gl_Position = projectionMatrix * mvPosition;
      }
    `
    const depthVizFrag = /* glsl */`
      uniform float cameraNear;
      uniform float cameraFar;
      varying vec3 vViewPosition;
      void main() {
        float d = length(vViewPosition);
        float linear = clamp((d - cameraNear) / (cameraFar - cameraNear), 0.0, 1.0);
        gl_FragColor = vec4(vec3(linear), 1.0);
      }
    `
    const worldNormalVizVert = /* glsl */`
      varying vec3 vWorldNormal;
      void main() {
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `
    const worldNormalVizFrag = /* glsl */`
      varying vec3 vWorldNormal;
      void main() {
        gl_FragColor = vec4(vWorldNormal * 0.5 + 0.5, 1.0);
      }
    `

    function stdProps(mat: THREE.Material) {
      const std = mat as THREE.MeshStandardMaterial
      return {
        color: std.color?.clone?.() ?? new THREE.Color(0xcccccc),
        map: std.map ?? null,
        roughness: std.roughness ?? 0.5,
        metalness: std.metalness ?? 0,
        normalMap: std.normalMap ?? null,
        aoMap: std.aoMap ?? null,
        emissive: std.emissive?.clone?.() ?? new THREE.Color(0x000000),
      }
    }

    function makeBufferVizMaterial(bv: Exclude<BufferViz, 'none'>, orig: THREE.Material, camera: THREE.Camera): THREE.Material {
      const p = stdProps(orig)
      if (bv === 'baseColor') {
        return new THREE.MeshBasicMaterial({ color: p.color, map: p.map })
      }
      if (bv === 'worldNormal') {
        return new THREE.ShaderMaterial({
          vertexShader: worldNormalVizVert,
          fragmentShader: worldNormalVizFrag,
        })
      }
      if (bv === 'depth') {
        const cam = camera as THREE.PerspectiveCamera
        return new THREE.ShaderMaterial({
          uniforms: {
            cameraNear: { value: cam.near ?? 0.1 },
            cameraFar: { value: cam.far ?? 1000 },
          },
          vertexShader: depthVizVert,
          fragmentShader: depthVizFrag,
        })
      }
      if (bv === 'roughness') {
        const g = p.roughness
        return new THREE.MeshBasicMaterial({ color: new THREE.Color(g, g, g) })
      }
      if (bv === 'metallic') {
        const g = p.metalness
        return new THREE.MeshBasicMaterial({ color: new THREE.Color(g, g, g) })
      }
      if (bv === 'emissive') {
        return new THREE.MeshBasicMaterial({ color: p.emissive })
      }
      // ao — show aoMap channel or vertex color bake
      if (p.aoMap) {
        return new THREE.MeshBasicMaterial({ map: p.aoMap, color: 0xffffff })
      }
      return new THREE.MeshBasicMaterial({ color: p.color, vertexColors: true })
    }

    function applyViewMode(mode: ViewMode, bufferViz: BufferViz, sceneVersion: number, camera: THREE.Camera) {
      const effective = bufferViz !== 'none' ? `bv:${bufferViz}` : mode
      if (effective === appliedEffectiveMode && sceneVersion === appliedViewVersion) return
      appliedEffectiveMode = effective
      appliedViewVersion = sceneVersion
      for (const actor of world.actors.values()) {
        actor.root.traverse((o) => {
          if (!(o instanceof THREE.Mesh) || o.userData.isHelper || o.userData.isEditorOnly) return
          const orig = (o.userData.origMaterial as THREE.Material | undefined) ?? (o.material as THREE.Material)
          if (!o.userData.origMaterial) o.userData.origMaterial = orig
          delete o.userData.depthVizUniforms
          if (bufferViz !== 'none') {
            const mat = makeBufferVizMaterial(bufferViz, orig, camera)
            o.material = mat
            if (bufferViz === 'depth' && mat instanceof THREE.ShaderMaterial) {
              o.userData.depthVizUniforms = mat.uniforms
            }
            return
          }
          if (mode === 'lit' || mode === 'pathtraced') {
            o.material = orig
          } else if (mode === 'unlit') {
            const p = stdProps(orig)
            o.material = new THREE.MeshBasicMaterial({ color: p.color, map: p.map })
          } else if (mode === 'detail') {
            // UE Detail Lighting: neutral material, lighting + normals only
            const p = stdProps(orig)
            o.material = new THREE.MeshStandardMaterial({
              color: 0x9a9a9a,
              roughness: 0.65,
              metalness: 0,
              normalMap: p.normalMap,
            })
          } else {
            o.material = new THREE.MeshBasicMaterial({ color: 0x8fa3bd, wireframe: true })
          }
        })
      }
    }

    function syncDepthVizUniforms(camera: THREE.Camera) {
      const cam = camera as THREE.PerspectiveCamera
      const near = cam.near ?? 0.1
      const far = cam.far ?? 1000
      for (const actor of world.actors.values()) {
        actor.root.traverse((o) => {
          const u = o.userData.depthVizUniforms as { cameraNear: { value: number }; cameraFar: { value: number } } | undefined
          if (!u) return
          u.cameraNear.value = near
          u.cameraFar.value = far
        })
      }
    }

    // selection raycasting
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let downPos: [number, number] | null = null

    function pick(e: MouseEvent) {
      pointerInPane(e)
      raycaster.setFromCamera(pointer, activeCamera())
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

    function pickAll(e: MouseEvent): { actor: import('../engine/Actor').Actor; distance: number }[] {
      pointerInPane(e)
      raycaster.setFromCamera(pointer, activeCamera())
      const pickables: THREE.Object3D[] = []
      for (const actor of world.actors.values()) {
        actor.root.traverse((o) => {
          if (o.userData.isHelper) return
          if (o instanceof THREE.Mesh) pickables.push(o)
        })
        if (!actor.mesh) pickables.push(actor.root)
      }
      const hits = raycaster.intersectObjects(pickables, false)
      const seen = new Set<string>()
      const results: { actor: import('../engine/Actor').Actor; distance: number }[] = []
      for (const hit of hits) {
        const actor = world.actorFromObject(hit.object)
        if (actor && !seen.has(actor.id)) {
          seen.add(actor.id)
          results.push({ actor, distance: hit.distance })
        }
      }
      for (const actor of world.actors.values()) {
        if (actor.mesh || seen.has(actor.id)) continue
        const p = new THREE.Vector3()
        actor.root.getWorldPosition(p)
        const d = raycaster.ray.distanceToPoint(p)
        if (d < 0.6) {
          results.push({ actor, distance: raycaster.ray.origin.distanceTo(p) })
          seen.add(actor.id)
        }
      }
      return results.sort((a, b) => a.distance - b.distance)
    }

    let altLatch = false
    let rmbDown: [number, number] | null = null
    domElement.addEventListener('mousedown', (e) => {
      altLatch = e.altKey
      if (e.button === 0) downPos = [e.clientX, e.clientY]
      if (e.button === 2) rmbDown = [e.clientX, e.clientY]
      ctxMenuSetter.current(null)
      pickMenuSetter.current(null)
      const st = useEditor.getState()
      if (!st.playing && st.viewportLayout === 'quad') {
        const rect = domElement.getBoundingClientRect()
        const hit = paneAt(canvasPaneRects(), e.clientX - rect.left, e.clientY - rect.top)
        if (hit) st.setActiveViewportPane(hit)
      }
    })

    // RMB click (no drag) → piercing pick (Unity Ctrl+RMB) or UE context menu
    domElement.addEventListener('mouseup', (e) => {
      if (e.button !== 2 || !rmbDown) return
      const moved = Math.hypot(e.clientX - rmbDown[0], e.clientY - rmbDown[1])
      rmbDown = null
      if (moved > 4 || useEditor.getState().playing) return
      const rect = domElement.getBoundingClientRect()
      const s = useEditor.getState()
      const piercing = e.ctrlKey || e.metaKey || s.gizmoMode === 'select'
      if (piercing) {
        const all = pickAll(e)
        if (all.length > 0) {
          pickMenuSetter.current({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
            hits: all.map(({ actor, distance }) => ({ id: actor.id, name: actor.name, distance })),
          })
          return
        }
      }
      pointerInPane(e)
      raycaster.setFromCamera(pointer, activeCamera())
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
    domElement.addEventListener('mouseup', (e) => {
      if (e.button !== 0 || !downPos || e.altKey) return
      const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1])
      downPos = null
      const s = useEditor.getState()
      if (s.foliagePaint || s.sculptActive) return // painting/sculpting owns the mouse
      // selection allowed in editor, while ejected, and in simulate — not while possessed
      if (s.playing && !s.simulate && !s.ejected) return
      if (moved > 5 || (gizmo as unknown as { dragging: boolean }).dragging) return
      const actor = pick(e)
      if (actor && (e.ctrlKey || e.metaKey)) s.toggleSelect(actor.id)
      else s.select(actor?.id ?? null)
    })

    // ---- landscape sculpting (UE Landscape mode) ----
    const brushRing = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthTest: false }),
    )
    brushRing.rotation.x = -Math.PI / 2
    brushRing.visible = false
    brushRing.userData.isHelper = true
    brushRing.renderOrder = 999
    world.scene.add(brushRing)

    let sculpting = false
    let sculptBefore: { heights: number[]; weights: number[] } | null = null

    function landscapeHit(e: MouseEvent): THREE.Intersection | null {
      const s = useEditor.getState()
      const land = s.selectedId ? world.actors.get(s.selectedId) : null
      if (!land?.landscapeProps || !land.mesh) return null
      pointerInPane(e)
      raycaster.setFromCamera(pointer, activeCamera())
      return raycaster.intersectObject(land.mesh, false)[0] ?? null
    }

    function sculptAt(e: MouseEvent) {
      const s = useEditor.getState()
      const land = s.selectedId ? world.actors.get(s.selectedId) : null
      if (!land?.landscapeProps) return
      const hit = landscapeHit(e)
      if (!hit) return
      // Shift inverts raise→lower for fast back-and-forth, UE-style
      const tool = e.shiftKey && s.sculptTool === 'raise' ? 'lower' : s.sculptTool
      if (sculptStamp(land, hit.point, tool, s.sculptRadius, s.sculptStrength * 0.25, s.paintLayer)) {
        s.touch()
      }
    }

    domElement.addEventListener('mousedown', (e) => {
      const s = useEditor.getState()
      if (e.button !== 0 || !s.sculptActive || s.playing) return
      const land = s.selectedId ? world.actors.get(s.selectedId) : null
      if (!land?.landscapeProps) return
      sculpting = true
      sculptBefore = { heights: [...land.landscapeProps.heights], weights: [...(land.landscapeProps.weights ?? [])] }
      sculptAt(e)
      e.stopPropagation()
    })
    domElement.addEventListener('mousemove', (e) => {
      const s = useEditor.getState()
      // brush cursor follows the terrain whenever sculpt mode is on
      if (s.sculptActive && !s.playing) {
        const hit = landscapeHit(e)
        if (hit) {
          brushRing.position.copy(hit.point).add(new THREE.Vector3(0, 0.05, 0))
          brushRing.scale.setScalar(s.sculptRadius)
          brushRing.visible = true
        } else {
          brushRing.visible = false
        }
      } else {
        brushRing.visible = false
      }
      if (sculpting) sculptAt(e)
    })
    window.addEventListener('mouseup', () => {
      if (!sculpting) return
      sculpting = false
      const s = useEditor.getState()
      const land = s.selectedId ? world.actors.get(s.selectedId) : null
      if (land?.landscapeProps && sculptBefore) {
        const before = sculptBefore
        const after = { heights: [...land.landscapeProps.heights], weights: [...(land.landscapeProps.weights ?? [])] }
        const apply = (snap: typeof before) => {
          land.landscapeProps!.heights = [...snap.heights]
          land.landscapeProps!.weights = [...snap.weights]
          syncLandscapeHeights(land)
          syncLandscapeColors(land)
        }
        runCommand({
          label: 'Sculpt stroke',
          execute: () => apply(after),
          undo: () => apply(before),
        })
      }
      sculptBefore = null
    })

    // ---- foliage painting (UE Foliage mode) ----
    let painting = false
    let strokeBefore: number[][] | null = null
    let lastStamp: THREE.Vector3 | null = null

    function paintSurfaceHit(e: MouseEvent): THREE.Intersection | null {
      const s = useEditor.getState()
      const layer = s.selectedId ? world.actors.get(s.selectedId) : null
      if (!layer?.foliageProps) return null
      pointerInPane(e)
      raycaster.setFromCamera(pointer, activeCamera())
      const targets: THREE.Object3D[] = []
      for (const a of world.actors.values()) {
        if (a.id === layer.id) continue
        a.root.traverse((o) => {
          if (o instanceof THREE.Mesh && !o.userData.isHelper && !o.userData.isEditorOnly && !o.userData.isFoliage)
            targets.push(o)
        })
      }
      return raycaster.intersectObjects(targets, false)[0] ?? null
    }

    function stampFoliage(e: MouseEvent) {
      const s = useEditor.getState()
      const layer = s.selectedId ? world.actors.get(s.selectedId) : null
      if (!layer?.foliageProps || !layer.foliageMesh) return
      const hit = paintSurfaceHit(e)
      if (!hit) return
      if (lastStamp && hit.point.distanceTo(lastStamp) < layer.foliageProps.brushRadius * 0.4) return
      lastStamp = hit.point.clone()
      const props = layer.foliageProps
      if (props.snap) {
        // GridMap: one instance per integer cell
        const cx = Math.round(hit.point.x)
        const cy = Math.round(hit.point.y)
        const cz = Math.round(hit.point.z)
        const at = props.instances.findIndex(([x, y, z]) => x === cx && Math.abs(y - (cy + 0.5)) < 0.6 && z === cz)
        if (e.shiftKey) {
          if (at >= 0) props.instances.splice(at, 1)
        } else if (at === -1 && props.instances.length < 4000) {
          props.instances.push([cx, cy + 0.5, cz, 1, 0])
        }
        rebuildFoliage(layer)
        s.touch()
        return
      }
      if (e.shiftKey) {
        // erase within brush
        props.instances = props.instances.filter(([x, y, z]) => hit.point.distanceTo(new THREE.Vector3(x, y, z)) > props.brushRadius)
      } else {
        for (let i = 0; i < props.density; i++) {
          if (props.instances.length >= 4000) break
          const a = Math.random() * Math.PI * 2
          const r = props.brushRadius * Math.sqrt(Math.random())
          const px = hit.point.x + Math.cos(a) * r
          const pz = hit.point.z + Math.sin(a) * r
          // drop each instance onto the surface below
          raycaster.set(new THREE.Vector3(px, hit.point.y + 5, pz), new THREE.Vector3(0, -1, 0))
          const drop = raycaster.intersectObject(hit.object, false)[0]
          const py = drop ? drop.point.y : hit.point.y
          const sc = THREE.MathUtils.lerp(props.scaleMin, props.scaleMax, Math.random())
          props.instances.push([px, py + sc * 0.5, pz, sc, Math.random() * Math.PI * 2])
        }
      }
      rebuildFoliage(layer)
      s.touch()
    }

    domElement.addEventListener('mousedown', (e) => {
      const s = useEditor.getState()
      if (e.button !== 0 || !s.foliagePaint || s.playing) return
      const layer = s.selectedId ? world.actors.get(s.selectedId) : null
      if (!layer?.foliageProps) return
      painting = true
      strokeBefore = layer.foliageProps.instances.map((i) => [...i])
      lastStamp = null
      stampFoliage(e)
      e.stopPropagation()
    })
    domElement.addEventListener('mousemove', (e) => {
      if (painting) stampFoliage(e)
    })
    window.addEventListener('mouseup', () => {
      if (!painting) return
      painting = false
      const s = useEditor.getState()
      const layer = s.selectedId ? world.actors.get(s.selectedId) : null
      if (layer?.foliageProps && strokeBefore) {
        const before = strokeBefore
        const after = layer.foliageProps.instances.map((i) => [...i])
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          runCommand({
            label: 'Foliage stroke',
            execute() {
              layer.foliageProps!.instances = after.map((i) => [...i])
              rebuildFoliage(layer)
            },
            undo() {
              layer.foliageProps!.instances = before.map((i) => [...i])
              rebuildFoliage(layer)
            },
          })
        }
      }
      strokeBefore = null
    })

    // drag & drop spawning — UE surface-tracking ghost preview
    let ghostMesh: THREE.Mesh | null = null
    let ghostKind = ''
    function ensureGhost(payload: AssetPayload): THREE.Mesh {
      const kind = payload.kind === 'mesh' ? payload.geometry : 'box'
      if (!ghostMesh || ghostKind !== kind) {
        ghostMesh?.removeFromParent()
        ghostMesh?.geometry.dispose()
        const geo =
          payload.kind === 'mesh'
            ? (() => {
                switch (payload.geometry) {
                  case 'sphere': return new THREE.SphereGeometry(0.5, 16, 12)
                  case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 16)
                  case 'cone': return new THREE.ConeGeometry(0.5, 1, 16)
                  case 'torus': return new THREE.TorusGeometry(0.5, 0.2, 8, 24)
                  case 'capsule': return new THREE.CapsuleGeometry(0.3, 0.6, 4, 8)
                  default: return new THREE.BoxGeometry(1, 1, 1)
                }
              })()
            : new THREE.SphereGeometry(0.35, 10, 8)
        ghostMesh = new THREE.Mesh(
          geo,
          new THREE.MeshBasicMaterial({ color: 0x2f80ed, transparent: true, opacity: 0.45, depthWrite: false }),
        )
        ghostMesh.userData.isHelper = true
        ghostKind = kind
        world.scene.add(ghostMesh)
      }
      return ghostMesh
    }
    function surfacePointAt(e: { clientX: number; clientY: number }): THREE.Vector3 | null {
      pointerInPane(e)
      raycaster.setFromCamera(pointer, activeCamera())
      const targets: THREE.Object3D[] = []
      for (const a of world.actors.values()) {
        a.root.traverse((o) => {
          if (o instanceof THREE.Mesh && !o.userData.isHelper && !o.userData.isEditorOnly) targets.push(o)
        })
      }
      const hit = raycaster.intersectObjects(targets, false)[0]
      if (hit) return hit.point
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const v = new THREE.Vector3()
      return raycaster.ray.intersectPlane(plane, v) ? v : null
    }
    domElement.addEventListener('dragover', (e) => {
      e.preventDefault()
      if (!dragGhost.payload) return
      const p = surfacePointAt(e)
      if (!p) return
      const g = ensureGhost(dragGhost.payload)
      g.visible = true
      g.position.set(p.x, dragGhost.payload.kind === 'mesh' ? p.y + 0.5 : p.y + 0.4, p.z)
    })
    domElement.addEventListener('dragleave', () => {
      if (ghostMesh) ghostMesh.visible = false
    })
    domElement.addEventListener('drop', (e) => {
      e.preventDefault()
      if (ghostMesh) ghostMesh.visible = false
      dragGhost.payload = null

      const droppedFiles = e.dataTransfer?.files
      if (droppedFiles && droppedFiles.length > 0) {
        void handlePluginFileDrop(droppedFiles)
        return
      }

      pointerInPane(e)
      raycaster.setFromCamera(pointer, activeCamera())
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
      const hit = new THREE.Vector3()
      const onPlane = raycaster.ray.intersectPlane(plane, hit)

      const prefabName = e.dataTransfer?.getData('lotus/prefab')
      if (prefabName) {
        const prefab = listPrefabs().find((p) => p.name === prefabName)
        if (prefab) {
          const y = prefab.actors[0].transform.position[1]
          instantiatePrefab(prefab, onPlane ? [hit.x, y, hit.z] : [0, y, 0])
        }
        return
      }
      const materialId = e.dataTransfer?.getData('lotus/material')
      if (materialId) {
        const target = pick(e)
        if (target?.mesh) assignMaterialAsset(target.id, materialId)
        else useEditor.getState().setStatus('Drop material onto a mesh actor')
        return
      }
      const raw = e.dataTransfer?.getData('lotus/asset')
      if (!raw) return
      const payload = JSON.parse(raw) as AssetPayload
      const sp = surfacePointAt(e)
      const pos: [number, number, number] = sp
        ? [sp.x, payload.kind === 'mesh' ? sp.y + 0.5 : Math.max(sp.y + 0.5, 1), sp.z]
        : onPlane
          ? [hit.x, payload.kind === 'mesh' ? 0.5 : hit.y, hit.z]
          : [0, 0.5, 0]
      spawnAsset(payload, pos)
    })

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
      if (isTypingTarget(e.target)) return
      const s = useEditor.getState()
      if (matchesShortcutId(e, 'tools.undo')) {
        e.preventDefault()
        undo()
        return
      }
      if (matchesShortcutId(e, 'tools.redo') || matchesShortcutId(e, 'tools.redoAlt')) {
        e.preventDefault()
        redo()
        return
      }
      if (matchesShortcutId(e, 'viewport.duplicate')) {
        e.preventDefault()
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
        return
      }
      if (s.playing) {
        if (matchesShortcutId(e, 'play.continue') && s.breakpointHit) {
          e.preventDefault()
          s.continueFromBreakpoint()
          s.setStatus('Continuing…')
          return
        }
        if (matchesShortcutId(e, 'play.stop')) s.stopPlay()
        if (matchesShortcutId(e, 'play.eject') && !s.simulate) {
          e.preventDefault()
          s.setEjected(!s.ejected)
        }
        if (matchesShortcutId(e, 'play.keepChanges') && (s.simulate || s.ejected) && s.selectedId) {
          const sel = world.actors.get(s.selectedId)
          if (sel) {
            sel.keepSimulationChanges()
            s.setStatus(`Kept simulation changes: ${sel.name}`)
          }
        }
        if (!s.simulate && !s.ejected) return
        if (matchesShortcutId(e, 'viewport.focus')) {
          const sel = s.selectedId ? world.actors.get(s.selectedId) : null
          if (sel) activeControls().focusOn(sel.root)
        }
        return
      }
      if (matchesShortcutId(e, 'gizmo.cycle')) {
        const order = ['select', 'translate', 'rotate', 'scale'] as const
        s.setGizmoMode(order[(order.indexOf(s.gizmoMode) + 1) % order.length])
        return
      }
      if (e.altKey && ['Digit2', 'Digit3', 'Digit4', 'Digit5'].includes(e.code)) {
        e.preventDefault()
        s.setViewMode(e.code === 'Digit2' ? 'wireframe' : e.code === 'Digit3' ? 'unlit' : e.code === 'Digit4' ? 'lit' : 'detail')
        return
      }
      // camera bookmarks — persisted per level in world.cameraBookmarks
      if (!e.altKey && /^Digit[0-9]$/.test(e.code)) {
        const slot = parseInt(e.code.slice(5), 10)
        if (e.shiftKey) {
          world.setCameraBookmark(slot, {
            position: editorCamera.position.toArray() as [number, number, number],
            quaternion: editorCamera.quaternion.toArray() as [number, number, number, number],
          })
          s.setStatus(`Bookmark ${slot} set`)
          s.touch()
        } else if (world.cameraBookmarks[slot]) {
          const bm = world.cameraBookmarks[slot]!
          editorCamera.position.fromArray(bm.position)
          editorCamera.quaternion.fromArray(bm.quaternion)
          controls.syncOrientation()
          s.setStatus(`Bookmark ${slot}`)
        }
        return
      }
      // UE Alt+G/H/J/K = Perspective/Front/Side/Top
      if (e.altKey && ['KeyG', 'KeyH', 'KeyJ', 'KeyK'].includes(e.code)) {
        e.preventDefault()
        const proj = e.code === 'KeyG' ? 'perspective' : e.code === 'KeyH' ? 'front' : e.code === 'KeyJ' ? 'side' : 'top'
        if (s.viewportLayout === 'quad') {
          s.setActiveViewportPane(proj)
        } else {
          s.setViewProjection(proj)
          // UE: ortho panes default to wireframe
          if (e.code !== 'KeyG' && s.viewMode === 'lit') s.setViewMode('wireframe')
          if (e.code === 'KeyG' && s.viewMode === 'wireframe') s.setViewMode('lit')
        }
        return
      }
      if (matchesShortcutId(e, 'viewport.fullscreen')) {
        e.preventDefault()
        const el = mountRef.current
        if (document.fullscreenElement) void document.exitFullscreen()
        else void el?.requestFullscreen()
        return
      }
      if (matchesShortcutId(e, 'play.pie')) {
        e.preventDefault()
        s.startPlay('pie')
        return
      }
      if (matchesShortcutId(e, 'viewport.gameView')) {
        s.toggleGameView()
        return
      }
      if (matchesShortcutId(e, 'gizmo.space')) {
        s.toggleGizmoSpace()
        s.setStatus(`Gizmo space: ${useEditor.getState().gizmoSpace}`)
        return
      }
      if (matchesShortcutId(e, 'viewport.snapFloor') && s.selectedId) {
        snapToFloor(s.selectedId)
        return
      }
      if (matchesShortcutId(e, 'gizmo.select')) {
        s.setGizmoMode('select')
        return
      }
      if (matchesShortcutId(e, 'gizmo.translate') && !controls.isNavigating) {
        s.setGizmoMode('translate')
        return
      }
      if (matchesShortcutId(e, 'gizmo.rotate') && !controls.isNavigating) {
        s.setGizmoMode('rotate')
        return
      }
      if (matchesShortcutId(e, 'gizmo.scale')) {
        s.setGizmoMode('scale')
        return
      }
      if (matchesShortcutId(e, 'viewport.focus')) {
        const sel = s.selectedId ? world.actors.get(s.selectedId) : null
        if (sel) activeControls().focusOn(sel.root)
        return
      }
      if (matchesShortcutId(e, 'viewport.delete') || (e.code === 'Backspace' && !e.ctrlKey && !e.metaKey && !e.altKey)) {
        if (s.selectedIds.length) deleteSelection(s.selectedIds)
        return
      }
      if (matchesShortcutId(e, 'viewport.deselect')) {
        s.select(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)

    // resize
    const resize = () => {
      const w = mount.clientWidth
      const h = mount.clientHeight
      renderer.setSize(w, h)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      if (webgpuActive) {
        primaryRenderer.setSize(w, h, false)
        primaryRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      }
      postStack.setSize(w, h)
      tslPipeline?.setSize(w, h)
      const st = useEditor.getState()
      const panes = computePanes(w, h, st.viewportLayout, st.maximizedPane)
      for (const pr of panes) {
        const cam = paneCameras[pr.pane]
        cam.aspect = pr.w / Math.max(pr.h, 1)
        cam.updateProjectionMatrix()
      }
      if (st.viewportLayout === 'single') {
        editorCamera.aspect = w / h
        editorCamera.updateProjectionMatrix()
      }
      widget3dLayer.setViewportRect(null)
      widget3dLayer.setSize(w, h)
    }
    const ro = new ResizeObserver(resize)
    ro.observe(mount)
    resize()

    world.onLevelSwitched = () => {
      if (!useEditor.getState().simulate) {
        pawn.possess(world.playerStart())
      }
      useEditor.getState().touch()
    }

    // ---- main loop ----
    const clock = new THREE.Clock()
    let frames = 0
    let fpsTimer = 0
    let wasPlaying = false
    let stepConsumed = 0
    let takeAcc = 0
    let liveBumpAcc = 0
    let lastFrameAt = 0
    let lastHudPreviewVersion = -1
    let lastWidget3DVersion = -1
    renderer.setAnimationLoop(() => {
      const __t0 = performance.now()
      if (consoleState.maxFPS > 0 && __t0 - lastFrameAt < 1000 / consoleState.maxFPS) return
      lastFrameAt = __t0
      const dt = Math.min(clock.getDelta(), 0.1)
      const s = useEditor.getState()

      // PIE lifecycle
      const possessed = s.playing && !s.simulate && !s.ejected
      if (s.playing && !wasPlaying) {
        mountHud(mount) // before beginPlay so onBeginPlay scripts can draw HUD
        world.beginPlay()
        mpConnect(world, (m) => useEditor.getState().setStatus(m))
        if (!s.simulate) {
          pawn.useRapierCharacter = world.environment.useRapierCharacter !== false
          pawn.useRaycastVehicle = world.environment.useRaycastVehicle === true
          pawn.possess(world.playerStart(), s.pendingSpawn ?? undefined)
          s.setPendingSpawn(null)
          s.select(null)
        }
      }
      if (!s.playing && wasPlaying) {
        world.endPlay()
        void world.restoreEditorAfterPIE()
        pawn.unpossess()
        unmountHud()
        mpDisconnect()
        s.touch()
      }
      wasPlaying = s.playing

      // HUD preview for Sequencer scrub (editor only — PIE mounts HUD in beginPlay)
      const previewHud = !s.playing && hasHudTracks(world.sequence)
      if (previewHud) {
        if (!isHudMounted()) mountHud(mount)
        if (lastHudPreviewVersion !== s.sceneVersion) {
          syncAuthoredHud(world.hudWidgets)
          lastHudPreviewVersion = s.sceneVersion
        }
      } else if (!s.playing && isHudMounted()) {
        unmountHud()
        lastHudPreviewVersion = -1
      }

      if (lastWidget3DVersion !== s.sceneVersion) {
        widget3dLayer.syncAll(world.actors.values(), world.hudWidgets)
        lastWidget3DVersion = s.sceneVersion
      }

      // eject / re-possess transitions
      if (s.playing && !s.simulate) {
        if (pawn.active && !possessed) pawn.suspend()
        if (!pawn.active && possessed) pawn.resume()
      }

      syncEnvironment()
      const quadMode = !s.playing && s.viewportLayout === 'quad'
      if (quadMode) {
        if (controls.orthoAxis) controls.setProjection(null)
        syncOrthoPivots()
        syncPaneControlEnabled()
        for (const oc of [topControls, frontControls, sideControls]) {
          oc.flySpeed = s.cameraSpeed * 2
          oc.update(dt)
        }
        controls.flySpeed = s.cameraSpeed * 2
        controls.update(dt)
      } else {
        controls.setProjection(s.viewProjection === 'perspective' ? null : s.viewProjection)
        controls.enabled = !possessed
        controls.flySpeed = s.cameraSpeed * 2
        controls.update(dt)
        topControls.enabled = false
        frontControls.enabled = false
        sideControls.enabled = false
      }
      // ortho panes: flat dark background instead of the sky dome interior (per-pane in quad render)
      if (!quadMode) {
        world.sky.visible = world.environment.skyEnabled && s.viewProjection === 'perspective'
      }
      let activeCam: THREE.PerspectiveCamera = possessed ? pawn.camera : editorCamera
      // api.setViewCamera('Name') cuts to a Camera actor during play (CineCamera)
      const viewCamName = s.playing ? getViewCamera() : null
      if (viewCamName) {
        const camActor = [...world.actors.values()].find((a) => a.name === viewCamName && a.camera)
        if (camActor?.camera) activeCam = camActor.camera
      }
      const camPos = new THREE.Vector3()
      activeCam.getWorldPosition(camPos)
      applyPostSettings(computeBlendedPost(camPos, world.actors.values(), world.environment))
      applyViewMode(s.viewMode, s.bufferViz, s.sceneVersion, activeCam)
      if (s.bufferViz === 'depth') syncDepthVizUniforms(activeCam)
      // UE pause + frame-step
      let simDt = dt
      if (s.playing && s.paused) {
        if (s.stepFrames > stepConsumed) {
          stepConsumed = s.stepFrames
          simDt = 1 / 60
        } else {
          simDt = 0
        }
      }
      if (simDt > 0) {
        pawn.update(simDt)
        world.tick(simDt * consoleState.timeDilation)
      }
      if (s.playing) {
        liveBumpAcc += dt
        if (liveBumpAcc >= 0.12) {
          liveBumpAcc = 0
          useEditor.getState().bumpLive()
        }
      } else {
        liveBumpAcc = 0
      }
      world.updateParticles(s.playing && s.paused ? 0.000001 : dt) // emitters preview in-editor like Niagara

      // Take Recorder: sample the selected actor into sequencer keys at 10 Hz
      if (s.takeRecording && s.playing && s.selectedId && !s.paused) {
        takeAcc += dt
        if (takeAcc >= 0.1) {
          takeAcc = 0
          const rec = world.actors.get(s.selectedId)
          if (rec) {
            const t = Math.min(world.playClock, world.sequence.duration)
            const tr = rec.transform
            setKey(world.sequence, rec.id, 'position', t, tr.position)
            setKey(world.sequence, rec.id, 'rotation', t, tr.rotation)
          }
        }
      }

      // sequencer editor playback (PIE auto-play is handled in world.tick)
      if (s.seqPlaying && !s.playing && world.sequence.tracks.length > 0) {
        const nt = (s.seqTime + dt) % world.sequence.duration
        s.setSeqTime(nt)
        sampleSequence(world, world.sequence, nt, hasAudioTracks(world.sequence))
      }

      // gizmo sync — only in the active/focused pane (quad layout)
      const selected = s.selectedId ? world.actors.get(s.selectedId) : null
      const gizmoCam = quadMode ? paneCameras[s.activeViewportPane] : editorCamera
      gizmo.camera = gizmoCam
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

      const pathTraceActive = s.viewMode === 'pathtraced' && s.bufferViz === 'none' && !quadMode && s.viewProjection === 'perspective'

      // selection outlines (multi-select aware)
      syncSelectionBoxes(s.selectedIds, !possessed && !pathTraceActive)

      // scripts can ask where the player is
      world.pawnPosition = s.playing && !s.simulate ? pawn.position : null
      if (s.playing) mpTick(dt, world.pawnPosition, pawn.camera.rotation.y)

      // WebAudio listener — true 3D spatialization (PannerNode / HRTF)
      const listenCam = possessed ? pawn.camera : quadMode ? paneCameras[s.activeViewportPane] : editorCamera
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(listenCam.quaternion)
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(listenCam.quaternion)
      updateListener(
        [listenCam.position.x, listenCam.position.y, listenCam.position.z],
        [fwd.x, fwd.y, fwd.z],
        [up.x, up.y, up.z],
      )

      if (!s.sculptActive || s.playing) brushRing.visible = false

      // helpers + editor-only visuals — hidden while possessed, Game View (G), or path tracing
      const hideChrome = possessed || s.gameView || pathTraceActive
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
      gizmoHelper.visible = !hideChrome

      // render — pawn camera while possessed, editor camera otherwise
      if (s.playing) {
        activeCam.aspect = mount.clientWidth / mount.clientHeight
        activeCam.updateProjectionMatrix()
        applyShake(activeCam)
      }
      // UE Pilot Actor: the editor camera drives the piloted actor's transform
      if (s.pilotingId && !s.playing) {
        const piloted = world.actors.get(s.pilotingId)
        if (piloted) {
          piloted.root.position.copy(editorCamera.position)
          piloted.root.quaternion.copy(editorCamera.quaternion)
        } else {
          s.setPiloting(null)
        }
      }

      // `show collision` — wireframe outlines on physics-enabled actors
      collisionHelpers.forEach((h, id) => {
        const a = world.actors.get(id)
        if (!consoleState.showCollision || pathTraceActive || !a || a.physicsProps?.mode === 'none') {
          h.removeFromParent()
          h.dispose()
          collisionHelpers.delete(id)
        } else {
          h.setFromObject(a.root)
        }
      })
      if (consoleState.showCollision && !pathTraceActive) {
        for (const a of world.actors.values()) {
          if (a.physicsProps && a.physicsProps.mode !== 'none' && !collisionHelpers.has(a.id)) {
            const h = new THREE.BoxHelper(a.root, 0x33ff66)
            h.userData.isHelper = true
            collisionHelpers.set(a.id, h)
            world.scene.add(h)
          }
        }
      }

      // `show navmesh` — Recast polygon wireframe overlay
      {
        const baked = getNavMesh()
        if (!consoleState.showNavMesh || pathTraceActive || !baked) {
          if (navMeshHelper) {
            world.scene.remove(navMeshHelper)
            navMeshHelper.navMeshGeometry.dispose()
            navMeshHelper.navMeshMaterial.dispose()
            navMeshHelper = null
          }
        } else if (!navMeshHelper || navMeshHelper.navMesh !== baked) {
          if (navMeshHelper) {
            world.scene.remove(navMeshHelper)
            navMeshHelper.navMeshGeometry.dispose()
            navMeshHelper.navMeshMaterial.dispose()
          }
          navMeshHelper = new NavMeshHelper(baked, {
            navMeshMaterial: new THREE.MeshBasicMaterial({
              color: 0x33aaff,
              transparent: true,
              opacity: 0.45,
              wireframe: true,
              depthTest: true,
            }),
          })
          navMeshHelper.userData.isHelper = true
          world.scene.add(navMeshHelper)
        }
      }

      // grid + distance streaming: hide actors outside camera cell radius / cull distance
      {
        const camP = new THREE.Vector3()
        activeCam.getWorldPosition(camP)
        for (const actor of world.actors.values()) {
          applyActorStreamingVisibility(actor, camP, world.streaming)
        }
      }

      // `show streaming` — grid cell overlay
      {
        const camP = new THREE.Vector3()
        activeCam.getWorldPosition(camP)
        if (!consoleState.showStreaming) {
          if (streamingGridHelper) {
            world.scene.remove(streamingGridHelper)
            streamingGridHelper.geometry.dispose()
            ;(streamingGridHelper.material as THREE.Material).dispose()
            streamingGridHelper = null
          }
        } else {
          streamingGridHelper = updateStreamingGridHelper(streamingGridHelper, camP, world.streaming)
          if (streamingGridHelper && !streamingGridHelper.parent) {
            world.scene.add(streamingGridHelper)
          }
        }
      }
      // r.ScreenPercentage — scale the render resolution
      const targetPR = Math.min(window.devicePixelRatio, 2) * (consoleState.screenPercentage / 100)
      if (Math.abs(renderer.getPixelRatio() - targetPR) > 0.01) {
        renderer.setPixelRatio(targetPR)
        postStack.setSize(mount.clientWidth, mount.clientHeight)
      }
      const __t1 = performance.now()
      if (quadMode) {
        const panes = canvasPaneRects()
        const canvasH = mount.clientHeight
        const savedBg = world.scene.background
        const savedSkyVisible = world.sky.visible
        const savedGizmoVisible = gizmoHelper.visible
        renderer.setScissorTest(true)
        for (const pr of panes) {
          const cam = paneCameras[pr.pane]
          const vp = toWebGLViewport(pr, canvasH)
          cam.aspect = pr.w / Math.max(pr.h, 1)
          cam.updateProjectionMatrix()
          renderer.setViewport(vp.x, vp.y, vp.w, vp.h)
          renderer.setScissor(vp.x, vp.y, vp.w, vp.h)
          world.sky.visible = world.environment.skyEnabled && pr.pane === 'perspective'
          if (pr.pane === 'perspective') {
            world.scene.background = savedBg
            renderer.setClearColor(0x000000, 1)
          } else {
            world.scene.background = null
            renderer.setClearColor(0x0d0f12, 1)
          }
          gizmoHelper.visible = savedGizmoVisible && pr.pane === s.activeViewportPane && !hideChrome
          updateLabel3DBillboards(cam, world.actors.values())
          renderer.render(world.scene, cam)
        }
        world.scene.background = savedBg
        world.sky.visible = savedSkyVisible
        gizmoHelper.visible = savedGizmoVisible
        renderer.setScissorTest(false)
        renderer.setViewport(0, 0, mount.clientWidth, canvasH)
        const perspPane = panes.find((p) => p.pane === 'perspective')
        if (perspPane) {
          widget3dLayer.setViewportRect({
            screenX: perspPane.screenX,
            screenY: perspPane.screenY,
            w: perspPane.w,
            h: perspPane.h,
          })
          widget3dLayer.setSize(perspPane.w, perspPane.h)
          widget3dLayer.render(world.scene, paneCameras.perspective)
        }
      } else {
        world.sky.visible = world.environment.skyEnabled && s.viewProjection === 'perspective'
        updateLabel3DBillboards(activeCam, world.actors.values())
        renderPass.camera = activeCam
        if (pathTraceActive) {
          const needsScene = ptSceneVersion !== s.sceneVersion
          const needsEnv = ptEnvVersion !== world.envVersion
          const camMoved =
            ptCamPos.distanceToSquared(activeCam.position) > 1e-6 ||
            ptCamQuat.angleTo(activeCam.quaternion) > 1e-4
          if (needsScene) {
            pathTracer.setScene(world.scene, activeCam)
            ptSceneVersion = s.sceneVersion
            ptEnvVersion = world.envVersion
            ptCamPos.copy(activeCam.position)
            ptCamQuat.copy(activeCam.quaternion)
            pathTracer.reset()
          } else {
            if (needsEnv) {
              pathTracer.updateEnvironment()
              ptEnvVersion = world.envVersion
              pathTracer.reset()
            }
            if (camMoved) {
              pathTracer.updateCamera()
              ptCamPos.copy(activeCam.position)
              ptCamQuat.copy(activeCam.quaternion)
              pathTracer.reset()
            }
          }
          pathTracer.renderSample()
        } else {
          if (ptSceneVersion !== -1) {
            ptSceneVersion = -1
            ptEnvVersion = -1
          }
          const useWebGPURender =
            webgpuActive &&
            !pathTraceActive &&
            s.bufferViz === 'none' &&
            s.viewportLayout === 'single'
          if (useWebGPURender) {
            if (tslPipeline?.active) {
              tslPipeline.setCamera(activeCam)
              tslPipeline.render()
            } else {
              primaryRenderer.render(world.scene, activeCam)
            }
          } else if (usePostFx) {
            composer.render()
          } else {
            renderer.render(world.scene, activeCam)
          }
        }
        widget3dLayer.setViewportRect(null)
        widget3dLayer.setSize(mount.clientWidth, mount.clientHeight)
        widget3dLayer.render(world.scene, activeCam)
      }

      // camera PiP preview when a camera actor is selected
      const showPip = !possessed && !!selected?.camera && !quadMode
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

      // bake queued reflection probes (one per frame)
      if (world.probeBakeQueue.length > 0) {
        const probeId = world.probeBakeQueue.shift()!
        const probe = world.actors.get(probeId)
        if (probe?.probeProps) {
          const rt = new THREE.WebGLCubeRenderTarget(256, { generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter })
          const cubeCam = new THREE.CubeCamera(0.1, 500, rt)
          probe.root.getWorldPosition(cubeCam.position)
          const hiddenP: THREE.Object3D[] = []
          for (const o of [grid, axes, gizmoHelper, ...selectionBoxes.values()]) {
            if (o.visible) { o.visible = false; hiddenP.push(o) }
          }
          if (probe.mesh?.visible) { probe.mesh.visible = false; hiddenP.push(probe.mesh) }
          cubeCam.update(renderer, world.scene)
          for (const o of hiddenP) o.visible = true
          const radius = probe.probeProps.radius
          const pPos = new THREE.Vector3()
          probe.root.getWorldPosition(pPos)
          let affected = 0
          for (const a of world.actors.values()) {
            if (!a.mesh || a.id === probeId || a.mesh.userData.isEditorOnly) continue
            const mp = new THREE.Vector3()
            a.root.getWorldPosition(mp)
            if (mp.distanceTo(pPos) <= radius) {
              const mat = a.mesh.material as THREE.MeshStandardMaterial
              if ('envMap' in mat) {
                mat.envMap = rt.texture
                mat.needsUpdate = true
                affected++
              }
            }
          }
          useEditor.getState().setStatus(`Probe ${probe.name} baked → ${affected} meshes`)
        }
      }

      pushSample({
        fps: dt > 0 ? 1 / dt : 0,
        tickMs: __t1 - __t0,
        renderMs: performance.now() - __t1,
        drawCalls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        actors: world.actors.size,
      })

      // UE stat HUD (stat fps / stat unit)
      if (statHudRef.current) {
        if (consoleState.statMode === 'none') {
          statHudRef.current.style.display = 'none'
        } else {
          statHudRef.current.style.display = 'block'
          const sample = latest()
          if (sample) {
            if (consoleState.statMode === 'fps') {
              statHudRef.current.textContent = `${sample.fps.toFixed(0)} FPS  ${(1000 / Math.max(1, sample.fps)).toFixed(2)} ms`
            } else {
              const frame = sample.tickMs + sample.renderMs
              statHudRef.current.textContent = `Frame: ${frame.toFixed(2)} ms\nGame: ${sample.tickMs.toFixed(2)} ms\nDraw: ${sample.renderMs.toFixed(2)} ms\nGPU: n/a (web)`
            }
          }
        }
      }

      // stats
      frames += 1
      fpsTimer += dt
      if (fpsTimer >= 0.5 && statsRef.current) {
        const fps = Math.round(frames / fpsTimer)
        const backend = getEffectiveRenderBackend(world.environment, webgpuOk)
        const fx = getPostFxSettings(world.environment)
        const ssgiFx = getSSGISettings(world.environment)
        const tslFull = (tslPipeline?.active ?? false) && fx.ssao && fx.fxaa
        const tsl = getTSLPostState(
          backend === 'webgpu',
          webgpuOk,
          tslPipeline?.active ?? false,
          tslFull,
          ssgiFx.enabled,
          fx.ssr,
        )
        const tslBadge = tsl.tier === 'full' ? 'F' : tsl.tier === 'pipeline' ? 'P' : tsl.tier === 'active' ? '+' : ''
        const ssgi = ssgiStatusLabel(world.environment, webgpuOk)
        const tris = rendererTriangleCount(primaryRenderer)
        statsRef.current.textContent = `${fps} FPS · ${world.actors.size} actors · ${tris.toLocaleString()} tris · ${backend.toUpperCase()}${webgpuActive ? 'R' : ''}${tslBadge}${ssgi}`
        frames = 0
        fpsTimer = 0
      }
    })

    teardown = () => {
      world.onLevelSwitched = null
      renderer.setAnimationLoop(null)
      window.removeEventListener('keydown', onKeyDown)
      ro.disconnect()
      controls.dispose()
      topControls.dispose()
      frontControls.dispose()
      sideControls.dispose()
      pawn.dispose()
      gizmo.dispose()
      pmrem.dispose()
      pathTracer.dispose()
      postStack.dispose()
      tslPipeline?.dispose()
      syncSelectionBoxes([], false)
      if (navMeshHelper) {
        world.scene.remove(navMeshHelper)
        navMeshHelper.navMeshGeometry.dispose()
        navMeshHelper.navMeshMaterial.dispose()
        navMeshHelper = null
      }
      brushRing.geometry.dispose()
      ;(brushRing.material as THREE.Material).dispose()
      world.scene.remove(grid, axes, gizmoHelper, pawn.body, brushRing)
      world.pawnPosition = null
      widget3dLayer.dispose()
      bundle.dispose()
      if (domElement.parentElement === mount) mount.removeChild(domElement)
    }
    })()

    return () => {
      disposed = true
      teardown?.()
    }
  }, [])

  const playing = useEditor((s) => s.playing)
  const pilotingId = useEditor((s) => s.pilotingId)
  const simulate = useEditor((s) => s.simulate)
  const ejected = useEditor((s) => s.ejected)
  const viewMode = useEditor((s) => s.viewMode)
  const bufferViz = useEditor((s) => s.bufferViz)
  const viewportLayout = useEditor((s) => s.viewportLayout)
  const viewProjection = useEditor((s) => s.viewProjection)
  const showPtBadge = viewMode === 'pathtraced' && bufferViz === 'none' && viewportLayout === 'single' && viewProjection === 'perspective'

  const banner = !playing
    ? null
    : simulate
      ? '≡ SIMULATING — Esc to stop'
      : ejected
        ? '⏏ EJECTED — F8 to possess · Esc to stop'
        : '▶ PLAYING — WASD+mouse · F8 eject · Esc stop'

  const closeMenu = () => {
    setCtxMenu(null)
    setPickMenu(null)
  }

  return (
    <div className="viewport" ref={mountRef}>
      <div className="viewport-stats" ref={statsRef} />
      <div className="stat-hud" ref={statHudRef} style={{ display: 'none' }} />
      <div className="viewport-modes">
        <ViewportLayoutSelect />
        <Projection />
        <CameraSpeed />
        <ViewModeSelect />
      </div>
      {showPtBadge && <div className="viewport-pt-badge" title="GPU path tracing preview (may be slow)">PT</div>}
      <ViewportPaneChrome />
      <div className="viewport-pip" ref={pipRef}>
        <span>Camera Preview</span>
      </div>
      {banner && <div className="viewport-pie-banner">{banner}</div>}
      {pilotingId && !playing && (
        <div className="viewport-pilot-banner" onClick={() => useEditor.getState().setPiloting(null)}>
          🛩 Piloting {world.actors.get(pilotingId)?.name ?? '?'} — click to eject
        </div>
      )}
      {pickMenu && (
        <div className="viewport-ctx" style={{ left: pickMenu.x, top: pickMenu.y }}>
          <div className="panel-empty" style={{ padding: '4px 10px', fontSize: 10, opacity: 0.75 }}>Select actor</div>
          {pickMenu.hits.map((h) => (
            <button
              key={h.id}
              onClick={() => {
                useEditor.getState().select(h.id)
                closeMenu()
              }}
            >
              {h.name}
              <span style={{ float: 'right', opacity: 0.55, marginLeft: 12, fontSize: 10 }}>{h.distance.toFixed(1)}m</span>
            </button>
          ))}
        </div>
      )}
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
                  const s2 = useEditor.getState()
                  if (ctxMenu.actorId) {
                    // UE: pilot snaps the camera into the actor first
                    s2.setPiloting(ctxMenu.actorId)
                    s2.setStatus(`Piloting ${world.actors.get(ctxMenu.actorId)?.name} — move the camera to fly it`)
                  }
                }}
              >
                🛩 Pilot
              </button>
              <button
                onClick={() => {
                  closeMenu()
                  if (ctxMenu.actorId) savePrefab(ctxMenu.actorId)
                }}
              >
                🧩 Save as Prefab
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
