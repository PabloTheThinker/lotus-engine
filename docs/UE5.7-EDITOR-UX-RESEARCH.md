# UE5.7 Editor UX Research

> Subagent research against the official Unreal Engine 5.7 documentation
> (dev.epicgames.com/documentation/unreal-engine/unreal-engine-5-7-documentation).
> Focus: how the editor *operates and feels* — not what tools exist (see the
> tool census in ROADMAP.md for that). Drives the UE-fidelity UX waves
> (v0.20+). Sources listed at the bottom.

**Critical 5.7-specific finding first:** UE5.7 ships the *redesigned unified viewport toolbar* (introduced 5.5, now mandatory): "This viewport toolbar replaces the previous viewport toolbar entirely for the Level Viewport." The classic layout (viewport-options hamburger top-left, transform buttons top-right) is the **legacy** arrangement. In 5.7 everything lives in one bar grouped left→right: **Transform & Snapping | Camera | View Modes + Show | Performance/Scalability | Viewport Settings**. The perspective/ortho switcher moved *inside the Camera menu*. For maximum recognition from veteran users, the legacy layout is still what most tutorials show. Both documented below.

---

## 1. Viewport toolbar (5.7 layout, left→right)

- **Transform tools:** Select Objects (Q), Select and Translate (W), Select and Rotate (E), Select and Scale (R). Spacebar cycles tools.
- **Coordinate space toggle:** "World Space Coordinates" / "Local Space Coordinates" globe icon, shortcut **Ctrl+`**.
- **Snapping cluster:** Surface Snapping toggle (with "Rotate to Surface Normal" checkbox and "Surface Offset" value), then three toggle+value pairs — Drag Grid, Rotation Grid, Scale Grid. Clicking the value opens a dropdown of presets or a custom-value field.
  - **Drag Grid presets** (editor defaults, configurable in Editor Preferences > Viewports > Snap): **1, 5, 10, 50, 100, 500, 1000, 5000, 10000** cm — default **10**. Alt set "Power of Two" (1,2,4…1024) selectable in prefs.
  - **Rotation Grid** (confirmed in Actor Snapping doc): common angles **5, 10, 15, 30, 45, 60, 90, 120°** plus 360-division column **2.8125, 5.625, 11.25, 22.5°** — default **10°**.
  - **Scale Grid:** **10, 1, 0.5, 0.25, 0.125, 0.0625, 0.03125** — default **0.25**; "use percentage values" option in prefs.
- **Camera menu:** Field of View, Near/Far View Planes, Exposure override (EV100 slider or "Auto"), **Camera Speed slider 1–8 + "Speed Scalar"** multiplier (RMB-held + scroll wheel also changes speed live), Movement Options ("Pilot [Selected Actor]", "Stop Piloting Actor", "Frame Selected", orbit options, "Link Ortho Camera Movement"), and the **Perspective / Orthographic (Top, Bottom, Left, Right, Front, Back)** switcher.
- **View Modes menu** (with hotkeys): Lit **Alt+4**, Unlit **Alt+3**, Wireframe **Alt+2**, Detail Lighting **Alt+5**, Lighting Only **Alt+6**, Light Complexity **Alt+7**, Shader Complexity **Alt+8**, Lightmap Density **Alt+0**, plus Optimization Viewmodes and Buffer Visualization submenus (Base Color, World Normal, Roughness, Metallic, Scene Depth, AO, etc.).
- **Show menu:** show flags grouped by category (Common: Grid, Bounds, Collision; then Advanced/Developer/Visualize groups), "Use Defaults" reset.
- **Performance group:** Realtime toggle (**Ctrl+R**), preview platform, scalability, material quality, screen percentage.
- **Viewport Settings menu (rightmost):** Viewport Layouts (one→four panes + "Immersive View"), realtime, fullscreen/immersive, High-Resolution Screenshot, Level Editor Volume (dB), mouse sensitivity, Game View, bookmarks (Create Camera Here / bookmark options live here under "Create").

*Web equivalent:* one flat toolbar overlaying the canvas top edge — left cluster of 4 icon-toggles + globe + 3 snap toggle/value pairs + camera-speed button; right cluster of 3 dropdown menus (View Mode, Show, Settings).

## 2. Viewport interaction

- **Ortho:** cycle viewport type with **Alt+G/H/J/K** = Perspective/Front/Side/Top. Ortho nav: RMB-drag pans (no rotation), wheel zooms (option "Orthographic Zoom to Cursor Position"), "Link Orthographic Viewport Movement" syncs all ortho panes. Ortho is wireframe (Alt+2) by default with a measure-able 2D grid.
- **Perspective nav:** LMB-drag = forward/turn, RMB-drag = look, LMB+RMB or MMB = pan; RMB+WASD flight; **RMB+wheel adjusts camera speed live**; Alt+LMB orbit, Alt+RMB dolly, Alt+MMB track; **F = Frame Selected** (sets orbit pivot to selection bounds — orbit always pivots around last-framed point).
- **Layouts:** Viewport Layouts menu — 1 pane, 2 panes (side-by-side/stacked), 3 panes (4 arrangements), 4 panes (default quad: Perspective + Top + Front + Side). Maximize/restore via the corner button on each pane; default layout is one maximized pane that restores to quad.
- **Immersive: F11** (viewport fills the whole window). **Game View: G** (hides all editor-only icons/gizmos/grid). **Bookmarks: Ctrl+0–9 set, 0–9 jump**, stored per level.
- **Pilot:** right-click actor → **"Pilot 'ActorName'"** (Ctrl+Shift+P) — camera snaps to look down the actor's +X; flying the camera drags the actor; upper-left of viewport shows a **pilot banner: "Pilot Actor: <name>"** with an **Eject icon** and (for cameras) a **toggle-camera-view/letterbox preview button**; eject leaves the actor at its new transform and unlocks the camera. Also reachable via Camera menu → Movement Options.

*Web equivalent:* single canvas — implement Alt+G/H/J/K as camera-mode swaps on one canvas (ortho camera + pan-only controls + wireframe), F-framing that sets orbit pivot, G to hide helpers, a pilot mode that parents selection to camera with a top-left banner + eject button.

## 3. Content Drawer / Browser

- **Ctrl+Space** (Cmd+Space mac) summons the drawer sliding up from the bottom status bar; it **"automatically minimizes when it loses focus (when you click away from it)"**; a **"Dock in Layout"** button (top-right of drawer) converts it into a persistent Content Browser tab — and you can still open a fresh drawer afterward. Up to **4 Content Browser instances**.
- Zones: Navigation bar (add/import/save buttons, back/forward history, breadcrumb path), Sources panel (Favorites + folder tree, real-time folder filter), Collections (with asset counts), Filters column, Search bar, Asset View (tile/list/column, thumbnail-scale slider in Settings), Settings button.
- Asset tiles: color-coded bottom stripe by asset type, hover tooltip with asset metadata; drag-drop into level spawns; right-click asset = Edit, Rename (F2), Duplicate (Ctrl+D), Save, Browse, asset-type-specific actions.

*Web equivalent:* bottom slide-up drawer on Ctrl+Space with click-outside auto-collapse and a "Dock in Layout" pin button — this single behavior is the most recognizable Content Browser trait.

## 4. Details panel

- **"Search Details"** filter box at top — typing live-filters properties, clear button resets. Below it: transform section first, then category sections (Transform, Static Mesh, Materials, Physics, Rendering, Collision, Actor, LOD…) as collapsible headers, declared per-property in code.
- **Reset-to-default:** when a value differs from default "an indicator is displayed" — the yellow ⟲ arrow to the property's right; click to reset. Right-click property → Copy / Paste / Reset to Default / Copy Display Name.
- Edit conditions gray out dependent properties; `editconst` props are read-only highlighted. Favorites (star) is an Experimental pref. Panel can be **locked** (padlock icon) to keep showing an actor while selection changes; up to 4 Details panels (Window > Details 1–4). Multi-select shows shared properties; differing values display **"Multiple Values"**; editing writes to all.

*Web equivalent:* search filter + collapsible category headers + per-row yellow reset arrow that appears only when non-default + "Multiple Values" placeholder on multi-select.

## 5. Outliner

- Hierarchical tree of all actors; columns: pin, visibility eye (per-row hover eye), **Item Label**, **Type** — right-click column header to add/remove columns, drag edges to resize. Search supports `-term` (exclude) and `+term` (exact match); saved **Custom Filters** in the filter dropdown. **F** in Outliner frames in viewport; "Always Frame Selection" toggle in its Settings menu. Drag-drop = attach (child indents under parent). Up to **4 Outliner instances** (Window menu).
- Right-click actor menu (canonical UE5 sections, in order): asset header (Edit <asset>, Browse to Asset) → **Edit** (Cut/Copy/Paste/Duplicate Ctrl+W/Delete/Rename F2) → **Play From Here** → **Pilot 'name'** → **Snapping** (Snap Origin to Grid, Snap to Floor *End*, Align to Floor, Snap Pivot…) → **Transform** (Mirror X/Y/Z, Delta Transform, Lock Actor Movement) → **Visibility** (Hide Selected *H*, Show Selected Only, Show All *Ctrl+H*) → **Select** (All of same class, children, parent…) → **Attach To… / Detach** → **Group** (Ctrl+G) → **Level** (Make Current, Move Selection to Current Level) → **Bookmarks** → Add Event / Convert To.

*Web equivalent:* tree with hover-eye visibility column, a Type column, pin column, `-`/`+` search operators, and the sectioned right-click menu above.

## 6. Main toolbar + menus

- Toolbar order (left→right): **Save** (current level) → level name/revision-control widget → **Modes dropdown** ("Select" by default: Selection, Landscape, Foliage, Mesh Paint, Modeling, Fracture, Brush Editing, Animation) → **Create/Add** (quickly-add content: Place Actors categories, Import, Add Feature, Content Packs) → **Blueprints** (Open Level Blueprint, new BP class) → **Cinematics** (Add Level Sequence / Master Sequence) → **Play cluster: Play ▶ | Frame Skip | Stop ■ | Eject** with a ⋮ dropdown for modes → **Platforms** dropdown → far right **Settings (Quick Settings)**: six groups — Selection, Scalability, Real Time Audio, Snapping, Viewport, Previewing.
- Menus: **File** (New/Open/Save Level, Save All Ctrl+Shift+S, Open Asset Ctrl+P, recent levels), **Edit** (Undo/Redo history, Cut/Copy/Paste/Duplicate/Delete, Editor Preferences, Project Settings, Plugins), **Window** (every panel: Outliner 1–4, Details 1–4, Content Browser, Place Actors, Output Log, Layouts save/load), **Tools** (debug/profile/class viewer), **Build** (Build Lighting, Build All, paths/HLOD), **Select** (All Ctrl+A, None Esc, Invert, by class), **Actor** (mirror of the right-click actor menu), **Help**.
- **Bottom status bar:** Content Drawer button (Ctrl+Space), **Output Log + `Cmd ▸ Enter Console Command` inline console field**, Derived Data, Save Status, Revision Control.

*Web equivalent:* slim top toolbar with exactly this button order plus a bottom status bar containing the Content Drawer button and an inline console input — the bottom bar is highly recognizable.

## 7. Console

- **`** / **~** opens the in-viewport console: one press = single-line overlay at bottom; second press = half-screen console with log scrollback; also the always-visible `Cmd` field in the status bar. **Autocomplete:** as you type, a popup lists matching commands/cvars with their help text; arrows navigate, Tab/Enter completes; **typing a cvar with no value prints its current value**; `cvar ?` prints help; Up-arrow recalls history.
- Must-have commands: `stat fps`, `stat unit` (rows **Frame / Game / Draw / GPU** — "if Frame ≈ Game, game-thread-bound; if Frame ≈ Draw, render-thread-bound"), `stat gpu`, `stat unitgraph`, `stat scenerendering`, `stat memory`, `stat none` (clear); cvars `r.ScreenPercentage 50–200`, `t.MaxFPS 60`, `slomo 0.5` (time dilation), `show collision`, `r.VSync`.

