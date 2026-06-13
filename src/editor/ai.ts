import { world } from '../engine/World'
import { applyMaterialProps } from '../engine/factory'
import type { GeometryKind, ActorType } from '../engine/types'
import * as THREE from 'three'
import { DeleteActorCommand, PropertyCommand, runCommand } from './commands'
import { buildSerializedActor, type AssetPayload } from './spawn'
import { AddActorCommand } from './commands'
import { useEditor } from './store'

/**
 * AI copilot — chat with a model that can act on the world. The model replies
 * with prose plus an optional ```vektra``` JSON block of commands; every
 * command routes through the editor's undo stack.
 */

export interface AISettings {
  provider: 'ollama' | 'anthropic'
  ollamaUrl: string
  ollamaModel: string
  anthropicKey: string
  anthropicModel: string
}

const SETTINGS_KEY = 'lotus-engine.ai'

export function loadAISettings(): AISettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}')
    return {
      provider: raw.provider ?? 'ollama',
      ollamaUrl: raw.ollamaUrl ?? '/ollama',
      ollamaModel: raw.ollamaModel ?? 'qwen3:14b',
      anthropicKey: raw.anthropicKey ?? '',
      anthropicModel: raw.anthropicModel ?? 'claude-sonnet-4-6',
    }
  } catch {
    return { provider: 'ollama', ollamaUrl: '/ollama', ollamaModel: 'qwen3:14b', anthropicKey: '', anthropicModel: 'claude-sonnet-4-6' }
  }
}

