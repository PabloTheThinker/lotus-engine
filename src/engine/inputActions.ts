import { Input } from './Input'

/**
 * Input actions — UE Enhanced Input / Godot Input Map analog.
 * Named actions ("Jump") bound to one or more key codes; scripts and
 * blueprints query actions instead of raw keys, so bindings are data.
 */

export interface InputAction {
  name: string
  keys: string[]
}

const KEY = 'vektra-engine.inputmap'

export const DEFAULT_ACTIONS: InputAction[] = [
  { name: 'Jump', keys: ['Space'] },
  { name: 'Sprint', keys: ['ShiftLeft'] },
  { name: 'Interact', keys: ['KeyE'] },
  { name: 'Fire', keys: ['KeyF'] },
  { name: 'Ability1', keys: ['Digit1'] },
  { name: 'Ability2', keys: ['Digit2'] },
]

let actions: InputAction[] | null = null

export function loadInputMap(): InputAction[] {
  if (actions) return actions
  try {
    const raw = localStorage.getItem(KEY)
    actions = raw ? (JSON.parse(raw) as InputAction[]) : DEFAULT_ACTIONS.map((a) => ({ ...a, keys: [...a.keys] }))
  } catch {
    actions = DEFAULT_ACTIONS.map((a) => ({ ...a, keys: [...a.keys] }))
  }
  return actions
}

export function saveInputMap(next: InputAction[]) {
  actions = next
  localStorage.setItem(KEY, JSON.stringify(next))
}

export function isActionDown(name: string): boolean {
  const a = loadInputMap().find((x) => x.name.toLowerCase() === name.toLowerCase())
  return !!a && a.keys.some((k) => Input.isDown(k))
}

/** UE Hold trigger: seconds the action's key has been held */
export function actionHeldTime(name: string): number {
  const a = loadInputMap().find((x) => x.name.toLowerCase() === name.toLowerCase())
  if (!a) return 0
  return Math.max(...a.keys.map((k) => Input.heldTime(k)), 0)
}

export function actionJustPressed(name: string): boolean {
  const a = loadInputMap().find((x) => x.name.toLowerCase() === name.toLowerCase())
  return !!a && a.keys.some((k) => Input.justPressed(k))
}

/** serializable form embedded in playable exports */
export function inputMapForExport(): InputAction[] {
  return loadInputMap().map((a) => ({ ...a, keys: [...a.keys] }))
}
