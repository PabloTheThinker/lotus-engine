/* Lotus Engine — standalone playable runtime. Injected into exported HTML
   alongside the level JSON. Loads three.js (+ optional Rapier physics) from
   CDN and runs the level: scripts, behaviors, particles, foliage, landscape,
   pawn controllers. Supports multi-level manifests + api.loadLevel(). */
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { Sky } from 'three/addons/objects/Sky.js'

const LEVELS =
  window.__LOTUS_LEVELS__ ??
  (window.__VEKTRA_LEVELS__ ??
    (window.__LOTUS_LEVEL__ ?? window.__VEKTRA_LEVEL__
      ? { main: window.__LOTUS_LEVEL__ ?? window.__VEKTRA_LEVEL__ }
      : null))
const MAIN_KEY = window.__LOTUS_MAIN__ ?? window.__VEKTRA_MAIN__ ?? 'main'
const EXPORT = window.__LOTUS_EXPORT__ ?? window.__VEKTRA_EXPORT__ ?? { quality: 'desktop' }
const CELL_MANIFEST = window.__LOTUS_CELLS__ ?? window.__VEKTRA_CELLS__ ?? null
const STREAMING_ENABLED = window.__LOTUS_STREAMING__ === true || window.__LOTUS_STREAMING__ === 'true'
const STREAM_PROGRESS_ID = 'lotus-stream-progress'
const EXPORT_LUT = window.__LOTUS_LUT__ ?? window.__VEKTRA_LUT__ ?? null
const TOUCH_ENABLED = window.__LOTUS_TOUCH__ === true || window.__LOTUS_TOUCH__ === 'true'
/** Wave 74 — adaptive haptics scale from perf gate fps + battery + env intensity. */
let hapticBatteryCharging = true
function refreshHapticBattery() {
  const getBattery = navigator.getBattery?.bind(navigator)
  if (!getBattery) return
  void getBattery().then((b) => { hapticBatteryCharging = !!b.charging }).catch(() => {})
}
refreshHapticBattery()
if (typeof setInterval === 'function') setInterval(refreshHapticBattery, 30000)
function perfFpsHapticScale() {
  const gate = window.__LOTUS_EXPORT_PERF__
  if (!gate?.fps || gate.fps <= 0) return 1
  const min = gate.perfMinFps ?? 24
  if (gate.perfPass === true) return 1
  return Math.max(0, Math.min(1, gate.fps / min))
}
function hapticIntensityFactor() {
  const v = LEVEL.environment?.hapticIntensity
  if (v == null) return 1
  return Math.max(0, Math.min(1, v))
}
function batteryHapticScale() {
  if (LEVEL.environment?.hapticBatterySaver === false) return 1
  return hapticBatteryCharging ? 1 : 0.5
}
function hapticScaleFromPerfGate() {
  return Math.max(0, Math.min(1, hapticIntensityFactor() * perfFpsHapticScale() * batteryHapticScale()))
}
function scaleHapticPattern(pattern) {
  const s = hapticScaleFromPerfGate()
  if (s >= 1) return pattern
  if (s <= 0) return [0]
  const arr = Array.isArray(pattern) ? pattern : [pattern]
  return arr.map((ms) => Math.max(1, Math.round(ms * s)))
}
/** Wave 64 — touch haptics (PWA Vibration API). */
function touchHapticsEnabled() {
  const flag = LEVEL.environment?.touchHaptics
  if (flag === false) return false
  return true
}
function tryTouchVibrate(pattern) {
  if (!touchHapticsEnabled()) return false
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false
  const scaled = scaleHapticPattern(pattern)
  if (!scaled || (Array.isArray(scaled) && scaled[0] <= 0)) return false
  try { return navigator.vibrate(scaled) } catch { return false }
}
function vibrateTouchFire() { return tryTouchVibrate([28]) }
function vibrateTouchInteract() { return tryTouchVibrate([14]) }
function vibrateTouchJump() { return tryTouchVibrate([22]) }
const GAMEPAD_ENABLED = window.__LOTUS_GAMEPAD__ === true || window.__LOTUS_GAMEPAD__ === 'true'
/** Wave 69 — gamepad haptics (Gamepad Haptic Actuators dual-rumble). */
function gamepadHapticsEnabled() {
  const flag = LEVEL.environment?.gamepadHaptics
  if (flag === false) return false
  return true
}
function pickGamepadActuator(padIndex) {
  if (!navigator.getGamepads) return null
  const pads = navigator.getGamepads()
  if (padIndex !== null && padIndex !== undefined) {
    const act = pads[padIndex]?.vibrationActuator
    return act && typeof act.playEffect === 'function' ? act : null
  }
  for (let i = 0; i < pads.length; i++) {
    const act = pads[i]?.vibrationActuator
    if (pads[i]?.connected && act && typeof act.playEffect === 'function') return act
  }
  return null
}
function pulseGamepad(padIndex, intensity, duration) {
  if (!GAMEPAD_ENABLED || !gamepadHapticsEnabled()) return false
  const act = pickGamepadActuator(padIndex)
  if (!act) return false
  const s = hapticScaleFromPerfGate()
  if (s <= 0) return false
  const mag = Math.max(0, Math.min(1, intensity * s))
  const ms = Math.max(0, Math.round(duration * s))
  if (ms <= 0 || mag <= 0) return false
  try {
    void act.playEffect('dual-rumble', { startDelay: 0, duration: ms, weakMagnitude: mag, strongMagnitude: mag })
    return true
  } catch { return false }
}
function pulseGamepadFire() { return pulseGamepad(null, 0.85, 28) }
function pulseGamepadInteract() { return pulseGamepad(null, 0.45, 14) }
const INPUT_BINDINGS = window.__LOTUS_INPUT_BINDINGS__ ?? { gamepad: {}, touch: {} }
const INPUT_PROFILE = window.__LOTUS_INPUT_PROFILE__ ?? 'desktop'
const DEFAULT_GP_BUTTONS = { Jump: 0, Interact: 2, Fire: 3 }
const DEFAULT_TOUCH_SLOTS = { jump: 'jump-btn', fire: 'fire-btn', interact: 'interact-btn' }
const GP_FIRE_ALT = 7
function gpButtonFor(action) {
  const n = INPUT_BINDINGS.gamepad?.[action]
  return typeof n === 'number' ? n : DEFAULT_GP_BUTTONS[action]
}
function touchSlotFor(action) {
  const slot = INPUT_BINDINGS.touch?.[action]
  return slot === 'jump-btn' || slot === 'fire-btn' || slot === 'interact-btn' ? slot : DEFAULT_TOUCH_SLOTS[action]
}
const MINIGAME_ENABLED = window.__LOTUS_MINIGAME__ === true || window.__LOTUS_MINIGAME__ === 'true'
const MINIGAME_PRESET = window.__LOTUS_MINIGAME_PRESET__ ?? null
const MINIGAME_PACK = window.__LOTUS_MINIGAME_PACK__ ?? null
const DIALOGUE_CATALOG = window.__LOTUS_DIALOGUE__ ?? null
const RPG_3D_ENABLED = window.__LOTUS_RPG_3D__ === true || window.__LOTUS_RPG_3D__ === 'true'
const RPG_HUD_ENABLED = window.__LOTUS_RPG_HUD__ === true || window.__LOTUS_RPG_HUD__ === 'true'
const ACHIEVEMENTS_DEF = window.__LOTUS_ACHIEVEMENTS__ ?? null
const ACHIEVEMENT_PROGRESS_DEF = window.__LOTUS_ACHIEVEMENT_PROGRESS__ ?? null
const ACHIEVEMENT_STORAGE_PREFIX = 'lotus-engine.achievements'
const ACHIEVEMENT_PROGRESS_STORAGE_PREFIX = 'lotus-engine.achievements.progress'
const PACK_CHANGELOG_HTML = window.__LOTUS_PACK_CHANGELOG_HTML__ ?? null
const PACK_CHANGELOG_BOOT =
  window.__LOTUS_PACK_CHANGELOG_BOOT__ === true || window.__LOTUS_PACK_CHANGELOG_BOOT__ === 'true'
const MAIN_MENU_ENABLED = window.__LOTUS_MAIN_MENU__ === true || window.__LOTUS_MAIN_MENU__ === 'true'
const SAVES_ENABLED = window.__LOTUS_SAVES__ === true || window.__LOTUS_SAVES__ === 'true'
const SAVE_MENU_ENABLED =
  SAVES_ENABLED &&
  (window.__LOTUS_SAVE_MENU__ === true || window.__LOTUS_SAVE_MENU__ === 'true')
const CLOUD_SAVES_ENABLED = window.__LOTUS_CLOUD_SAVES__ === true || window.__LOTUS_CLOUD_SAVES__ === 'true'
const CLOUD_SYNC_ENABLED =
  CLOUD_SAVES_ENABLED && (window.__LOTUS_CLOUD_SYNC__ === true || window.__LOTUS_CLOUD_SYNC__ === 'true')
const CROSS_LEVEL_SAVES_ENABLED =
  SAVES_ENABLED &&
  (window.__LOTUS_CROSS_LEVEL_SAVES__ === true || window.__LOTUS_CROSS_LEVEL_SAVES__ === 'true')
const GLOBAL_SAVE_LEVEL_KEY = '__global__'
const MAIN_MENU_ITEMS = [
  { label: 'Platformer', key: 'platformer' },
  { label: 'RPG', key: 'rpg' },
  { label: 'FPS', key: 'fps' },
  { label: 'MP Deathmatch', key: 'mpdeathmatch' },
]

/** Wave 32 — decode embedded LUT atlas bytes from export payload. */
function decodeExportLUTTexture(payload) {
  if (!payload?.data || !payload.atlasW || !payload.atlasH) return null
  try {
    const raw = Uint8Array.from(atob(payload.data), (c) => c.charCodeAt(0))
    const tex = new THREE.DataTexture(raw, payload.atlasW, payload.atlasH, THREE.RGBAFormat)
    tex.needsUpdate = true
    tex.colorSpace = THREE.SRGBColorSpace
    return { tex, size: payload.size ?? 16 }
  } catch {
    return null
  }
}
const ALWAYS_LOADED = new Set(['DirectionalLight', 'AmbientLight', 'PlayerStart'])
if (!LEVELS || !LEVELS[MAIN_KEY]) throw new Error('Lotus: no level data')

let LEVEL = LEVELS[MAIN_KEY]
const pixelRatio = EXPORT.pixelRatio ?? (EXPORT.quality === 'mobile' ? 1 : Math.min(devicePixelRatio, 2))
const exportRenderTier = EXPORT.renderBackend ?? LEVEL.environment?.renderBackend ?? 'webgl'

/** Wave 14 — WebGPU export runtime when tier + API available. */
async function createPlayRenderer() {
  const antialias = EXPORT.quality !== 'mobile'
  if (exportRenderTier === 'webgpu' && navigator.gpu) {
    try {
      const { WebGPURenderer } = await import('three/webgpu')
      const r = new WebGPURenderer({ antialias, alpha: false })
      await r.init()
      r.toneMapping = THREE.ACESFilmicToneMapping
      r.toneMappingExposure = LEVEL.environment?.exposure ?? 0.75
      r.outputColorSpace = THREE.SRGBColorSpace
      r.setPixelRatio(pixelRatio)
      r.setSize(innerWidth, innerHeight)
      document.body.appendChild(r.domElement)
      return { renderer: r, tier: 'webgpu' }
    } catch {
      /* fall through to WebGL */
    }
  }
  const r = new THREE.WebGLRenderer({ antialias })
  r.shadowMap.enabled = true
  r.toneMapping = THREE.ACESFilmicToneMapping
  r.toneMappingExposure = LEVEL.environment.exposure ?? 0.75
  r.outputColorSpace = THREE.SRGBColorSpace
  r.setPixelRatio(pixelRatio)
  r.setSize(innerWidth, innerHeight)
  document.body.appendChild(r.domElement)
  return { renderer: r, tier: 'webgl' }
}

let renderer
let playRenderTier = 'webgl'
/** @type {{ render: () => void, setCamera: (cam: import('three').Camera) => void } | null} */
let exportTslPipeline = null

/** Wave 15–18 — TSL GTAO + SSGI/TRAA/denoise + SSR denoise + bloom + FXAA for WebGPU export tier. */
async function createExportTSLPipeline(primary, scene, camera) {
  if (playRenderTier !== 'webgpu') return null
  try {
    const webgpu = await import('three/webgpu')
    const tsl = await import('three/tsl')
    const { bloom } = await import('three/addons/tsl/display/BloomNode.js')
    const { fxaa } = await import('three/addons/tsl/display/FXAANode.js')
    const { ao } = await import('three/addons/tsl/display/GTAONode.js')
    const { ssgi } = await import('three/addons/tsl/display/SSGINode.js')
    const { ssr } = await import('three/addons/tsl/display/SSRNode.js')
    const { traa } = await import('three/addons/tsl/display/TRAANode.js')
    const { denoise } = await import('three/addons/tsl/display/DenoiseNode.js')
    const { dof } = await import('three/addons/tsl/display/DepthOfFieldNode.js')
    const { pass, add, mul, max, pow, mrt, output, normalView, velocity, metalness, roughness, vec2, vec3, vec4, float, mix, texture, reflector, perspectiveDepthToViewZ, acesFilmicToneMapping } = tsl
    const embeddedLut = EXPORT_LUT ? decodeExportLUTTexture(EXPORT_LUT) : null
    const env = LEVEL.environment ?? {}
    const bloomOn = env.bloomEnabled !== false
    const strength = env.bloomStrength ?? 0.35
    const threshold = env.bloomThreshold ?? 0.9
    const radius = env.bloomRadius ?? 0.6
    const ssaoOn = env.postSsao === true || env.renderBackend === 'webgpu'
    const fxaaOn = env.postFxaa !== false
    const taaOn = env.postTaa === true
    const ssrOn = env.postSsr === true
    const ssrPreset = env.postSsrPreset ?? 'medium'
    const ssrTable = {
      off: { maxDistance: 0, opacity: 0, thickness: 0 },
      low: { maxDistance: 50, opacity: 0.28, thickness: 0.018 },
      medium: { maxDistance: 100, opacity: 0.5, thickness: 0.01 },
      high: { maxDistance: 200, opacity: 0.82, thickness: 0.005 },
    }
    const ssrRow = ssrTable[ssrPreset] ?? ssrTable.medium
    const ssgiPreset = env.postSsgiPreset ?? 'off'
    const ssgiOn = env.postSsgi === true || (ssgiPreset !== 'off' && env.renderBackend === 'webgpu')
    const ssgiTable = {
      off: { intensity: 0, radius: 0, samples: 0, slices: 1 },
      low: { intensity: 0.35, radius: 0.4, samples: 4, slices: 1 },
      medium: { intensity: 0.55, radius: 0.65, samples: 8, slices: 2 },
      high: { intensity: 0.75, radius: 0.9, samples: 12, slices: 3 },
    }
    const ssgiRow = ssgiTable[ssgiPreset] ?? ssgiTable.off
    const dofOn = env.postDof === true
    const colorGradingOn = env.postColorGrading === true
    const gradingPreset = env.postColorGradingPreset ?? 'off'
    const acesOn =
      gradingPreset !== 'off'
        ? (env.postPresetAces?.[gradingPreset] ?? env.postAces === true)
        : env.postAces === true
    const compareT = Math.max(0, Math.min(1, env.postGradingCompareT ?? 0))
    const compareA = env.postGradingCompareA ?? gradingPreset
    const compareB = env.postGradingCompareB ?? 'neutral'
    const presetTable = {
      neutral: { lift: [0, 0, 0], gamma: [1, 1, 1], gain: [1, 1, 1] },
      cinematic: { lift: [0.02, 0.01, 0], gamma: [0.95, 0.98, 1.05], gain: [1.05, 1.02, 0.98] },
      highContrast: { lift: [-0.02, -0.02, -0.02], gamma: [1.1, 1.1, 1.1], gain: [1.2, 1.15, 1.1] },
    }
    const presetThumbnails = {
      neutral: { label: 'Neutral', gradient: 'linear-gradient(135deg, #6a7a8a 0%, #9aa8b8 50%, #c8d0d8 100%)' },
      cinematic: { label: 'Cinematic', gradient: 'linear-gradient(135deg, #3a2818 0%, #8a6040 45%, #c8a878 100%)' },
      highContrast: { label: 'High contrast', gradient: 'linear-gradient(135deg, #0a0c10 0%, #4a5058 50%, #e8ecf0 100%)' },
    }
    const blendGradingCompare = (aId, bId, t) => lerpRow(rowFor(aId), rowFor(bId), Math.max(0, Math.min(1, t)))
    const rowFor = (id) => (id && id !== 'off' ? presetTable[id] : null)
    const presetRow = rowFor(gradingPreset)
    const rowA = rowFor(compareA)
    const rowB = rowFor(compareB)
    const exposure = env.exposure ?? 0.75
    const gainMul = Math.max(0.25, Math.min(2, exposure)) / 0.75
    const liftBias = (Math.max(0.25, Math.min(2, exposure)) - 0.75) * 0.06
    const lerpRow = (a, b, t) => {
      if (!a) return b
      if (!b) return a
      return {
        lift: a.lift.map((v, i) => v + (b.lift[i] - v) * t),
        gamma: a.gamma.map((v, i) => v + (b.gamma[i] - v) * t),
        gain: a.gain.map((v, i) => v + (b.gain[i] - v) * t),
      }
    }
    const blended =
      compareT > 0.001 && rowA && rowB && compareA !== compareB
        ? lerpRow(rowA, rowB, compareT)
        : null
    const baseLift = blended?.lift ?? presetRow?.lift ?? env.postLift ?? [0, 0, 0]
    const baseGamma = blended?.gamma ?? presetRow?.gamma ?? env.postGamma ?? [1, 1, 1]
    const baseGain = blended?.gain ?? presetRow?.gain ?? env.postGain ?? [1, 1, 1]
    const lift = baseLift.map((v) => v + liftBias)
    const gamma = baseGamma
    const gain = baseGain.map((v) => v * gainMul)
    const colorGradingOnResolved = colorGradingOn || gradingPreset !== 'off'
    const lutOn = !!env.postGradingLutName || !!embeddedLut
    const lutStrength = Math.max(0, Math.min(1, env.postGradingLutStrength ?? 1))
    const lutSize = embeddedLut?.size ?? env.postGradingLutSize ?? 16
    const lutTexture = embeddedLut?.tex ?? null
    const applyLutGrading = (rgb, size, strength, lutTex) => {
      if (!lutTex || strength <= 0.001) {
        return mix(rgb, mul(rgb, vec3(1.04, 1.02, 0.98)), float(strength))
      }
      const r = rgb.r ?? rgb.x ?? rgb
      const g = rgb.g ?? rgb.y ?? rgb
      const b = rgb.b ?? rgb.z ?? float(0)
      const grid = size * size
      const u = mul(add(mul(r, float(size - 1)), mul(g, float(size - 1))), float(1 / grid))
      const v = mul(b, float(1 / size))
      const sampled = texture(lutTex, vec2(u, v)).rgb
      return mix(rgb, sampled, float(strength))
    }
    void presetThumbnails
    void blendGradingCompare
    void applyLutGrading
    const groundReflect = env.postSsrGround === true && ssrOn
    let tslGround = null
    if (groundReflect) {
      const groundReflector = reflector()
      const geo = new THREE.PlaneGeometry(120, 120)
      const mat = new webgpu.MeshBasicNodeMaterial()
      mat.colorNode = groundReflector
      const mesh = new THREE.Mesh(geo, mat)
      mesh.rotation.x = -Math.PI / 2
      mesh.userData.isSSRGround = true
      mesh.add(groundReflector.target)
      scene.add(mesh)
      tslGround = { mesh, dispose: () => { geo.dispose(); mat.dispose() } }
    }
    let activeCam = camera
    let dofFocusDist = env.postDofFocusDistance ?? 5
    const pipeline = new webgpu.RenderPipeline(primary)
    const rebuild = () => {
      const scenePass = pass(scene, activeCam)
      const needsMRT = ssaoOn || ssgiOn || ssrOn || taaOn || dofOn
      const needsVelocity = taaOn || ssgiOn || ssrOn
      if (needsMRT) {
        const mrtOut = { output, normal: normalView }
        if (needsVelocity) mrtOut.velocity = velocity
        if (ssrOn) {
          mrtOut.metalness = metalness
          mrtOut.roughness = roughness
        }
        scenePass.setMRT(mrt(mrtOut))
      }
      let color = scenePass.getTextureNode('output')
      if (needsMRT) {
        const depth = scenePass.getTextureNode('depth')
        const normal = scenePass.getTextureNode('normal')
        if (taaOn) {
          const vel = scenePass.getTextureNode('velocity')
          const traaPass = traa(color, depth, vel, activeCam)
          color = traaPass.getTextureNode()
        }
        if (ssaoOn) {
          const aoPass = ao(depth, normal, activeCam)
          const aoTex = aoPass.getTextureNode()
          color = mul(color, vec4(vec3(aoTex.r), 1))
        }
        if (ssgiOn) {
          const ssgiPass = ssgi(color, depth, normal, activeCam)
          ssgiPass.useTemporalFiltering = taaOn
          ssgiPass.sliceCount.value = ssgiRow.slices
          ssgiPass.stepCount.value = Math.max(4, ssgiRow.samples)
          ssgiPass.giIntensity.value = Math.max(1, ssgiRow.intensity * 12)
          ssgiPass.radius.value = Math.max(2, ssgiRow.radius * 14)
          let giTex = ssgiPass.getTextureNode()
          if (!taaOn) giTex = denoise(giTex, depth, normal, activeCam)
          color = add(color, giTex)
        }
        if (ssrOn) {
          const metal = scenePass.getTextureNode('metalness')
          const rough = scenePass.getTextureNode('roughness')
          const ssrPass = ssr(color, depth, normal, metal, rough, activeCam)
          if (ssrPass.maxDistance) ssrPass.maxDistance.value = ssrRow.maxDistance
          if (ssrPass.opacity) ssrPass.opacity.value = ssrRow.opacity
          if (ssrPass.thickness) ssrPass.thickness.value = ssrRow.thickness
          let ssrTex = ssrPass.getTextureNode()
          if (taaOn && needsVelocity) {
            const vel = scenePass.getTextureNode('velocity')
            const ssrTraa = traa(ssrTex, depth, vel, activeCam)
            ssrTex = ssrTraa.getTextureNode()
          }
          ssrTex = denoise(ssrTex, depth, normal, activeCam)
          color = add(color, ssrTex)
        }
      }
      if (colorGradingOnResolved || acesOn || lutOn) {
        const zero = float(0)
        const minGamma = vec3(0.01, 0.01, 0.01)
        let rgb = color.rgb ?? color
        if (colorGradingOnResolved) {
          const liftV = vec3(lift[0], lift[1], lift[2])
          const gammaV = vec3(gamma[0], gamma[1], gamma[2])
          const gainV = vec3(gain[0], gain[1], gain[2])
          rgb = pow(max(add(rgb, liftV), zero), max(gammaV, minGamma))
          rgb = mul(rgb, gainV)
        }
        if (lutOn && lutStrength > 0.001) {
          rgb = applyLutGrading(rgb, lutSize, lutStrength, lutTexture)
        }
        if (acesOn) {
          rgb = acesFilmicToneMapping(rgb, float(Math.max(0.35, (env.exposure ?? 0.75) * (acesOn ? 1.02 : 1))))
        }
        color = color.a !== undefined ? vec4(rgb, color.a) : rgb
      }
      if (bloomOn) {
        const bp = bloom(color, strength, radius, threshold)
        color = add(color, bp)
      }
      if (dofOn && needsMRT) {
        const depth = scenePass.getTextureNode('depth')
        const viewZ = perspectiveDepthToViewZ(depth, float(activeCam.near), float(activeCam.far))
        const focalLen = env.postDofFocalLength ?? 2
        const bokeh = env.postDofBokehScale ?? 1.2
        color = dof(color, viewZ, dofFocusDist, focalLen, bokeh)
      }
      if (fxaaOn) color = fxaa(color)
      pipeline.outputNode = color
      pipeline.needsUpdate = true
    }
    rebuild()
    return {
      render: () => pipeline.render(),
      setCamera(cam) {
        if (activeCam === cam) return
        activeCam = cam
        rebuild()
      },
      setDofFocus(dist) {
        if (typeof dist !== 'number' || !Number.isFinite(dist)) return
        dofFocusDist = dist
        rebuild()
      },
      dispose() {
        if (tslGround) {
          scene.remove(tslGround.mesh)
          tslGround.dispose()
        }
        pipeline.dispose()
      },
    }
  } catch {
    return null
  }
}

