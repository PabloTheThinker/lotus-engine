import { create } from 'zustand'
import { loadViewportPrefs, saveViewportPrefs, type ViewportLayout, type ViewportPane } from './viewportLayout'

export type GizmoMode = 'select' | 'translate' | 'rotate' | 'scale'
/** UE main-toolbar Modes: Select / Landscape / Foliage / Paint */
export type EditorMode = 'select' | 'landscape' | 'foliage' | 'paint'

export function deriveEditorMode(s: {
  foliagePaint: boolean
  sculptActive: boolean
  sculptTool: import('../engine/types').SculptTool
}): EditorMode {
  if (s.foliagePaint) return 'foliage'
  if (s.sculptActive && s.sculptTool === 'paint') return 'paint'
  if (s.sculptActive) return 'landscape'
  return 'select'
}
export type ViewMode = 'lit' | 'unlit' | 'wireframe' | 'detail' | 'pathtraced'
export type BuiltinBottomTab = 'content' | 'script' | 'blueprint' | 'material' | 'metasound' | 'anim' | 'sequencer' | 'console' | 'ai' | 'debug' | 'pcg'
export type BottomTab = BuiltinBottomTab | `plugin:${string}`

export interface ConsoleEntry {
  level: 'log' | 'error' | 'cmd' | 'ai'
  message: string
}

interface EditorState {
  // selection — selectedId is the primary (gizmo/details target);
  // selectedIds is the full multi-selection
  selectedId: string | null
  selectedIds: string[]
  select: (id: string | null) => void
  toggleSelect: (id: string) => void

  // gizmo
  gizmoMode: GizmoMode
  setGizmoMode: (m: GizmoMode) => void
  snapEnabled: boolean
  toggleSnap: () => void
  /** UE Surface Snapping: drop/release aligns actors to the surface below */
  surfaceSnap: boolean
  toggleSurfaceSnap: () => void
  translateSnap: number
  setTranslateSnap: (v: number) => void
  rotateSnapDeg: number
  setRotateSnapDeg: (v: number) => void
  scaleSnap: number
  setScaleSnap: (v: number) => void
  /** UE camera speed (1–8) */
  cameraSpeed: number
  setCameraSpeed: (v: number) => void
  /** UE Pilot Actor: editor camera drives this actor */
  pilotingId: string | null
  setPiloting: (id: string | null) => void

  // play-in-editor
  playing: boolean
  /** Simulate runs the world without possessing a pawn (UE Alt+S). */
  simulate: boolean
  /** Ejected: PIE keeps running but the editor camera is back (UE F8). */
  ejected: boolean
  startPlay: (mode: 'pie' | 'simulate') => void
  stopPlay: () => void
  /** UE pause + frame-step */
  paused: boolean
  setPaused: (v: boolean) => void
  /** Blueprint exec breakpoint — set when __bpBreakpoint pauses play (v0.63) */
  breakpointHit: { actorId: string; nodeId: string } | null
  setBreakpointHit: (h: { actorId: string; nodeId: string } | null) => void
  continueFromBreakpoint: () => void
  stepFrames: number
  requestStep: () => void
  setPlaying: (p: boolean) => void
  setEjected: (e: boolean) => void

  // viewport render mode (UE view modes: Lit / Unlit / Wireframe)
  viewMode: ViewMode
  setViewMode: (m: ViewMode) => void
  /** UE viewport projection (Alt+G/H/J/K) */
  viewProjection: 'perspective' | 'top' | 'front' | 'side'
  setViewProjection: (p: 'perspective' | 'top' | 'front' | 'side') => void

  /** UE viewport layouts — single pane or 2×2 quad (v0.45) */
  viewportLayout: ViewportLayout
  setViewportLayout: (l: ViewportLayout) => void
  activeViewportPane: ViewportPane
  setActiveViewportPane: (p: ViewportPane) => void
  maximizedPane: ViewportPane | null
  setMaximizedPane: (p: ViewportPane | null) => void

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

  /** Bumped during Play so Details/Debug mirror live actor state. */
  liveVersion: number
  bumpLive: () => void

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
  /** UE Content Drawer — floating overlay when unpinned (Ctrl+Space) */
  contentDrawerOpen: boolean
  openContentDrawer: () => void
  closeContentDrawer: () => void
  toggleContentDrawer: () => void
  /** UE "Dock in Layout" — pinned drawer stays open and does not auto-collapse */
  contentDrawerDocked: boolean
  toggleContentDrawerDocked: () => void
  placeActorsOpen: boolean
  togglePlaceActors: () => void

  // bottom dock (Godot bottom-panel pattern)
  bottomTab: BottomTab
  setBottomTab: (t: BottomTab) => void

  /** MetaSound asset open in the bottom dock editor */
  editingMetaSoundId: string | null
  setEditingMetaSound: (id: string | null) => void

  // console / output log
  consoleEntries: ConsoleEntry[]
  pushConsole: (level: ConsoleEntry['level'], message: string) => void
  clearConsole: () => void

  // foliage paint mode (UE Foliage mode)
  foliagePaint: boolean
  setFoliagePaint: (v: boolean) => void

