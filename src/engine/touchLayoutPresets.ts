/**
 * Wave 49 (v2.84) — Touch HUD layout presets (joystick + action button positions via CSS vars).
 */

export type TouchLayoutPreset = 'compact' | 'wide' | 'fps'

export const TOUCH_LAYOUT_PRESET_IDS: readonly TouchLayoutPreset[] = ['compact', 'wide', 'fps'] as const

export const TOUCH_LAYOUT_PRESET_LABELS: Record<TouchLayoutPreset, string> = {
  compact: 'Compact (phone)',
  wide: 'Wide (tablet)',
  fps: 'FPS (fire right)',
}

export interface TouchLayoutVars {
  stickLeft: string
  stickBottom: string
  stickSize: string
  actionsRight: string
  actionsBottom: string
  actionsGap: string
  btnSize: string
  fireBtnSize: string
}

export const TOUCH_LAYOUT_PRESETS: Record<TouchLayoutPreset, TouchLayoutVars> = {
  compact: {
    stickLeft: '12px',
    stickBottom: '12px',
    stickSize: '120px',
    actionsRight: '16px',
    actionsBottom: '24px',
    actionsGap: '8px',
    btnSize: '64px',
    fireBtnSize: '64px',
  },
  wide: {
    stickLeft: '48px',
    stickBottom: '32px',
    stickSize: '160px',
    actionsRight: '48px',
    actionsBottom: '48px',
    actionsGap: '14px',
    btnSize: '80px',
    fireBtnSize: '80px',
  },
  fps: {
    stickLeft: '20px',
    stickBottom: '18px',
    stickSize: '128px',
    actionsRight: '18px',
    actionsBottom: '22px',
    actionsGap: '12px',
    btnSize: '60px',
    fireBtnSize: '88px',
  },
}

/** Gamepad glyph hint appended to export overlay when __LOTUS_GAMEPAD__ is enabled. */
export const GAMEPAD_GLYPH_HINT = '🎮 A fire · B interact'

export function normalizeTouchLayoutPreset(preset: string | undefined): TouchLayoutPreset {
  if (preset === 'wide' || preset === 'fps') return preset
  return 'compact'
}

export function getTouchLayoutVars(preset?: TouchLayoutPreset | string): TouchLayoutVars {
  return TOUCH_LAYOUT_PRESETS[normalizeTouchLayoutPreset(preset)]
}

const CSS_VAR_MAP: [keyof TouchLayoutVars, string][] = [
  ['stickLeft', '--lotus-touch-stick-left'],
  ['stickBottom', '--lotus-touch-stick-bottom'],
  ['stickSize', '--lotus-touch-stick-size'],
  ['actionsRight', '--lotus-touch-actions-right'],
  ['actionsBottom', '--lotus-touch-actions-bottom'],
  ['actionsGap', '--lotus-touch-actions-gap'],
  ['btnSize', '--lotus-touch-btn-size'],
  ['fireBtnSize', '--lotus-touch-fire-btn-size'],
]

/** Apply preset CSS custom properties on a touch HUD root element. */
export function applyTouchLayoutPreset(el: HTMLElement, preset?: TouchLayoutPreset | string): TouchLayoutPreset {
  const id = normalizeTouchLayoutPreset(preset)
  const vars = TOUCH_LAYOUT_PRESETS[id]
  el.dataset.lotusTouchLayout = id
  for (const [key, cssVar] of CSS_VAR_MAP) {
    el.style.setProperty(cssVar, vars[key])
  }
  return id
}