const scene = new THREE.Scene()
const actors = new Map()
const keys = new Set()
const pressed = new Set()
addEventListener('keydown', (e) => { if (!keys.has(e.code)) pressed.add(e.code); keys.add(e.code) })
addEventListener('keyup', (e) => keys.delete(e.code))

/** Wave 39/44 — virtual stick + action buttons for mobile PWA export */
let touchMove = { x: 0, y: 0 }
let touchJump = false
let touchFire = false
let touchInteract = false
/** Wave 44 — gamepad stick + face buttons share the same injection path */
let gamepadMove = { x: 0, y: 0 }
let gamepadJump = false
let gamepadFire = false
let gamepadInteract = false
let gpPrevJump = false
let gpPrevFire = false
let gpPrevInteract = false
const TOUCH_DEAD = 0.28
function mergedAltMove() {
  return {
    x: Math.abs(gamepadMove.x) > Math.abs(touchMove.x) ? gamepadMove.x : touchMove.x,
    y: Math.abs(gamepadMove.y) > Math.abs(touchMove.y) ? gamepadMove.y : touchMove.y,
  }
}
function touchKeyDown(code) {
  if (keys.has(code)) return true
  const move = mergedAltMove()
  switch (code) {
    case 'KeyW': return move.y < -TOUCH_DEAD
    case 'KeyS': return move.y > TOUCH_DEAD
    case 'KeyA': return move.x < -TOUCH_DEAD
    case 'KeyD': return move.x > TOUCH_DEAD
    case 'Space': return touchJump || gamepadJump
    case 'KeyF': return touchFire || gamepadFire
    case 'KeyE': return touchInteract || gamepadInteract
    default: return false
  }
}
function pollExportGamepad() {
  if (!GAMEPAD_ENABLED || !navigator.getGamepads) {
    gamepadMove = { x: 0, y: 0 }
    gamepadJump = false
    gamepadFire = false
    gamepadInteract = false
    gpPrevJump = false
    gpPrevFire = false
    gpPrevInteract = false
    return false
  }
  const pads = navigator.getGamepads()
  let pad = null
  for (let i = 0; i < pads.length; i++) {
    if (pads[i]?.connected) { pad = pads[i]; break }
  }
  if (!pad) {
    gamepadMove = { x: 0, y: 0 }
    gamepadJump = false
    gamepadFire = false
    gamepadInteract = false
    gpPrevJump = false
    gpPrevFire = false
    gpPrevInteract = false
    return false
  }
  const dead = 0.18
  let x = pad.axes[0] ?? 0
  let y = pad.axes[1] ?? 0
  if (Math.hypot(x, y) < dead) { x = 0; y = 0 }
  else {
    const mag = Math.hypot(x, y)
    const scale = (mag - dead) / (1 - dead)
    x = (x / mag) * scale
    y = (y / mag) * scale
  }
  gamepadMove = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) }
  const btn = (i) => !!pad.buttons[i]?.pressed
  const jumpBtn = gpButtonFor('Jump')
  const interactBtn = gpButtonFor('Interact')
  const fireBtn = gpButtonFor('Fire')
  gamepadJump = btn(jumpBtn)
  gamepadInteract = btn(interactBtn)
  gamepadFire = btn(fireBtn) || (fireBtn === DEFAULT_GP_BUTTONS.Fire && btn(GP_FIRE_ALT))
  if (gamepadJump && !gpPrevJump) pressed.add('Space')
  if (gamepadFire && !gpPrevFire) {
    pressed.add('KeyF')
    pulseGamepadFire()
  }
  if (gamepadInteract && !gpPrevInteract) {
    pressed.add('KeyE')
    pulseGamepadInteract()
  }
  gpPrevJump = gamepadJump
  gpPrevFire = gamepadFire
  gpPrevInteract = gamepadInteract
  return true
}
function bindActionButton(btn, code, getDown, setDown) {
  const press = (e) => {
    e.preventDefault()
    if (!getDown()) pressed.add(code)
    setDown(true)
  }
  const release = (e) => { e.preventDefault(); setDown(false) }
  btn.addEventListener('touchstart', press, { passive: false })
  btn.addEventListener('touchend', release, { passive: false })
  btn.addEventListener('touchcancel', release, { passive: false })
  btn.addEventListener('mousedown', press)
  btn.addEventListener('mouseup', release)
  btn.addEventListener('mouseleave', release)
}
const TOUCH_LAYOUT_PRESETS = {
  compact: {
    stickLeft: '12px', stickBottom: '12px', stickSize: '120px',
    actionsRight: '16px', actionsBottom: '24px', actionsGap: '8px',
    btnSize: '64px', fireBtnSize: '64px',
  },
  wide: {
    stickLeft: '48px', stickBottom: '32px', stickSize: '160px',
    actionsRight: '48px', actionsBottom: '48px', actionsGap: '14px',
    btnSize: '80px', fireBtnSize: '80px',
  },
  fps: {
    stickLeft: '20px', stickBottom: '18px', stickSize: '128px',
    actionsRight: '18px', actionsBottom: '22px', actionsGap: '12px',
    btnSize: '60px', fireBtnSize: '88px',
  },
}
const GAMEPAD_GLYPH_HINT = '🎮 A fire · B interact'
function applyExportTouchLayoutPreset(hud, preset) {
  const id = preset === 'wide' || preset === 'fps' ? preset : 'compact'
  const vars = TOUCH_LAYOUT_PRESETS[id]
  hud.dataset.lotusTouchLayout = id
  hud.style.setProperty('--lotus-touch-stick-left', vars.stickLeft)
  hud.style.setProperty('--lotus-touch-stick-bottom', vars.stickBottom)
  hud.style.setProperty('--lotus-touch-stick-size', vars.stickSize)
  hud.style.setProperty('--lotus-touch-actions-right', vars.actionsRight)
  hud.style.setProperty('--lotus-touch-actions-bottom', vars.actionsBottom)
  hud.style.setProperty('--lotus-touch-actions-gap', vars.actionsGap)
  hud.style.setProperty('--lotus-touch-btn-size', vars.btnSize)
  hud.style.setProperty('--lotus-touch-fire-btn-size', vars.fireBtnSize)
}
function initExportTouchHud() {
  if (!TOUCH_ENABLED) return
  const hud = document.createElement('div')
  hud.className = 'lotus-touch-hud'
  hud.id = 'lotus-touch-hud'
  applyExportTouchLayoutPreset(hud, LEVEL.environment?.touchLayoutPreset)
  const stickZone = document.createElement('div')
  stickZone.className = 'lotus-touch-stick-zone'
  hud.appendChild(stickZone)
  document.body.appendChild(hud)
  const radius = 56
  const dead = 0.12
  const base = document.createElement('div')
  base.className = 'lotus-touch-joystick'
  base.style.width = `${radius * 2}px`
  base.style.height = `${radius * 2}px`
  const knob = document.createElement('div')
  knob.className = 'lotus-touch-joystick-knob'
  base.appendChild(knob)
  stickZone.appendChild(base)
  const actions = document.createElement('div')
  actions.className = 'lotus-touch-actions'
  hud.appendChild(actions)
  const interactBtn = document.createElement('button')
  interactBtn.type = 'button'
  interactBtn.className = 'lotus-touch-interact'
  interactBtn.textContent = 'Use'
  actions.appendChild(interactBtn)
  const fireBtn = document.createElement('button')
  fireBtn.type = 'button'
  fireBtn.className = 'lotus-touch-fire'
  fireBtn.textContent = 'Fire'
  actions.appendChild(fireBtn)
  const jumpBtn = document.createElement('button')
  jumpBtn.type = 'button'
  jumpBtn.className = 'lotus-touch-jump'
  jumpBtn.textContent = 'Jump'
  actions.appendChild(jumpBtn)
  let stickId = null
  const setStick = (t) => {
    const rect = base.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    let dx = t.clientX - cx
    let dy = t.clientY - cy
    const len = Math.hypot(dx, dy)
    if (len > radius) { dx = (dx / len) * radius; dy = (dy / len) * radius }
    const nx = dx / radius
    const ny = dy / radius
    const mag = Math.hypot(nx, ny)
    if (mag < dead) touchMove = { x: 0, y: 0 }
    else {
      const scale = (mag - dead) / (1 - dead)
      touchMove = { x: (nx / mag) * scale, y: (ny / mag) * scale }
    }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`
  }
  const pick = (e) => {
    const rect = base.getBoundingClientRect()
    for (const t of e.changedTouches) {
      if (t.clientX >= rect.left && t.clientX <= rect.right && t.clientY >= rect.top && t.clientY <= rect.bottom) return t
    }
    return e.changedTouches[0] ?? null
  }
  const find = (e, id) => {
    for (const t of e.touches) if (t.identifier === id) return t
    for (const t of e.changedTouches) if (t.identifier === id) return t
    return null
  }
  base.addEventListener('touchstart', (e) => {
    if (stickId !== null) return
    const t = pick(e)
    if (!t) return
    e.preventDefault()
    stickId = t.identifier
    setStick(t)
  }, { passive: false })
  base.addEventListener('touchmove', (e) => {
    if (stickId === null) return
    const t = find(e, stickId)
    if (!t) return
    e.preventDefault()
    setStick(t)
  }, { passive: false })
  const endStick = (e) => {
    if (stickId === null) return
    if (!find(e, stickId) && e.type !== 'touchcancel') return
    e.preventDefault()
    stickId = null
    touchMove = { x: 0, y: 0 }
    knob.style.transform = 'translate(-50%, -50%)'
  }
  base.addEventListener('touchend', endStick, { passive: false })
  base.addEventListener('touchcancel', endStick, { passive: false })
  const slotDown = { 'jump-btn': false, 'fire-btn': false, 'interact-btn': false }
  const slotPressed = { 'jump-btn': false, 'fire-btn': false, 'interact-btn': false }
  const bindSlotButton = (btn, slot, code) => {
    btn.dataset.lotusTouchSlot = slot
    const press = (e) => {
      e.preventDefault()
      if (!slotDown[slot]) slotPressed[slot] = true
      slotDown[slot] = true
      pressed.add(code)
    }
    const release = (e) => { e.preventDefault(); slotDown[slot] = false }
    btn.addEventListener('touchstart', press, { passive: false })
    btn.addEventListener('touchend', release, { passive: false })
    btn.addEventListener('touchcancel', release, { passive: false })
    btn.addEventListener('mousedown', press)
    btn.addEventListener('mouseup', release)
    btn.addEventListener('mouseleave', release)
  }
  bindSlotButton(jumpBtn, 'jump-btn', 'Space')
  bindSlotButton(fireBtn, 'fire-btn', 'KeyF')
  bindSlotButton(interactBtn, 'interact-btn', 'KeyE')
  const syncTouchActions = () => {
    touchJump = slotDown[touchSlotFor('jump')]
    touchFire = slotDown[touchSlotFor('fire')]
    touchInteract = slotDown[touchSlotFor('interact')]
    if (slotPressed[touchSlotFor('jump')]) {
      pressed.add('Space')
      vibrateTouchJump()
    }
    if (slotPressed[touchSlotFor('fire')]) {
      pressed.add('KeyF')
      vibrateTouchFire()
    }
    if (slotPressed[touchSlotFor('interact')]) {
      pressed.add('KeyE')
      vibrateTouchInteract()
    }
    for (const slot of Object.keys(slotPressed)) slotPressed[slot] = false
  }
  window.__lotusSyncTouchBindings = syncTouchActions
}

let skyObj = null
let particleSystems = []
let ticks = []
let physWorld = null
let bindings = []
let clock = 0
/** v2.74 — script signal bus + timers for mini-game export */
const signalHandlers = new Map()
let scriptTimers = []
let triggerState = new Map()
let mgOverlay = null

function resetSignals() {
  signalHandlers.clear()
}

function parseExportValue(raw) {
  const t = String(raw).trim()
  try { return JSON.parse(t) } catch { return t.replace(/^["']|["']$/g, '') }
}

function parseExportVars(source, overrides) {
  const vars = {}
  if (!source) return { ...vars, ...(overrides ?? {}) }
  for (const line of source.split('\n')) {
    let m = line.match(/^\s*\/\/\s*@export_range\s+([A-Za-z_$][\w$]*)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*=\s*(.+)\s*$/)
    if (m) {
      const value = Number(parseExportValue(m[5]))
      vars[m[1]] = Number.isFinite(value) ? value : 0
      continue
    }
    m = line.match(/^\s*\/\/\s*@export_enum\s+([A-Za-z_$][\w$]*)\s*:\s*(.+)\s*=\s*(.+)\s*$/)
    if (m) {
      vars[m[1]] = parseExportValue(m[3])
      continue
    }
    m = line.match(/^\s*\/\/\s*@export\s+([A-Za-z_$][\w$]*)\s*=\s*(.+)\s*$/)
    if (m) vars[m[1]] = parseExportValue(m[2])
  }
  return { ...vars, ...(overrides ?? {}) }
}

function tickScriptTimers(dt) {
  for (let i = scriptTimers.length - 1; i >= 0; i--) {
    const t = scriptTimers[i]
    t.at -= dt
    if (t.at > 0) continue
    try { t.fn() } catch (e) { console.warn('timer', e) }
    if (t.loop != null) t.at = t.loop
    else scriptTimers.splice(i, 1)
  }
}

function showMiniGameOverlay(kind, title, color) {
  if (mgOverlay) mgOverlay.remove()
  mgOverlay = document.createElement('div')
  mgOverlay.className = `lotus-minigame-overlay lotus-minigame-${kind}`
  mgOverlay.innerHTML = `<div class="lotus-minigame-panel">
    <div class="lotus-minigame-title" style="color:${color}">${title}</div>
    <div class="lotus-minigame-sub">${kind === 'win' ? 'Great run!' : 'Refresh to try again'}</div>
  </div>`
  document.body.appendChild(mgOverlay)
}

let achievementToastEl = null
let achievementToastTimer = null
let achievementProgressToastEl = null
let achievementProgressToastTimer = null
function progressRingSvg(current, max) {
  const pct = max > 0 ? Math.min(1, current / max) : 0
  const r = 16
  const c = 2 * Math.PI * r
  const offset = c * (1 - pct)
  return `<svg viewBox="0 0 40 40" aria-hidden="true">
    <circle class="lotus-achievement-progress-ring-bg" cx="20" cy="20" r="${r}" />
    <circle class="lotus-achievement-progress-ring-fg" cx="20" cy="20" r="${r}"
      stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}" />
  </svg>
    <div class="lotus-achievement-progress-ring-label">${current}/${max}</div>`
}
function showAchievementProgressToast(title, current, max, icon = '🏆') {
  if (achievementProgressToastTimer) {
    clearTimeout(achievementProgressToastTimer)
    achievementProgressToastTimer = null
  }
  achievementProgressToastEl?.remove()
  const safeMax = Math.max(1, Math.floor(max))
  const safeCurrent = Math.max(0, Math.min(Math.floor(current), safeMax))
  const pct = safeMax > 0 ? Math.round((safeCurrent / safeMax) * 100) : 0
  achievementProgressToastEl = document.createElement('div')
  achievementProgressToastEl.className = 'lotus-achievement-progress-toast'
  achievementProgressToastEl.innerHTML = `<div class="lotus-achievement-progress-ring">${progressRingSvg(safeCurrent, safeMax)}</div>
    <div>
      <div class="lotus-achievement-toast-title">${icon} ${title}</div>
      <div class="lotus-achievement-toast-sub">${safeCurrent} / ${safeMax}</div>
      <div class="lotus-achievement-progress-bar"><div class="lotus-achievement-progress-bar-fill" style="width:${pct}%"></div></div>
    </div>`
  document.body.appendChild(achievementProgressToastEl)
  achievementProgressToastTimer = setTimeout(() => {
    achievementProgressToastEl?.remove()
    achievementProgressToastEl = null
    achievementProgressToastTimer = null
  }, 3200)
}
function showAchievementToast(title, subtitle, icon = '🏆') {
  if (achievementToastTimer) {
    clearTimeout(achievementToastTimer)
    achievementToastTimer = null
  }
  achievementToastEl?.remove()
  achievementToastEl = document.createElement('div')
  achievementToastEl.className = 'lotus-achievement-toast'
  achievementToastEl.innerHTML = `<div class="lotus-achievement-toast-icon">${icon}</div>
    <div>
      <div class="lotus-achievement-toast-title">${title}</div>
      ${subtitle ? `<div class="lotus-achievement-toast-sub">${subtitle}</div>` : ''}
    </div>`
  document.body.appendChild(achievementToastEl)
  achievementToastTimer = setTimeout(() => {
    achievementToastEl?.remove()
    achievementToastEl = null
    achievementToastTimer = null
  }, 3200)
}

function achievementStorageKey(packId) {
  const safe = String(packId ?? '').trim().toLowerCase().replace(/[^\w.-]+/g, '_').slice(0, 32)
  return `${ACHIEVEMENT_STORAGE_PREFIX}.${safe || 'pack'}`
}

function achievementProgressStorageKey(packId) {
  const safe = String(packId ?? '').trim().toLowerCase().replace(/[^\w.-]+/g, '_').slice(0, 32)
  return `${ACHIEVEMENT_PROGRESS_STORAGE_PREFIX}.${safe || 'pack'}`
}

function exportAchievementPackId() {
  return ACHIEVEMENTS_DEF?.packId ?? MINIGAME_PACK ?? MINIGAME_PRESET ?? null
}

function exportFindAchievement(id) {
  const q = String(id ?? '').trim()
  if (!q || !ACHIEVEMENTS_DEF?.achievements) return null
  return ACHIEVEMENTS_DEF.achievements.find((a) => a.id === q) ?? null
}

function exportReadUnlockedSet(packId) {
  try {
    const raw = localStorage.getItem(achievementStorageKey(packId))
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return new Set()
    return new Set(parsed.map((v) => String(v)))
  } catch {
    return new Set()
  }
}

function exportWriteUnlockedSet(packId, unlocked) {
  localStorage.setItem(achievementStorageKey(packId), JSON.stringify([...unlocked]))
}

function exportListUnlockedAchievements(packId) {
  const id = packId ?? exportAchievementPackId()
  if (!id) return []
  return [...exportReadUnlockedSet(id)]
}

function exportUnlockAchievement(id) {
  const packId = exportAchievementPackId()
  const achievement = exportFindAchievement(id)
  if (!packId || !achievement) return false
  const unlocked = exportReadUnlockedSet(packId)
  if (unlocked.has(achievement.id)) return false
  unlocked.add(achievement.id)
  exportWriteUnlockedSet(packId, unlocked)
  api.emit('achievement_unlock', achievement)
  return true
}

function exportReadProgressMap(packId) {
  try {
    const raw = localStorage.getItem(achievementProgressStorageKey(packId))
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      const current = Number(value.current)
      const max = Number(value.max)
      if (!Number.isFinite(current) || !Number.isFinite(max) || max <= 0) continue
      out[key] = { current: Math.max(0, current), max }
    }
    return out
  } catch {
    return {}
  }
}

function exportWriteProgressMap(packId, progress) {
  localStorage.setItem(achievementProgressStorageKey(packId), JSON.stringify(progress))
}

function exportResolveProgressMax(achievement, maxArg, stored) {
  if (typeof maxArg === 'number' && Number.isFinite(maxArg) && maxArg > 0) return Math.floor(maxArg)
  if (stored && stored.max > 0) return stored.max
  const defMax = ACHIEVEMENT_PROGRESS_DEF?.defaults?.[achievement.id]?.max
  if (typeof defMax === 'number' && defMax > 0) return defMax
  if (typeof achievement.progressMax === 'number' && achievement.progressMax > 0) return achievement.progressMax
  return 1
}

function exportGetAchievementProgress(id) {
  const packId = exportAchievementPackId()
  const achievement = exportFindAchievement(id)
  if (!packId || !achievement) return null
  const stored = exportReadProgressMap(packId)[achievement.id]
  if (stored) return { ...stored }
  const defMax = ACHIEVEMENT_PROGRESS_DEF?.defaults?.[achievement.id]?.max ?? achievement.progressMax
  if (typeof defMax === 'number' && defMax > 0) return { current: 0, max: defMax }
  return null
}

function exportSetAchievementProgress(id, current, max) {
  const packId = exportAchievementPackId()
  const achievement = exportFindAchievement(id)
  if (!packId || !achievement) return false
  const progressMap = exportReadProgressMap(packId)
  const stored = progressMap[achievement.id] ?? null
  const resolvedMax = exportResolveProgressMax(achievement, max, stored)
  const resolvedCurrent = Math.max(0, Math.min(Math.floor(current), resolvedMax))
  progressMap[achievement.id] = { current: resolvedCurrent, max: resolvedMax }
  exportWriteProgressMap(packId, progressMap)
  api.emit('achievement_progress', {
    ...achievement,
    current: resolvedCurrent,
    max: resolvedMax,
  })
  if (resolvedCurrent >= resolvedMax) return exportUnlockAchievement(achievement.id)
  return false
}

/** Wave 95 — export runtime inventory mirror (rpg3d pack scripts). */
const exportInventory = { gold: 0, slots: [] }
const EXPORT_INVENTORY_SLOTS = 20

function exportAddItem(itemId, quantity = 1) {
  const q = Math.max(1, Math.floor(quantity))
  let remaining = q
  for (const slot of exportInventory.slots) {
    if (slot.itemId !== itemId) continue
    const room = 99 - slot.quantity
    if (room <= 0) continue
    const add = Math.min(room, remaining)
    slot.quantity += add
    remaining -= add
    if (remaining <= 0) return true
  }
  while (remaining > 0 && exportInventory.slots.length < EXPORT_INVENTORY_SLOTS) {
    const add = Math.min(99, remaining)
    exportInventory.slots.push({ itemId, quantity: add })
    remaining -= add
  }
  return remaining <= 0
}

function exportRemoveItem(itemId, quantity = 1) {
  let remaining = Math.max(1, Math.floor(quantity))
  for (let i = exportInventory.slots.length - 1; i >= 0 && remaining > 0; i--) {
    const slot = exportInventory.slots[i]
    if (slot.itemId !== itemId) continue
    const take = Math.min(slot.quantity, remaining)
    slot.quantity -= take
    remaining -= take
    if (slot.quantity <= 0) exportInventory.slots.splice(i, 1)
  }
  return remaining <= 0
}

function exportHasItem(itemId) {
  return exportInventory.slots.some((s) => s.itemId === itemId && s.quantity > 0)
}

function exportGetItemCount(itemId) {
  return exportInventory.slots.reduce((n, s) => (s.itemId === itemId ? n + s.quantity : n), 0)
}

function exportGetGold() {
  return exportInventory.gold
}

function exportAddGold(amount) {
  exportInventory.gold = Math.max(0, exportInventory.gold + Math.floor(amount))
  return exportInventory.gold
}

function wireExportMiniGameHud() {
  api.on('game_won', () => showMiniGameOverlay('win', 'YOU WIN!', '#46a758'))
  api.on('game_lost', () => showMiniGameOverlay('lose', 'GAME OVER', '#e5484d'))
  api.on('achievement_unlock', (ach) => {
    const title = ach?.title ?? 'Achievement Unlocked'
    const subtitle = ach?.description ?? ''
    showAchievementToast(title, subtitle, ach?.icon ?? '🏆')
  })
  api.on('achievement_progress', (ach) => {
    const title = ach?.title ?? 'Achievement Progress'
    const current = Number(ach?.current ?? 0)
    const max = Number(ach?.max ?? 1)
    showAchievementProgressToast(title, current, max, ach?.icon ?? '🏆')
  })
}

/** Wave 93 — RPG dialogue trees (#lotus-dialogue-overlay, __LOTUS_DIALOGUE__). */
const DIALOGUE_NPC_TAG_W93 = 'DialogueNPC'
const DIALOGUE_INTERACT_RADIUS_W93 = 2.5
const DIALOGUE_OVERLAY_ID_W93 = 'lotus-dialogue-overlay'
let exportDialogueTreeId = null
let exportDialogueNodeId = null
let exportDialogueRoot = null
let exportDialogueKeyHandler = null
let exportDialogueInteractJust = false

function exportDialogueTrees() {
  return DIALOGUE_CATALOG?.trees ?? {}
}

function exportDialogueNode(treeId, nodeId) {
  const tree = exportDialogueTrees()[treeId]
  if (!tree?.nodes) return null
  return tree.nodes.find((n) => n.id === nodeId) ?? null
}

function exportDialogueEnd() {
  exportDialogueTreeId = null
  exportDialogueNodeId = null
  if (exportDialogueRoot) exportDialogueRoot.classList.remove('visible')
}

function exportDialogueShow(treeId, nodeId) {
  const node = exportDialogueNode(treeId, nodeId)
  if (!node) {
    exportDialogueEnd()
    return false
  }
  exportDialogueTreeId = treeId
  exportDialogueNodeId = nodeId
  exportRenderDialogueUi(node)
  return true
}

function exportStartDialogue(treeId) {
  const tree = exportDialogueTrees()[treeId]
  if (!tree?.startId) return false
  return exportDialogueShow(treeId, tree.startId)
}

function exportAdvanceDialogue() {
  if (!exportDialogueTreeId || !exportDialogueNodeId) return false
  const node = exportDialogueNode(exportDialogueTreeId, exportDialogueNodeId)
  if (!node) {
    exportDialogueEnd()
    return false
  }
  if (node.choices?.length) return false
  if (node.nextId) return exportDialogueShow(exportDialogueTreeId, node.nextId)
  exportDialogueEnd()
  return true
}

function exportChooseDialogue(index) {
  if (!exportDialogueTreeId || !exportDialogueNodeId) return false
  const node = exportDialogueNode(exportDialogueTreeId, exportDialogueNodeId)
  const choice = node?.choices?.[index]
  if (!choice) return false
  return exportDialogueShow(exportDialogueTreeId, choice.nextId)
}

function exportDialogueActive() {
  return exportDialogueTreeId !== null && exportDialogueNodeId !== null
}

function exportRenderDialogueUi(node) {
  if (!exportDialogueRoot) return
  exportDialogueRoot.classList.add('visible')
  const speaker = exportDialogueRoot.querySelector('[data-dialogue-speaker]')
  const body = exportDialogueRoot.querySelector('[data-dialogue-body]')
  const choicesEl = exportDialogueRoot.querySelector('[data-dialogue-choices]')
  const hint = exportDialogueRoot.querySelector('[data-dialogue-hint]')
  if (!speaker || !body || !choicesEl || !hint) return
  speaker.textContent = node.speaker ?? ''
  speaker.style.display = node.speaker ? 'block' : 'none'
  body.textContent = node.text ?? ''
  choicesEl.innerHTML = ''
  const choices = node.choices ?? []
  if (choices.length) {
    choices.forEach((c, i) => {
      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'lotus-dialogue-choice'
      btn.textContent = `${i + 1}. ${c.text}`
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        exportChooseDialogue(i)
      })
      choicesEl.appendChild(btn)
    })
    hint.textContent = 'Choose a response · 1–9 keys'
  } else {
    hint.textContent = node.nextId ? 'Press E, Space, or Enter to continue' : 'Press E, Space, or Enter to close'
  }
}

function initExportDialogue() {
  if (!DIALOGUE_CATALOG?.trees) return
  if (exportDialogueRoot) return
  exportDialogueRoot = document.createElement('div')
  exportDialogueRoot.id = DIALOGUE_OVERLAY_ID_W93
  exportDialogueRoot.setAttribute('role', 'dialog')
  exportDialogueRoot.setAttribute('aria-label', 'Dialogue')
  exportDialogueRoot.innerHTML = `<div class="lotus-dialogue-panel">
    <div class="lotus-dialogue-speaker" data-dialogue-speaker></div>
    <div class="lotus-dialogue-body" data-dialogue-body></div>
    <div class="lotus-dialogue-choices" data-dialogue-choices></div>
    <div class="lotus-dialogue-hint" data-dialogue-hint></div>
  </div>`
  document.body.appendChild(exportDialogueRoot)
  if (!exportDialogueKeyHandler) {
    exportDialogueKeyHandler = (e) => {
      if (!exportDialogueActive()) return
      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault()
        exportAdvanceDialogue()
      }
      const digit = e.code.startsWith('Digit') ? Number(e.code.replace('Digit', '')) : 0
      if (digit >= 1 && digit <= 9) {
        const idx = digit - 1
        const choiceBtns = exportDialogueRoot?.querySelectorAll('.lotus-dialogue-choice') ?? []
        if (idx < choiceBtns.length) {
          e.preventDefault()
          exportChooseDialogue(idx)
        }
      }
    }
    window.addEventListener('keydown', exportDialogueKeyHandler)
  }
}

function tickExportDialogueInteract(pos) {
  if (!DIALOGUE_CATALOG?.trees || !pos) return
  const interact = exportDialogueInteractJust || pressed.has('KeyE')
  exportDialogueInteractJust = false
  if (exportDialogueActive()) {
    if (interact) exportAdvanceDialogue()
    return
  }
  if (!interact) return
  let best = null
  const r2 = DIALOGUE_INTERACT_RADIUS_W93 * DIALOGUE_INTERACT_RADIUS_W93
  for (const a of actors.values()) {
    const tags = a.data.tags ?? []
    if (!tags.includes(DIALOGUE_NPC_TAG_W93)) continue
    const treeId = a.data.scriptVars?.dialogueId
    if (typeof treeId !== 'string' || !treeId.trim() || !exportDialogueTrees()[treeId.trim()]) continue
    const p = new THREE.Vector3()
    a.root.getWorldPosition(p)
    const dx = p.x - pos.x
    const dz = p.z - pos.z
    const distSq = dx * dx + dz * dz
    if (distSq > r2) continue
    if (!best || distSq < best.distSq) best = { treeId: treeId.trim(), distSq }
  }
  if (best) exportStartDialogue(best.treeId)
}

/** Wave 95 — RPG HUD mirror: health bar, quest tracker, inventory panel, dialogue. */
let rpgHudRoot = null
let rpgDialogueLines = []
let rpgDialogueIndex = 0
let rpgDialogueSpeaker = ''

function ensureRpgHudRoot() {
  if (rpgHudRoot) return rpgHudRoot
  rpgHudRoot = document.createElement('div')
  rpgHudRoot.id = 'lotus-rpg-hud-root'
  rpgHudRoot.innerHTML = `<div class="lotus-rpg-hp-wrap">
    <div class="lotus-rpg-hp-label">HP</div>
    <div class="lotus-rpg-hp-bar"><div class="lotus-rpg-hp-fill" id="lotus-rpg-hp-fill" style="width:100%"></div></div>
  </div>
  <div class="lotus-rpg-quest" id="lotus-rpg-quest">
    <div class="lotus-rpg-quest-title">QUEST</div>
    <div id="lotus-rpg-quest-text">Talk to the Village Elder</div>
  </div>
  <div class="lotus-rpg-inventory" id="lotus-rpg-inventory">
    <div class="lotus-rpg-inventory-title">Inventory</div>
    <ul id="lotus-rpg-inventory-list"></ul>
    <div class="lotus-rpg-inventory-hint">Press I to close</div>
  </div>
  <div class="lotus-rpg-dialogue" id="lotus-rpg-dialogue">
    <div class="lotus-rpg-dialogue-speaker" id="lotus-rpg-dialogue-speaker"></div>
    <div class="lotus-rpg-dialogue-text" id="lotus-rpg-dialogue-text"></div>
    <div class="lotus-rpg-dialogue-hint">Interact / E — next line</div>
  </div>`
  document.body.appendChild(rpgHudRoot)
  return rpgHudRoot
}

function rpgSetHpFraction(fraction) {
  const fill = document.getElementById('lotus-rpg-hp-fill')
  if (fill) fill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`
}