*Web equivalent:* backtick overlay console with fuzzy autocomplete popup + a working `stat fps`/`stat unit` HUD (Frame/Game/Draw/GPU rows, ms + color thresholds) — enormous recognition for tiny effort.

## 8. Editor Preferences

Most-touched: **Level Editor > Viewports** — Flight Camera Control ("Use WASD for Camera Controls"), Mouse Scroll Camera Speed, Invert Mouse Look/Orbit axes, Orthographic Zoom to Cursor Position, Link Orthographic Viewport Movement, and the **Snap category** (Drag/Rotation/Scale grid preset arrays live here, percentage-scale option). **Loading & Saving > Auto Save** — "Enable AutoSave", Save Maps, Save Packages, **Frequency in Minutes (default 10)**, "Warning in Seconds" countdown toast before autosave. Appearance ("Use Small Tool Bar Icons"), Keyboard Shortcuts (fully rebindable, searchable).

*Web equivalent:* a single Preferences modal with Viewports (speed/invert/zoom-to-cursor) + Auto Save (toggle + minutes + warning toast) + editable snap preset lists.

## 9. Place Actors / world building

- Panel categories in exact order: **Recently Placed** (rolling last 20 types), **Basic** (Empty Actor, Player Start, triggers, planes, Pawn), **Lights** (Directional/Point/Spot/Rect/Sky), **Shapes** (Cube, Sphere, Cylinder, Cone, Plane), **Cinematic** (CineCamera + rigs), **Visual Effects** (PostProcess/fog/volumetrics), **Geometry** (brushes), **Volumes**, **All Classes** — plus a search bar.
- Placement: drag from panel/Content Browser → a live **ghost preview of the actor follows the cursor and slides along whatever surface is under it** (surface trace placement); release to spawn at that point; right-click in viewport → "Place Actor" submenu spawns at clicked location. Surface Snapping toggle adds normal-alignment on placement/move.

