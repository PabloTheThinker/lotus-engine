/** Wave 93 (v5.04–v5.08) — DOM dialogue overlay for PIE + export runtime. */

import {
  advance,
  choose,
  type DialogueSnapshot,
} from '../engine/rpgDialogue'

export const DIALOGUE_OVERLAY_ID = 'lotus-dialogue-overlay'

export const DIALOGUE_OVERLAY_CSS = `
  #${DIALOGUE_OVERLAY_ID} {
    position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;
    display: none; pointer-events: auto;
    padding: 0 16px 22px;
    font: 600 14px system-ui, sans-serif; color: #e8edf4;
    animation: lotus-dialogue-in 0.22s ease-out;
  }
  #${DIALOGUE_OVERLAY_ID}.visible { display: block; }
  .lotus-dialogue-panel {
    max-width: min(720px, 96vw); margin: 0 auto;
    padding: 18px 22px 16px;
    border-radius: 12px 12px 10px 10px;
    background: rgba(13, 15, 18, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.14);
    box-shadow: 0 -8px 32px rgba(0, 0, 0, 0.45);
  }
  .lotus-dialogue-speaker {
    font-size: 12px; font-weight: 800; letter-spacing: 0.08em;
    text-transform: uppercase; color: #f6d365; margin-bottom: 8px;
  }
  .lotus-dialogue-body {
    font-size: 15px; font-weight: 500; line-height: 1.55; color: #d8e0ea;
    min-height: 2.4em;
  }
  .lotus-dialogue-choices {
    display: flex; flex-direction: column; gap: 8px; margin-top: 14px;
  }
  .lotus-dialogue-choice {
    text-align: left; padding: 10px 14px; border-radius: 8px;
    border: 1px solid rgba(47, 128, 237, 0.35);
    background: rgba(47, 128, 237, 0.14); color: #d8e8ff;
    font: inherit; cursor: pointer;
  }
  .lotus-dialogue-choice:hover { background: rgba(47, 128, 237, 0.24); }
  .lotus-dialogue-hint {
    margin-top: 10px; font-size: 11px; font-weight: 500; color: #6b7585;
  }
  @keyframes lotus-dialogue-in {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
`

let overlayEl: HTMLElement | null = null
let keyHandler: ((e: KeyboardEvent) => void) | null = null
let mountParent: HTMLElement | null = null

function ensureOverlay(parent?: HTMLElement): HTMLElement {
  const host = parent ?? mountParent ?? document.body
  if (overlayEl && overlayEl.parentElement === host) return overlayEl
  overlayEl?.remove()
  overlayEl = document.createElement('div')
  overlayEl.id = DIALOGUE_OVERLAY_ID
  overlayEl.setAttribute('role', 'dialog')
  overlayEl.setAttribute('aria-label', 'Dialogue')
  overlayEl.innerHTML = `<div class="lotus-dialogue-panel">
    <div class="lotus-dialogue-speaker" data-dialogue-speaker></div>
    <div class="lotus-dialogue-body" data-dialogue-body></div>
    <div class="lotus-dialogue-choices" data-dialogue-choices></div>
    <div class="lotus-dialogue-hint" data-dialogue-hint></div>
  </div>`
  host.appendChild(overlayEl)
  return overlayEl
}

function bindKeyboard() {
  if (keyHandler) return
  keyHandler = (e: KeyboardEvent) => {
    if (!overlayEl?.classList.contains('visible')) return
    if (e.code === 'Space' || e.code === 'Enter') {
      e.preventDefault()
      advance()
    }
    const digit = e.code.startsWith('Digit') ? Number(e.code.replace('Digit', '')) : 0
    if (digit >= 1 && digit <= 9) {
      const idx = digit - 1
      const choices = overlayEl.querySelectorAll('.lotus-dialogue-choice')
      if (idx < choices.length) {
        e.preventDefault()
        choose(idx)
      }
    }
  }
  window.addEventListener('keydown', keyHandler)
}

function unbindKeyboard() {
  if (!keyHandler) return
  window.removeEventListener('keydown', keyHandler)
  keyHandler = null
}

/** Render the current dialogue node into #lotus-dialogue-overlay. */
export function renderRpgDialogueUi(snap: DialogueSnapshot | null, parent?: HTMLElement) {
  if (!snap?.node) {
    if (overlayEl) overlayEl.classList.remove('visible')
    return
  }
  const root = ensureOverlay(parent)
  root.classList.add('visible')

  const speaker = root.querySelector('[data-dialogue-speaker]') as HTMLElement | null
  const body = root.querySelector('[data-dialogue-body]') as HTMLElement | null
  const choicesEl = root.querySelector('[data-dialogue-choices]') as HTMLElement | null
  const hint = root.querySelector('[data-dialogue-hint]') as HTMLElement | null
  if (!speaker || !body || !choicesEl || !hint) return

  const node = snap.node
  speaker.textContent = node.speaker ?? ''
  speaker.style.display = node.speaker ? 'block' : 'none'
  body.textContent = node.text

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
        choose(i)
      })
      choicesEl.appendChild(btn)
    })
    hint.textContent = 'Choose a response · 1–9 keys'
  } else {
    hint.textContent = node.nextId ? 'Press E, Space, or Enter to continue' : 'Press E, Space, or Enter to close'
  }
}

export function mountRpgDialogueUi(parent: HTMLElement = document.body) {
  mountParent = parent
  ensureOverlay(parent)
  bindKeyboard()
}

export function unmountRpgDialogueUi() {
  unbindKeyboard()
  overlayEl?.remove()
  overlayEl = null
  mountParent = null
}