function rpgSetQuestText(text) {
  const el = document.getElementById('lotus-rpg-quest-text')
  if (el) el.textContent = text
}

function rpgRenderInventory(items) {
  const list = document.getElementById('lotus-rpg-inventory-list')
  if (!list) return
  if (!items?.length) list.innerHTML = '<li><em>Empty</em></li>'
  else list.innerHTML = items.map((item) => `<li>${item}</li>`).join('')
}

function rpgShowInventory(open) {
  const panel = document.getElementById('lotus-rpg-inventory')
  if (panel) panel.classList.toggle('open', !!open)
}

function rpgShowDialogueLine() {
  const panel = document.getElementById('lotus-rpg-dialogue')
  const speakerEl = document.getElementById('lotus-rpg-dialogue-speaker')
  const textEl = document.getElementById('lotus-rpg-dialogue-text')
  if (!panel || !speakerEl || !textEl) return
  if (rpgDialogueIndex >= rpgDialogueLines.length) {
    panel.classList.remove('open')
    rpgDialogueLines = []
    rpgDialogueIndex = 0
    api.emit('dialogue_end')
    return
  }
  speakerEl.textContent = rpgDialogueSpeaker
  textEl.textContent = rpgDialogueLines[rpgDialogueIndex]
  panel.classList.add('open')
}

function wireExportRpg3dHud() {
  ensureRpgHudRoot()
  api.on('rpg_hud_ready', () => rpgSetHpFraction(1))
  api.on('hp_update', (frac) => rpgSetHpFraction(Number(frac)))
  api.on('quest_update', (text) => rpgSetQuestText(String(text ?? '')))
  api.on('quest_complete', () => rpgSetQuestText('Quest complete: Herbs delivered!'))
  api.on('inventory_toggle', (open, items) => {
    rpgRenderInventory(Array.isArray(items) ? items : [])
    rpgShowInventory(open === true)
  })
  api.on('dialogue_start', (id, lines) => {
    const speaker = String(id ?? '')
    rpgDialogueSpeaker = speaker === 'village_elder' ? 'Village Elder' : speaker
    rpgDialogueLines = Array.isArray(lines) ? lines.map((l) => String(l)) : []
    rpgDialogueIndex = 0
    rpgShowDialogueLine()
  })
  api.on('dialogue_advance', () => {
    rpgDialogueIndex++
    rpgShowDialogueLine()
  })
  api.on('quest_started', (q) => {
    const o = q?.objectives?.[0]
    if (o) rpgSetQuestText(`${q.title}: ${o.description}`)
  })
  api.on('quest_updated', (q) => {
    const o = q?.objectives?.[0]
    if (o) rpgSetQuestText(`${q.title} (${o.current}/${o.count})`)
  })
  api.on('quest_completed', (q) => {
    rpgSetQuestText(q?.title ? `${q.title} complete!` : 'Quest complete!')
  })
  if (MINIGAME_ENABLED || RPG_3D_ENABLED) {
    api.on('game_won', () => showMiniGameOverlay('win', 'QUEST COMPLETE!', '#46a758'))
  }
  api.on('achievement_unlock', (ach) => {
    const title = ach?.title ?? 'Achievement Unlocked'
    const subtitle = ach?.description ?? ''
    showAchievementToast(title, subtitle, ach?.icon ?? '🏆')
  })
}

