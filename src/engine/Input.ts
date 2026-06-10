/**
 * Input — global key state for gameplay scripts and pawn controllers
 * (the UInput / Godot Input singleton analog).
 */
class InputSystem {
  private keys = new Set<string>()
  private pressedThisFrame = new Set<string>()

  constructor() {
    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressedThisFrame.add(e.code)
      this.keys.add(e.code)
    })
    window.addEventListener('keyup', (e) => this.keys.delete(e.code))
    window.addEventListener('blur', () => this.keys.clear())
  }

  /** true while the key is held */
  isDown(code: string): boolean {
    return this.keys.has(code)
  }

  /** true only on the frame the key went down */
  justPressed(code: string): boolean {
    return this.pressedThisFrame.has(code)
  }

  /** called once per frame by the viewport loop */
  endFrame() {
    this.pressedThisFrame.clear()
  }
}

export const Input = new InputSystem()