  // landscape sculpt mode (UE Landscape mode)
  sculptActive: boolean
  setSculptActive: (v: boolean) => void
  /** UE Modes dropdown — switches select / landscape / foliage / paint */
  setEditorMode: (m: EditorMode) => void
  sculptTool: import('../engine/types').SculptTool
  setSculptTool: (t: import('../engine/types').SculptTool) => void
  sculptRadius: number
  setSculptRadius: (r: number) => void
  sculptStrength: number
  setSculptStrength: (v: number) => void
  paintLayer: number
  setPaintLayer: (l: number) => void

  // Play From Here — spawn override consumed by the viewport at play start
  pendingSpawn: [number, number, number] | null
  setPendingSpawn: (p: [number, number, number] | null) => void

  // terminal — focus request nonce (Console panel watches this)
  consoleFocusNonce: number
  openConsole: () => void

  // sequencer transport
  seqPlaying: boolean
  setSeqPlaying: (v: boolean) => void
  seqTime: number
  setSeqTime: (t: number) => void

  // Take Recorder: sample the selected actor into sequencer keys while playing
  takeRecording: boolean
  setTakeRecording: (v: boolean) => void

  // preferences modal
  showPrefs: boolean
  setShowPrefs: (v: boolean) => void

  // keyboard shortcuts editor
  showShortcutEditor: boolean
  setShowShortcutEditor: (v: boolean) => void

  // plugin manager modal
  showPluginManager: boolean
  setShowPluginManager: (v: boolean) => void

  // external CLI bridge (dev WebSocket)
  bridgeConnected: boolean
  setBridgeConnected: (v: boolean) => void
}

const viewportPrefs = loadViewportPrefs()