const _ray = new THREE.Raycaster()
function raycastActors(origin, dir, maxDist = 1000) {
  _ray.set(new THREE.Vector3(...origin), new THREE.Vector3(...dir).normalize())
  _ray.far = maxDist
  const meshes = []
  for (const a of actors.values()) {
    a.root.traverse((o) => {
      if (o.isMesh && !o.userData?.isHelper && !o.userData?.isEditorOnly) meshes.push(o)
    })
  }
  for (const hit of _ray.intersectObjects(meshes, false)) {
    let cur = hit.object
    while (cur) {
      const id = cur.userData?.actorId
      if (id && actors.has(id)) {
        return { point: [hit.point.x, hit.point.y, hit.point.z], actor: actors.get(id), distance: hit.distance }
      }
      cur = cur.parent
    }
  }
  return null
}

function tickTriggerVolumes(pos) {
  const local = new THREE.Vector3()
  for (const a of actors.values()) {
    if (a.data.type !== 'TriggerVolume') continue
    local.copy(pos)
    a.root.worldToLocal(local)
    const inside = Math.abs(local.x) <= 0.5 && Math.abs(local.y) <= 0.5 && Math.abs(local.z) <= 0.5
    const was = triggerState.get(a.id) ?? false
    if (inside !== was) {
      triggerState.set(a.id, inside)
      api.emit(`${inside ? 'enter' : 'exit'}:${a.data.name}`, a.data.name)
    }
  }
}

/** Wave 28 — cinematic focus-pull parity with editor CineCamera. */
function resolveExportDofFocus(camProps, env, playT) {
  const base = camProps?.dofFocusDistance ?? env.postDofFocusDistance ?? 5
  if (!camProps?.dofFocusPull) return base
  const dur = Math.max(0.05, camProps.dofFocusPullDuration ?? 2)
  const t = Math.min(1, playT / dur)
  const from = camProps.dofFocusPullFrom ?? base
  const to = camProps.dofFocusPullTo ?? base
  return from + (to - from) * t
}

function findExportFocusPullCamera() {
  for (const a of actors.values()) {
    const cp = a.data.cameraProps
    if (cp?.dofFocusPull) return cp
  }
  return null
}
let loadingLevel = false
const loadedCells = new Set()
const cellActorIds = new Map()

/** Wave 60 — cell load progress (mirrors streamingProgress.ts). */
let streamProgress = { cellsLoaded: 0, cellsTotal: 0, percent: 0, active: false }

function resetStreamProgress() {
  streamProgress = { cellsLoaded: 0, cellsTotal: 0, percent: 0, active: false }
}

function beginStreamProgress(total) {
  const cellsTotal = Math.max(0, total)
  streamProgress = {
    cellsLoaded: 0,
    cellsTotal,
    percent: cellsTotal <= 0 ? 100 : 0,
    active: cellsTotal > 0,
  }
}

function noteStreamCellLoaded() {
  if (streamProgress.cellsTotal <= 0) {
    streamProgress.percent = 100
    streamProgress.active = false
    return
  }
  streamProgress.cellsLoaded = Math.min(streamProgress.cellsTotal, streamProgress.cellsLoaded + 1)
  streamProgress.percent = Math.round((streamProgress.cellsLoaded / streamProgress.cellsTotal) * 100)
  if (streamProgress.cellsLoaded >= streamProgress.cellsTotal) {
    streamProgress.active = false
    streamProgress.percent = 100
  }
}

function ensureStreamProgressBar() {
  let el = document.getElementById(STREAM_PROGRESS_ID)
  if (!el) {
    el = document.createElement('div')
    el.id = STREAM_PROGRESS_ID
    el.setAttribute('aria-hidden', 'true')
    el.style.cssText =
      'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);width:min(320px,80vw);height:6px;background:rgba(255,255,255,.12);border-radius:4px;overflow:hidden;z-index:25;pointer-events:none;opacity:0;transition:opacity .2s ease'
    const fill = document.createElement('div')
    fill.className = 'lotus-stream-progress-fill'
    fill.style.cssText =
      'height:100%;width:0%;background:linear-gradient(90deg,#2f80ed,#46a758);border-radius:4px;transition:width .15s ease'
    el.appendChild(fill)
    document.body.appendChild(el)
  }
  return el
}

function updateStreamProgressBar() {
  if (!STREAMING_ENABLED) return
  const el = ensureStreamProgressBar()
  const fill = el.querySelector('.lotus-stream-progress-fill')
  if (!fill) return
  fill.style.width = `${streamProgress.percent}%`
  el.style.opacity = streamProgress.active || streamProgress.percent < 100 ? '1' : '0'
}

function hideStreamProgressBar() {
  const el = document.getElementById(STREAM_PROGRESS_ID)
  if (el) el.style.opacity = '0'
  streamProgress.active = false
}

function tickStreamProgressCell() {
  noteStreamCellLoaded()
  updateStreamProgressBar()
  if (!streamProgress.active && streamProgress.percent >= 100) {
    setTimeout(() => hideStreamProgressBar(), 320)
  }
}

function streamSettings() {
  const s = LEVEL.streaming ?? {}
  return {
    enabled: s.enabled !== false,
    gridSize: Math.max(8, s.gridSize ?? 64),
    loadRadius: Math.max(0, s.loadRadius ?? 2),
  }
}

function worldToCell(x, z, gridSize) {
  return [Math.floor(x / gridSize), Math.floor(z / gridSize)]
}

function cellKey(cx, cz) { return `${cx},${cz}` }

function isCellInRadius(acx, acz, ccx, ccz, r) {
  return Math.abs(acx - ccx) <= r && Math.abs(acz - ccz) <= r
}

function actorStreamVisible(sa, camPos) {
  const cfg = streamSettings()
  if (!cfg.enabled) return true
  if (ALWAYS_LOADED.has(sa.type) || !sa.streamCell) return true
  const camCell = worldToCell(camPos.x, camPos.z, cfg.gridSize)
  return isCellInRadius(sa.streamCell[0], sa.streamCell[1], camCell[0], camCell[1], cfg.loadRadius)
}

function applyStreamingVisibility(camPos) {
  const cfg = streamSettings()
  for (const a of actors.values()) {
    const sa = a.data
    const streamOk = actorStreamVisible(sa, camPos)
    const cullOk = !sa.cullDistance || a.root.position.distanceTo(camPos) < sa.cullDistance
    a.root.visible = (sa.visible !== false) && streamOk && cullOk
  }
}

// ---- environment ----
function applyEnvironment() {
  const env = LEVEL.environment
  if (skyObj) { scene.remove(skyObj); skyObj = null }
  if (env.skyEnabled) {
    const sky = new Sky()
    sky.scale.setScalar(450000)
    const u = sky.material.uniforms
    u.turbidity.value = 4; u.rayleigh.value = 1.1; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8
    const phi = THREE.MathUtils.degToRad(90 - env.sunElevation)
    const theta = THREE.MathUtils.degToRad(env.sunAzimuth)
    u.sunPosition.value.setFromSphericalCoords(1, phi, theta)
    scene.add(sky)
    skyObj = sky
    scene.background = null
  } else {
    scene.background = new THREE.Color(env.background)
  }
  scene.fog = env.fogEnabled ? new THREE.FogExp2(env.fogColor, env.fogDensity) : null
  if (renderer) renderer.toneMappingExposure = env.exposure ?? 0.75
}
applyEnvironment()

// ---- geometry / actor builders ----
function buildGeometry(kind) {
  switch (kind) {
    case 'sphere': return new THREE.SphereGeometry(0.5, 32, 16)
    case 'cylinder': return new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
    case 'cone': return new THREE.ConeGeometry(0.5, 1, 32)
    case 'plane': return new THREE.PlaneGeometry(1, 1)
    case 'torus': return new THREE.TorusGeometry(0.5, 0.2, 16, 48)
    case 'capsule': return new THREE.CapsuleGeometry(0.3, 0.6, 8, 16)
    case 'icosahedron': return new THREE.IcosahedronGeometry(0.5, 0)
    default: return new THREE.BoxGeometry(1, 1, 1)
  }
}
function buildMaterial(m, vertexColors = false) {
  return new THREE.MeshStandardMaterial({
    color: m?.color ?? '#9da4ae', roughness: m?.roughness ?? 0.6, metalness: m?.metalness ?? 0.1,
    emissive: m?.emissive ?? '#000', emissiveIntensity: m?.emissiveIntensity ?? 1,
    transparent: !!m?.transparent || (m?.opacity ?? 1) < 1, opacity: m?.opacity ?? 1, wireframe: !!m?.wireframe,
    vertexColors,
  })
}

/** Re-apply Baked AO (approx) vertex colors saved on the actor. */
function applyBakedAO(root, sa) {
  if (!sa.bakedAO || !sa.bakedAOMeshes?.length) return
  const meshes = []
  root.traverse((o) => { if (o.isMesh) meshes.push(o) })
  sa.bakedAOMeshes.forEach((colors, i) => {
    const mesh = meshes[i]
    if (!mesh || !colors?.length) return
    mesh.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3))
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      if (mat.isMeshStandardMaterial) mat.vertexColors = true
    }
  })
}

function generateBoxProjectionUV2(geometry) {
  const pos = geometry.attributes.position
  if (!pos?.count) return false
  if (!geometry.attributes.normal) geometry.computeVertexNormals()
  const norm = geometry.attributes.normal
  geometry.computeBoundingBox()
  const bbox = geometry.boundingBox
  if (!bbox) return false
  const size = new THREE.Vector3()
  bbox.getSize(size)
  const sx = size.x || 1
  const sy = size.y || 1
  const sz = size.z || 1
  const uvs = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const ax = Math.abs(norm.getX(i))
    const ay = Math.abs(norm.getY(i))
    const az = Math.abs(norm.getZ(i))
    let u
    let v
    if (ax >= ay && ax >= az) {
      u = (z - bbox.min.z) / sz
      v = (y - bbox.min.y) / sy
    } else if (ay >= ax && ay >= az) {
      u = (x - bbox.min.x) / sx
      v = (z - bbox.min.z) / sz
    } else {
      u = (x - bbox.min.x) / sx
      v = (y - bbox.min.y) / sy
    }
    uvs[i * 2] = THREE.MathUtils.clamp(u, 0, 1)
    uvs[i * 2 + 1] = THREE.MathUtils.clamp(v, 0, 1)
  }
  geometry.setAttribute('uv2', new THREE.BufferAttribute(uvs, 2))
  return true
}

function createAOMapTexture(pixels, size) {
  const data = new Uint8Array(size * size * 3)
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(THREE.MathUtils.clamp(pixels[i] ?? 1, 0, 1) * 255)
    data[i * 3] = v
    data[i * 3 + 1] = v
    data[i * 3 + 2] = v
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBFormat)
  tex.colorSpace = THREE.NoColorSpace
  tex.needsUpdate = true
  return tex
}

/** Re-apply AO Map Bake (UV2, approx) saved on the actor. */
function applyBakedAOMap(root, sa) {
  if (!sa.bakedAOMap || !sa.bakedAOMapMeshes?.length) return
  const meshes = []
  root.traverse((o) => { if (o.isMesh) meshes.push(o) })
  const size = sa.bakedAOMapSize ?? 256
  const intensity = sa.aoMapIntensity ?? 1
  sa.bakedAOMapMeshes.forEach((pixels, i) => {
    const mesh = meshes[i]
    if (!mesh || !pixels?.length) return
    if (!mesh.geometry.attributes.uv2) generateBoxProjectionUV2(mesh.geometry)
    const tex = createAOMapTexture(pixels, size)
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const mat of mats) {
      if (mat.isMeshStandardMaterial) {
        if (mat.aoMap) mat.aoMap.dispose()
        mat.aoMap = tex
        mat.aoMapIntensity = intensity
      }
    }
  })
}

const gltfAssets = {}
async function loadAssets(level) {
  const loader = new GLTFLoader()
  for (const [id, a] of Object.entries(level.assets ?? {})) {
    if (gltfAssets[id]) continue
    const bytes = Uint8Array.from(atob(a.data), (c) => c.charCodeAt(0))
    gltfAssets[id] = (await loader.parseAsync(bytes.buffer, '')).scene
  }
}

let particleGpuKernels = null

async function bindExportParticleCompute() {
  if (playRenderTier !== 'webgpu' || (LEVEL.environment?.particleBackend ?? 'cpu') !== 'gpu' || !renderer?.compute) return
  try {
    const webgpu = await import('three/webgpu')
    const tsl = await import('three/tsl')
    const { storage, Fn, float, instanceIndex, uniform, If, sin, cos, fract } = tsl
    const StorageBufferAttribute = webgpu.StorageBufferAttribute
    particleGpuKernels = []
    for (const ps of particleSystems) {
      if (!ps.aliveF) continue
      const cap = ps.cap
      const posAttr = new StorageBufferAttribute(ps.pos, 3)
      const velAttr = new StorageBufferAttribute(ps.vel, 3)
      const aliveAttr = new StorageBufferAttribute(ps.aliveF, 1)
      const posBuf = storage(posAttr, 'vec3', cap)
      const velBuf = storage(velAttr, 'vec3', cap)
      const aliveBuf = storage(aliveAttr, 'float', cap)
      const dtU = uniform(float(0))
      const gravityU = uniform(float(0))
      const dragU = uniform(float(0))
      const spawnProbU = uniform(float(0))
      const speedU = uniform(float(1))
      const seedU = uniform(float(0))
      const integrate = Fn(() => {
        const alive = aliveBuf.element(instanceIndex)
        If(alive.greaterThan(0.5), () => {
          const p = posBuf.element(instanceIndex)
          const v = velBuf.element(instanceIndex)
          const drag = float(1).sub(dragU.mul(dtU))
          v.y.addAssign(gravityU)
          v.x.mulAssign(drag)
          v.y.mulAssign(drag)
          v.z.mulAssign(drag)
          p.x.addAssign(v.x.mul(dtU))
          p.y.addAssign(v.y.mul(dtU))
          p.z.addAssign(v.z.mul(dtU))
        })
      }).compute(cap)
      let trailShift = null
      if (ps.trail && ps.trailLen >= 2) {
        const slots = cap * ps.trailLen
        const trailAttr = new StorageBufferAttribute(ps.trail, 3)
        const trailBuf = storage(trailAttr, 'vec3', slots)
        const lenF = float(ps.trailLen)
        trailShift = Fn(() => {
          const alive = aliveBuf.element(instanceIndex)
          If(alive.greaterThan(0.5), () => {
            const base = instanceIndex.mul(lenF)
            const p = posBuf.element(instanceIndex)
            for (let s = ps.trailLen - 1; s >= 1; s--) {
              const dst = trailBuf.element(base.add(float(s)))
              const src = trailBuf.element(base.add(float(s - 1)))
              dst.assign(src)
            }
            trailBuf.element(base).assign(p)
          })
        }).compute(cap)
      }
      const emit = Fn(() => {
        const alive = aliveBuf.element(instanceIndex)
        If(alive.lessThan(0.5), () => {
          const h = fract(sin(instanceIndex.add(seedU)).mul(43758.5453))
          If(h.lessThan(spawnProbU), () => {
            alive.assign(1)
            const p = posBuf.element(instanceIndex)
            const v = velBuf.element(instanceIndex)
            const a = h.mul(6.283)
            const sp = speedU.mul(float(0.5).add(h.mul(0.5)))
            p.x.assign(sin(a).mul(0.05))
            p.y.assign(0)
            p.z.assign(cos(a).mul(0.05))
            v.x.assign(sin(a).mul(sp))
            v.y.assign(sp.mul(0.6))
            v.z.assign(cos(a).mul(sp))
          })
        })
      }).compute(cap)
      particleGpuKernels.push({ ps, dtU, gravityU, dragU, spawnProbU, speedU, seedU, integrate, emit, trailShift, seed: 0 })
      ps.gpuTier = true
    }
  } catch (e) {
    console.warn('export particle GPU bind failed', e)
    particleGpuKernels = null
  }
}