export function saveAISettings(s: AISettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

// ---- scene context ----

function sceneSummary(): string {
  const actors = [...world.actors.values()].slice(0, 80).map((a) => {
    const p = a.transform.position.map((v) => Math.round(v * 100) / 100)
    const bits = [`${a.name} (${a.type}) pos=[${p.join(',')}]`]
    if (a.materialProps) bits.push(`color=${a.materialProps.color}`)
    if (a.physicsProps && a.physicsProps.mode !== 'none') bits.push(`physics=${a.physicsProps.mode}`)
    if (a.mobility !== 'movable') bits.push(`mobility=${a.mobility}`)
    if (a.tags.length) bits.push(`tags=[${a.tags.join(',')}]`)
    if (a.script) bits.push('scripted')
    return bits.join(' ')
  })
  const env = world.environment
  let out = `Level "${world.levelName}" — ${world.actors.size} actors:\n${actors.join('\n')}\nEnvironment: sky=${env.skyEnabled} sunElevation=${env.sunElevation} fog=${env.fogEnabled} bloom=${env.bloomEnabled}`
  // recent console output — lets the copilot see script errors and debug its own work
  const entries = useEditor.getState().consoleEntries.slice(-12)
  if (entries.length) {
    out += `\n\nRECENT CONSOLE OUTPUT (script errors appear here):\n${entries.map((e) => `[${e.level}] ${e.message}`).join('\n')}`
  }
  return out
}

const SYSTEM_PROMPT = `You are the AI copilot inside Lotus Engine, a Three.js game editor with an Unreal-style actor framework. You can SEE the scene (provided below) and ACT on it.

To act, include ONE fenced code block labeled vektra containing a JSON array of commands. Available commands:
- {"cmd":"spawn","what":"box|sphere|cylinder|cone|plane|torus|capsule|icosahedron|PointLight|SpotLight|DirectionalLight|AmbientLight|Camera|PlayerStart|Empty|Folder|PostProcessVolume","name":"MyActor","position":[x,y,z],"color":"#hex","scale":[x,y,z],"physics":"none|static|dynamic","mobility":"static|stationary|movable","tags":["Tag1"]}
- {"cmd":"set","actor":"Name","position":[x,y,z],"rotation":[degX,degY,degZ],"scale":[x,y,z]}
- {"cmd":"material","actor":"Name","color":"#hex","roughness":0..1,"metalness":0..1,"emissive":"#hex","emissiveIntensity":n}
- {"cmd":"physics","actor":"Name","mode":"none|static|dynamic","mass":n}
- {"cmd":"script","actor":"Name","code":"function onBeginPlay(){...} function onTick(dt){...}"} — JS with actor, api (api.log, api.isKeyDown(code), api.keyJustPressed, api.getActor(name), api.time()), THREE in scope. actor.root is the THREE.Object3D.
- {"cmd":"rename","actor":"Old","name":"New"}
- {"cmd":"delete","actor":"Name"}
- {"cmd":"environment","sunElevation":deg,"sunAzimuth":deg,"skyEnabled":bool,"fogEnabled":bool,"fogDensity":n,"fogColor":"#hex","bloomEnabled":bool,"bloomStrength":n,"exposure":n}
- {"cmd":"mobility","actor":"Name","mobility":"static|stationary|movable"}
- {"cmd":"tags","actor":"Name","tags":["Tag1","Tag2"]}

Rules: ground plane is y=0; meshes are 1 unit before scale; place objects so they rest on surfaces (a unit box at rest has y=0.5*scaleY). Actor names must be unique — check the scene list. Keep prose brief; the commands are the work. Scripts run only during Play. PlayerStart pawnMode is fly by default.

CURRENT SCENE:
`

// ---- command execution ----

const MESH_KINDS: GeometryKind[] = ['box', 'sphere', 'cylinder', 'cone', 'plane', 'torus', 'capsule', 'icosahedron']
const LIGHT_TYPES = ['PointLight', 'SpotLight', 'DirectionalLight', 'AmbientLight']

function findActor(name: string) {
  const lower = String(name).toLowerCase()
  return [...world.actors.values()].find((a) => a.name.toLowerCase() === lower)
}

interface AICommand {
  cmd: string
  [key: string]: unknown
}

export function executeAICommands(commands: AICommand[]): string[] {
  const results: string[] = []
  const s = useEditor.getState()
  for (const c of commands) {
    try {
      switch (c.cmd) {
        case 'spawn': {
          const what = String(c.what ?? 'box')
          let payload: AssetPayload
          if (MESH_KINDS.includes(what as GeometryKind)) payload = { kind: 'mesh', geometry: what as GeometryKind }
          else if (LIGHT_TYPES.includes(what)) payload = { kind: 'light', type: what as Extract<ActorType, 'PointLight' | 'SpotLight' | 'DirectionalLight' | 'AmbientLight'> }
          else if (what === 'Camera') payload = { kind: 'camera' }
          else if (what === 'PlayerStart') payload = { kind: 'playerstart' }
          else if (what === 'Folder') payload = { kind: 'folder' }
          else if (what === 'PostProcessVolume') payload = { kind: 'postprocess' }
          else payload = { kind: 'empty' }
          const pos = (c.position as [number, number, number]) ?? [0, 0.5, 0]
          const sa = buildSerializedActor(payload, pos)
          if (c.name) sa.name = String(c.name)
          if (c.scale) sa.transform.scale = c.scale as [number, number, number]
          if (c.color && sa.material) sa.material.color = String(c.color)
          if (c.physics && sa.material) {
            sa.physics = { mode: c.physics as 'none' | 'static' | 'dynamic', mass: 1, friction: 0.5, restitution: 0.2 }
            if (c.physics === 'dynamic') sa.mobility = 'movable' // dynamic requires Movable
          }
          if (c.mobility) sa.mobility = c.mobility as 'static' | 'stationary' | 'movable'
          if (Array.isArray(c.tags)) sa.tags = c.tags.map(String)
          runCommand(new AddActorCommand(sa))
          results.push(`spawned ${sa.name}`)
          break
        }
        case 'set': {
          const actor = findActor(String(c.actor))
          if (!actor) throw new Error(`no actor "${c.actor}"`)
          const before = actor.transform
          const after = { ...before }
          if (c.position) after.position = c.position as [number, number, number]
          if (c.rotation) after.rotation = (c.rotation as number[]).map((d) => THREE.MathUtils.degToRad(d)) as [number, number, number]
          if (c.scale) after.scale = c.scale as [number, number, number]
          actor.setTransform(after)
          runCommand({ label: `AI move ${actor.name}`, execute: () => actor.setTransform(after), undo: () => actor.setTransform(before) })
          results.push(`moved ${actor.name}`)
          break
        }
        case 'material': {
          const actor = findActor(String(c.actor))
          if (!actor?.materialProps || !actor.mesh) throw new Error(`no mesh actor "${c.actor}"`)
          const props = actor.materialProps
          const before = { ...props }
          const after = { ...props }
          for (const k of ['color', 'roughness', 'metalness', 'emissive', 'emissiveIntensity', 'opacity', 'wireframe'] as const) {
            if (c[k] !== undefined) (after as Record<string, unknown>)[k] = c[k]
          }
          const mat = actor.mesh.material as THREE.MeshStandardMaterial
          runCommand(
            new PropertyCommand(
              `AI material ${actor.name}`,
              () => { Object.assign(props, after); applyMaterialProps(mat, props) },
              () => { Object.assign(props, before); applyMaterialProps(mat, props) },
            ),
          )
          results.push(`restyled ${actor.name}`)
          break
        }
        case 'physics': {
          const actor = findActor(String(c.actor))
          if (!actor?.physicsProps) throw new Error(`no physics-capable actor "${c.actor}"`)
          const props = actor.physicsProps
          const before = { ...props }
          runCommand(
            new PropertyCommand(
              `AI physics ${actor.name}`,
              () => Object.assign(props, { mode: c.mode ?? props.mode, mass: c.mass ?? props.mass }),
              () => Object.assign(props, before),
            ),
          )
          results.push(`physics ${actor.name} → ${c.mode}`)
          break
        }
        case 'script': {
          const actor = findActor(String(c.actor))
          if (!actor) throw new Error(`no actor "${c.actor}"`)
          const before = actor.script
          const after = String(c.code ?? '')
          runCommand(new PropertyCommand(`AI script ${actor.name}`, () => (actor.script = after), () => (actor.script = before)))
          results.push(`scripted ${actor.name}`)
          break
        }
        case 'rename': {
          const actor = findActor(String(c.actor))
          if (!actor) throw new Error(`no actor "${c.actor}"`)
          const prev = actor.name
          const next = String(c.name)
          runCommand(new PropertyCommand(`AI rename`, () => { actor.name = next; actor.root.name = next }, () => { actor.name = prev; actor.root.name = prev }))
          results.push(`renamed ${prev} → ${next}`)
          break
        }
        case 'delete': {
          const actor = findActor(String(c.actor))
          if (!actor) throw new Error(`no actor "${c.actor}"`)
          runCommand(new DeleteActorCommand(actor.id))
          results.push(`deleted ${c.actor}`)
          break
        }
        case 'mobility': {
          const actor = findActor(String(c.actor))
          if (!actor) throw new Error(`no actor "${c.actor}"`)
          const prev = actor.mobility
          const next = String(c.mobility) as 'static' | 'stationary' | 'movable'
          runCommand(new PropertyCommand(`AI mobility ${actor.name}`, () => (actor.mobility = next), () => (actor.mobility = prev)))
          results.push(`${actor.name} mobility → ${next}`)
          break
        }
        case 'tags': {
          const actor = findActor(String(c.actor))
          if (!actor) throw new Error(`no actor "${c.actor}"`)
          const prev = [...actor.tags]
          const next = Array.isArray(c.tags) ? c.tags.map(String) : []
          runCommand(new PropertyCommand(`AI tags ${actor.name}`, () => (actor.tags = next), () => (actor.tags = prev)))
          results.push(`tagged ${actor.name}`)
          break
        }
        case 'environment': {
          const env = world.environment
          const before = { ...env }
          const patch: Record<string, unknown> = {}
          for (const k of Object.keys(env) as Array<keyof typeof env>) {
            if (c[k] !== undefined) patch[k] = c[k]
          }
          runCommand(
            new PropertyCommand(
              'AI environment',
              () => { Object.assign(env, patch); world.applyEnvironment() },
              () => { Object.assign(env, before); world.applyEnvironment() },
            ),
          )
          results.push(`environment: ${Object.keys(patch).join(', ')}`)
          break
        }
        default:
          results.push(`unknown cmd "${c.cmd}" — skipped`)
      }
    } catch (err) {
      results.push(`✗ ${c.cmd}: ${(err as Error).message}`)
    }
  }
  s.touch()
  return results
}

// ---- providers ----

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

export async function chat(history: ChatMessage[], settings: AISettings): Promise<string> {
  const system = SYSTEM_PROMPT + sceneSummary()
  if (settings.provider === 'anthropic') {
    if (!settings.anthropicKey) throw new Error('Set an Anthropic API key in the AI settings.')
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.anthropicKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: settings.anthropicModel,
        max_tokens: 2048,
        system,
        messages: history,
      }),
    })
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const data = await res.json()
    return data.content?.map((b: { text?: string }) => b.text ?? '').join('') ?? ''
  }
  // Ollama
  const base = settings.ollamaUrl.replace(/\/$/, '')
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: settings.ollamaModel,
      stream: false,
      messages: [{ role: 'system', content: system }, ...history],
    }),
  })
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const data = await res.json()
  return data.message?.content ?? ''
}

/** Pull the ```vektra``` (or ```json```) command block out of a reply. */
export function extractCommands(reply: string): AICommand[] {
  const match = reply.match(/```(?:vektra|json)\s*([\s\S]*?)```/)
  if (!match) return []
  try {
    const parsed = JSON.parse(match[1].trim())
    return Array.isArray(parsed) ? parsed : [parsed]
  } catch {
    return []
  }
}