*Web equivalent:* the Create menu reproducing those 9 category names, and drag-spawn with raycast-follow translucent ghost — the surface-tracking ghost is the signature feel.

## 10. PIE

- Play ⋮ dropdown: **Selected Viewport (default), New Editor Window (PIE), VR Preview, Standalone Game, Mobile Preview ES3.1 (PIE)** + Simulate (Alt+S) + "Play From Here" via right-click in viewport. Shortcuts: **Alt+P** play, **Esc** stop, **F8** eject/possess toggle, Pause.
- During PIE the toolbar morphs: **Pause, Frame Skip (enabled only while paused — single-steps one frame), Stop, Eject**; paused shows **Resume + Possess**. Viewport overlays: **"Click for Mouse Control"** prompt on start; while captured, hint **"Shift+F1 for Mouse Cursor"**. Eject = free editor camera while the game keeps running, full editing allowed; Possess returns control to the pawn.

*Web equivalent:* Play swaps toolbar to Pause/FrameSkip/Stop/Eject, with mouse-capture click prompt + Shift+F1 release, Esc to stop, frame-step while paused.

---

## TOP-15 UX changes for "feels like UE5.7" (recognition × feasibility)

> Implementation status as of v0.20+ marked inline.

1. **Snap toggle+value triplet in viewport toolbar** with exact UE preset lists (10cm/10°/0.25 defaults) — the #1 visual fingerprint of the UE viewport. ✅ shipped
2. **Q/W/E/R + Spacebar-cycle transform tools, world/local globe toggle (Ctrl+`)** — muscle memory match. ✅ Q/W/E/R + T space toggle; Spacebar cycle shipped
3. **RMB+WASD fly with RMB+scroll live speed change + camera speed 1–8 slider w/ Speed Scalar** — *the* UE navigation feel. ✅ shipped
4. **F = Frame Selected sets the orbit pivot; Alt+LMB orbit / Alt+RMB dolly** afterwards. ✅ orbit shipped
5. **Backtick console with autocomplete popup + `stat fps` / `stat unit` (Frame/Game/Draw/GPU) + `slomo`, `t.MaxFPS`, `r.ScreenPercentage`** — cheap, dripping with UE identity. ✅ shipped
6. **Content Drawer: Ctrl+Space slide-up, auto-collapse on focus loss, "Dock in Layout" button**, color-striped asset tiles. ✅ summon/auto-collapse shipped
7. **Bottom status bar** (Content Drawer button + inline `Cmd` console field + autosave/save status) — subtle but instantly "Unreal." ✅ Cmd field shipped
8. **Drag-spawn surface-tracing ghost** from Create menu/drawer, End = snap-to-floor, V = vertex snap, Surface Snapping toggle with Rotate-to-Normal. ✅ ghost + End shipped
9. **PIE toolbar morph**: Play→(Pause | Frame-Skip-when-paused | Stop | Eject), Alt+P/Esc/F8, "Click for Mouse Control" + "Shift+F1 for Mouse Cursor" overlays. ✅ pause/step/stop/F8 shipped
10. **Details panel: Search Details box, collapsible categories, yellow reset-to-default arrow appearing only on modified values, right-click Copy/Paste/Reset**. ✅ search + categories shipped; reset arrows pending
11. **Pilot mode**: right-click → "Pilot 'name'" (Ctrl+Shift+P), top-left banner with Eject icon; eject keeps the new transform. ✅ shipped
12. **G Game View + F11 Immersive + view modes with Alt+2/3/4 (Wireframe/Unlit/Lit)** — three keys, huge payoff. ✅ G + Alt keys shipped; F11 pending
13. **Outliner with Type column, hover visibility eyes, `-`/`+` search operators, drag-to-attach**, and the full sectioned right-click menu (incl. "Play From Here"). ◐ partial (type column, eyes, search, attach shipped; operators + full menu pending)
14. **Ortho views via Alt+G/H/J/K** — single-canvas camera swap to ortho+pan-only+wireframe is feasible; the **quad layout / maximize-restore is the part that depends on multi-viewport** ⚠ (fake-able later with 4 cameras + scissor viewports on one canvas). ⏳ pending
15. **Bookmarks Ctrl+0–9 / 0–9** + main-toolbar exact order (Save → Modes → Add → Blueprints → Cinematics → Play cluster → Platforms → Settings) with the Quick Settings six-group dropdown. ◐ bookmarks shipped (Shift+# set — Ctrl+# is browser-reserved on web)

⚠ Multi-viewport-dependent: only #14's layout half (and "Link Ortho Movement"). Everything else works in the single-canvas Three.js setup. Note again for fidelity decisions: 5.7's toolbar is the new unified one (transform tools left, perspective switcher inside the Camera menu); the classic split toolbar is legacy.

## Sources

- [Viewport Toolbar](https://dev.epicgames.com/documentation/unreal-engine/viewport-toolbar)
- [Viewport Controls](https://dev.epicgames.com/documentation/en-us/unreal-engine/viewport-controls-in-unreal-engine)
- [Using Editor Viewports](https://dev.epicgames.com/documentation/unreal-engine/using-editor-viewports-in-unreal-engine)
- [Viewport Modes](https://dev.epicgames.com/documentation/en-us/unreal-engine/viewport-modes-in-unreal-engine)
- [Actor Snapping](https://dev.epicgames.com/documentation/unreal-engine/actor-snapping-in-unreal-engine)
- [Content Browser](https://dev.epicgames.com/documentation/en-us/unreal-engine/content-browser-in-unreal-engine)
- [Content Browser Interface](https://dev.epicgames.com/documentation/en-us/unreal-engine/content-browser-interface-in-unreal-engine)
- [Outliner](https://dev.epicgames.com/documentation/en-us/unreal-engine/outliner-in-unreal-engine)
- [Details Panel](https://dev.epicgames.com/documentation/en-us/unreal-engine/level-editor-details-panel-in-unreal-engine)
- [Unreal Editor Interface](https://dev.epicgames.com/documentation/unreal-engine/unreal-editor-interface)
- [Quick Settings](https://dev.epicgames.com/documentation/unreal-engine/quick-settings-in-the-unreal-engine-level-toolbar)
- [Placing Actors](https://dev.epicgames.com/documentation/en-us/unreal-engine/placing-actors-in-unreal-engine)
- [Playing and Simulating](https://dev.epicgames.com/documentation/en-us/unreal-engine/playing-and-simulating-in-unreal-engine)
- [Stat Commands](https://dev.epicgames.com/documentation/en-us/unreal-engine/stat-commands-in-unreal-engine)
- [Editor Preferences](https://dev.epicgames.com/documentation/en-us/unreal-engine/unreal-editor-preferences)
- [Pilot Actors (4.27)](https://dev.epicgames.com/documentation/en-us/unreal-engine/pilot-actors-in-the-viewport?application_version=4.27)

*Caveat from the researcher: snap/scale preset arrays and bookmark keys marked "editor defaults" come from editor behavior knowledge where the docs only confirm the mechanism, not the numbers — spot-check in a live 5.7 install if exact parity matters.*