// minimal particle sim (CPU + optional WebGPU compute tier + ribbon trails)
function makeParticles(props) {
  const cap = Math.min(props.maxParticles ?? 500, 3000)
  const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 3)
  const vel = new Float32Array(cap * 3), life = new Float32Array(cap), maxLife = new Float32Array(cap)
  const aliveF = new Float32Array(cap)
  const isRibbon = props.renderMode === 'ribbon'
  const trailLen = isRibbon ? Math.max(2, Math.min(props.ribbonSegments ?? 8, 16)) : 0
  const trail = isRibbon ? new Float32Array(cap * trailLen * 3) : null
  const c1 = new THREE.Color(props.colorStart), c2 = new THREE.Color(props.colorEnd), tmp = new THREE.Color()
  let display, geo
  if (isRibbon) {
    const maxVerts = cap * trailLen * 2
    geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3))
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3))
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(cap * (trailLen - 1) * 6), 1))
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.85, depthWrite: false,
      blending: props.additive ? THREE.AdditiveBlending : THREE.NormalBlending, side: THREE.DoubleSide,
    })
    display = new THREE.Mesh(geo, mat)
  } else {
    geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1000)
    const mat = new THREE.PointsMaterial({
      size: (props.sizeStart + props.sizeEnd) / 2, vertexColors: true, transparent: true, opacity: 0.9,
      depthWrite: false, blending: props.additive ? THREE.AdditiveBlending : THREE.NormalBlending, sizeAttenuation: true,
    })
    display = new THREE.Points(geo, mat)
  }
  display.frustumCulled = false
  let acc = 0
  function shiftTrail(i) {
    const tb = i * trailLen * 3
    for (let s = trailLen - 1; s > 0; s--) {
      const dst = tb + s * 3, src = tb + (s - 1) * 3
      trail[dst] = trail[src]; trail[dst + 1] = trail[src + 1]; trail[dst + 2] = trail[src + 2]
    }
    const i3 = i * 3
    trail[tb] = pos[i3]; trail[tb + 1] = pos[i3 + 1]; trail[tb + 2] = pos[i3 + 2]
  }
  function buildRibbon() {
    const posAttr = geo.attributes.position
    const colAttr = geo.attributes.color
    const idxAttr = geo.index
    const width = Math.max(0.02, props.ribbonWidth ?? 0.08)
    let v = 0, tri = 0
    const up = new THREE.Vector3(0, 1, 0), side = new THREE.Vector3(), wp = new THREE.Vector3(), wv = new THREE.Vector3()
    for (let i = 0; i < cap; i++) {
      if (life[i] <= 0) continue
      const f = 1 - life[i] / maxLife[i]
      tmp.copy(c1).lerp(c2, f)
      const tb = i * trailLen * 3
      for (let s = 0; s < trailLen; s++) {
        wp.set(trail[tb + s * 3], trail[tb + s * 3 + 1], trail[tb + s * 3 + 2])
        if (s < trailLen - 1) {
          wv.set(trail[tb + (s + 1) * 3] - wp.x, trail[tb + (s + 1) * 3 + 1] - wp.y, trail[tb + (s + 1) * 3 + 2] - wp.z)
        } else if (s > 0) {
          wv.set(wp.x - trail[tb + (s - 1) * 3], wp.y - trail[tb + (s - 1) * 3 + 1], wp.z - trail[tb + (s - 1) * 3 + 2])
        } else wv.set(0, 1, 0)
        if (wv.lengthSq() < 1e-8) wv.set(0, 1, 0)
        wv.normalize()
        side.crossVectors(wv, up)
        if (side.lengthSq() < 1e-8) side.set(1, 0, 0)
        side.normalize().multiplyScalar(width * 0.5 * (1 - s / Math.max(1, trailLen - 1) * 0.5))
        const fade = 1 - s / Math.max(1, trailLen - 1) * 0.85
        for (const sign of [-1, 1]) {
          posAttr.setXYZ(v, wp.x + side.x * sign, wp.y + side.y * sign, wp.z + side.z * sign)
          colAttr.setXYZ(v, tmp.r * fade, tmp.g * fade, tmp.b * fade)
          v++
        }
        if (s < trailLen - 1) {
          const base = v - 2
          idxAttr.setX(tri++, base); idxAttr.setX(tri++, base + 1); idxAttr.setX(tri++, base + 2)
          idxAttr.setX(tri++, base + 1); idxAttr.setX(tri++, base + 3); idxAttr.setX(tri++, base + 2)
        }
      }
    }
    posAttr.needsUpdate = true
    colAttr.needsUpdate = true
    idxAttr.needsUpdate = true
    geo.setDrawRange(0, tri)
  }
  const se = props.subEmitter
  const subOn = se?.enabled && !(props.modulesOff ?? []).includes('subEmitter')
  function spawnBurstAt(wx, wy, wz) {
    if (!subOn || !se) return
    const n = Math.max(1, Math.min(se.count ?? 8, 24))
    for (let k = 0; k < n; k++) {
      const i = life.findIndex((l) => l <= 0)
      if (i < 0) break
      maxLife[i] = Math.max(0.05, (se.lifetime ?? 0.4) * (0.7 + Math.random() * 0.6))
      life[i] = maxLife[i]
      const i3 = i * 3
      pos[i3] = wx; pos[i3 + 1] = wy; pos[i3 + 2] = wz
      const sp = (se.speed ?? 1.5) * (0.5 + Math.random())
      const a = Math.random() * Math.PI * 2
      const incl = Math.random() * Math.PI * 0.5
      vel[i3] = Math.cos(a) * Math.sin(incl) * sp
      vel[i3 + 1] = Math.cos(incl) * sp
      vel[i3 + 2] = Math.sin(a) * Math.sin(incl) * sp
      if (trail) {
        const tb = i * trailLen * 3
        for (let s = 0; s < trailLen; s++) {
          trail[tb + s * 3] = wx; trail[tb + s * 3 + 1] = wy; trail[tb + s * 3 + 2] = wz
        }
      }
    }
  }
  function spawn() {
    const i = life.findIndex((l) => l <= 0)
    if (i < 0) return
    maxLife[i] = Math.max(0.05, props.lifetime * (1 - (props.lifetimeJitter ?? 0.3) * Math.random()))
    life[i] = maxLife[i]
    const i3 = i * 3
    pos[i3] = pos[i3 + 1] = pos[i3 + 2] = 0
    const sp = props.speed * (1 - (props.speedJitter ?? 0.3) * Math.random())
    const a = THREE.MathUtils.degToRad(props.spreadDeg ?? 20) * Math.sqrt(Math.random())
    const t = Math.random() * Math.PI * 2
    vel[i3] = Math.sin(a) * Math.cos(t) * sp
    vel[i3 + 1] = Math.cos(a) * sp
    vel[i3 + 2] = Math.sin(a) * Math.sin(t) * sp
    if (trail) {
      const tb = i * trailLen * 3
      for (let s = 0; s < trailLen; s++) {
        trail[tb + s * 3] = pos[i3]; trail[tb + s * 3 + 1] = pos[i3 + 1]; trail[tb + s * 3 + 2] = pos[i3 + 2]
      }
    }
  }
  return {
    points: display,
    display,
    subEmitterOn: subOn,
    cap,
    pos,
    vel,
    life,
    aliveF,
    trail,
    trailLen,
    gpuTier: false,
    update(dt) {
      if (this.gpuTier && particleGpuKernels) {
        const k = particleGpuKernels.find((x) => x.ps === this)
        if (k) {
          const prob = Math.min(1, ((props.rate ?? 40) * dt) / cap)
          if (prob > 0) {
            k.spawnProbU.value = prob
            k.speedU.value = props.speed ?? 2.5
            k.seedU.value = k.seed++
            renderer.compute(k.emit)
            for (let i = 0; i < cap; i++) {
              if (aliveF[i] > 0.5 && life[i] <= 0) {
                life[i] = props.lifetime ?? 1.6
                maxLife[i] = life[i]
              }
            }
          }
          for (let i = 0; i < cap; i++) aliveF[i] = life[i] > 0 ? 1 : 0
          k.dtU.value = dt
          k.gravityU.value = (props.gravity ?? -1) * dt
          k.dragU.value = props.drag ?? 0.5
          renderer.compute(k.integrate)
          if (trail && k.trailShift) renderer.compute(k.trailShift)
          else if (trail) { for (let i = 0; i < cap; i++) if (life[i] > 0) shiftTrail(i) }
          if (!isRibbon) geo.attributes.position.needsUpdate = true
        }
      }
      if (!this.gpuTier) {
        acc += (props.rate ?? 40) * dt
        while (acc >= 1) { acc -= 1; spawn() }
      }
      const drag = Math.max(0, 1 - (props.drag ?? 0.5) * dt)
      for (let i = 0; i < cap; i++) {
        if (life[i] <= 0) continue
        life[i] -= dt
        const i3 = i * 3
        if (life[i] <= 0 && subOn && se.onDeath) spawnBurstAt(pos[i3], pos[i3 + 1], pos[i3 + 2])
        if (!this.gpuTier) {
          vel[i3 + 1] += (props.gravity ?? -1) * dt
          vel[i3] *= drag; vel[i3 + 1] *= drag; vel[i3 + 2] *= drag
          pos[i3] += vel[i3] * dt; pos[i3 + 1] += vel[i3 + 1] * dt; pos[i3 + 2] += vel[i3 + 2] * dt
          if (trail) shiftTrail(i)
        }
        const f = 1 - life[i] / maxLife[i]
        tmp.copy(c1).lerp(c2, f)
        if (!isRibbon) {
          col[i3] = tmp.r; col[i3 + 1] = tmp.g; col[i3 + 2] = tmp.b
          if (life[i] <= 0) pos[i3 + 1] = -9999
        } else if (life[i] <= 0) {
          pos[i3 + 1] = -9999
        }
      }
      if (isRibbon) buildRibbon()
      else {
        geo.attributes.position.needsUpdate = true
        geo.attributes.color.needsUpdate = true
      }
    },
  }
}

function instantiate(sa) {
  const root = new THREE.Group()
  root.position.fromArray(sa.transform.position)
  root.rotation.set(...sa.transform.rotation)
  root.scale.fromArray(sa.transform.scale)
  root.visible = sa.visible !== false
  const actor = {
    id: sa.id,
    name: sa.name,
    type: sa.type,
    tags: sa.tags ?? [],
    root,
    data: sa,
    mesh: null,
    autoload: (sa.tags ?? []).some((t) => String(t).toLowerCase() === 'autoload'),
  }

  if (sa.type === 'StaticMesh') {
    const mesh = new THREE.Mesh(buildGeometry(sa.geometry), buildMaterial(sa.material, !!sa.bakedAO))
    mesh.castShadow = sa.castShadow !== false
    mesh.receiveShadow = sa.receiveShadow !== false
    if (sa.geometry === 'plane') mesh.rotation.x = -Math.PI / 2
    actor.mesh = mesh
    root.add(mesh)
    applyBakedAO(root, sa)
    applyBakedAOMap(root, sa)
  } else if (sa.type === 'CustomMesh' && sa.customGeometry) {
    const g = sa.customGeometry
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.positions, 3))
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.normals, 3))
    if (g.index) geo.setIndex(g.index)
    const mesh = new THREE.Mesh(geo, buildMaterial(sa.material, !!sa.bakedAO))
    mesh.castShadow = sa.castShadow !== false
    mesh.receiveShadow = sa.receiveShadow !== false
    actor.mesh = mesh
    root.add(mesh)
    applyBakedAO(root, sa)
    applyBakedAOMap(root, sa)
  } else if (sa.type === 'ImportedMesh' && sa.assetId && gltfAssets[sa.assetId]) {
    const inst = gltfAssets[sa.assetId].clone(true)
    inst.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (!actor.mesh) actor.mesh = o } })
    root.add(inst)
    applyBakedAO(root, sa)
    applyBakedAOMap(root, sa)
  } else if (sa.type === 'DirectionalLight') {
    const l = new THREE.DirectionalLight(sa.light?.color ?? '#fff', sa.light?.intensity ?? 2)
    l.castShadow = true
    l.shadow.mapSize.set(2048, 2048)
    Object.assign(l.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30 })
    root.add(l)
  } else if (sa.type === 'PointLight') {
    root.add(new THREE.PointLight(sa.light?.color ?? '#fff', sa.light?.intensity ?? 10, sa.light?.distance ?? 0, sa.light?.decay ?? 2))
  } else if (sa.type === 'SpotLight') {
    const l = new THREE.SpotLight(sa.light?.color ?? '#fff', sa.light?.intensity ?? 20, sa.light?.distance ?? 0, sa.light?.angle ?? 0.5, sa.light?.penumbra ?? 0.3)
    l.target.position.set(0, -1, 0); root.add(l, l.target)
  } else if (sa.type === 'AmbientLight') {
    root.add(new THREE.AmbientLight(sa.light?.color ?? '#404a5a', sa.light?.intensity ?? 1))
  } else if (sa.type === 'ParticleEmitter' && sa.particles) {
    const ps = makeParticles(sa.particles)
    root.add(ps.points)
    particleSystems.push(ps)
  } else if (sa.type === 'FoliageLayer' && sa.foliage) {
    const f = sa.foliage
    const mesh = new THREE.InstancedMesh(buildGeometry(f.geometry), new THREE.MeshStandardMaterial({ color: f.color, roughness: 0.85 }), Math.max(1, f.instances.length))
    mesh.castShadow = true
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), sv = new THREE.Vector3()
    f.instances.forEach(([x, y, z, sc, ry], i) => {
      e.set(0, ry, 0); q.setFromEuler(e); v.set(x, y, z); sv.setScalar(sc)
      m4.compose(v, q, sv); mesh.setMatrixAt(i, m4)
    })
    mesh.count = f.instances.length
    root.add(mesh)
    actor.mesh = mesh
  } else if (sa.type === 'Widget3D' && sa.widget3D) {
    const W = sa.widget3D
    const wPx = Math.max(32, Math.round((W.width ?? 2) * 100))
    const hPx = Math.max(32, Math.round((W.height ?? 1) * 100))
    let html = W.html ?? '<div>Widget</div>'
    if (W.hudWidgetId && LEVEL.hud) {
      const hw = LEVEL.hud.find((h) => h.id === W.hudWidgetId)
      if (hw) {
        if (hw.type === 'text') html = `<div style="padding:8px 12px;background:#1a1d24aa;border-radius:6px;color:${hw.color};font:14px system-ui;">${hw.text}</div>`
        else if (hw.type === 'bar') {
          const pct = Math.round((hw.value ?? 1) * 100)
          html = `<div style="width:160px;background:#2a2f38;border-radius:6px;overflow:hidden;height:20px;"><div style="width:${pct}%;height:100%;background:${hw.color};"></div></div>`
        } else html = `<button style="padding:8px 16px;background:${hw.color};color:#fff;border:none;border-radius:6px;">${hw.text}</button>`
      }
    }
    const canvas = document.createElement('canvas')
    canvas.width = wPx
    canvas.height = hPx
    const ctx = canvas.getContext('2d')
    const svg = `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" width="${wPx}" height="${hPx}"><foreignObject width="100%" height="100%"><div xmlns="http://www.w3.org/1999/xhtml" style="width:${wPx}px;height:${hPx}px;overflow:hidden;">${html}</div></foreignObject></svg>`
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(W.width ?? 2, W.height ?? 1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: (W.opacity ?? 1) < 1, opacity: W.opacity ?? 1, side: THREE.DoubleSide, depthWrite: false }),
    )
    mesh.userData.isWidget3D = true
    actor.mesh = mesh
    root.add(mesh)
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
    const img = new Image()
    img.onload = () => { ctx.drawImage(img, 0, 0, wPx, hPx); tex.needsUpdate = true }
    img.onerror = () => {
      ctx.fillStyle = '#1a1d24'; ctx.fillRect(0, 0, wPx, hPx)
      ctx.fillStyle = '#e8eaed'; ctx.font = '14px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
      ctx.fillText('Widget3D', wPx / 2, hPx / 2); tex.needsUpdate = true
    }
    img.src = url
  } else if (sa.type === 'Label3D' && sa.label3D) {
    const L = sa.label3D
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const font = `600 ${L.fontSize}px system-ui, sans-serif`
    ctx.font = font
    const metrics = ctx.measureText(L.text || ' ')
    const pad = L.padding ?? 12
    canvas.width = Math.max(64, Math.ceil(metrics.width) + pad * 2)
    canvas.height = Math.max(32, L.fontSize + pad * 2)
    ctx.font = font
    if (L.background) { ctx.fillStyle = L.background; ctx.fillRect(0, 0, canvas.width, canvas.height) }
    ctx.fillStyle = L.color ?? '#fff'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText(L.text, canvas.width / 2, canvas.height / 2)
    const tex = new THREE.CanvasTexture(canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    const aspect = canvas.width / canvas.height
    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(aspect, 1),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    )
    mesh.userData.isLabel3D = true
    actor.mesh = mesh
    root.add(mesh)
  } else if (sa.type === 'Landscape' && sa.landscape) {
    const L = sa.landscape
    const geo = new THREE.PlaneGeometry(L.size, L.size, L.resolution, L.resolution)
    for (let i = 0; i < geo.attributes.position.count; i++) geo.attributes.position.setZ(i, L.heights[i] ?? 0)
    geo.computeVertexNormals()
    let mat
    if (L.weights && L.layerColors) {
      const cols = L.layerColors.map((c) => new THREE.Color(c))
      const vc = new Float32Array(geo.attributes.position.count * 3)
      for (let i = 0; i < geo.attributes.position.count; i++) {
        let r = 0, g = 0, b = 0
        for (let l = 0; l < 4; l++) { const w = L.weights[i * 4 + l] ?? 0; r += cols[l].r * w; g += cols[l].g * w; b += cols[l].b * w }
        vc[i * 3] = r; vc[i * 3 + 1] = g; vc[i * 3 + 2] = b
      }
      geo.setAttribute('color', new THREE.BufferAttribute(vc, 3))
      mat = new THREE.MeshStandardMaterial({ color: '#fff', roughness: 0.92, vertexColors: true })
    } else {
      mat = new THREE.MeshStandardMaterial({ color: L.color, roughness: 0.92 })
    }
    const mesh = new THREE.Mesh(geo, mat)
    mesh.rotation.x = -Math.PI / 2
    mesh.receiveShadow = true
    actor.mesh = mesh
    root.add(mesh)
    applyBakedAO(root, sa)
    applyBakedAOMap(root, sa)
  }
  scene.add(root)
  actors.set(sa.id, actor)
  return actor
}

function teardownActors() {
  for (const a of [...actors.values()]) {
    if (a.autoload) continue
    scene.remove(a.root)
    actors.delete(a.id)
  }
  particleSystems = []
  ticks = []
  bindings = []
  physWorld = null
}

function spawnActorsList(list) {
  for (const sa of list) instantiate(sa)
  for (const sa of list) {
    if (sa.parentId && actors.has(sa.parentId)) actors.get(sa.parentId).root.add(actors.get(sa.id).root)
  }
}

function spawnLevelActors(level) {
  spawnActorsList(level.actors)
}

function unloadCell(cx, cz) {
  const key = cellKey(cx, cz)
  const ids = cellActorIds.get(key)
  if (!ids) return
  for (const id of ids) {
    const a = actors.get(id)
    if (!a || a.autoload) continue
    scene.remove(a.root)
    actors.delete(id)
    ticks = ticks.filter(([act]) => act.id !== id)
    bindings = bindings.filter(([act]) => act.id !== id)
    particleSystems = particleSystems.filter((ps) => ps.points.parent !== a.root)
  }
  cellActorIds.delete(key)
  loadedCells.delete(key)
}

function loadCellActors(cx, cz) {
  if (!CELL_MANIFEST) return false
  const key = cellKey(cx, cz)
  if (loadedCells.has(key)) return true
  const list = CELL_MANIFEST[key]
  if (!list?.length) return false
  spawnActorsList(list)
  loadedCells.add(key)
  cellActorIds.set(key, list.map((sa) => sa.id))
  for (const sa of list) {
    const a = actors.get(sa.id)
    if (!a?.data.script) continue
    try {
      const vars = parseExportVars(a.data.script, a.data.scriptVars)
      const fn = new Function('actor', 'api', 'THREE', 'vars', `"use strict";\n${a.data.script}\nreturn { b: typeof onBeginPlay === 'function' ? onBeginPlay : null, t: typeof onTick === 'function' ? onTick : null }`)
      const h = fn(a, api, THREE, vars)
      if (h.b) h.b()
      if (h.t) ticks.push([a, h.t])
    } catch (e) { console.warn(a.name, 'script error', e) }
  }
  return true
}

function syncCellsAround(camPos) {
  if (!CELL_MANIFEST) return
  const cfg = streamSettings()
  if (!cfg.enabled) return
  const camCell = worldToCell(camPos.x, camPos.z, cfg.gridSize)
  const want = new Set()
  for (let dx = -cfg.loadRadius; dx <= cfg.loadRadius; dx++) {
    for (let dz = -cfg.loadRadius; dz <= cfg.loadRadius; dz++) {
      want.add(cellKey(camCell[0] + dx, camCell[1] + dz))
    }
  }
  let pending = 0
  if (STREAMING_ENABLED) {
    for (const key of want) {
      if (!loadedCells.has(key)) pending++
    }
    if (pending > 0) {
      beginStreamProgress(pending)
      updateStreamProgressBar()
    } else {
      hideStreamProgressBar()
    }
  }
  for (const key of want) {
    const p = key.split(',')
    const wasLoaded = loadedCells.has(key)
    loadCellActors(parseInt(p[0], 10), parseInt(p[1], 10))
    if (STREAMING_ENABLED && !wasLoaded) tickStreamProgressCell()
  }
  for (const key of [...loadedCells]) {
    if (!want.has(key)) {
      const p = key.split(',')
      unloadCell(parseInt(p[0], 10), parseInt(p[1], 10))
    }
  }
}

