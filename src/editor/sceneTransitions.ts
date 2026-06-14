/** Wave 55 (v3.14–v3.18) — DOM scene transition overlay (CSS fade / slide). */

export type SceneTransitionKind = 'fade' | 'slideLeft' | 'slideRight'
export type SceneTransitionPhase = 'out' | 'in'

export const SCENE_TRANSITION_OVERLAY_ID = 'lotus-scene-transition'
const DEFAULT_MS = 400

function ensureOverlay(): HTMLDivElement {
  let el = document.getElementById(SCENE_TRANSITION_OVERLAY_ID) as HTMLDivElement | null
  if (!el) {
    el = document.createElement('div')
    el.id = SCENE_TRANSITION_OVERLAY_ID
    el.setAttribute('aria-hidden', 'true')
    document.body.appendChild(el)
  }
  return el
}

function applyBase(el: HTMLDivElement) {
  el.style.position = 'fixed'
  el.style.inset = '0'
  el.style.zIndex = '10000'
  el.style.background = '#0d0f12'
}

function waitTransition(el: HTMLElement, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      el.removeEventListener('transitionend', onEnd)
      clearTimeout(tid)
      resolve()
    }
    const onEnd = (e: TransitionEvent) => {
      if (e.target === el) done()
    }
    el.addEventListener('transitionend', onEnd)
    const tid = window.setTimeout(done, ms + 96)
  })
}

function forceReflow(el: HTMLElement) {
  void el.offsetWidth
}

/** Fade to opaque — covers the viewport before a scene swap. */
export async function fadeOut(ms = DEFAULT_MS): Promise<void> {
  return transitionOut('fade', ms)
}

/** Fade to transparent — reveals the new scene. */
export async function fadeIn(ms = DEFAULT_MS): Promise<void> {
  return transitionIn('fade', ms)
}

/** Slide overlay in from the right (covers scene). */
export async function slideLeftOut(ms = DEFAULT_MS): Promise<void> {
  return transitionOut('slideLeft', ms)
}

/** Slide overlay out to the left (reveals scene). */
export async function slideLeftIn(ms = DEFAULT_MS): Promise<void> {
  return transitionIn('slideLeft', ms)
}

/** Slide overlay in from the left (covers scene). */
export async function slideRightOut(ms = DEFAULT_MS): Promise<void> {
  return transitionOut('slideRight', ms)
}

/** Slide overlay out to the right (reveals scene). */
export async function slideRightIn(ms = DEFAULT_MS): Promise<void> {
  return transitionIn('slideRight', ms)
}

export async function transitionOut(kind: SceneTransitionKind, ms = DEFAULT_MS): Promise<void> {
  const el = ensureOverlay()
  applyBase(el)
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
  forceReflow(el)
  el.style.transition =
    kind === 'fade' ? `opacity ${ms}ms ease` : `transform ${ms}ms ease`
  if (kind === 'fade') el.style.opacity = '1'
  else el.style.transform = 'translateX(0)'
  await waitTransition(el, ms)
}

export async function transitionIn(kind: SceneTransitionKind, ms = DEFAULT_MS): Promise<void> {
  const el = ensureOverlay()
  applyBase(el)
  el.style.pointerEvents = 'auto'
  el.style.transition = 'none'
  if (kind === 'fade') {
    el.style.opacity = '1'
    el.style.transform = 'none'
  } else {
    el.style.opacity = '1'
    el.style.transform = 'translateX(0)'
  }
  forceReflow(el)
  el.style.transition =
    kind === 'fade' ? `opacity ${ms}ms ease` : `transform ${ms}ms ease`
  if (kind === 'fade') el.style.opacity = '0'
  else if (kind === 'slideLeft') el.style.transform = 'translateX(-100%)'
  else el.style.transform = 'translateX(100%)'
  await waitTransition(el, ms)
  el.style.pointerEvents = 'none'
  if (kind === 'fade') el.style.opacity = '0'
}

/** Fade/slide out → optional work → fade/slide in. */
export async function runSceneTransition(
  kind: SceneTransitionKind,
  ms = DEFAULT_MS,
  work?: () => void | Promise<void>,
): Promise<void> {
  await transitionOut(kind, ms)
  if (work) await work()
  await transitionIn(kind, ms)
}

/** Bridge helper — single phase only (`out` covers, `in` reveals). */
export async function sceneTransition(
  kind: SceneTransitionKind,
  ms = DEFAULT_MS,
  phase: SceneTransitionPhase = 'out',
): Promise<void> {
  return phase === 'out' ? transitionOut(kind, ms) : transitionIn(kind, ms)
}