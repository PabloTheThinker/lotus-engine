import { world } from '../engine/World'
import { execPluginConsoleCommand, getPluginConsoleCommands, pluginConsoleSuggestions } from './plugins'
import { useEditor } from './store'

/**
 * UE console commands — the ` console vocabulary: stat fps / stat unit,
 * slomo, t.MaxFPS, r.ScreenPercentage, show collision. Anything unhandled
 * falls through to the JS evaluator.
 */

export const consoleState = {
  statMode: 'none' as 'none' | 'fps' | 'unit',
  timeDilation: 1,
  maxFPS: 0, // 0 = uncapped
  screenPercentage: 100,
  showCollision: false,
  showNavMesh: false,
  showStreaming: false,
}

export const CONSOLE_COMMANDS = [
  'stat fps',
  'stat unit',
  'stat none',
  'slomo ',
  't.MaxFPS ',
  'r.ScreenPercentage ',
  'r.PathTracer ',
  'show collision',
  'show navmesh',
  'show streaming',
]

/** returns a response string if the input was a console command, else null */
export function execConsoleCommand(raw: string): string | null {
  const input = raw.trim()
  const lower = input.toLowerCase()
  const push = useEditor.getState().pushConsole

  if (lower === 'stat fps') {
    consoleState.statMode = consoleState.statMode === 'fps' ? 'none' : 'fps'
    return `stat fps ${consoleState.statMode === 'fps' ? 'ON' : 'OFF'}`
  }
  if (lower === 'stat unit') {
    consoleState.statMode = consoleState.statMode === 'unit' ? 'none' : 'unit'
    return `stat unit ${consoleState.statMode === 'unit' ? 'ON' : 'OFF'}`
  }
  if (lower === 'stat none') {
    consoleState.statMode = 'none'
    return 'stats cleared'
  }
  if (lower.startsWith('slomo')) {
    const v = parseFloat(input.split(/\s+/)[1])
    if (Number.isFinite(v)) {
      consoleState.timeDilation = Math.max(0.01, Math.min(10, v))
      return `slomo = ${consoleState.timeDilation}`
    }
    return `slomo = ${consoleState.timeDilation}`
  }
  if (lower.startsWith('t.maxfps')) {
    const v = parseFloat(input.split(/\s+/)[1])
    if (Number.isFinite(v)) {
      consoleState.maxFPS = Math.max(0, v)
      return `t.MaxFPS = ${consoleState.maxFPS || 'uncapped'}`
    }
    return `t.MaxFPS = ${consoleState.maxFPS || 'uncapped'}`
  }
  if (lower.startsWith('r.screenpercentage')) {
    const v = parseFloat(input.split(/\s+/)[1])
    if (Number.isFinite(v)) {
      consoleState.screenPercentage = Math.max(25, Math.min(200, v))
      return `r.ScreenPercentage = ${consoleState.screenPercentage}`
    }
    return `r.ScreenPercentage = ${consoleState.screenPercentage}`
  }
  if (lower.startsWith('r.pathtracer')) {
    const v = parseInt(input.split(/\s+/)[1], 10)
    if (v === 1) {
      useEditor.getState().setViewMode('pathtraced')
      return 'r.PathTracer = 1 (Path Traced view mode — preview may be slow)'
    }
    if (v === 0) {
      useEditor.getState().setViewMode('lit')
      return 'r.PathTracer = 0'
    }
    return `r.PathTracer = ${useEditor.getState().viewMode === 'pathtraced' ? 1 : 0}`
  }
  if (lower === 'show collision') {
    consoleState.showCollision = !consoleState.showCollision
    return `show collision ${consoleState.showCollision ? 'ON' : 'OFF'}`
  }
  if (lower === 'show navmesh') {
    consoleState.showNavMesh = !consoleState.showNavMesh
    return `show navmesh ${consoleState.showNavMesh ? 'ON' : 'OFF'}`
  }
  if (lower === 'show streaming') {
    consoleState.showStreaming = !consoleState.showStreaming
    return `show streaming ${consoleState.showStreaming ? 'ON' : 'OFF'}`
  }
  if (lower === 'help' || lower === '?') {
    const pluginLines = getPluginConsoleCommands().map((c) => `${c.name} — ${c.help}`)
    const lines = [...CONSOLE_COMMANDS, ...pluginLines]
    push('log', lines.join('\n'))
    return 'console commands listed (anything else evaluates as JS: world, api, THREE in scope)'
  }

  const pluginHandled = execPluginConsoleCommand(input)
  if (pluginHandled !== null) return pluginHandled
  // quality-of-life: actor count like UE's `obj list`
  if (lower === 'obj list') {
    return `${world.actors.size} actors`
  }
  return null
}

/** autocomplete suggestions for the console input */
export function consoleSuggestions(prefix: string): string[] {
  const p = prefix.toLowerCase()
  if (!p) return []
  const builtin = CONSOLE_COMMANDS.filter((c) => c.toLowerCase().startsWith(p))
  const plugin = pluginConsoleSuggestions(p)
  return [...builtin, ...plugin].slice(0, 8)
}