// ---- pawn ----
const pawnCam = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 5000)
let yaw = 0, pitch = 0
const euler = new THREE.Euler(0, 0, 0, 'YXZ')
const feet = new THREE.Vector3(0, 0, 8)
let vy = 0, grounded = false, pawnMode = 'fly'
const ray = new THREE.Raycaster()
function groundAt(p) {
  ray.set(new THREE.Vector3(p.x, p.y + 1.2, p.z), new THREE.Vector3(0, -1, 0))
  ray.far = 80
  const meshes = []
  for (const a of actors.values()) a.root.traverse((o) => { if (o.isMesh) meshes.push(o) })
  const hit = ray.intersectObjects(meshes, false)[0]
  return hit ? hit.point.y : null
}
addEventListener('mousemove', (e) => {
  if (!renderer?.domElement) return
  if (document.pointerLockElement !== renderer.domElement) return
  yaw -= e.movementX * 0.0023
  pitch = Math.max(-1.45, Math.min(1.45, pitch - e.movementY * 0.0023))
})
function bindPawnInput() {
  if (!renderer?.domElement) return
  renderer.domElement.addEventListener('click', () => renderer.domElement.requestPointerLock())
}

function resetPawnFromStart() {
  const start = LEVEL.actors.find((a) => a.type === 'PlayerStart')
  pawnMode = start?.pawnMode ?? 'fly'
  if (start) {
    feet.fromArray(start.transform.position)
    pawnCam.position.copy(feet).add(new THREE.Vector3(0, 1.65, 0))
    yaw = start.transform.rotation?.[1] ?? 0
    pitch = 0
  }
}

function updatePawn(dt) {
  const move = new THREE.Vector3()
  if (touchKeyDown('KeyW')) move.z -= 1
  if (touchKeyDown('KeyS')) move.z += 1
  if (touchKeyDown('KeyA')) move.x -= 1
  if (touchKeyDown('KeyD')) move.x += 1
  euler.set(pitch, yaw, 0)
  if (pawnMode === 'fly') {
    if (touchKeyDown('Space')) move.y += 1
    if (keys.has('KeyC')) move.y -= 1
    pawnCam.quaternion.setFromEuler(euler)
    if (move.lengthSq()) {
      move.normalize()
      const sp = keys.has('ShiftLeft') ? 18 : 6
      const fwd = new THREE.Vector3(); pawnCam.getWorldDirection(fwd)
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize()
      pawnCam.position.addScaledVector(fwd, -move.z * sp * dt)
      pawnCam.position.addScaledVector(right, move.x * sp * dt)
      pawnCam.position.y += move.y * sp * dt
    }
    return
  }
  const sp = (touchKeyDown('ShiftLeft') || keys.has('ShiftLeft') ? 9.5 : 5)
  if (move.lengthSq()) {
    move.normalize()
    const sin = Math.sin(yaw), cos = Math.cos(yaw)
    feet.x += (move.x * cos + move.z * sin) * sp * dt
    feet.z += (-move.x * sin + move.z * cos) * sp * dt
  }
  vy -= 22 * dt
  if (grounded && touchKeyDown('Space')) { vy = 8.5; grounded = false }
  feet.y += vy * dt
  const g = groundAt(feet)
  if (g !== null && feet.y <= g + 0.02 && vy <= 0) { feet.y = g; vy = 0; grounded = true } else grounded = false
  if (feet.y < -60) { feet.set(0, 2, 8); vy = 0 }
  if (pawnMode === 'thirdperson') {
    const head = feet.clone().add(new THREE.Vector3(0, 1.6, 0))
    const back = new THREE.Vector3(0, 0, 1).applyEuler(euler).multiplyScalar(4.5)
    pawnCam.position.copy(head).add(back)
    pawnCam.lookAt(head)
  } else {
    pawnCam.position.copy(feet).add(new THREE.Vector3(0, 1.65, 0))
    pawnCam.quaternion.setFromEuler(euler)
  }
}

// ---- physics (optional) ----
async function startPhysics() {
  try {
    const R = await import('@dimforge/rapier3d-compat')
    await R.init()
    physWorld = new R.World({ x: 0, y: -9.81, z: 0 })
    for (const a of actors.values()) {
      const p = a.data.physics
      if (!p || p.mode === 'none' || !a.mesh) continue
      const desc = p.mode === 'dynamic' ? R.RigidBodyDesc.dynamic().setAdditionalMass(p.mass ?? 1) : R.RigidBodyDesc.fixed()
      const wp = new THREE.Vector3(); a.root.getWorldPosition(wp)
      const wq = new THREE.Quaternion(); a.root.getWorldQuaternion(wq)
      desc.setTranslation(wp.x, wp.y, wp.z).setRotation({ x: wq.x, y: wq.y, z: wq.z, w: wq.w })
      const body = physWorld.createRigidBody(desc)
      let col
      const sc = new THREE.Vector3(); a.root.getWorldScale(sc)
      if (a.data.geometry === 'sphere') col = R.ColliderDesc.ball(0.5 * Math.max(sc.x, sc.y, sc.z))
      else if (a.data.geometry === 'plane') col = R.ColliderDesc.cuboid(0.5 * sc.x, 0.02, 0.5 * sc.z)
      else if (a.type === 'Landscape') {
        const geo = a.mesh.geometry
        const verts = new Float32Array(geo.attributes.position.array.length)
        const v = new THREE.Vector3()
        for (let i = 0; i < geo.attributes.position.count; i++) {
          v.fromBufferAttribute(geo.attributes.position, i); a.mesh.localToWorld(v)
          verts[i * 3] = v.x; verts[i * 3 + 1] = v.y; verts[i * 3 + 2] = v.z
        }
        col = R.ColliderDesc.trimesh(verts, new Uint32Array(geo.index.array))
        body.setTranslation({ x: 0, y: 0, z: 0 })
      } else {
        const box = new THREE.Box3().setFromObject(a.mesh)
        const size = new THREE.Vector3(); box.getSize(size)
        col = R.ColliderDesc.cuboid(Math.max(size.x, 0.1) / 2, Math.max(size.y, 0.1) / 2, Math.max(size.z, 0.1) / 2)
      }
      col.setFriction(p.friction ?? 0.5).setRestitution(p.restitution ?? 0.2)
      physWorld.createCollider(col, body)
      if (p.mode === 'dynamic') bindings.push([a, body])
    }
  } catch (e) {
    console.warn('physics unavailable:', e)
  }
}

// ---- audio (sequencer audio tracks) ----
let audioCtx = null
const soundBuffers = new Map()
/** @type {{ src: AudioBufferSourceNode, gain: GainNode, keys: object[] }[]} */
let seqAudioVoices = []
let seqAudioLastT = -1

async function loadSounds(level) {
  if (!level.sounds || !Object.keys(level.sounds).length) return
  if (!audioCtx) audioCtx = new AudioContext()
  if (audioCtx.state === 'suspended') void audioCtx.resume()
  for (const [name, b64] of Object.entries(level.sounds)) {
    if (soundBuffers.has(name)) continue
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    soundBuffers.set(name, await audioCtx.decodeAudioData(bytes.buffer))
  }
}

function stopSeqAudio() {
  for (const v of seqAudioVoices) {
    try { v.src.stop() } catch (_) { /* already stopped */ }
    v.src.disconnect()
    v.gain.disconnect()
  }
  seqAudioVoices = []
}

function sampleSeqValue(keys, t) {
  if (!keys.length) return null
  if (t <= keys[0].t) return keys[0].v
  if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i]
    const b = keys[i + 1]
    if (t >= a.t && t <= b.t) {
      const f = (b.t - a.t) ? (t - a.t) / (b.t - a.t) : 0
      if (typeof a.v === 'number' && typeof b.v === 'number') return a.v + (b.v - a.v) * f
      if (Array.isArray(a.v) && Array.isArray(b.v)) return a.v.map((av, j) => av + ((b.v[j] ?? av) - av) * f)
      return a.v
    }
  }
  return null
}

function startSeqAudioVoice(soundName, keys, t) {
  if (!audioCtx) return
  const buf = soundBuffers.get(soundName)
  if (!buf) return
  const startT = keys[0].t
  if (t < startT) return
  const offset = t - startT
  const vol = sampleSeqValue(keys, t)
  const volume = typeof vol === 'number' ? vol : 1
  const src = audioCtx.createBufferSource()
  const gain = audioCtx.createGain()
  src.buffer = buf
  src.loop = true
  gain.gain.value = volume
  src.connect(gain)
  gain.connect(audioCtx.destination)
  src.start(0, Math.min(offset, Math.max(0, buf.duration - 0.001)))
  seqAudioVoices.push({ src, gain, keys })
}

function updateSeqAudio(t) {
  if (!audioCtx) return
  const seq = LEVEL.sequence
  if (!seq) return
  const wrapped = seqAudioLastT > t
  if (wrapped || seqAudioVoices.length === 0) {
    stopSeqAudio()
    for (const tr of seq.tracks) {
      if (tr.trackType !== 'audio' || !tr.keys.length) continue
      startSeqAudioVoice(tr.actorId, tr.keys, t)
    }
  } else {
    for (const v of seqAudioVoices) {
      const vol = sampleSeqValue(v.keys, t)
      v.gain.gain.value = typeof vol === 'number' ? vol : 1
    }
  }
  seqAudioLastT = t
}

// ---- Wave 80 — pause save menu overlay (mirrors exportSaveMenu.ts) ----
const SAVE_MENU_SLOTS = ['slot1', 'slot2', 'slot3']
let saveMenuPaused = false
let saveMenuRoot = null

function exportCheckpointPayload() {
  return {
    playTime: clock,
    pawn:
      pawnMode === 'fly'
        ? [pawnCam.position.x, pawnCam.position.y, pawnCam.position.z]
        : [feet.x, feet.y, feet.z],
    quests: exportSerializeQuestState(),
  }
}

function applyExportCheckpoint(data) {
  if (!data || typeof data !== 'object') return
  const pawn = data.pawn
  if (Array.isArray(pawn) && pawn.length >= 3) {
    if (pawnMode === 'fly') pawnCam.position.set(pawn[0], pawn[1], pawn[2])
    else feet.set(pawn[0], pawn[1], pawn[2])
  }
  if (typeof data.playTime === 'number') clock = data.playTime
  if (data.quests !== undefined) exportRestoreQuestState(data.quests)
}

function refreshExportSaveMenuHints() {
  if (!saveMenuRoot) return
  const filled = new Set(exportListSaveSlots())
  for (const slot of SAVE_MENU_SLOTS) {
    const hint = saveMenuRoot.querySelector(`[data-slot-hint="${slot}"]`)
    const loadBtn = saveMenuRoot.querySelector(`[data-slot-load="${slot}"]`)
    const has = filled.has(slot)
    if (hint) hint.textContent = has ? 'Saved data available' : 'Empty'
    if (loadBtn) loadBtn.disabled = !has
  }
}

function showExportSaveMenu() {
  if (!SAVE_MENU_ENABLED || !saveMenuRoot) return
  saveMenuRoot.style.display = 'flex'
  saveMenuPaused = true
  refreshExportSaveMenuHints()
  if (document.pointerLockElement) void document.exitPointerLock()
}

function hideExportSaveMenu() {
  if (saveMenuRoot) saveMenuRoot.style.display = 'none'
  saveMenuPaused = false
}

function toggleExportSaveMenu() {
  if (saveMenuPaused) hideExportSaveMenu()
  else showExportSaveMenu()
}

function initExportSaveMenu() {
  if (!SAVE_MENU_ENABLED) return
  const rows = SAVE_MENU_SLOTS.map((slot) => {
    const n = slot.replace(/^slot/, '')
    return `<div class="lotus-save-menu-row">
      <span class="lotus-save-menu-slot-label">Save Slot ${n}</span>
      <button type="button" class="lotus-save-menu-btn lotus-save-menu-btn-save" data-slot-save="${slot}">Save</button>
      <button type="button" class="lotus-save-menu-btn lotus-save-menu-btn-load" data-slot-load="${slot}" disabled>Load</button>
      <div class="lotus-save-menu-slot-hint" data-slot-hint="${slot}">Empty</div>
    </div>`
  }).join('')
  saveMenuRoot = document.createElement('div')
  saveMenuRoot.id = 'lotus-save-menu'
  saveMenuRoot.className = 'lotus-save-menu-overlay'
  saveMenuRoot.setAttribute('role', 'dialog')
  saveMenuRoot.setAttribute('aria-label', 'Pause — Save / Load')
  const cloudSyncBlock = CLOUD_SYNC_ENABLED
    ? `<div class="lotus-save-menu-cloud" data-lotus-cloud-sync-menu>
      <div class="lotus-save-menu-cloud-hint">Cross-device stub — download/import JSON or copy manifest token for QR / another browser</div>
      <div class="lotus-save-menu-cloud-transfer">
        <button type="button" class="lotus-save-menu-cloud-export" data-lotus-cloud-export>Download cloud saves JSON</button>
        <label class="lotus-save-menu-cloud-import" data-lotus-cloud-import-label>
          <input type="file" accept=".json,application/json" data-lotus-cloud-import />
          Import cloud saves JSON
        </label>
      </div>
      <button type="button" class="lotus-save-menu-cloud-copy" data-copy-cloud-manifest>Copy cloud save manifest</button>
    </div>`
    : ''
  saveMenuRoot.innerHTML = `<div class="lotus-save-menu-panel">
    <div class="lotus-save-menu-title">PAUSED</div>
    <div class="lotus-save-menu-sub">Escape to resume · Save or load a checkpoint</div>
    ${rows}
    ${cloudSyncBlock}
    <button type="button" class="lotus-save-menu-resume" data-save-menu-resume>Resume</button>
  </div>`
  document.body.appendChild(saveMenuRoot)
  for (const slot of SAVE_MENU_SLOTS) {
    saveMenuRoot.querySelector(`[data-slot-save="${slot}"]`)?.addEventListener('click', (e) => {
      e.preventDefault()
      exportSaveCheckpoint(slot, exportCheckpointPayload())
      refreshExportSaveMenuHints()
    })
    saveMenuRoot.querySelector(`[data-slot-load="${slot}"]`)?.addEventListener('click', (e) => {
      e.preventDefault()
      const data = exportLoadCheckpoint(slot)
      if (data == null) return
      applyExportCheckpoint(data)
      hideExportSaveMenu()
    })
  }
  saveMenuRoot.querySelector('[data-save-menu-resume]')?.addEventListener('click', (e) => {
    e.preventDefault()
    hideExportSaveMenu()
  })
  saveMenuRoot.querySelector('[data-copy-cloud-manifest]')?.addEventListener('click', (e) => {
    e.preventDefault()
    void exportCloudSaveManifest().then((m) => {
      const hint = m?.crossDeviceHint
      if (!hint) return
      void navigator.clipboard?.writeText(hint).catch(() => {})
    })
  })
  saveMenuRoot.querySelector('[data-lotus-cloud-export]')?.addEventListener('click', (e) => {
    e.preventDefault()
    void downloadExportCloudSaveJson()
  })
  saveMenuRoot.querySelector('[data-lotus-cloud-import]')?.addEventListener('change', (e) => {
    const input = e.currentTarget
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    void file.text().then((text) => importExportCloudSaveJson(text)).catch(() => {})
  })
  addEventListener('keydown', (e) => {
    if (!SAVES_ENABLED || !SAVE_MENU_ENABLED) return
    if (e.code !== 'Escape') return
    e.preventDefault()
    toggleExportSaveMenu()
  })
}

// ---- Wave 65 — localStorage save slots (mirrors saveSystem.ts) ----
const SAVE_STORAGE_PREFIX = 'lotus-engine.saves'
let saveLevelName = LEVEL?.name ?? 'Untitled'

function sanitizeSaveLevelName(name) {
  const t = String(name ?? '').trim() || 'Untitled'
  return t.replace(/[^\w.-]+/g, '_').slice(0, 64)
}

function sanitizeSaveSlot(slot) {
  const t = String(slot ?? '').trim()
  if (!t) return 'slot0'
  return t.replace(/[^\w.-]+/g, '_').slice(0, 32)
}

function globalSaveStorageKey(slot) {
  return `${SAVE_STORAGE_PREFIX}.${GLOBAL_SAVE_LEVEL_KEY}.${sanitizeSaveSlot(slot)}`
}

function saveStorageKey(slot) {
  if (CROSS_LEVEL_SAVES_ENABLED) return globalSaveStorageKey(slot)
  return `${SAVE_STORAGE_PREFIX}.${sanitizeSaveLevelName(saveLevelName)}.${sanitizeSaveSlot(slot)}`
}

function exportMigrateToLevel(newLevelName) {
  const fromLevel = sanitizeSaveLevelName(saveLevelName)
  let migrated = 0
  if (SAVES_ENABLED && CROSS_LEVEL_SAVES_ENABLED) {
    const fromPrefix = `${SAVE_STORAGE_PREFIX}.${fromLevel}.`
    try {
      const slots = []
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i)
        if (!key?.startsWith(fromPrefix)) continue
        const slot = key.slice(fromPrefix.length)
        if (slot) slots.push(slot)
      }
      for (const slot of slots) {
        const globalKey = globalSaveStorageKey(slot)
        if (localStorage.getItem(globalKey)) continue
        const raw = localStorage.getItem(`${fromPrefix}${slot}`)
        if (!raw) continue
        localStorage.setItem(globalKey, raw)
        migrated++
      }
    } catch {
      /* ignore */
    }
  }
  saveLevelName = newLevelName
  return migrated
}

function exportSaveCheckpoint(slot, data) {
  if (!SAVES_ENABLED) return false
  try {
    const payload = {
      savedAt: Date.now(),
      level: CROSS_LEVEL_SAVES_ENABLED ? GLOBAL_SAVE_LEVEL_KEY : sanitizeSaveLevelName(saveLevelName),
      slot: sanitizeSaveSlot(slot),
      data,
    }
    localStorage.setItem(saveStorageKey(slot), JSON.stringify(payload))
    if (CLOUD_SAVES_ENABLED) void exportBackupToCloud(slot, data).catch(() => {})
    return true
  } catch {
    return false
  }
}

function exportLoadCheckpoint(slot) {
  if (!SAVES_ENABLED) return null
  try {
    const raw = localStorage.getItem(saveStorageKey(slot))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.data ?? null
  } catch {
    return null
  }
}

function exportListSaveSlots() {
  if (!SAVES_ENABLED) return []
  const prefix = CROSS_LEVEL_SAVES_ENABLED
    ? `${SAVE_STORAGE_PREFIX}.${GLOBAL_SAVE_LEVEL_KEY}.`
    : `${SAVE_STORAGE_PREFIX}.${sanitizeSaveLevelName(saveLevelName)}.`
  const out = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key?.startsWith(prefix)) continue
      const slot = key.slice(prefix.length)
      if (slot) out.push(slot)
    }
  } catch {
    return []
  }
  return out.sort()
}

// ---- Wave 70 — IndexedDB cloud backup (mirrors cloudSaveStub.ts) ----
const CLOUD_DB_NAME = 'lotus-engine-cloud-saves-v1'
const CLOUD_STORE = 'checkpoints'
const CLOUD_KEY_PREFIX = 'lotus-engine.cloud'
let cloudDbPromise = null

function cloudSaveKey(slot) {
  const levelKey = CROSS_LEVEL_SAVES_ENABLED ? GLOBAL_SAVE_LEVEL_KEY : sanitizeSaveLevelName(saveLevelName)
  return `${CLOUD_KEY_PREFIX}.${levelKey}.${sanitizeSaveSlot(slot)}`
}

function cloudLevelPrefix() {
  const levelKey = CROSS_LEVEL_SAVES_ENABLED ? GLOBAL_SAVE_LEVEL_KEY : sanitizeSaveLevelName(saveLevelName)
  return `${CLOUD_KEY_PREFIX}.${levelKey}.`
}