export const useEditor = create<EditorState>((set) => ({
  selectedId: null,
  selectedIds: [],
  select: (id) => set({ selectedId: id, selectedIds: id ? [id] : [] }),
  toggleSelect: (id) =>
    set((s) => {
      const ids = s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id]
      return { selectedIds: ids, selectedId: ids[ids.length - 1] ?? null }
    }),

  gizmoMode: 'select',
  setGizmoMode: (m) => set({ gizmoMode: m }),
  snapEnabled: false,
  toggleSnap: () => set((s) => ({ snapEnabled: !s.snapEnabled })),
  surfaceSnap: false,
  toggleSurfaceSnap: () => set((s) => ({ surfaceSnap: !s.surfaceSnap })),
  translateSnap: 0.5,
  setTranslateSnap: (v) => set({ translateSnap: v }),
  rotateSnapDeg: 15,
  setRotateSnapDeg: (v) => set({ rotateSnapDeg: v }),
  scaleSnap: 0.25,
  setScaleSnap: (v) => set({ scaleSnap: v }),
  cameraSpeed: 4,
  setCameraSpeed: (v) => set({ cameraSpeed: v }),
  pilotingId: null,
  setPiloting: (id) => set({ pilotingId: id }),

  playing: false,
  simulate: false,
  ejected: false,
  startPlay: (mode) => set({ playing: true, simulate: mode === 'simulate', ejected: false, paused: false, breakpointHit: null }),
  stopPlay: () => set({ playing: false, simulate: false, ejected: false, paused: false, breakpointHit: null }),
  paused: false,
  setPaused: (v) => set({ paused: v }),
  breakpointHit: null,
  setBreakpointHit: (h) => set({ breakpointHit: h }),
  continueFromBreakpoint: () => set({ paused: false, breakpointHit: null }),
  stepFrames: 0,
  requestStep: () => set((st) => ({ stepFrames: st.stepFrames + 1 })),
  setPlaying: (p) => set(p ? { playing: true, simulate: false, ejected: false } : { playing: false, simulate: false, ejected: false }),
  setEjected: (e) => set({ ejected: e }),

  viewMode: 'lit',
  setViewMode: (m) => set({ viewMode: m }),
  viewProjection: 'perspective',
  setViewProjection: (p) => set({ viewProjection: p, activeViewportPane: p }),

  viewportLayout: viewportPrefs.layout,
  setViewportLayout: (l) =>
    set((s) => {
      const next = { layout: l, maximizedPane: l === 'quad' ? s.maximizedPane : null }
      saveViewportPrefs(next)
      return {
        viewportLayout: l,
        maximizedPane: next.maximizedPane,
        activeViewportPane: l === 'quad' ? s.activeViewportPane : 'perspective',
      }
    }),
  activeViewportPane: 'perspective',
  setActiveViewportPane: (p) => set({ activeViewportPane: p, viewProjection: p }),
  maximizedPane: viewportPrefs.maximizedPane,
  setMaximizedPane: (p) =>
    set((s) => {
      const next = { layout: s.viewportLayout, maximizedPane: p }
      saveViewportPrefs(next)
      return { maximizedPane: p, activeViewportPane: p ?? s.activeViewportPane }
    }),

  gameView: false,
  toggleGameView: () => set((s) => ({ gameView: !s.gameView })),

  gizmoSpace: 'world',
  toggleGizmoSpace: () => set((s) => ({ gizmoSpace: s.gizmoSpace === 'world' ? 'local' : 'world' })),

  sceneVersion: 0,
  touch: () => set((s) => ({ sceneVersion: s.sceneVersion + 1 })),

  liveVersion: 0,
  bumpLive: () => set((s) => ({ liveVersion: s.liveVersion + 1 })),

  canUndo: false,
  canRedo: false,
  setHistoryState: (u, r) => set({ canUndo: u, canRedo: r }),

  levelName: 'Untitled',
  setLevelName: (n) => set({ levelName: n }),

  statusMessage: 'Ready',
  setStatus: (m) => set({ statusMessage: m }),

  contentBrowserOpen: true,
  toggleContentBrowser: () => set((s) => ({ contentBrowserOpen: !s.contentBrowserOpen })),

  contentDrawerOpen: false,
  openContentDrawer: () =>
    set((s) =>
      s.contentDrawerDocked
        ? { bottomTab: 'content', contentBrowserOpen: true }
        : { contentDrawerOpen: true },
    ),
  closeContentDrawer: () =>
    set((s) =>
      s.contentDrawerDocked
        ? s.bottomTab === 'content'
          ? { contentBrowserOpen: false }
          : {}
        : { contentDrawerOpen: false },
    ),
  toggleContentDrawer: () =>
    set((s) => {
      if (s.contentDrawerDocked) {
        const onContent = s.contentBrowserOpen && s.bottomTab === 'content'
        return onContent
          ? { contentBrowserOpen: false }
          : { bottomTab: 'content', contentBrowserOpen: true }
      }
      return { contentDrawerOpen: !s.contentDrawerOpen }
    }),
  contentDrawerDocked: true,
  toggleContentDrawerDocked: () =>
    set((s) => {
      const docked = !s.contentDrawerDocked
      if (docked) {
        return {
          contentDrawerDocked: true,
          contentDrawerOpen: false,
          bottomTab: 'content',
          contentBrowserOpen: true,
        }
      }
      return {
        contentDrawerDocked: false,
        contentDrawerOpen: s.contentBrowserOpen && s.bottomTab === 'content',
        contentBrowserOpen: s.bottomTab === 'content' ? false : s.contentBrowserOpen,
      }
    }),

  placeActorsOpen: true,
  togglePlaceActors: () => set((s) => ({ placeActorsOpen: !s.placeActorsOpen })),

  bottomTab: 'content',
  setBottomTab: (t) => set({ bottomTab: t, contentBrowserOpen: true }),

  editingMetaSoundId: null,
  setEditingMetaSound: (id) => set({ editingMetaSoundId: id, bottomTab: 'metasound', contentBrowserOpen: true }),

  consoleEntries: [],
  pushConsole: (level, message) =>
    set((s) => ({ consoleEntries: [...s.consoleEntries.slice(-199), { level, message }] })),
  clearConsole: () => set({ consoleEntries: [] }),

  foliagePaint: false,
  setFoliagePaint: (v) => set(v ? { foliagePaint: true, sculptActive: false } : { foliagePaint: false }),

  sculptActive: false,
  setSculptActive: (v) =>
    set(() => (v ? { sculptActive: true, foliagePaint: false } : { sculptActive: false })),
  setEditorMode: (m) =>
    set((s) => {
      switch (m) {
        case 'select':
          return { foliagePaint: false, sculptActive: false }
        case 'landscape':
          return {
            foliagePaint: false,
            sculptActive: true,
            sculptTool: s.sculptTool === 'paint' ? 'raise' : s.sculptTool,
          }
        case 'foliage':
          return { foliagePaint: true, sculptActive: false }
        case 'paint':
          return { foliagePaint: false, sculptActive: true, sculptTool: 'paint' }
      }
    }),
  sculptTool: 'raise',
  setSculptTool: (t) => set({ sculptTool: t }),
  sculptRadius: 5,
  setSculptRadius: (r) => set({ sculptRadius: r }),
  sculptStrength: 0.35,
  setSculptStrength: (v) => set({ sculptStrength: v }),
  paintLayer: 0,
  setPaintLayer: (l) => set({ paintLayer: l }),

  pendingSpawn: null,
  setPendingSpawn: (p) => set({ pendingSpawn: p }),

  consoleFocusNonce: 0,
  openConsole: () =>
    set((s) => ({
      bottomTab: 'console',
      contentBrowserOpen: true,
      consoleFocusNonce: s.consoleFocusNonce + 1,
    })),

  seqPlaying: false,
  setSeqPlaying: (v) => set({ seqPlaying: v }),
  seqTime: 0,
  setSeqTime: (t) => set({ seqTime: t }),

  takeRecording: false,
  setTakeRecording: (v) => set({ takeRecording: v }),

  showPrefs: false,
  setShowPrefs: (v) => set({ showPrefs: v }),

  showShortcutEditor: false,
  setShowShortcutEditor: (v) => set({ showShortcutEditor: v }),

  showPluginManager: false,
  setShowPluginManager: (v) => set({ showPluginManager: v }),

  bridgeConnected: false,
  setBridgeConnected: (v) => set({ bridgeConnected: v }),
}))
