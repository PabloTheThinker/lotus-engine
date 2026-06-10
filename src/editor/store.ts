import { create } from 'zustand'

export type GizmoMode = 'select' | 'translate' | 'rotate' | 'scale'
export type ViewMode = 'lit' | 'unlit' | 'wireframe' | 'detail'
export type BottomTab = 'content' | 'script' | 'console' | 'ai'

export interface ConsoleEntry {
  level: 'log' | 'error' | 'cmd' | 'ai'
  message: string
}

interface EditorState {
  // selection
  selectedId: string | null
  select: (id: string | null) => void

  // gizmo
  gizmoMode: GizmoMode
  setGizmoMode: (m: GizmoMode) => void
  snapEnabled: boolean
  toggleSnap: () => void
  translateSnap: number
  rotateSnapDeg: number
  scaleSnap: number

  // play-in-editor
  playing: boolean
  /** Simulate runs the world without possessing a pawn (UE Alt+S). */
  simulate: boolean
  /** Ejected: PIE keeps running but the editor camera is back (UE F8). */
  ejected: boolean
  startPlay: (mode: 'pie' | 'simulate') => void
  stopPlay: () => void
  setPlaying: (p: boolean) => void
  setEjected: (e: boolean) => void

  // viewport render mode (UE view modes: Lit / Unlit / Wireframe)
  viewMode: ViewMode
  setViewMode: (m: ViewMode) => void

  // G — game view: hide all editor-only visuals
  gameView: boolean
  toggleGameView: () => void

  // gizmo transform space (world/local)
  gizmoSpace: 'world' | 'local'
  toggleGizmoSpace: () => void

  // scene version — bumped whenever the world mutates so React panels re-render.
  // The Three.js scene graph stays the source of truth; React just mirrors it.
  sceneVersion: number
  touch: () => void

  // undo/redo availability (mirrored from the command stack)
  canUndo: boolean
  canRedo: boolean
  setHistoryState: (u: boolean, r: boolean) => void

  levelName: string
  setLevelName: (n: string) => void

  statusMessage: string
  setStatus: (m: string) => void

  contentBrowserOpen: boolean
  toggleContentBrowser: () => void

  // bottom dock (Godot bottom-panel pattern)
  bottomTab: BottomTab
  setBottomTab: (t: BottomTab) => void

  // console / output log
  consoleEntries: ConsoleEntry[]
  pushConsole: (level: ConsoleEntry['level'], message: string) => void
  clearConsole: () => void

  // Play From Here — spawn override consumed by the viewport at play start
  pendingSpawn: [number, number, number] | null
  setPendingSpawn: (p: [number, number, number] | null) => void
}

export const useEditor = create<EditorState>((set) => ({
  selectedId: null,
  select: (id) => set({ selectedId: id }),

  gizmoMode: 'select',
  setGizmoMode: (m) => set({ gizmoMode: m }),
  snapEnabled: false,
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
  translateSnap: 0.5,
  rotateSnapDeg: 15,
  scaleSnap: 0.25,

  playing: false,
  simulate: false,
  ejected: false,
  startPlay: (mode) => set({ playing: true, simulate: mode === 'simulate', ejected: false }),
  stopPlay: () => set({ playing: false, simulate: false, ejected: false }),
  setPlaying: (p) => set(p ? { playing: true, simulate: false, ejected: false } : { playing: false, simulate: false, ejected: false }),
  setEjected: (e) => set({ ejected: e }),

  viewMode: 'lit',
  setViewMode: (m) => set({ viewMode: m }),

  gameView: false,
  toggleGameView: () => set((s) => ({ gameView: !s.gameView })),

  gizmoSpace: 'world',
  toggleGizmoSpace: () => set((s) => ({ gizmoSpace: s.gizmoSpace === 'world' ? 'local' : 'world' })),

  sceneVersion: 0,
  touch: () => set((s) => ({ sceneVersion: s.sceneVersion + 1 })),

  canUndo: false,
  canRedo: false,
  setHistoryState: (u, r) => set({ canUndo: u, canRedo: r }),

  levelName: 'Untitled',
  setLevelName: (n) => set({ levelName: n }),

  statusMessage: 'Ready',
  setStatus: (m) => set({ statusMessage: m }),

  contentBrowserOpen: true,
  toggleContentBrowser: () => set((s) => ({ contentBrowserOpen: !s.contentBrowserOpen })),

  bottomTab: 'content',
  setBottomTab: (t) => set({ bottomTab: t, contentBrowserOpen: true }),

  consoleEntries: [],
  pushConsole: (level, message) =>
    set((s) => ({ consoleEntries: [...s.consoleEntries.slice(-199), { level, message }] })),
  clearConsole: () => set({ consoleEntries: [] }),

  pendingSpawn: null,
  setPendingSpawn: (p) => set({ pendingSpawn: p }),
}))