function openCloudDb() {
  if (!cloudDbPromise) {
    cloudDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(CLOUD_DB_NAME, 1)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(CLOUD_STORE)) db.createObjectStore(CLOUD_STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'))
    })
  }
  return cloudDbPromise
}

async function exportBackupToCloud(slot, data) {
  if (!CLOUD_SAVES_ENABLED) return false
  try {
    const db = await openCloudDb()
    const payload = {
      savedAt: Date.now(),
      level: sanitizeSaveLevelName(saveLevelName),
      slot: sanitizeSaveSlot(slot),
      data,
    }
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CLOUD_STORE, 'readwrite')
      tx.objectStore(CLOUD_STORE).put(payload, cloudSaveKey(slot))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IDB put failed'))
    })
    return true
  } catch {
    return false
  }
}

async function exportRestoreFromCloud(slot) {
  if (!CLOUD_SAVES_ENABLED) return null
  try {
    const db = await openCloudDb()
    const row = await new Promise((resolve, reject) => {
      const tx = db.transaction(CLOUD_STORE, 'readonly')
      const req = tx.objectStore(CLOUD_STORE).get(cloudSaveKey(slot))
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error ?? new Error('IDB get failed'))
    })
    return row?.data ?? null
  } catch {
    return null
  }
}

async function exportListCloudSlots() {
  if (!CLOUD_SAVES_ENABLED) return []
  const prefix = cloudLevelPrefix()
  try {
    const db = await openCloudDb()
    const keys = await new Promise((resolve, reject) => {
      const tx = db.transaction(CLOUD_STORE, 'readonly')
      const req = tx.objectStore(CLOUD_STORE).getAllKeys()
      req.onsuccess = () => resolve(req.result ?? [])
      req.onerror = () => reject(req.error ?? new Error('IDB list failed'))
    })
    const out = []
    for (const key of keys) {
      const k = String(key)
      if (!k.startsWith(prefix)) continue
      const slot = k.slice(prefix.length)
      if (slot) out.push(slot)
    }
    return out.sort()
  } catch {
    return []
  }
}

// ---- Wave 84 — cloud save manifest + cross-device hint (mirrors cloudSaveSync.ts) ----
function exportCloudSyncLevelKey() {
  return CROSS_LEVEL_SAVES_ENABLED ? GLOBAL_SAVE_LEVEL_KEY : sanitizeSaveLevelName(saveLevelName)
}

function buildExportCrossDeviceHint(level, slots) {
  const token = `LOTUS-CLOUD-SYNC:v1|${level}|${(slots ?? [])
    .map((s) => `${s.slot}@${s.savedAt}`)
    .join(',')}`
  return `Cross-device stub — copy this token to another browser (same level) or encode as QR: ${token}`
}

async function exportListCloudManifest() {
  if (!CLOUD_SYNC_ENABLED) return []
  const level = exportCloudSyncLevelKey()
  try {
    const db = await openCloudDb()
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(CLOUD_STORE, 'readonly')
      const req = tx.objectStore(CLOUD_STORE).getAll()
      req.onsuccess = () => resolve(req.result ?? [])
      req.onerror = () => reject(req.error ?? new Error('IDB getAll failed'))
    })
    return rows
      .filter((r) => r?.level === level && r?.slot)
      .map((r) => ({ slot: String(r.slot), savedAt: r.savedAt ?? 0 }))
      .sort((a, b) => a.slot.localeCompare(b.slot))
  } catch {
    return []
  }
}

async function exportCloudSaveManifest() {
  if (!CLOUD_SYNC_ENABLED) return null
  const level = exportCloudSyncLevelKey()
  const slots = await exportListCloudManifest()
  return {
    version: 1,
    level,
    generatedAt: Date.now(),
    slots,
    crossDeviceHint: buildExportCrossDeviceHint(level, slots),
  }
}

// ---- Wave 89 — cloud save JSON import/export (mirrors cloudSaveSync.ts) ----
const CLOUD_SAVE_JSON_VERSION = 2

function validateExportCloudSaveJson(json) {
  let doc = json
  if (typeof json === 'string') {
    try {
      doc = JSON.parse(json)
    } catch {
      throw new Error('Invalid JSON')
    }
  }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('Cloud save JSON must be an object')
  }
  if (doc.version !== CLOUD_SAVE_JSON_VERSION) {
    throw new Error(`Unsupported cloud save JSON version (expected ${CLOUD_SAVE_JSON_VERSION})`)
  }
  const level = String(doc.level ?? '').trim()
  if (!level) throw new Error('Cloud save JSON missing level')
  if (!Array.isArray(doc.entries)) throw new Error('Cloud save JSON missing entries array')
  const entries = []
  for (const row of doc.entries) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw new Error('Cloud save entry must be an object')
    }
    const slot = String(row.slot ?? '').trim()
    if (!slot) throw new Error('Cloud save entry missing slot')
    const savedAt = Number(row.savedAt)
    if (!Number.isFinite(savedAt)) throw new Error(`Cloud save entry "${slot}" missing savedAt`)
    if (!('data' in row)) throw new Error(`Cloud save entry "${slot}" missing data`)
    entries.push({ slot, savedAt, data: row.data })
  }
  const slots = entries.map((e) => ({ slot: e.slot, savedAt: e.savedAt }))
  return {
    version: CLOUD_SAVE_JSON_VERSION,
    level,
    generatedAt: Number.isFinite(Number(doc.generatedAt)) ? Number(doc.generatedAt) : Date.now(),
    entries,
    crossDeviceHint:
      typeof doc.crossDeviceHint === 'string'
        ? doc.crossDeviceHint
        : buildExportCrossDeviceHint(level, slots),
  }
}

async function exportListCloudCheckpointEntries() {
  if (!CLOUD_SYNC_ENABLED) return []
  const level = exportCloudSyncLevelKey()
  try {
    const db = await openCloudDb()
    const rows = await new Promise((resolve, reject) => {
      const tx = db.transaction(CLOUD_STORE, 'readonly')
      const req = tx.objectStore(CLOUD_STORE).getAll()
      req.onsuccess = () => resolve(req.result ?? [])
      req.onerror = () => reject(req.error ?? new Error('IDB getAll failed'))
    })
    return rows
      .filter((r) => r?.level === level && r?.slot && r?.data !== undefined)
      .map((r) => ({ slot: String(r.slot), savedAt: r.savedAt ?? 0, data: r.data }))
      .sort((a, b) => a.slot.localeCompare(b.slot))
  } catch {
    return []
  }
}

async function putExportCloudCheckpoint(entry) {
  if (!CLOUD_SAVES_ENABLED) return false
  try {
    const db = await openCloudDb()
    const payload = {
      savedAt: entry.savedAt,
      level: exportCloudSyncLevelKey(),
      slot: sanitizeSaveSlot(entry.slot),
      data: entry.data,
    }
    await new Promise((resolve, reject) => {
      const tx = db.transaction(CLOUD_STORE, 'readwrite')
      tx.objectStore(CLOUD_STORE).put(payload, cloudSaveKey(entry.slot))
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error ?? new Error('IDB put failed'))
    })
    return true
  } catch {
    return false
  }
}

async function mergeExportCloudCheckpoints(entries) {
  let merged = 0
  let skipped = 0
  for (const entry of entries ?? []) {
    if (!entry?.slot || entry.data === undefined) {
      skipped++
      continue
    }
    const ok = await putExportCloudCheckpoint(entry)
    if (ok) merged++
    else skipped++
  }
  return { merged, skipped }
}

async function exportCloudSaveJson() {
  if (!CLOUD_SYNC_ENABLED) return null
  const level = exportCloudSyncLevelKey()
  const entries = await exportListCloudCheckpointEntries()
  const slots = entries.map((e) => ({ slot: e.slot, savedAt: e.savedAt }))
  return {
    version: CLOUD_SAVE_JSON_VERSION,
    level,
    generatedAt: Date.now(),
    entries,
    crossDeviceHint: buildExportCrossDeviceHint(level, slots),
  }
}

async function importExportCloudSaveJson(json) {
  if (!CLOUD_SYNC_ENABLED) throw new Error('Cloud sync disabled')
  const doc = validateExportCloudSaveJson(json)
  const active = exportCloudSyncLevelKey()
  const incoming = sanitizeSaveLevelName(doc.level)
  if (incoming !== active) {
    throw new Error(`Level mismatch: export is "${doc.level}", active is "${saveLevelName}"`)
  }
  const { merged, skipped } = await mergeExportCloudCheckpoints(doc.entries)
  return { merged, skipped, level: doc.level }
}

async function downloadExportCloudSaveJson() {
  const doc = await exportCloudSaveJson()
  if (!doc) return null
  const name = `lotus-cloud-saves-${sanitizeSaveLevelName(doc.level) || 'untitled'}.json`
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  anchor.click()
  URL.revokeObjectURL(url)
  return doc
}

// ---- Wave 94 — RPG quest log lite (mirrors rpgQuests.ts) ----
const EXPORT_QUEST_DEFS = {
  find_herbs: {
    id: 'find_herbs',
    title: 'Find Herbs',
    objectives: [{ id: 'collect_herbs', description: 'Collect 3 herbs', count: 3, target: 'Herb' }],
  },
}
const exportQuestRuntime = new Map()
let exportQuestTrackerEl = null

function exportFindQuestDef(id) {
  return EXPORT_QUEST_DEFS[id] ?? null
}

function exportEnrichQuest(runtime) {
  const def = exportFindQuestDef(runtime.id)
  if (!def) return null
  return {
    ...runtime,
    title: def.title,
    objectives: runtime.objectives.map((o) => {
      const od = def.objectives.find((d) => d.id === o.id)
      return { ...o, description: od?.description ?? o.id, target: od?.target ?? '' }
    }),
  }
}

function exportSerializeQuestState() {
  const quests = {}
  for (const [id, runtime] of exportQuestRuntime) quests[id] = { ...runtime, objectives: runtime.objectives.map((o) => ({ ...o })) }
  return { version: 1, quests }
}

function exportRestoreQuestState(data) {
  if (!data || typeof data !== 'object' || !data.quests) return false
  exportQuestRuntime.clear()
  for (const [id, runtime] of Object.entries(data.quests)) {
    const def = exportFindQuestDef(id)
    if (!def || !runtime) continue
    exportQuestRuntime.set(id, {
      id,
      state: runtime.state,
      objectives: def.objectives.map((o) => {
        const prev = runtime.objectives?.find((p) => p.id === o.id)
        const current = Math.max(0, Math.min(Math.floor(prev?.current ?? 0), o.count))
        return { id: o.id, current, count: o.count }
      }),
    })
  }
  return true
}

function exportStartQuest(id) {
  const def = exportFindQuestDef(id)
  if (!def) return false
  const existing = exportQuestRuntime.get(id)
  if (existing?.state === 'active' || existing?.state === 'completed') return false
  exportQuestRuntime.set(id, {
    id,
    state: 'active',
    objectives: def.objectives.map((o) => ({ id: o.id, current: 0, count: o.count })),
  })
  return true
}

function exportUpdateQuestObjective(questId, objectiveId, current) {
  const runtime = exportQuestRuntime.get(questId)
  if (!runtime || runtime.state !== 'active') return false
  const obj = runtime.objectives.find((o) => o.id === objectiveId)
  if (!obj) return false
  obj.current = Math.max(0, Math.min(Math.floor(current), obj.count))
  if (runtime.objectives.every((o) => o.current >= o.count)) runtime.state = 'completed'
  return true
}

function exportCompleteQuest(id) {
  const runtime = exportQuestRuntime.get(id)
  if (!runtime || runtime.state !== 'active') return false
  for (const o of runtime.objectives) o.current = o.count
  runtime.state = 'completed'
  return true
}

function exportGetQuestState(id) {
  const runtime = exportQuestRuntime.get(id)
  return runtime ? exportEnrichQuest(runtime) : null
}

function exportEmitQuestSignal(questId, signal) {
  const view = exportGetQuestState(questId)
  if (!view) return
  for (const h of signalHandlers.get(signal) ?? []) {
    try { h(view) } catch (e) { console.warn('signal', signal, e) }
  }
}

function showExportQuestTracker(quest) {
  const obj = quest?.objectives?.[0]
  if (!obj) {
    exportQuestTrackerEl?.remove()
    exportQuestTrackerEl = null
    return
  }
  const pct = obj.count > 0 ? Math.round((obj.current / obj.count) * 100) : 0
  exportQuestTrackerEl?.remove()
  exportQuestTrackerEl = document.createElement('div')
  exportQuestTrackerEl.id = 'lotus-rpg-quest-tracker'
  exportQuestTrackerEl.className = 'lotus-rpg-quest-tracker'
  exportQuestTrackerEl.innerHTML = `<div class="lotus-rpg-quest-title">📜 ${quest.title}</div>
    <div class="lotus-rpg-quest-objective">${obj.description}</div>
    <div class="lotus-rpg-quest-progress">${obj.current} / ${obj.count}</div>
    <div class="lotus-rpg-quest-bar"><div class="lotus-rpg-quest-bar-fill" style="width:${pct}%"></div></div>`
  document.body.appendChild(exportQuestTrackerEl)
}

function wireExportQuestHud() {
  if (!signalHandlers.has('quest_started')) signalHandlers.set('quest_started', [])
  if (!signalHandlers.has('quest_updated')) signalHandlers.set('quest_updated', [])
  if (!signalHandlers.has('quest_completed')) signalHandlers.set('quest_completed', [])
  signalHandlers.get('quest_started').push((q) => showExportQuestTracker(q))
  signalHandlers.get('quest_updated').push((q) => showExportQuestTracker(q))
  signalHandlers.get('quest_completed').push(() => {
    exportQuestTrackerEl?.remove()
    exportQuestTrackerEl = null
  })
}

// ---- scripts & behaviors ----
const api = {
  log: (...a) => console.log('[lotus]', ...a),
  isKeyDown: (c) => touchKeyDown(c),
  keyJustPressed: (c) => pressed.has(c),
  actionJustPressed: (name) => {
    if (name === 'Fire') return pressed.has('KeyF')
    if (name === 'Interact') return pressed.has('KeyE')
    if (name === 'Jump') return pressed.has('Space')
    return false
  },
  getActor: (n) => [...actors.values()].find((a) => a.name === n),
  getActorsByTag: (tag) => {
    const q = String(tag).toLowerCase()
    return [...actors.values()].filter((a) =>
      (a.data.tags ?? []).some((t) => {
        const tl = String(t).toLowerCase()
        return tl === q || tl.startsWith(q + '.')
      }),
    )
  },
  emit: (signal, ...args) => {
    for (const h of signalHandlers.get(signal) ?? []) {
      try { h(...args) } catch (e) { console.warn('signal', signal, e) }
    }
  },
  on: (signal, handler) => {
    if (!signalHandlers.has(signal)) signalHandlers.set(signal, [])
    signalHandlers.get(signal).push(handler)
  },
  setTimer: (seconds, fn, loop) => {
    scriptTimers.push({ at: Math.max(0, seconds), fn, loop: loop ? Math.max(0, seconds) : null })
  },
  raycast: (origin, dir, maxDist) => raycastActors(origin, dir, maxDist),
  time: () => clock,
  pawnPosition: () => (pawnMode === 'fly' ? pawnCam.position : feet),
  async loadCell(cx, cz) {
    const ok = loadCellActors(cx, cz)
    if (!ok) api.log('loadCell: empty or missing', cx, cz)
    else api.log('loadCell:', cx, cz)
    return ok
  },
  async loadLevel(name) {
    if (loadingLevel) return false
    const key = String(name).trim().toLowerCase()
    const resolved = LEVELS[key] ?? LEVELS[name] ?? (key === 'main' ? LEVELS[MAIN_KEY] : null)
    if (!resolved) {
      api.log('loadLevel: unknown level', name)
      return false
    }
    await sceneTransitionOut('fade', SCENE_TRANSITION_MS)
    loadingLevel = true
    try {
      const ok = await loadLevelCore(name)
      await sceneTransitionIn('fade', SCENE_TRANSITION_MS)
      return ok
    } finally {
      loadingLevel = false
    }
  },
  changeScene: (name) => api.loadLevel(name),
  saveGame: (slot, data) => {
    if (!SAVES_ENABLED) return false
    const base =
      data !== undefined
        ? (typeof data === 'object' && data !== null ? data : { data })
        : {
            playTime: clock,
            pawn: pawnMode === 'fly' ? [pawnCam.position.x, pawnCam.position.y, pawnCam.position.z] : [feet.x, feet.y, feet.z],
          }
    const payload = { ...base, quests: exportSerializeQuestState() }
    return exportSaveCheckpoint(slot, payload)
  },
  loadGame: (slot) => {
    const row = exportLoadCheckpoint(slot)
    if (row?.quests !== undefined) exportRestoreQuestState(row.quests)
    return row
  },
  listSaveSlots: () => exportListSaveSlots(),
  unlockAchievement: (id) => exportUnlockAchievement(id),
  setAchievementProgress: (id, current, max) => exportSetAchievementProgress(id, current, max),
  getAchievementProgress: (id) => exportGetAchievementProgress(id),
  startQuest: (id) => {
    const ok = exportStartQuest(id)
    if (ok) exportEmitQuestSignal(id, 'quest_started')
    return ok
  },
  updateQuestObjective: (questId, objectiveId, current) => {
    const before = exportGetQuestState(questId)
    const ok = exportUpdateQuestObjective(questId, objectiveId, current)
    if (!ok) return false
    const after = exportGetQuestState(questId)
    if (after?.state === 'completed') exportEmitQuestSignal(questId, 'quest_completed')
    else if (before?.state === 'active') exportEmitQuestSignal(questId, 'quest_updated')
    return true
  },
  completeQuest: (id) => {
    const ok = exportCompleteQuest(id)
    if (ok) exportEmitQuestSignal(id, 'quest_completed')
    return ok
  },
  getQuestState: (id) => exportGetQuestState(id),
  addItem: (itemId, quantity) => exportAddItem(itemId, quantity),
  removeItem: (itemId, quantity) => exportRemoveItem(itemId, quantity),
  hasItem: (itemId) => exportHasItem(itemId),
  getItemCount: (itemId) => exportGetItemCount(itemId),
  getGold: () => exportGetGold(),
  addGold: (amount) => exportAddGold(amount),
}
function compileScripts() {
  ticks = []
  scriptTimers = []
  triggerState.clear()
  exportQuestRuntime.clear()
  resetSignals()
  wireExportQuestHud()
  if (MINIGAME_ENABLED) wireExportMiniGameHud()
  if (RPG_HUD_ENABLED || RPG_3D_ENABLED) wireExportRpg3dHud()
  for (const a of actors.values()) {
    const src = a.data.script
    if (!src) continue
    try {
      const vars = parseExportVars(src, a.data.scriptVars)
      const fn = new Function('actor', 'api', 'THREE', 'vars', `"use strict";\n${src}\nreturn { b: typeof onBeginPlay === 'function' ? onBeginPlay : null, t: typeof onTick === 'function' ? onTick : null }`)
      const h = fn(a, api, THREE, vars)
      if (h.b) h.b()
      if (h.t) ticks.push([a, h.t])
    } catch (e) { console.warn(a.name, 'script error', e) }
  }
}

/** Wave 55 — DOM scene transition overlay (mirrors editor/sceneTransitions.ts). */
const SCENE_TRANSITION_MS = 400
const SCENE_TRANSITION_OVERLAY_ID = 'lotus-scene-transition'

function ensureSceneTransitionOverlay() {
  let el = document.getElementById(SCENE_TRANSITION_OVERLAY_ID)
  if (!el) {
    el = document.createElement('div')
    el.id = SCENE_TRANSITION_OVERLAY_ID
    el.setAttribute('aria-hidden', 'true')
    document.body.appendChild(el)
  }
  return el
}

function waitSceneTransition(el, ms) {
  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener('transitionend', onEnd)
      clearTimeout(tid)
      resolve()
    }
    const onEnd = (e) => {
      if (e.target === el) done()
    }
    el.addEventListener('transitionend', onEnd)
    const tid = setTimeout(done, ms + 96)
  })
}

async function sceneTransitionOut(kind, ms = SCENE_TRANSITION_MS) {
  const el = ensureSceneTransitionOverlay()
  el.style.position = 'fixed'
  el.style.inset = '0'
  el.style.zIndex = '10000'
  el.style.background = '#0d0f12'
  el.style.pointerEvents = 'auto'
  el.style.transition = 'none'
  if (kind === 'fade') {
    el.style.opacity = '0'
    el.style.transform = 'none'
  } else if (kind === 'slideLeft') {
    el.style.opacity = '1'
    el.style.transform = 'translateX(100%)'
  } else {
    el.style.opacity = '1'
    el.style.transform = 'translateX(-100%)'
  }
  void el.offsetWidth
  el.style.transition = kind === 'fade' ? `opacity ${ms}ms ease` : `transform ${ms}ms ease`
  if (kind === 'fade') el.style.opacity = '1'
  else el.style.transform = 'translateX(0)'
  await waitSceneTransition(el, ms)
}

async function sceneTransitionIn(kind, ms = SCENE_TRANSITION_MS) {
  const el = ensureSceneTransitionOverlay()
  el.style.position = 'fixed'
  el.style.inset = '0'
  el.style.zIndex = '10000'
  el.style.background = '#0d0f12'
  el.style.pointerEvents = 'auto'
  el.style.transition = 'none'
  el.style.opacity = '1'
  el.style.transform = 'none'
  void el.offsetWidth
  el.style.transition = kind === 'fade' ? `opacity ${ms}ms ease` : `transform ${ms}ms ease`
  if (kind === 'fade') el.style.opacity = '0'
  else if (kind === 'slideLeft') el.style.transform = 'translateX(-100%)'
  else el.style.transform = 'translateX(100%)'
  await waitSceneTransition(el, ms)
  el.style.pointerEvents = 'none'
  if (kind === 'fade') el.style.opacity = '0'
}

async function loadLevelCore(name) {
  const key = String(name).trim().toLowerCase()
  const resolved = LEVELS[key] ?? LEVELS[name] ?? (key === 'main' ? LEVELS[MAIN_KEY] : null)
  if (!resolved) {
    api.log('loadLevel: unknown level', name)
    return false
  }
  try {
    teardownActors()
    LEVEL = resolved
    const nextLevelName = LEVEL?.name ?? saveLevelName
    if (CROSS_LEVEL_SAVES_ENABLED) exportMigrateToLevel(nextLevelName)
    else saveLevelName = nextLevelName
    applyEnvironment()
    await loadAssets(LEVEL)
    await loadSounds(LEVEL)
    stopSeqAudio()
    spawnLevelActors(LEVEL)
    resetPawnFromStart()
    await startPhysics()
    compileScripts()
    api.log('loadLevel:', name)
    return true
  } catch (e) {
    console.warn('loadLevel failed:', e)
    return false
  }
}

/** Wave 82 — optional pack changelog panel before first frame. */
function showPackChangelogBoot() {
  return new Promise((resolve) => {
    if (!PACK_CHANGELOG_HTML || !PACK_CHANGELOG_BOOT) {
      resolve()
      return
    }
    const root = document.createElement('div')
    root.id = 'lotus-pack-changelog-boot'
    const inner = document.createElement('div')
    inner.className = 'lotus-pack-changelog-boot-inner'
    const panel = document.createElement('div')
    panel.innerHTML = PACK_CHANGELOG_HTML
    inner.appendChild(panel)
    const actions = document.createElement('div')
    actions.className = 'lotus-pack-changelog-boot-actions'
    const playBtn = document.createElement('button')
    playBtn.type = 'button'
    playBtn.className = 'lotus-pack-changelog-play'
    playBtn.textContent = 'Play'
    playBtn.onclick = () => {
      root.remove()
      resolve()
    }
    actions.appendChild(playBtn)
    inner.appendChild(actions)
    root.appendChild(inner)
    document.body.appendChild(root)
  })
}

/** Wave 50 — optional boot main-menu overlay before first level load. */
function showExportMainMenu() {
  return new Promise((resolve) => {
    const root = document.createElement('div')
    root.id = 'lotus-export-main-menu'
    root.style.cssText =
      'position:fixed;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;background:rgba(13,15,18,.94);z-index:30;font:600 16px system-ui,sans-serif;color:#e8edf4;gap:10px;pointer-events:auto'
    const title = document.createElement('div')
    title.textContent = 'LOTUS ENGINE'
    title.style.cssText = 'font-size:28px;margin-bottom:4px'
    root.appendChild(title)
    const sub = document.createElement('div')
    sub.textContent = 'Choose a starter level'
    sub.style.cssText = 'font-size:13px;color:#9aa4b2;margin-bottom:16px;font-weight:500'
    root.appendChild(sub)
    const available = MAIN_MENU_ITEMS.filter((item) => LEVELS[item.key])
    const items = available.length ? available : MAIN_MENU_ITEMS
    for (const item of items) {
      const btn = document.createElement('button')
      btn.textContent = item.label
      btn.style.cssText =
        'min-width:220px;padding:10px 20px;border:none;border-radius:8px;background:#2f80ed;color:#fff;cursor:pointer;font:inherit'
      if (item.key === 'mpdeathmatch') btn.style.background = '#7c3aed'
      btn.onclick = async () => {
        await sceneTransitionOut('fade', SCENE_TRANSITION_MS)
        root.remove()
        resolve(item.key)
      }
      root.appendChild(btn)
    }
    document.body.appendChild(root)
  })
}

// ---- boot ----
const overlay = document.getElementById('overlay')
let perfBadge = document.getElementById('perf-badge')
if (!perfBadge) {
  perfBadge = document.createElement('div')
  perfBadge.id = 'perf-badge'
  perfBadge.style.cssText =
    'position:fixed;top:8px;right:8px;padding:4px 8px;font:11px/1.4 monospace;background:rgba(0,0,0,.55);color:#9fd3ff;border-radius:4px;pointer-events:none;z-index:20'
  document.body.appendChild(perfBadge)
}
let perfFpsAcc = 0
let perfFpsFrames = 0
let perfFps = 0
async function boot() {
  const created = await createPlayRenderer()
  renderer = created.renderer
  playRenderTier = created.tier
  bindPawnInput()
  initExportTouchHud()
  initExportSaveMenu()
  initExportDialogue()
  if (PACK_CHANGELOG_HTML && PACK_CHANGELOG_BOOT) {
    if (overlay) overlay.textContent = 'Release notes'
    await showPackChangelogBoot()
  }
  let bootMenuPick = false
  if (MAIN_MENU_ENABLED) {
    if (overlay) overlay.textContent = 'Select a level'
    const picked = await showExportMainMenu()
    bootMenuPick = true
    const resolved = LEVELS[picked] ?? LEVELS[MAIN_KEY]
    if (resolved) {
      LEVEL = resolved
      saveLevelName = LEVEL?.name ?? saveLevelName
    }
  }
  applyEnvironment()
  await loadAssets(LEVEL)
  await loadSounds(LEVEL)
  spawnLevelActors(LEVEL)
  if (CELL_MANIFEST) {
    const start = LEVEL.actors.find((a) => a.type === 'PlayerStart')
    const p = start ? new THREE.Vector3(...start.transform.position) : feet.clone()
    syncCellsAround(p)
  }
  resetPawnFromStart()
  await startPhysics()
  compileScripts()
  if (bootMenuPick) await sceneTransitionIn('fade', SCENE_TRANSITION_MS)
  exportTslPipeline = await createExportTSLPipeline(renderer, scene, pawnCam)
  await bindExportParticleCompute()
  const gpuParticleCount = particleSystems.filter((p) => p.gpuTier).length
  const particleTier =
    (LEVEL.environment?.particleBackend ?? 'cpu') === 'gpu' && playRenderTier === 'webgpu'
      ? gpuParticleCount > 0
        ? `GPU particles ×${gpuParticleCount}`
        : 'GPU particles (bind pending)'
      : 'CPU particles'
  const gamepadHint = GAMEPAD_ENABLED ? ` · ${GAMEPAD_GLYPH_HINT}` : ''
  const presetHint = MINIGAME_PACK
    ? ` · Pack: ${MINIGAME_PACK}`
    : MINIGAME_PRESET
      ? ` · Mini-game: ${MINIGAME_PRESET}`
      : MINIGAME_ENABLED
        ? ' · Mini-game HUD'
        : ''
  overlay.textContent =
    (playRenderTier === 'webgpu' ? (exportTslPipeline ? 'WebGPU TSL · ' : 'WebGPU · ') : '') +
    (TOUCH_ENABLED
      ? `${particleTier} · Touch stick + actions · tap canvas for mouse look${gamepadHint}${presetHint}`
      : GAMEPAD_ENABLED
        ? `${particleTier} · WASD / gamepad · click canvas for mouse look${gamepadHint}${presetHint}`
        : `${particleTier} · Click to play — WASD + mouse · Space jump · Shift sprint${presetHint}`)
  const perfMinFps = EXPORT.perfMinFps ?? 24
  window.__LOTUS_EXPORT_PERF__ = {
    tier: playRenderTier,
    particleTier,
    gpuParticleCount,
    perfMinFps,
    perfPass: null,
    fps: 0,
  }
  if (STREAMING_ENABLED) {
    window.__LOTUS_STREAM_PROGRESS__ = {
      getProgress: () => streamProgress.percent,
      cellsLoaded: () => streamProgress.cellsLoaded,
      cellsTotal: () => streamProgress.cellsTotal,
      reset: resetStreamProgress,
    }
  }
  if (SAVE_MENU_ENABLED) {
    window.__LOTUS_SAVE_MENU_API__ = {
      showMenu: showExportSaveMenu,
      hideMenu: hideExportSaveMenu,
      toggleMenu: toggleExportSaveMenu,
      isPaused: () => saveMenuPaused,
    }
  }
  if (CLOUD_SYNC_ENABLED) {
    window.__LOTUS_CLOUD_SYNC_API__ = {
      listCloudManifest: exportListCloudManifest,
      exportCloudManifest: exportCloudSaveManifest,
      crossDeviceHint: async () => (await exportCloudSaveManifest())?.crossDeviceHint ?? '',
      exportJson: exportCloudSaveJson,
      importJson: importExportCloudSaveJson,
      syncEnabled: () => CLOUD_SYNC_ENABLED,
    }
  }
  if (ACHIEVEMENTS_DEF) {
    window.__LOTUS_ACHIEVEMENTS_API__ = {
      packId: () => exportAchievementPackId(),
      list: () => ACHIEVEMENTS_DEF.achievements ?? [],
      unlocked: () => exportListUnlockedAchievements(),
      unlock: (id) => exportUnlockAchievement(id),
      setProgress: (id, current, max) => exportSetAchievementProgress(id, current, max),
      getProgress: (id) => exportGetAchievementProgress(id),
    }
  }
  if (SAVES_ENABLED) {
    window.__LOTUS_SAVE_SLOTS__ = {
      checkpoint: exportSaveCheckpoint,
      load: exportLoadCheckpoint,
      listSlots: exportListSaveSlots,
      enabled: () => SAVES_ENABLED,
      levelName: () => saveLevelName,
      crossLevel: () => CROSS_LEVEL_SAVES_ENABLED,
      migrateToLevel: exportMigrateToLevel,
      globalCheckpoint: (slot, data) => {
        if (!SAVES_ENABLED) return false
        try {
          const payload = {
            savedAt: Date.now(),
            level: GLOBAL_SAVE_LEVEL_KEY,
            slot: sanitizeSaveSlot(slot),
            data,
          }
          localStorage.setItem(globalSaveStorageKey(slot), JSON.stringify(payload))
          if (CLOUD_SAVES_ENABLED) void exportBackupToCloud(slot, data).catch(() => {})
          return true
        } catch {
          return false
        }
      },
      globalLoad: (slot) => {
        if (!SAVES_ENABLED) return null
        try {
          const raw = localStorage.getItem(globalSaveStorageKey(slot))
          if (!raw) return null
          const parsed = JSON.parse(raw)
          return parsed?.data ?? null
        } catch {
          return null
        }
      },
      cloudBackup: () => CLOUD_SAVES_ENABLED,
      backupToCloud: exportBackupToCloud,
      restoreFromCloud: exportRestoreFromCloud,
      listCloudSlots: exportListCloudSlots,
      listCloudManifest: exportListCloudManifest,
      exportCloudManifest: exportCloudSaveManifest,
      crossDeviceHint: async () => (await exportCloudSaveManifest())?.crossDeviceHint ?? '',
      exportJson: exportCloudSaveJson,
      importJson: importExportCloudSaveJson,
      syncEnabled: () => CLOUD_SYNC_ENABLED,
    }
  }
  const c = new THREE.Clock()
  renderer.setAnimationLoop(() => {
    const dt = Math.min(c.getDelta(), 0.1)
    const frozen = SAVE_MENU_ENABLED && saveMenuPaused
    const simDt = frozen ? 0 : dt
    if (!frozen) clock += simDt
    perfFpsAcc += dt
    perfFpsFrames++
    if (perfFpsAcc >= 0.5) {
      perfFps = Math.round(perfFpsFrames / perfFpsAcc)
      perfFpsAcc = 0
      perfFpsFrames = 0
      const gpuN = particleSystems.filter((p) => p.gpuTier).length
      const perfGate = window.__LOTUS_EXPORT_PERF__
      if (perfGate) {
        perfGate.fps = perfFps
        perfGate.perfPass = perfFps >= perfGate.perfMinFps
      }
      const gateOk = perfGate?.perfPass !== false
      perfBadge.textContent = `${perfFps} fps · ${playRenderTier}${gpuN ? ` · GPU×${gpuN}` : ''}${gateOk ? '' : ' · PERF!'}`
    }
    if (physWorld && simDt > 0) {
      physWorld.timestep = Math.min(simDt, 1 / 30)
      physWorld.step()
      for (const [a, body] of bindings) {
        const t = body.translation(), r = body.rotation()
        a.root.position.set(t.x, t.y, t.z)
        a.root.quaternion.set(r.x, r.y, r.z, r.w)
      }
    }
    if (simDt > 0) {
      tickScriptTimers(simDt)
      for (const [a, t] of ticks) { try { t(simDt) } catch (e) { /* script error */ } }
    }
    if (simDt > 0) tickTriggerVolumes(pawnMode === 'fly' ? pawnCam.position : feet)
    if (simDt > 0) tickExportDialogueInteract(pawnMode === 'fly' ? pawnCam.position : feet)
    if (simDt > 0) {
      for (const a of actors.values()) {
        for (const b of a.data.behaviors ?? []) {
          if (b.type === 'rotator') {
            a.root.rotation.x += b.speedX * simDt
            a.root.rotation.y += b.speedY * simDt
            a.root.rotation.z += b.speedZ * simDt
          }
        }
      }
    }
    const seq = LEVEL.sequence
    let seqDofFocus = null
    if (simDt > 0 && seq && seq.autoPlay && seq.tracks.length) {
      const t = clock % seq.duration
      let hasAudio = false
      for (const tr of seq.tracks) {
        if (tr.trackType === 'audio') { hasAudio = true; continue }
        const a = actors.get(tr.actorId)
        if (!a || !tr.keys.length) continue
        if (tr.property === 'dofFocusDistance' || tr.property === 'fov') {
          const sv = sampleSeqValue(tr.keys, t)
          if (typeof sv !== 'number') continue
          if (tr.property === 'dofFocusDistance') {
            seqDofFocus = sv
            if (!a.data.cameraProps) a.data.cameraProps = {}
            a.data.cameraProps.dofFocusDistance = sv
          } else if (tr.property === 'fov') {
            pawnCam.fov = sv
            pawnCam.updateProjectionMatrix()
          }
          continue
        }
        let v
        const ks = tr.keys
        if (t <= ks[0].t) v = ks[0].v
        else if (t >= ks[ks.length - 1].t) v = ks[ks.length - 1].v
        else for (let i = 0; i < ks.length - 1; i++) {
          if (t >= ks[i].t && t <= ks[i + 1].t) {
            const f = (t - ks[i].t) / (ks[i + 1].t - ks[i].t || 1)
            v = [0, 1, 2].map((j) => ks[i].v[j] + (ks[i + 1].v[j] - ks[i].v[j]) * f)
            break
          }
        }
        if (!v) continue
        if (tr.property === 'position') a.root.position.fromArray(v)
        else if (tr.property === 'rotation') a.root.rotation.set(v[0], v[1], v[2])
        else a.root.scale.fromArray(v)
      }
      if (hasAudio) updateSeqAudio(t)
    }
    let dofFocus = seqDofFocus
    if (dofFocus == null) {
      const pullCam = findExportFocusPullCamera()
      if (pullCam) dofFocus = resolveExportDofFocus(pullCam, LEVEL.environment ?? {}, clock)
    }
    if (dofFocus != null && exportTslPipeline?.setDofFocus) exportTslPipeline.setDofFocus(dofFocus)
    if (simDt > 0) for (const ps of particleSystems) ps.update(simDt)
    if (particleSystems.some((p) => p.trailLen > 0)) {
      let trailTris = 0
      for (const ps of particleSystems) {
        if (!ps.trailLen || !ps.display?.geometry) continue
        trailTris = Math.max(trailTris, ps.display.geometry.drawRange?.count ?? 0)
      }
      if (trailTris > 0) window.__LOTUS_EXPORT_RIBBON_QA__ = { trailTris, ribbonSystems: particleSystems.filter((p) => p.trailLen > 0).length }
    }
    const subSystems = particleSystems.filter((p) => p.subEmitterOn)
    if (subSystems.length) window.__LOTUS_EXPORT_SUB_EMITTER_QA__ = { systems: subSystems.length }
    if (GAMEPAD_ENABLED) pollExportGamepad()
    if (TOUCH_ENABLED && typeof window.__lotusSyncTouchBindings === 'function') window.__lotusSyncTouchBindings()
    if (simDt > 0) updatePawn(simDt)
    if (CELL_MANIFEST) syncCellsAround(pawnCam.position)
    applyStreamingVisibility(pawnCam.position)
    // Widget3D export fallback — canvas billboard planes (no CSS3D)
    const camPos = pawnCam.position
    for (const a of actors.values()) {
      if (a.data.type !== 'Widget3D' || !a.data.widget3D?.billboard || !a.mesh) continue
      const obj = new THREE.Vector3(); a.root.getWorldPosition(obj)
      const parentQ = new THREE.Quaternion(); a.mesh.parent?.getWorldQuaternion(parentQ)
      const invQ = parentQ.clone().invert()
      const lookM = new THREE.Matrix4().lookAt(obj, camPos, new THREE.Vector3(0, 1, 0))
      const lookQ = new THREE.Quaternion().setFromRotationMatrix(lookM)
      a.mesh.quaternion.copy(invQ).multiply(lookQ)
    }
    pressed.clear()
    if (exportTslPipeline) {
      exportTslPipeline.setCamera(pawnCam)
      exportTslPipeline.render()
    } else {
      renderer.render(scene, pawnCam)
    }
  })
}
addEventListener('resize', () => {
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(innerWidth, innerHeight)
  pawnCam.aspect = innerWidth / innerHeight
  pawnCam.updateProjectionMatrix()
})
boot()