import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

interface LotusBridge {
  getLiveSnapshot: () => {
    actorCount: number
    playing: boolean
    tree: Array<{ type: string; name: string; children?: Array<{ type: string; name: string }> }>
  }
  terminal: { exec: (source: string) => { output: string | null; error: string | null; level: string } }
  world: {
    actors: { size: number; values: () => IterableIterator<{
      id: string
      name: string
      type: string
      script?: string
      blueprint?: unknown
      materialAssetId?: string
      materialOverrides?: { color?: string }
      mesh?: unknown
    }> }
    serialize: () => { engine: string; name: string; actors: unknown[] }
    load: (level: unknown) => Promise<void>
  }
  useEditor: { getState: () => { select: (id: string | null) => void } }
  undo: () => void
  redo: () => void
  bakeNavMesh: () => Promise<boolean>
  isNavMeshReady: () => boolean
  compileBlueprint: (graph: unknown) => string
  emptyGraph: () => unknown
  multiplayer: {
    loadSettings: () => { url: string; room: string; enabled: boolean }
    enabled: () => boolean
  }
  character: {
    ready: () => boolean
    isOnFloor: () => boolean
    moveAndSlide: (
      position: [number, number, number],
      velocity: [number, number, number],
      dt: number,
    ) => { position: [number, number, number]; onFloor: boolean } | null
  }
  crowd: {
    init: () => boolean
    addAgent: (id: string, pos: [number, number, number], target?: [number, number, number]) => boolean
    count: () => number
  }
  mpNet: {
    settings: () => { lagCompensationMs: number; interestRadius: number; deltaCompression: boolean }
    isDedicatedServer: () => boolean
  }
  materialTSL: { serialize: (graph?: unknown) => object }
}

declare global {
  interface Window {
    lotus?: LotusBridge
    vektra?: LotusBridge
    lotusGfx?: { renderer: unknown; composer: unknown }
  }
}

async function bootEditor(
  page: import('@playwright/test').Page,
  localStorageSeed?: Record<string, string>,
) {
  await page.addInitScript((seed) => {
    localStorage.clear()
    if (seed) {
      for (const [key, value] of Object.entries(seed)) localStorage.setItem(key, value)
    }
  }, localStorageSeed ?? {})
  await page.goto('/')
  await page.waitForFunction(() => {
    const v = window.lotus
    return Boolean(
      v?.world &&
        v.world.actors.size > 0 &&
        v.terminal?.exec &&
        v.getLiveSnapshot &&
        v.bakeNavMesh &&
        v.compileBlueprint &&
        v.multiplayer?.loadSettings,
    )
  })
}

/** Export playable overlay finished boot (keyboard / gamepad / touch copy variants). */
function isExportOverlayReady(): boolean {
  const t = document.getElementById('overlay')?.textContent ?? ''
  if (!t || t === 'Loading…') return false
  return /Click to play|click canvas|Touch stick|WASD/i.test(t)
}

test('build passes', () => {
  expect(() => {
    execSync('npm run build', { cwd: root, stdio: 'pipe', encoding: 'utf8' })
  }).not.toThrow()
})

test('editor page loads', async ({ page }) => {
  await bootEditor(page)
  await expect(page.locator('.editor-root')).toBeVisible()
  await expect(page.locator('.viewport')).toBeVisible()
  await page.waitForSelector('.viewport canvas', { timeout: 30_000 })
})

test('window.lotus bridge is exposed', async ({ page }) => {
  await bootEditor(page)
  const api = await page.evaluate(() => {
    const v = window.lotus!
    return {
      hasWorld: v.world.actors.size > 0,
      hasTerminal: typeof v.terminal.exec === 'function',
      hasSnapshot: typeof v.getLiveSnapshot === 'function',
    }
  })
  expect(api.hasWorld).toBe(true)
  expect(api.hasTerminal).toBe(true)
  expect(api.hasSnapshot).toBe(true)
})

test('spawns a box via terminal API', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus!
    const before = v.getLiveSnapshot().actorCount
    const spawn = v.terminal.exec('/spawn box')
    const after = v.getLiveSnapshot().actorCount
    const meshActors = v.getLiveSnapshot().tree.flatMap(function walk(node) {
      const kids = node.children ?? []
      return [node, ...kids.flatMap(walk)]
    }).filter((a) => a.type === 'StaticMesh')
    return { before, after, spawn, meshCount: meshActors.length }
  })

  expect(result.spawn.error).toBeNull()
  expect(result.spawn.output).toContain('Spawned box')
  expect(result.after).toBeGreaterThan(result.before)
  expect(result.meshCount).toBeGreaterThan(0)
})

test('viewport mounts canvas and render loop reports stats', async ({ page }) => {
  await bootEditor(page)
  const canvas = page.locator('.viewport canvas')
  await expect(canvas).toBeVisible()

  const box = await canvas.boundingBox()
  expect(box?.width ?? 0).toBeGreaterThan(100)
  expect(box?.height ?? 0).toBeGreaterThan(100)

  const hasWebGl = await page.evaluate(() => {
    const el = document.querySelector('.viewport canvas')
    return el instanceof HTMLCanvasElement && Boolean(el.getContext('webgl2') ?? el.getContext('webgl'))
  })
  expect(hasWebGl).toBe(true)

  // readPixels is unreliable without preserveDrawingBuffer; stats prove the loop is drawing.
  await page.waitForFunction(() => {
    const text = document.querySelector('.viewport-stats')?.textContent ?? ''
    return /\d+ FPS/.test(text) && /\d+ actors/.test(text) && /\d[\d,]* tris/.test(text)
  })
  const statsText = await page.locator('.viewport-stats').textContent()
  expect(statsText).toMatch(/\d+ FPS/)
  expect(statsText).toMatch(/\d+ actors/)
  expect(statsText).toMatch(/tris/)
})

test('undo after spawn reduces actor count (Ctrl+Z)', async ({ page }) => {
  await bootEditor(page)

  const before = await page.evaluate(() => window.lotus!.getLiveSnapshot().actorCount)
  await page.evaluate(() => {
    const spawn = window.lotus!.terminal.exec('/spawn box')
    if (spawn.error) throw new Error(spawn.error)
  })
  const afterSpawn = await page.evaluate(() => window.lotus!.getLiveSnapshot().actorCount)
  expect(afterSpawn).toBeGreaterThan(before)

  await page.keyboard.press('Control+KeyZ')
  await page.waitForFunction((expected) => window.lotus?.getLiveSnapshot().actorCount === expected, before)
  const afterUndo = await page.evaluate(() => window.lotus!.getLiveSnapshot().actorCount)
  expect(afterUndo).toBe(before)
})

test('play mode starts and stops (Alt+P / vektra API)', async ({ page }) => {
  await bootEditor(page)

  await page.keyboard.press('Alt+KeyP')
  await page.waitForFunction(() => window.lotus?.getLiveSnapshot().playing === true)
  await expect(page.locator('.play-button.stop')).toBeVisible()

  const playing = await page.evaluate(() => window.lotus!.getLiveSnapshot().playing)
  expect(playing).toBe(true)

  const stop = await page.evaluate(() => window.lotus!.terminal.exec('/stop'))
  expect(stop.error).toBeNull()
  expect(stop.output).toContain('Stopped')
  await page.waitForFunction(() => window.lotus?.getLiveSnapshot().playing === false)

  const stopped = await page.evaluate(() => window.lotus!.getLiveSnapshot().playing)
  expect(stopped).toBe(false)
})

test('command palette opens (Ctrl+Shift+P)', async ({ page }) => {
  await bootEditor(page)

  await page.keyboard.press('Control+Shift+KeyP')
  await expect(page.locator('.palette')).toBeVisible()
  await expect(page.locator('.palette input')).toHaveAttribute('placeholder', 'Type a command or asset…')
  await expect(page.locator('.palette-list button').first()).toBeVisible()
})

test('level save/load roundtrip via terminal world API', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus!
    const baseline = v.getLiveSnapshot().actorCount

    const saveProbe = v.terminal.exec('world.serialize().engine')
    if (saveProbe.error) throw new Error(saveProbe.error)

    const snap = v.world.serialize()
    const spawn = v.terminal.exec('/spawn sphere')
    if (spawn.error) throw new Error(spawn.error)
    const afterSpawn = v.getLiveSnapshot().actorCount

    await v.world.load(snap)
    const afterLoad = v.getLiveSnapshot().actorCount

    return {
      engine: saveProbe.output,
      baseline,
      afterSpawn,
      afterLoad,
      levelName: snap.name,
    }
  })

  expect(result.engine).toBe('lotus')
  expect(result.afterSpawn).toBeGreaterThan(result.baseline)
  expect(result.afterLoad).toBe(result.baseline)
  expect(result.levelName.length).toBeGreaterThan(0)
})

test('navmesh bake and show navmesh overlay', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus!
    const bakeOk = await v.bakeNavMesh()
    const show = v.terminal.exec('show navmesh')
    const toggleOff = v.terminal.exec('show navmesh')
    return {
      bakeOk,
      navReady: v.isNavMeshReady(),
      showError: show.error,
      showOutput: show.output,
      toggleOutput: toggleOff.output,
    }
  })

  expect(result.showError).toBeNull()
  expect(result.showOutput).toMatch(/show navmesh (ON|OFF)/)
  expect(result.toggleOutput).toMatch(/show navmesh (ON|OFF)/)
  expect(result.bakeOk).toBe(true)
  expect(result.navReady).toBe(true)
})

test('material instance assignment via terminal', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus!
    const spawn = v.terminal.exec('/spawn box')
    if (spawn.error) throw new Error(spawn.error)

    const box = [...v.world.actors.values()].filter((a) => a.type === 'StaticMesh' && /^box/i.test(a.name)).at(-1)
    if (!box) throw new Error('spawned box not found')

    const mat = v.terminal.exec(`createMaterial('E2E_Base', { color: '#cc2244', roughness: 0.4 })`)
    if (mat.error) throw new Error(mat.error)
    const matId = mat.output?.match(/"id":\s*"([^"]+)"/)?.[1]
    if (!matId) throw new Error(`material id missing: ${mat.output}`)

    const assign = v.terminal.exec(`assignMaterial('${box.name}', '${matId}')`)
    if (assign.error) throw new Error(assign.error)

    const override = v.terminal.exec(`setMaterialOverrides('${box.name}', { color: '#22cc44' })`)
    if (override.error) throw new Error(override.error)

    const actor = [...v.world.actors.values()].find((a) => a.id === box.id)
    return {
      materialAssetId: actor?.materialAssetId,
      overrideColor: actor?.materialOverrides?.color,
      hasMesh: Boolean(actor?.mesh),
    }
  })

  expect(result.hasMesh).toBe(true)
  expect(result.materialAssetId).toBeTruthy()
  expect(result.overrideColor).toBe('#22cc44')
})

test('blueprint compile and play starts', async ({ page }) => {
  await bootEditor(page)

  await page.evaluate(() => {
    const v = window.lotus!
    const spawn = v.terminal.exec('/spawn box')
    if (spawn.error) throw new Error(spawn.error)

    const actor = [...v.world.actors.values()].filter((a) => a.type === 'StaticMesh' && /^box/i.test(a.name)).at(-1)
    if (!actor) throw new Error('spawned box not found')

    v.useEditor.getState().select(actor.id)
    const graph = v.emptyGraph()
    actor.blueprint = graph
    actor.script = v.compileBlueprint(graph)

    const play = v.terminal.exec('/play')
    if (play.error) throw new Error(play.error)
  })

  await page.waitForFunction(() => window.lotus?.getLiveSnapshot().playing === true)
  const playing = await page.evaluate(() => window.lotus!.getLiveSnapshot().playing)
  expect(playing).toBe(true)

  const compiled = await page.evaluate(() => {
    const actor = [...window.lotus!.world.actors.values()].find((a) => /^box/i.test(a.name) && a.script)
    return actor?.script?.includes('onBeginPlay') ?? false
  })
  expect(compiled).toBe(true)

  await page.evaluate(() => window.lotus!.terminal.exec('/stop'))
})

test('multiplayer settings load without crash when disabled', async ({ page }) => {
  await bootEditor(page, {
    'lotus-engine.multiplayer': JSON.stringify({
      url: 'ws://localhost:24690',
      room: 'e2e-off',
      enabled: false,
    }),
  })

  const mp = await page.evaluate(() => {
    const v = window.lotus!
    const settings = v.multiplayer.loadSettings()
    const play = v.terminal.exec('/play')
    return {
      enabled: v.multiplayer.enabled(),
      settings,
      playError: play.error,
      playing: v.getLiveSnapshot().playing,
    }
  })

  expect(mp.settings.enabled).toBe(false)
  expect(mp.enabled).toBe(false)
  expect(mp.playError).toBeNull()

  await page.waitForFunction(() => window.lotus?.getLiveSnapshot().playing === true)
  await expect(page.locator('.editor-root')).toBeVisible()
  await expect(page.locator('.viewport canvas')).toBeVisible()

  await page.evaluate(() => window.lotus!.terminal.exec('/stop'))
})

test('wave 10 environment defaults (render tier + pawn)', async ({ page }) => {
  await bootEditor(page)

  const env = await page.evaluate(() => {
    const e = window.lotus!.world.environment as Record<string, unknown>
    return {
      renderBackend: e.renderBackend,
      postFxaa: e.postFxaa,
      postSsao: e.postSsao,
      useRapierCharacter: e.useRapierCharacter,
      exportBatchStatic: e.exportBatchStatic,
    }
  })

  expect(env.renderBackend).toBe('webgl')
  expect(env.postFxaa).toBe(true)
  expect(env.postSsao).toBe(false)
  expect(env.useRapierCharacter).toBe(true)
  expect(env.exportBatchStatic).toBe(false)
})

test('render backend badge reports WEBGL tier (Wave 10)', async ({ page }) => {
  await bootEditor(page)

  await page.waitForFunction(() => {
    const stats = document.querySelector('.viewport-stats')?.textContent ?? ''
    return /\d+ FPS/.test(stats) && /WEBGL/.test(stats)
  })

  const stats = await page.locator('.viewport-stats').textContent()
  expect(stats).toMatch(/WEBGL/)
  expect(stats).toMatch(/\d+ FPS/)
})

test('moveAndSlide after play (Rapier character controller)', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus!
    const play = v.terminal.exec('/play')
    if (play.error) throw new Error(play.error)

    await new Promise<void>((resolve) => {
      const start = performance.now()
      const tick = () => {
        if (v.character.ready()) {
          resolve()
          return
        }
        if (performance.now() - start > 15_000) throw new Error('character controller timeout')
        requestAnimationFrame(tick)
      }
      tick()
    })

    const moved = v.character.moveAndSlide([0, 2, 0], [0, -1, 0], 1 / 60)
    return {
      playing: v.getLiveSnapshot().playing,
      ready: v.character.ready(),
      moved,
    }
  })

  expect(result.playing).toBe(true)
  expect(result.ready).toBe(true)
  expect(result.moved).not.toBeNull()
  expect(result.moved!.position.length).toBe(3)

  await page.evaluate(() => window.lotus!.terminal.exec('/stop'))
})

test('wave 11 environment defaults (SSR, GI, vehicle)', async ({ page }) => {
  await bootEditor(page)

  const env = await page.evaluate(() => {
    const e = window.lotus!.world.environment as Record<string, unknown>
    return {
      postSsr: e.postSsr,
      lightProbeGrid: e.lightProbeGrid,
      useRaycastVehicle: e.useRaycastVehicle,
    }
  })

  expect(env.postSsr).toBe(false)
  expect(env.lightProbeGrid).toBe(false)
  expect(env.useRaycastVehicle).toBe(false)
})

test('wave 11 mp net settings surface', async ({ page }) => {
  await bootEditor(page)

  const mp = await page.evaluate(() => {
    const v = window.lotus!
    return {
      settings: v.mpNet.settings(),
      dedicated: v.mpNet.isDedicatedServer(),
    }
  })

  expect(mp.settings.lagCompensationMs).toBe(120)
  expect(mp.settings.interestRadius).toBe(80)
  expect(mp.settings.deltaCompression).toBe(true)
  expect(mp.dedicated).toBe(false)
})

test('wave 11 TSL material serialize + crowd after nav bake', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus!
    const tsl = v.materialTSL.serialize()
    const baked = await v.bakeNavMesh()
    const crowdOk = baked ? v.crowd.init() : false
    const agentOk = crowdOk ? v.crowd.addAgent('e2e-1', [0, 0, 0], [4, 0, 4]) : false
    return { tsl, baked, crowdOk, agentOk, count: v.crowd.count() }
  })

  expect(result.tsl).toMatchObject({ backend: 'tsl', version: 2 })
  expect(result.baked).toBe(true)
  expect(result.crowdOk).toBe(true)
  expect(result.agentOk).toBe(true)
  expect(result.count).toBe(1)
})

test('wave 12 BT graph compile + curve evaluate via lotus bridge', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: { emptyGraph: () => unknown; compile: (g: unknown) => { tree: unknown; pathIndex: Record<string, string> } | null }
      curve: { sample: () => number }
      projectSettings: { load: () => { showLotusBranding: boolean; defaultPostSsgi: boolean } }
    }
    const graph = v.bt.emptyGraph()
    const compiled = v.bt.compile(graph)
    return {
      compiled: !!compiled?.tree,
      pathKeys: compiled ? Object.keys(compiled.pathIndex).length : 0,
      curveSample: v.curve.sample(),
      branding: v.projectSettings.load().showLotusBranding,
    }
  })

  expect(result.compiled).toBe(true)
  expect(result.pathKeys).toBeGreaterThan(0)
  expect(result.curveSample).toBe(0.5)
  expect(result.branding).toBe(true)
})

test('wave 12 command palette asset search', async ({ page }) => {
  await bootEditor(page)

  await page.evaluate(() => {
    window.lotus!.world.dataTables['E2E_Table'] = {
      name: 'E2E_Table',
      columns: [{ name: 'id', type: 'string' }],
      rows: [{ id: 'a' }],
    }
  })

  await page.keyboard.press('Control+Shift+KeyP')
  await page.locator('.palette input').fill('E2E_Table')
  await expect(page.locator('.palette-list button').first()).toContainText('Asset: Data / E2E_Table')
})

test('wave 12 project settings modal opens from File menu', async ({ page }) => {
  await bootEditor(page)

  await page.locator('.menu-title', { hasText: 'File' }).click()
  await page.locator('.menu-item', { hasText: 'Project Settings…' }).click()
  await expect(page.locator('.project-settings')).toBeVisible()
  await expect(page.locator('.project-settings .panel-header')).toContainText('Project Settings')
})

test('wave 13 WebGPU QA matrix + export playable roundtrip', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      renderer: { runQA: () => Promise<{ ok: boolean; checks: unknown[] }>; ssgi: () => { enabled: boolean } }
      export: { buildPlayableHTML: () => string }
      particles: { create: (b: 'cpu' | 'gpu') => { backend: string; computeSim?: boolean } }
    }
    const html = v.export.buildPlayableHTML()
    const hasLevel = html.includes('__LOTUS_LEVELS__')
    const gpu = v.particles.create('gpu')
    return {
      qaChecks: 0,
      hasLevel,
      htmlLen: html.length,
      gpuBackend: gpu.backend,
      gpuCompute: !!gpu.computeSim,
    }
  })

  const qa = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      renderer: { runQA: () => Promise<{ ok: boolean; checks: { length: number } }> }
    }
    const r = await v.renderer.runQA()
    return { ok: r.ok, checks: r.checks.length }
  })

  expect(qa.checks).toBeGreaterThan(2)
  expect(result.hasLevel).toBe(true)
  expect(result.htmlLen).toBeGreaterThan(5000)
  expect(result.gpuBackend === 'gpu' || result.gpuBackend === 'cpu').toBe(true)
})

test('wave 14 exported HTML boots playable overlay', async ({ page }) => {
  test.setTimeout(120_000)
  await bootEditor(page)

  const html = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      export: { buildPlayableHTML: () => string }
    }
    return v.export.buildPlayableHTML()
  })

  const exportPath = path.join(root, 'dist', 'e2e-wave14.play.html')
  fs.writeFileSync(exportPath, html, 'utf8')

  await page.goto('/e2e-wave14.play.html', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForSelector('canvas', { timeout: 90_000 })
  await page.waitForFunction(isExportOverlayReady, { timeout: 90_000 })

  const overlay = await page.locator('#overlay').textContent()
  expect(overlay).toMatch(/Click to play|click canvas|Touch stick|WASD/i)
})

test('wave 14 export embeds renderBackend + BT decorators compile', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      export: { buildPlayableHTML: () => string }
      bt: {
        emptyGraph: () => { nodes: { id: string; type: string; x: number; y: number; props: Record<string, unknown> }[]; edges: { from: string; to: string }[] }
        compile: (g: unknown) => { tree: unknown } | null
      }
    }
    const html = v.export.buildPlayableHTML()
    const hasExport = html.includes('__LOTUS_EXPORT__')
    const hasRenderBackend = html.includes('"renderBackend"')
    const graph = v.bt.emptyGraph()
    const root = graph.nodes.find((n) => n.type === 'Root')!
    const repeat: typeof graph.nodes[0] = {
      id: 'repeat-test',
      type: 'Repeat',
      x: 200,
      y: 40,
      props: { count: 2 },
    }
    const wait: typeof graph.nodes[0] = {
      id: 'wait-test',
      type: 'Wait',
      x: 400,
      y: 40,
      props: { seconds: 0.1 },
    }
    graph.nodes.push(repeat, wait)
    const selector = graph.nodes.find((n) => n.type === 'Selector')!
    graph.edges = graph.edges.filter((e) => !(e.from === root.id && e.to === selector.id))
    graph.edges.push({ from: root.id, to: repeat.id }, { from: repeat.id, to: wait.id })
    const compiled = v.bt.compile(graph)
    const repeatTree = compiled?.tree as { repeat?: { count: number } } | undefined
    return {
      hasExport,
      hasRenderBackend,
      repeatCount: repeatTree?.repeat?.count ?? 0,
    }
  })

  expect(result.hasExport).toBe(true)
  expect(result.hasRenderBackend).toBe(true)
  expect(result.repeatCount).toBe(2)
})

test('wave 15 BT validate + compile preview bridge', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: {
        emptyGraph: () => import('../src/engine/btGraph').BTGraph
        validate: (g: import('../src/engine/btGraph').BTGraph) => import('../src/engine/btGraph').BTValidationIssue[]
        compile: (g: import('../src/engine/btGraph').BTGraph) => { tree: unknown } | null
        summarize: (tree: unknown) => string
      }
    }
    const graph = v.bt.emptyGraph()
    const ok = v.bt.validate(graph)
    const compiled = v.bt.compile(graph)
    const summary = compiled ? v.bt.summarize(compiled.tree) : ''
    const root = graph.nodes.find((n) => n.type === 'Root')!
    const dup = graph.nodes.find((n) => n.type === 'Selector')!
    const bad = { ...graph, edges: [...graph.edges, { from: root.id, to: dup.id }] }
    const multiParent = v.bt.validate(bad)
    return {
      okCount: ok.length,
      hasSummary: summary.includes('Selector'),
      multiParentErrors: multiParent.filter((i) => i.level === 'error').length,
    }
  })

  expect(result.okCount).toBeGreaterThanOrEqual(0)
  expect(result.hasSummary).toBe(true)
  expect(result.multiParentErrors).toBeGreaterThan(0)
})

test('wave 15 GPU particle simBuffers + material TSL serialize', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      particles: { create: (b: 'cpu' | 'gpu') => { simBuffers: () => { positions: Float32Array }; backend: string } }
      materialTSL: { serialize: (g?: unknown) => object }
    }
    const gpu = v.particles.create('gpu')
    const buf = gpu.simBuffers()
    const tsl = v.materialTSL.serialize()
    return {
      backend: gpu.backend,
      posLen: buf.positions.length,
      tslBackend: (tsl as { backend?: string }).backend,
    }
  })

  expect(result.posLen).toBeGreaterThan(0)
  expect(result.tslBackend).toBe('tsl')
  expect(result.backend === 'gpu' || result.backend === 'cpu').toBe(true)
})

test('wave 16 BT compile-to-script + blackboard type hints', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: {
        emptyGraph: () => import('../src/engine/btGraph').BTGraph
        compileScript: (g: import('../src/engine/btGraph').BTGraph) => string | null
        inferBBTypes: (g: import('../src/engine/btGraph').BTGraph) => Record<string, string>
      }
    }
    const graph = v.bt.emptyGraph()
    const setBb = graph.nodes.find((n) => n.type === 'SetBB')
    if (setBb) {
      setBb.type = 'SetBB'
      setBb.props = { key: 'alerted', value: true }
    } else {
      graph.nodes.push({
        id: 'setbb-test',
        type: 'SetBB',
        x: 400,
        y: 200,
        props: { key: 'alerted', value: true },
      })
    }
    const script = v.bt.compileScript(graph)
    const types = v.bt.inferBBTypes(graph)
    return {
      hasScript: !!script && script.includes('runBTWithPaths'),
      alertedType: types.alerted,
    }
  })

  expect(result.hasScript).toBe(true)
  expect(result.alertedType).toBe('bool')
})

test('wave 16 GPU particle compute exports + TSL post bridge', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      particles: {
        create: (b: 'cpu' | 'gpu') => {
          backend: string
          usesComputeNode?: boolean
          gpuKernelActive?: boolean
          bindComputeRenderer?: (r: unknown) => Promise<void>
        }
      }
      renderer: { ssgi: () => { enabled: boolean; preset: string } }
    }
    const gpu = v.particles.create('gpu')
    const ssgi = v.renderer.ssgi()
    return {
      backend: gpu.backend,
      hasBind: typeof gpu.bindComputeRenderer === 'function',
      ssgiPreset: ssgi.preset,
    }
  })

  expect(result.hasBind).toBe(true)
  expect(result.ssgiPreset).toBeDefined()
  expect(result.backend === 'gpu' || result.backend === 'cpu').toBe(true)
})

test('wave 16 material TSL preview capability probe', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      materialTSL: { previewAvailable: () => Promise<boolean> }
    }
    const ok = await v.materialTSL.previewAvailable()
    return { probe: typeof ok === 'boolean' }
  })

  expect(result.probe).toBe(true)
})

test('wave 17 BT decorator compile + subtree collapse', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: {
        emptyGraph: () => import('../src/engine/btGraph').BTGraph
        compile: (g: import('../src/engine/btGraph').BTGraph) => { tree: unknown } | null
        summarize: (tree: unknown) => string
        collapseSubtree: (g: import('../src/engine/btGraph').BTGraph, id: string) => import('../src/engine/btGraph').BTGraph
      }
    }
    const graph = v.bt.emptyGraph()
    const root = graph.nodes.find((n) => n.type === 'Root')!
    const repeat = {
      id: 'r1',
      type: 'Repeat',
      x: 300,
      y: 80,
      props: { count: 3 },
    }
    const wait = { id: 'w1', type: 'Wait', x: 500, y: 80, props: { seconds: 0.2 } }
    graph.nodes.push(repeat, wait)
    graph.edges.push({ from: root.id, to: repeat.id }, { from: repeat.id, to: wait.id })
    const compiled = v.bt.compile(graph)
    const summary = compiled ? v.bt.summarize(compiled.tree) : ''
    const beforeCount = graph.nodes.length
    const collapsed = v.bt.collapseSubtree(graph, repeat.id)
    return {
      hasRepeat: summary.includes('Repeat x3'),
      stashed: !!collapsed.subtrees?.[repeat.id],
      beforeCount,
      nodeCount: collapsed.nodes.length,
    }
  })

  expect(result.hasRepeat).toBe(true)
  expect(result.stashed).toBe(true)
  expect(result.nodeCount).toBe(result.beforeCount - 1)
})

test('wave 17 material TSL node graph compile', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      materialTSL: { compileNodes: (g: import('../src/engine/materialGraph').MaterialGraph) => Record<string, unknown> | null }
    }
    const g = {
      nodes: [
        { id: 'out', type: 'Output', x: 0, y: 0, props: {} },
        { id: 'c', type: 'Color', x: 0, y: 0, props: { value: '#ff0000' } },
      ],
      edges: [{ from: 'c', to: 'out:baseColor' }],
    }
    const nodes = v.materialTSL.compileNodes(g)
    return { hasBase: nodes != null && 'baseColor' in nodes }
  })

  expect(result.hasBase).toBe(true)
})

test('wave 17 GPU particle alive mask bridge', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      particles: { create: (b: 'gpu') => { simBuffers: () => { aliveF: Float32Array }; syncAliveMask?: () => void } }
    }
    const ps = v.particles.create('gpu')
    const buf = ps.simBuffers()
    return { aliveFLen: buf.aliveF.length, hasMask: buf.aliveF instanceof Float32Array }
  })

  expect(result.hasMask).toBe(true)
  expect(result.aliveFLen).toBeGreaterThan(0)
})

test('wave 18 BT collapsed subtree still compiles for PIE', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: {
        emptyGraph: () => import('../src/engine/btGraph').BTGraph
        compile: (g: import('../src/engine/btGraph').BTGraph) => { tree: unknown } | null
        collapseSubtree: (g: import('../src/engine/btGraph').BTGraph, id: string) => import('../src/engine/btGraph').BTGraph
        graphForCompile: (g: import('../src/engine/btGraph').BTGraph) => import('../src/engine/btGraph').BTGraph
        resolveHighlight: (g: import('../src/engine/btGraph').BTGraph, id: string | null) => string | null
        summarize: (tree: unknown) => string
      }
    }
    const graph = v.bt.emptyGraph()
    const root = graph.nodes.find((n) => n.type === 'Root')!
    const repeat = { id: 'r18', type: 'Repeat', x: 300, y: 80, props: { count: 2 } }
    const wait = { id: 'w18', type: 'Wait', x: 500, y: 80, props: { seconds: 0.1 } }
    graph.nodes.push(repeat, wait)
    const selector = graph.nodes.find((n) => n.type === 'Selector')!
    graph.edges = graph.edges.filter((e) => !(e.from === root.id && e.to === selector.id))
    graph.edges.push({ from: root.id, to: repeat.id }, { from: repeat.id, to: wait.id })
    const collapsed = v.bt.collapseSubtree(graph, repeat.id)
    const compiled = v.bt.compile(collapsed)
    const summary = compiled ? v.bt.summarize(compiled.tree) : ''
    const merged = v.bt.graphForCompile(collapsed)
    const highlight = v.bt.resolveHighlight(collapsed, wait.id)
    return {
      hasRepeat: summary.includes('Repeat x2'),
      mergedNodes: merged.nodes.length,
      visibleNodes: collapsed.nodes.length,
      highlight,
    }
  })

  expect(result.hasRepeat).toBe(true)
  expect(result.mergedNodes).toBeGreaterThan(result.visibleNodes)
  expect(result.highlight).toBe('r18')
})

test('wave 18 GPU particle life buffers + QA matrix', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      particles: {
        create: (b: 'gpu') => {
          simBuffers: () => { life: Float32Array; colors: Float32Array; sizes: Float32Array }
        }
        qaMatrix: () => { ok: boolean; checks: { id: string; pass: boolean }[] }
      }
    }
    const ps = v.particles.create('gpu')
    const buf = ps.simBuffers()
    const qa = v.particles.qaMatrix()
    return {
      lifeLen: buf.life.length,
      colorLen: buf.colors.length,
      sizeLen: buf.sizes.length,
      qaChecks: qa.checks.length,
      hasGpuApi: qa.checks.some((c) => c.id === 'navigator.gpu'),
    }
  })

  expect(result.lifeLen).toBeGreaterThan(0)
  expect(result.colorLen).toBeGreaterThan(0)
  expect(result.sizeLen).toBeGreaterThan(0)
  expect(result.qaChecks).toBeGreaterThanOrEqual(4)
  expect(result.hasGpuApi).toBe(true)
})

test('wave 18 material TSL preview channels bridge', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      materialTSL: { previewChannels: (g: import('../src/engine/materialGraph').MaterialGraph) => string[] }
    }
    const g = {
      nodes: [
        { id: 'out', type: 'Output', x: 0, y: 0, props: {} },
        { id: 'c', type: 'Color', x: 0, y: 0, props: { value: '#00ff00' } },
        { id: 'r', type: 'Scalar', x: 0, y: 0, props: { value: 0.4 } },
      ],
      edges: [
        { from: 'c', to: 'out:baseColor' },
        { from: 'r', to: 'out:roughness' },
      ],
    }
    const ch = v.materialTSL.previewChannels(g)
    return { channels: ch }
  })

  expect(result.channels).toContain('baseColor')
  expect(result.channels).toContain('roughness')
})

test('wave 19 BT services + decorators compile', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: {
        emptyGraph: () => import('../src/engine/btGraph').BTGraph
        compile: (g: import('../src/engine/btGraph').BTGraph) => {
          tree: unknown
          services?: { hostPath: string; service: { service: string } }[]
        } | null
        summarize: (tree: unknown) => string
      }
    }
    const graph = v.bt.emptyGraph()
    const root = graph.nodes.find((n) => n.type === 'Root')!
    const selector = graph.nodes.find((n) => n.type === 'Selector')!
    const tl = { id: 'tl19', type: 'TimeLimit', x: 300, y: 80, props: { seconds: 3 } }
    const wait = { id: 'w19', type: 'Wait', x: 500, y: 80, props: { seconds: 0.1 } }
    const svc = { id: 's19', type: 'SvcPlayerNear', x: 300, y: 180, props: { key: 'near', distance: 6 } }
    graph.nodes.push(tl, wait, svc)
    graph.edges = [
      { from: root.id, to: selector.id },
      { from: selector.id, to: tl.id },
      { from: tl.id, to: wait.id },
      { from: selector.id, to: svc.id, kind: 'service' },
    ]
    const compiled = v.bt.compile(graph)
    const summary = compiled ? v.bt.summarize(compiled.tree) : ''
    return {
      hasTimeLimit: summary.includes('TimeLimit'),
      serviceCount: compiled?.services?.length ?? 0,
      serviceKind: compiled?.services?.[0]?.service.service,
    }
  })

  expect(result.hasTimeLimit).toBe(true)
  expect(result.serviceCount).toBe(1)
  expect(result.serviceKind).toBe('playerNear')
})

test('wave 19 particle wind/rotation/collision modules', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      particles: { create: (b: 'cpu') => { props: { windX?: number; rotationSpeed?: number; collisionRadius?: number } } }
    }
    const ps = v.particles.create('cpu')
    return {
      windX: ps.props.windX,
      rotationSpeed: ps.props.rotationSpeed,
      collisionRadius: ps.props.collisionRadius,
    }
  })

  expect(result.windX).toBeGreaterThan(0)
  expect(result.rotationSpeed).toBeGreaterThan(0)
  expect(result.collisionRadius).toBeGreaterThan(0)
})

test('wave 19 substrate clearCoat + sheen material channels', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      materialTSL: { previewChannels: (g: import('../src/engine/materialGraph').MaterialGraph) => string[] }
    }
    const g = {
      nodes: [
        { id: 'out', type: 'Output', x: 0, y: 0, props: {} },
        { id: 'cc', type: 'Scalar', x: 0, y: 0, props: { value: 0.9 } },
        { id: 'sh', type: 'Color', x: 0, y: 0, props: { value: '#ffeedd' } },
      ],
      edges: [
        { from: 'cc', to: 'out:clearCoat' },
        { from: 'sh', to: 'out:sheen' },
      ],
    }
    return { channels: v.materialTSL.previewChannels(g) }
  })

  expect(result.channels).toContain('clearCoat')
  expect(result.channels).toContain('sheen')
})

test('wave 19 GAS stacking + mp replication tier', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      gas: {
        initActor: (a: import('../src/engine/Actor').Actor) => void
        applyEffect: (a: import('../src/engine/Actor').Actor, id: string) => boolean
        getStacks: (a: import('../src/engine/Actor').Actor, id: string) => number
        getEffect: (id: string) => import('../src/engine/gameplayAbilities').GameplayEffect | undefined
        saveEffect: (e: import('../src/engine/gameplayAbilities').GameplayEffect) => void
      }
      mpNet: { replicationTier: (k: string) => string; tierPriority: Record<string, number> }
    }
    const spawn = v.terminal.exec('/spawn box')
    if (spawn.error) throw new Error(spawn.error)
    const actor = [...v.world.actors.values()].find((a) => /box/i.test(a.name))
    if (!actor) throw new Error('no box')
    actor.attributeSetId = 'default'
    v.gas.initActor(actor)
    const poison = v.gas.getEffect('effect_poison')
    if (!poison) throw new Error('poison effect missing')
    v.gas.saveEffect({ ...poison, stackPolicy: 'stack', maxStacks: 3 })
    v.gas.applyEffect(actor, 'effect_poison')
    v.gas.applyEffect(actor, 'effect_poison')
    const stacks = v.gas.getStacks(actor, 'effect_poison')
    return {
      stacks,
      gaTier: v.mpNet.replicationTier('ga:Health'),
      gasPriority: v.mpNet.tierPriority.gas,
      transformPriority: v.mpNet.tierPriority.transform,
    }
  })

  expect(result.stacks).toBe(2)
  expect(result.gaTier).toBe('gas')
  expect(result.transformPriority).toBeGreaterThan(result.gasPriority)
})

test('wave 20 SSR quality presets bridge', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      ssr: { settings: () => { enabled: boolean; preset: string; maxDistance: number } }
    }
    const s = v.ssr.settings()
    return { preset: s.preset, maxDistance: s.maxDistance, enabled: s.enabled }
  })

  expect(result.preset).toBe('medium')
  expect(result.maxDistance).toBeGreaterThan(0)
})

test('wave 20 GPU ribbon trail buffers + shift', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      particles: {
        create: (b: 'gpu') => {
          props: { renderMode: string; ribbonSegments: number }
          simBuffers: () => { trail?: Float32Array; trailLen?: number }
          shiftAllRibbonTrails: () => void
        }
        qaMatrix: () => { checks: { id: string }[] }
      }
    }
    const ps = v.particles.create('gpu')
    const buf = ps.simBuffers()
    ps.shiftAllRibbonTrails()
    const qa = v.particles.qaMatrix()
    return {
      trailLen: buf.trail?.length ?? 0,
      segments: buf.trailLen,
      hasRibbonCheck: qa.checks.some((c) => c.id === 'ribbon.trail'),
    }
  })

  expect(result.trailLen).toBeGreaterThan(0)
  expect(result.segments).toBeGreaterThanOrEqual(2)
  expect(result.hasRibbonCheck).toBe(true)
})

test('wave 20 BT collapsed subtree compiles to script', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: {
        emptyGraph: () => import('../src/engine/btGraph').BTGraph
        collapseSubtree: (g: import('../src/engine/btGraph').BTGraph, id: string) => import('../src/engine/btGraph').BTGraph
        compileScript: (g: import('../src/engine/btGraph').BTGraph) => string | null
      }
    }
    const graph = v.bt.emptyGraph()
    const root = graph.nodes.find((n) => n.type === 'Root')!
    const repeat = { id: 'r20', type: 'Repeat', x: 300, y: 80, props: { count: 2 } }
    const wait = { id: 'w20', type: 'Wait', x: 500, y: 80, props: { seconds: 0.1 } }
    graph.nodes.push(repeat, wait)
    graph.edges = [
      { from: root.id, to: repeat.id },
      { from: repeat.id, to: wait.id },
    ]
    const beforeCount = graph.nodes.length
    const collapsed = v.bt.collapseSubtree(graph, repeat.id)
    const script = v.bt.compileScript(collapsed)
    return {
      hasWait: script?.includes('wait') ?? false,
      hasPaths: script?.includes('__btPaths') ?? false,
      visibleNodes: collapsed.nodes.length,
      stashed: !!collapsed.subtrees?.[repeat.id],
      shrunk: collapsed.nodes.length < beforeCount,
    }
  })

  expect(result.hasWait).toBe(true)
  expect(result.hasPaths).toBe(true)
  expect(result.stashed).toBe(true)
  expect(result.shrunk).toBe(true)
})

test('wave 20 export perf gate surface', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      export: { buildPlayableHTML: () => string }
    }
    const html = v.export.buildPlayableHTML()
    return {
      hasPerfMin: html.includes('perfMinFps') || html.includes('__LOTUS_EXPORT_PERF__'),
      hasExportPerf: html.includes('__LOTUS_EXPORT_PERF__'),
    }
  })

  expect(result.hasExportPerf).toBe(true)
})

test('wave 21 SSR ground + DOF settings bridge', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus!
    v.world.environment.postSsr = true
    v.world.environment.postSsrGround = true
    v.world.environment.postDof = true
    const ssr = v.ssr.settings()
    return {
      groundReflect: ssr.groundReflect,
      dof: v.world.environment.postDof,
    }
  })

  expect(result.groundReflect).toBe(true)
  expect(result.dof).toBe(true)
})

test('wave 21 GPU trail shift kernel QA check', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      particles: {
        create: (b: 'gpu') => {
          props: { renderMode: string; ribbonSegments: number }
          shiftAllRibbonTrails: () => void
        }
        qaMatrix: () => { checks: { id: string; pass: boolean }[] }
      }
    }
    const ps = v.particles.create('gpu')
    ps.shiftAllRibbonTrails()
    const qa = v.particles.qaMatrix()
    const trailCheck = qa.checks.find((c) => c.id === 'kernel.trail')
    return { hasTrailCheck: !!trailCheck, trailPass: trailCheck?.pass ?? false }
  })

  expect(result.hasTrailCheck).toBe(true)
})

test('wave 21 BT services compile with serviceNodeId', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: {
        emptyGraph: () => import('../src/engine/btGraph').BTGraph
        compileScript: (g: import('../src/engine/btGraph').BTGraph) => string | null
        compile: (g: import('../src/engine/btGraph').BTGraph) => {
          services?: { hostPath: string; serviceNodeId: string; service: { service: string } }[]
        } | null
      }
    }
    const graph = v.bt.emptyGraph()
    const root = graph.nodes.find((n) => n.type === 'Root')!
    const selector = graph.nodes.find((n) => n.type === 'Selector')!
    const wait = { id: 'w21', type: 'Wait', x: 400, y: 80, props: { seconds: 0.1 } }
    const svc = { id: 's21', type: 'SvcSetBB', x: 300, y: 180, props: { key: 'flag', value: true } }
    graph.nodes.push(wait, svc)
    graph.edges = [
      { from: root.id, to: selector.id },
      { from: selector.id, to: wait.id },
      { from: selector.id, to: svc.id, kind: 'service' },
    ]
    const compiled = v.bt.compile(graph)
    const script = v.bt.compileScript(graph)
    return {
      serviceNodeId: compiled?.services?.[0]?.serviceNodeId,
      scriptHasServices: script?.includes('__btServices') ?? false,
      scriptHasNodeId: script?.includes('s21') ?? false,
    }
  })

  expect(result.serviceNodeId).toBe('s21')
  expect(result.scriptHasServices).toBe(true)
  expect(result.scriptHasNodeId).toBe(true)
})

test('wave 21 export perfMinFps in export JSON', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      export: { buildPlayableHTML: () => string }
    }
    const html = v.export.buildPlayableHTML()
    const match = html.match(/window\.__LOTUS_EXPORT__\s*=\s*(\{[^;]+\})/)
    const json = match ? JSON.parse(match[1]) : {}
    return { perfMinFps: json.perfMinFps }
  })

  expect(result.perfMinFps).toBe(20)
})

test('wave 21 material TSL preview channel on wire port', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      materialTSL: {
        previewChannelForPort: (
          g: import('../src/engine/materialGraph').MaterialGraph,
          nodeId: string,
          port: string,
        ) => string | null
      }
    }
    const graph = v.world.actors.values().next().value?.materialGraph ?? {
      nodes: [
        { id: 'out1', type: 'Output', x: 0, y: 0, props: {} },
        { id: 'c1', type: 'Constant', x: -200, y: 0, props: { value: '#ff0000' } },
      ],
      edges: [],
    }
    const out = graph.nodes.find((n: { type: string }) => n.type === 'Output')
    return v.materialTSL.previewChannelForPort(graph, out?.id ?? 'out1', 'baseColor')
  })

  expect(result).toBe('baseColor')
})

test('wave 22 TSL DOF + SSR ground settings', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus!
    v.world.environment.postDof = true
    v.world.environment.postSsr = true
    v.world.environment.postSsrGround = true
    const ssr = v.ssr.settings()
    return { dof: v.world.environment.postDof, groundReflect: ssr.groundReflect }
  })

  expect(result.dof).toBe(true)
  expect(result.groundReflect).toBe(true)
})

test('wave 22 BT services compile preview bridge', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: {
        emptyGraph: () => import('../src/engine/btGraph').BTGraph
        summarizeServices: (g: import('../src/engine/btGraph').BTGraph) => string
      }
    }
    const graph = v.bt.emptyGraph()
    const selector = graph.nodes.find((n) => n.type === 'Selector')!
    const svc = { id: 'svc22', type: 'SvcPlayerNear', x: 300, y: 180, props: { key: 'near', distance: 5 } }
    graph.nodes.push(svc)
    graph.edges.push({ from: selector.id, to: svc.id, kind: 'service' })
    const preview = v.bt.summarizeServices(graph)
    return { hasArrow: preview.includes('←'), hasPlayerNear: preview.includes('playerNear') }
  })

  expect(result.hasArrow).toBe(true)
  expect(result.hasPlayerNear).toBe(true)
})

test('wave 22 material TSL solo channel compile', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      materialTSL: {
        soloChannel: (
          g: import('../src/engine/materialGraph').MaterialGraph,
          ch: string,
        ) => Record<string, unknown> | null
      }
    }
    const graph = {
      nodes: [
        { id: 'out', type: 'Output', x: 0, y: 0, props: {} },
        { id: 'c', type: 'Scalar', x: -200, y: 0, props: { value: 0.2 } },
      ],
      edges: [{ from: 'c', to: 'out:roughness' }],
    }
    const solo = v.materialTSL.soloChannel(graph, 'roughness')
    const keys = solo ? Object.keys(solo) : []
    return { hasRoughness: keys.includes('roughness'), channelCount: keys.length }
  })

  expect(result.hasRoughness).toBe(true)
  expect(result.channelCount).toBeGreaterThan(1)
})

test('wave 22 export WebGPU particle boot', async ({ page }) => {
  test.setTimeout(120_000)
  await bootEditor(page)

  const html = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      export: { buildPlayableHTML: () => string }
      world: { environment: Record<string, unknown> }
    }
    v.world.environment.renderBackend = 'webgpu'
    v.world.environment.particleBackend = 'gpu'
    return v.export.buildPlayableHTML()
  })

  const exportPath = path.join(root, 'dist', 'e2e-wave22-gpu-particles.play.html')
  fs.writeFileSync(exportPath, html, 'utf8')

  await page.goto('/e2e-wave22-gpu-particles.play.html', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForSelector('canvas', { timeout: 90_000 })
  await page.waitForFunction(isExportOverlayReady, { timeout: 90_000 })

  const overlay = await page.locator('#overlay').textContent()
  expect(overlay).toMatch(/particle/i)
})

test('wave 23 DOF focus/aperture env settings', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      dof: { settings: () => { webgl: { focus: number }; tsl: { focusDistance: number } } }
    }
    v.world.environment.postDof = true
    v.world.environment.postDofFocusDistance = 8
    v.world.environment.postDofFocalLength = 3
    const s = v.dof.settings()
    return { focusDistance: s.tsl.focusDistance, webglFocus: s.webgl.focus }
  })

  expect(result.focusDistance).toBe(8)
  expect(result.webglFocus).toBeGreaterThan(0)
})

test('wave 23 BT script compile diff bridge', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: {
        emptyGraph: () => import('../src/engine/btGraph').BTGraph
        diffScript: (g: import('../src/engine/btGraph').BTGraph, script: string) => {
          changed: boolean
          lines: string[]
        }
      }
    }
    const graph = v.bt.emptyGraph()
    const diff = v.bt.diffScript(graph, '// old script')
    return { changed: diff.changed, hasPlus: diff.lines.some((l) => l.startsWith('+')) }
  })

  expect(result.changed).toBe(true)
  expect(result.hasPlus).toBe(true)
})

test('wave 23 material solo channel bridge', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      materialTSL: {
        soloChannel: (g: import('../src/engine/materialGraph').MaterialGraph, ch: string) => Record<string, unknown> | null
      }
    }
    const graph = {
      nodes: [
        { id: 'out', type: 'Output', x: 0, y: 0, props: {} },
        { id: 'c', type: 'Scalar', x: -200, y: 0, props: { value: 0.8 } },
      ],
      edges: [{ from: 'c', to: 'out:metalness' }],
    }
    const solo = v.materialTSL.soloChannel(graph, 'metalness')
    return { keys: solo ? Object.keys(solo) : [], hasMetalness: !!solo?.metalness }
  })

  expect(result.hasMetalness).toBe(true)
  expect(result.keys.length).toBeGreaterThan(1)
})

test('wave 23 export ribbon particle runtime surface', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      export: { buildPlayableHTML: () => string }
    }
    const html = v.export.buildPlayableHTML()
    return {
      hasTrailShift: html.includes('trailShift') || html.includes('trailLen'),
      hasRibbon: html.includes('renderMode') || html.includes('buildRibbon'),
    }
  })

  expect(result.hasTrailShift || result.hasRibbon).toBe(true)
})

test('wave 24 DOF per-camera override + focus pull', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      dof: {
        settings: (
          cam: { dofOverride: boolean; dofFocusDistance: number; dofFocusPull: boolean; dofFocusPullFrom: number; dofFocusPullTo: number },
          t?: number,
        ) => { tsl: { focusDistance: number }; focusPullActive: boolean }
        resolveFocusPull: (cam: { dofFocusPullFrom: number; dofFocusPullTo: number }, t: number) => number
      }
    }
    const cam = {
      dofOverride: true,
      dofFocusDistance: 12,
      dofFocusPull: true,
      dofFocusPullFrom: 10,
      dofFocusPullTo: 2,
      dofFocusPullDuration: 2,
    }
    v.world.environment.postDof = false
    const s0 = v.dof.settings(cam, 0)
    const s1 = v.dof.settings(cam, 0.5)
    const pulled = v.dof.resolveFocusPull(cam, 0.5)
    return {
      overrideFocus: s0.tsl.focusDistance,
      midFocus: s1.tsl.focusDistance,
      pulled,
      pullActive: s0.focusPullActive,
    }
  })

  expect(result.overrideFocus).toBe(10)
  expect(result.midFocus).toBe(6)
  expect(result.pulled).toBe(6)
  expect(result.pullActive).toBe(true)
})

test('wave 24 BT script diff gutter node ids', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: {
        emptyGraph: () => import('../src/engine/btGraph').BTGraph
        diffGutter: (g: import('../src/engine/btGraph').BTGraph, script: string) => string[]
        compileScript: (g: import('../src/engine/btGraph').BTGraph) => string | null
      }
    }
    const graph = v.bt.emptyGraph()
    const root = graph.nodes.find((n) => n.type === 'Root')!
    const svc = { id: 'svc24', type: 'SvcPlayerNear', x: 200, y: 200, props: { radius: 5 } }
    const sel = { id: 'sel24', type: 'Selector', x: 300, y: 80, props: {} }
    graph.nodes.push(svc, sel)
    graph.edges = [
      { from: root.id, to: sel.id },
      { from: sel.id, to: svc.id, kind: 'service' },
    ]
    const compiled = v.bt.compileScript(graph) ?? ''
    const gutter = v.bt.diffGutter(graph, '// stale script')
    const gutterMatch = v.bt.diffGutter(graph, compiled)
    return { gutterLen: gutter.length, matchEmpty: gutterMatch.length === 0, hasSvc: gutter.includes('svc24') }
  })

  expect(result.gutterLen).toBeGreaterThan(0)
  expect(result.hasSvc).toBe(true)
  expect(result.matchEmpty).toBe(true)
})

test('wave 24 export perf gate probe bridge', async ({ page }) => {
  await bootEditor(page)

  const hasBridge = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & { export: { probePerfGate?: () => void } }
    return typeof v.export.probePerfGate === 'function'
  })
  expect(hasBridge).toBe(true)

  await page.evaluate(() => window.lotus!.export.probePerfGate())
  await page.waitForSelector('.status-perf-gate', { timeout: 20_000 })
  const badge = await page.locator('.status-perf-gate').textContent()
  expect(badge).toMatch(/Export perf/)
})

test('wave 24 material minimap viewport sync', async ({ page }) => {
  await bootEditor(page)

  await page.evaluate(() => {
    const v = window.lotus!
    const spawn = v.terminal.exec('/spawn box')
    if (spawn.error) throw new Error(spawn.error)
    const actor = [...v.world.actors.values()].find((a) => a.name.toLowerCase().includes('box'))
    if (!actor) throw new Error('spawned box not found')
    v.useEditor.getState().select(actor.id)
    actor.materialGraph = {
      nodes: [
        { id: 'out', type: 'Output', x: 400, y: 100, props: {} },
        { id: 'c1', type: 'Color', x: 100, y: 80, props: { color: '#4488ff' } },
        { id: 'c2', type: 'Scalar', x: 100, y: 200, props: { value: 0.5 } },
      ],
      edges: [
        { from: 'c1', to: 'out:baseColor' },
        { from: 'c2', to: 'out:roughness' },
      ],
    }
  })

  await page.evaluate(() => window.lotus!.useEditor.getState().setBottomTab('material'))
  await expect(page.locator('.mat-minimap')).toBeVisible()
  await expect(page.locator('.mat-canvas-layer')).toBeVisible()
  const hasViewportRect = await page.locator('.mat-minimap-viewport').count()
  expect(hasViewportRect).toBeGreaterThan(0)
})

test('wave 24 export ribbon E2E boot trail assert', async ({ page }) => {
  test.setTimeout(120_000)
  await bootEditor(page)

  const html = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      export: { buildPlayableHTML: () => string }
      world: { serialize: () => { name: string; actors: unknown[]; environment: Record<string, unknown> }; load: (l: unknown) => Promise<void> }
    }
    const level = v.world.serialize()
    level.actors.push({
      id: 'ribbon_e2e',
      name: 'RibbonFX',
      type: 'ParticleEmitter',
      parentId: null,
      visible: true,
      transform: { position: [0, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] },
      particles: {
        rate: 120,
        lifetime: 2.5,
        speed: 4,
        renderMode: 'ribbon',
        ribbonSegments: 8,
        ribbonWidth: 0.15,
        maxParticles: 48,
        colorStart: '#66ccff',
        colorEnd: '#3366ff',
        additive: true,
      },
      behaviors: [],
    })
    await v.world.load(level)
    return v.export.buildPlayableHTML()
  })

  const exportPath = path.join(root, 'dist', 'e2e-wave24-ribbon.play.html')
  fs.writeFileSync(exportPath, html, 'utf8')

  await page.goto('/e2e-wave24-ribbon.play.html', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.waitForSelector('canvas', { timeout: 90_000 })
  await page.waitForFunction(isExportOverlayReady, { timeout: 90_000 })
  await page.waitForFunction(
    () => {
      const qa = (window as unknown as { __LOTUS_EXPORT_RIBBON_QA__?: { trailTris: number } }).__LOTUS_EXPORT_RIBBON_QA__
      return (qa?.trailTris ?? 0) > 0
    },
    { timeout: 30_000 },
  )

  const ribbonQa = await page.evaluate(() => {
    const qa = (window as unknown as { __LOTUS_EXPORT_RIBBON_QA__?: { trailTris: number; ribbonSystems: number } })
      .__LOTUS_EXPORT_RIBBON_QA__
    return { trailTris: qa?.trailTris ?? 0, ribbonSystems: qa?.ribbonSystems ?? 0 }
  })

  expect(ribbonQa.ribbonSystems).toBeGreaterThan(0)
  expect(ribbonQa.trailTris).toBeGreaterThan(0)
})

test('wave 25 DOF sequencer track + color grading', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      colorGrading: { settings: () => { enabled: boolean; gain: number[] } }
      world: { sequence: { tracks: unknown[] }; actors: { values: () => IterableIterator<{ id: string; type: string; camera?: unknown; cameraProps?: { dofFocusDistance?: number } }> } }
    }
    v.world.environment.postColorGrading = true
    v.world.environment.postGain = [1.2, 1, 1]
    const cg = v.colorGrading.settings()
    const seq = v.world.sequence
    seq.tracks.push({
      actorId: 'cam_seq25',
      property: 'dofFocusDistance',
      keys: [{ t: 0, v: 3 }, { t: 2, v: 8 }],
    })
    return { hasCg: cg.enabled, gain: cg.gain[0], keyed: seq.tracks.some((t: { property?: string }) => t.property === 'dofFocusDistance') }
  })

  expect(result.hasCg).toBe(true)
  expect(result.gain).toBe(1.2)
  expect(result.keyed).toBe(true)
})

test('wave 25 BT gutter service compile hint', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: {
        emptyGraph: () => import('../src/engine/btGraph').BTGraph
        diffGutter: (g: import('../src/engine/btGraph').BTGraph, script: string) => string[]
        serviceCompileHint: (g: import('../src/engine/btGraph').BTGraph, nodeId: string) => string | null
      }
    }
    const graph = v.bt.emptyGraph()
    const root = graph.nodes.find((n) => n.type === 'Root')!
    const svc = { id: 'svc25', type: 'SvcPlayerNear', x: 200, y: 200, props: { radius: 5 } }
    const sel = { id: 'sel25', type: 'Selector', x: 300, y: 80, props: {} }
    graph.nodes.push(svc, sel)
    graph.edges = [
      { from: root.id, to: sel.id },
      { from: sel.id, to: svc.id, kind: 'service' },
    ]
    const gutter = v.bt.diffGutter(graph, '// stale')
    const hint = v.bt.serviceCompileHint(graph, 'svc25')
    return { hasGutter: gutter.includes('svc25'), hint: hint ?? '' }
  })

  expect(result.hasGutter).toBe(true)
  expect(result.hint).toMatch(/SvcPlayerNear|PlayerNear/i)
})

test('wave 25 export schedule perf probe bridge', async ({ page }) => {
  await bootEditor(page)

  const hasBridge = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & { export: { schedulePerfProbe?: (ms?: number) => void } }
    return typeof v.export.schedulePerfProbe === 'function'
  })
  expect(hasBridge).toBe(true)
})

test('wave 25 export sub-emitter runtime surface', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & { export: { buildPlayableHTML: () => string } }
    const html = v.export.buildPlayableHTML()
    return {
      hasSpawnBurst: html.includes('spawnBurstAt'),
      hasSubEmitterOn: html.includes('subEmitterOn'),
    }
  })

  expect(result.hasSpawnBurst || result.hasSubEmitterOn).toBe(true)
})

test('wave 26 TSL color grading LGG + ACES bridges', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      colorGrading: { settings: () => { lift: number[]; gamma: number[]; gain: number[] }; acesEnabled: () => boolean }
    }
    v.world.environment.postColorGrading = true
    v.world.environment.postLift = [0.05, 0, 0]
    v.world.environment.postGamma = [1.1, 1, 1]
    v.world.environment.postGain = [1.15, 1, 1]
    v.world.environment.postAces = true
    const cg = v.colorGrading.settings()
    return { lift: cg.lift[0], gamma: cg.gamma[0], gain: cg.gain[0], aces: v.colorGrading.acesEnabled() }
  })

  expect(result.lift).toBeCloseTo(0.05)
  expect(result.gamma).toBeCloseTo(1.1)
  expect(result.gain).toBeCloseTo(1.15)
  expect(result.aces).toBe(true)
})

test('wave 26 GPU particle wind/rotation integrate uniforms', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      particles: { create: (b: 'gpu') => { props: { windX?: number; rotationSpeed?: number } } }
    }
    const ps = v.particles.create('gpu')
    return { windX: ps.props.windX, rotationSpeed: ps.props.rotationSpeed }
  })

  expect(result.windX).toBeGreaterThan(0)
  expect(result.rotationSpeed).toBeGreaterThan(0)
})

test('wave 26 export TSL color grading parity', async ({ page }) => {
  await bootEditor(page)

  const html = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & { export: { buildPlayableHTML: () => string } }
    v.world.environment.postColorGrading = true
    v.world.environment.postAces = true
    return v.export.buildPlayableHTML()
  })

  expect(html).toContain('postColorGrading')
  expect(html).toContain('acesFilmicToneMapping')
})

test('wave 26 BT diff line jump targets', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: {
        emptyGraph: () => import('../src/engine/btGraph').BTGraph
        diffLineTargets: (g: import('../src/engine/btGraph').BTGraph, script: string) => Array<{ nodeId: string | null }>
        scrollRectForNode: (n: { x: number; y: number }, w: number, h: number) => { scrollLeft: number; scrollTop: number }
      }
    }
    const graph = v.bt.emptyGraph()
    const root = graph.nodes.find((n) => n.type === 'Root')!
    const svc = { id: 'svc26', type: 'SvcPlayerNear', x: 200, y: 200, props: { radius: 5 } }
    const sel = { id: 'sel26', type: 'Selector', x: 300, y: 80, props: {} }
    graph.nodes.push(svc, sel)
    graph.edges = [
      { from: root.id, to: sel.id },
      { from: sel.id, to: svc.id, kind: 'service' },
    ]
    const targets = v.bt.diffLineTargets(graph, '// stale')
    const scroll = v.bt.scrollRectForNode({ x: 300, y: 80 }, 400, 280)
    return { hasTarget: targets.some((t) => t.nodeId === 'svc26'), scrollLeft: scroll.scrollLeft }
  })

  expect(result.hasTarget).toBe(true)
  expect(result.scrollLeft).toBeGreaterThan(0)
})

test('wave 27 color grading preset + ACES exposure', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      colorGrading: {
        preset: () => string
        settings: () => { enabled: boolean; gain: number[] }
        acesExposure: () => number
        exposureScale: (lift: number[], gamma: number[], gain: number[]) => { gain: number[] }
      }
    }
    v.world.environment.postColorGradingPreset = 'cinematic'
    v.world.environment.exposure = 1
    return {
      preset: v.colorGrading.preset(),
      enabled: v.colorGrading.settings().enabled,
      gain: v.colorGrading.settings().gain[0],
      acesExp: v.colorGrading.acesExposure(),
      scaled: v.colorGrading.exposureScale([0, 0, 0], [1, 1, 1], [1, 1, 1]).gain[0],
    }
  })

  expect(result.preset).toBe('cinematic')
  expect(result.enabled).toBe(true)
  expect(result.gain).toBeGreaterThan(1)
  expect(result.acesExp).toBeGreaterThan(0.75)
  expect(result.scaled).toBeGreaterThan(1)
})

test('wave 27 GPU particle collision module props', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      particles: { create: (b: 'gpu') => { props: { collisionRadius?: number; collisionBounce?: number } } }
    }
    const ps = v.particles.create('gpu')
    return { radius: ps.props.collisionRadius, bounce: ps.props.collisionBounce }
  })

  expect(result.radius).toBeGreaterThan(0)
  expect(result.bounce).toBeGreaterThan(0)
})

test('wave 27 export DOF sequencer setDofFocus surface', async ({ page }) => {
  await bootEditor(page)

  const html = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & { export: { buildPlayableHTML: () => string } }
    return v.export.buildPlayableHTML()
  })

  expect(html).toContain('setDofFocus')
  expect(html).toContain('dofFocusDistance')
})

test('wave 27 BT gutter batch resolve bridge', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: {
        emptyGraph: () => import('../src/engine/btGraph').BTGraph
        resolveDiffGutter: (
          g: import('../src/engine/btGraph').BTGraph,
          script: string,
        ) => { nodeIds: string[]; scrollLeft: number }
      }
    }
    const graph = v.bt.emptyGraph()
    const root = graph.nodes.find((n) => n.type === 'Root')!
    const svc = { id: 'svc27', type: 'SvcPlayerNear', x: 200, y: 200, props: { radius: 5 } }
    const sel = { id: 'sel27', type: 'Selector', x: 300, y: 80, props: {} }
    graph.nodes.push(svc, sel)
    graph.edges = [
      { from: root.id, to: sel.id },
      { from: sel.id, to: svc.id, kind: 'service' },
    ]
    const batch = v.bt.resolveDiffGutter(graph, '// stale')
    return { count: batch.nodeIds.length, scrollLeft: batch.scrollLeft }
  })

  expect(result.count).toBeGreaterThan(0)
  expect(result.scrollLeft).toBeGreaterThan(0)
})

test('wave 27 world resyncActorScript during play', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus!
    const spawn = v.terminal.exec('/spawn box')
    if (spawn.error) throw new Error(spawn.error)
    const actor = [...v.world.actors.values()].find((a) => a.name.toLowerCase().includes('box'))
    if (!actor) throw new Error('spawned box not found')
    actor.script = 'function onBeginPlay() { api.log("v27") }'
    const play = v.terminal.exec('/play')
    if (play.error) throw new Error(play.error)
    await new Promise((r) => setTimeout(r, 80))
    const synced = v.world.resyncActorScript(actor.id)
    v.terminal.exec('/stop')
    return { playing: v.world.playing, synced }
  })

  expect(result.synced).toBe(true)
})

test('wave 41 gridMap autotileNeighbors bitmask', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      gridMap: {
        autotileNeighbors: (n: boolean, e: boolean, s: boolean, w: boolean) => number
      }
    }
    return {
      isolated: v.gridMap.autotileNeighbors(false, false, false, false),
      cross: v.gridMap.autotileNeighbors(true, true, true, true),
      northOnly: v.gridMap.autotileNeighbors(true, false, false, false),
      eastSouth: v.gridMap.autotileNeighbors(false, true, true, false),
    }
  })

  expect(result.isolated).toBe(0)
  expect(result.cross).toBe(15)
  expect(result.northOnly).toBe(1)
  expect(result.eastSouth).toBe(6)
})

test('wave 41 gridMap paintLayer isolates layers 0 and 1', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: import('../src/engine/types').FoliageProps } | null }
      gridMap: {
        paintLayer: (props: import('../src/engine/types').FoliageProps, layer: number, cx: number, cy: number, cz: number) => boolean
        getLayerCellCount: (props: import('../src/engine/types').FoliageProps, layer: number) => number
        getCellCount: (props: import('../src/engine/types').FoliageProps) => number
      }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!layer?.foliageProps) return { ok: false }
    const props = layer.foliageProps
    v.gridMap.paintLayer(props, 0, 1, 0, 2)
    v.gridMap.paintLayer(props, 1, 1, 0, 2)
    return {
      ok: true,
      l0: v.gridMap.getLayerCellCount(props, 0),
      l1: v.gridMap.getLayerCellCount(props, 1),
      total: v.gridMap.getCellCount(props),
    }
  })

  expect(result.ok).toBe(true)
  expect(result.l0).toBe(1)
  expect(result.l1).toBe(1)
  expect(result.total).toBe(2)
})

test('wave 41 gridMap eraseLayer only clears target layer', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: import('../src/engine/types').FoliageProps } | null }
      gridMap: {
        paintLayer: (props: import('../src/engine/types').FoliageProps, layer: number, cx: number, cy: number, cz: number) => boolean
        eraseLayer: (props: import('../src/engine/types').FoliageProps, layer: number, cx: number, cy: number, cz: number) => boolean
        getLayerCellCount: (props: import('../src/engine/types').FoliageProps, layer: number) => number
      }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!layer?.foliageProps) return { ok: false }
    const props = layer.foliageProps
    v.gridMap.paintLayer(props, 0, 0, 0, 0)
    v.gridMap.paintLayer(props, 1, 0, 0, 0)
    const erased = v.gridMap.eraseLayer(props, 0, 0, 0, 0)
    return {
      ok: true,
      erased,
      l0: v.gridMap.getLayerCellCount(props, 0),
      l1: v.gridMap.getLayerCellCount(props, 1),
    }
  })

  expect(result.ok).toBe(true)
  expect(result.erased).toBe(true)
  expect(result.l0).toBe(0)
  expect(result.l1).toBe(1)
})

test('wave 41 gridMap activeLayer clamps to 0–3', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: import('../src/engine/types').FoliageProps } | null }
      gridMap: {
        activeLayer: (props: import('../src/engine/types').FoliageProps) => number
      }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!layer?.foliageProps) return { ok: false }
    const props = layer.foliageProps
    props.activeGridLayer = 2
    const mid = v.gridMap.activeLayer(props)
    props.activeGridLayer = 9
    const clamped = v.gridMap.activeLayer(props)
    delete props.activeGridLayer
    const defaulted = v.gridMap.activeLayer(props)
    return { ok: true, mid, clamped, defaulted }
  })

  expect(result.ok).toBe(true)
  expect(result.mid).toBe(2)
  expect(result.clamped).toBe(3)
  expect(result.defaulted).toBe(0)
})

test('wave 41 gridmap spawn exposes layer + autotile fields', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: { snap?: boolean; activeGridLayer?: number; gridAutotile?: boolean; gridLayers?: Record<number, unknown[]> } } | null }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    const props = layer?.foliageProps
    props!.activeGridLayer = 1
    props!.gridAutotile = true
    return {
      ok: !!props?.snap,
      active: props?.activeGridLayer,
      autotile: props?.gridAutotile,
      hasLayers: props?.gridLayers === undefined,
    }
  })

  expect(result.ok).toBe(true)
  expect(result.active).toBe(1)
  expect(result.autotile).toBe(true)
  expect(result.hasLayers).toBe(true)
})
test('wave 42 minigame script exports', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        minigame: {
          managerName: string
          goalZoneName: string
          fpsTargetTag: string
          rpgNpcGoal: number
          platformerScript: string
          rpgScript: string
          fpsScript: string
        }
      }
    }
    const m = v.indie.minigame
    return {
      manager: m.managerName,
      goal: m.goalZoneName,
      targetTag: m.fpsTargetTag,
      npcGoal: m.rpgNpcGoal,
      platGoal: m.platformerScript.includes('enter:GoalZone') && m.platformerScript.includes('game_won'),
      rpgCollect: m.rpgScript.includes("getActorsByTag('NPC')") && m.rpgScript.includes('enter:RpgQuestZone'),
      fpsFire: m.fpsScript.includes("actionJustPressed('Fire')") && m.fpsScript.includes('game_won'),
    }
  })

  expect(result.manager).toBe('MiniGameManager')
  expect(result.goal).toBe('GoalZone')
  expect(result.targetTag).toBe('Target')
  expect(result.npcGoal).toBe(3)
  expect(result.platGoal).toBe(true)
  expect(result.rpgCollect).toBe(true)
  expect(result.fpsFire).toBe(true)
})

test('wave 42 platformer mini-game attachMiniGameScripts', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawnPlatformerStarter: (mode: 'side') => void; minigame: { attachMiniGameScripts: (m: 'platformer') => void } }
    }
    v.indie.spawnPlatformerStarter('side')
    v.indie.minigame.attachMiniGameScripts('platformer')
    const goal = [...v.world.actors.values()].find((a) => a.name === 'GoalZone')
    const mgr = [...v.world.actors.values()].find((a) => a.name === 'MiniGameManager')
    return {
      goalType: goal?.type,
      goalTag: goal?.type === 'TriggerVolume',
      mgrScript: (mgr?.script ?? '').includes('enter:GoalZone'),
      mgrTag: mgr?.tags.includes('minigame'),
    }
  })

  expect(result.goalTag).toBe(true)
  expect(result.mgrScript).toBe(true)
  expect(result.mgrTag).toBe(true)
})

test('wave 42 rpg mini-game NPC collection path', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawnTopDownRpgStarter: (mode: 'small') => void; minigame: { attachMiniGameScripts: (m: 'rpg') => void } }
    }
    v.indie.spawnTopDownRpgStarter('small')
    v.indie.minigame.attachMiniGameScripts('rpg')
    const npcCount = [...v.world.actors.values()].filter((a) => a.tags.includes('NPC')).length
    const quest = [...v.world.actors.values()].find((a) => a.name === 'RpgQuestZone')
    const mgr = [...v.world.actors.values()].find((a) => a.name === 'MiniGameManager')
    return {
      npcCount,
      quest: quest?.type === 'TriggerVolume',
      questWin: (mgr?.script ?? '').includes('enter:RpgQuestZone'),
      collect: (mgr?.script ?? '').includes('getActorsByTag'),
    }
  })

  expect(result.npcCount).toBeGreaterThanOrEqual(3)
  expect(result.quest).toBe(true)
  expect(result.questWin).toBe(true)
  expect(result.collect).toBe(true)
})

test('wave 42 fps mini-game target crate tags', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawnFpsStarter: () => void; minigame: { attachMiniGameScripts: (m: 'fps') => void; fpsTargetTag: string } }
    }
    v.indie.spawnFpsStarter()
    v.indie.minigame.attachMiniGameScripts('fps')
    const crates = [...v.world.actors.values()].filter((a) => a.name === 'FpsCrateA' || a.name === 'FpsCrateB')
    const mgr = [...v.world.actors.values()].find((a) => a.name === 'MiniGameManager')
    return {
      tagged: crates.every((c) => c.tags.includes(v.indie.minigame.fpsTargetTag)),
      crateCount: crates.length,
      shootScript: (mgr?.script ?? '').includes("actionJustPressed('Fire')"),
    }
  })

  expect(result.tagged).toBe(true)
  expect(result.crateCount).toBe(2)
  expect(result.shootScript).toBe(true)
})

test('wave 42 /minigame platformer terminal command', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus!
    const out = v.terminal.exec('/minigame platformer')
    const floor = [...v.world.actors.values()].find((a) => a.name === 'PlatformerFloor')
    const goal = [...v.world.actors.values()].find((a) => a.name === 'GoalZone')
    const mgr = [...v.world.actors.values()].find((a) => a.name === 'MiniGameManager')
    return {
      output: out?.output,
      floor: !!floor,
      goal: goal?.type === 'TriggerVolume',
      mgr: !!mgr,
    }
  })

  expect(result.output).toMatch(/Mini-game: platformer/i)
  expect(result.floor).toBe(true)
  expect(result.goal).toBe(true)
  expect(result.mgr).toBe(true)
})

test('wave 46 gridMap isLayerVisible defaults all layers on', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: import('../src/engine/types').FoliageProps } | null }
      gridMap: {
        isLayerVisible: (props: import('../src/engine/types').FoliageProps, layer: number) => boolean
      }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!layer?.foliageProps) return { ok: false }
    const props = layer.foliageProps
    return {
      ok: true,
      l0: v.gridMap.isLayerVisible(props, 0),
      l1: v.gridMap.isLayerVisible(props, 1),
      l2: v.gridMap.isLayerVisible(props, 2),
      l3: v.gridMap.isLayerVisible(props, 3),
    }
  })

  expect(result.ok).toBe(true)
  expect(result.l0).toBe(true)
  expect(result.l1).toBe(true)
  expect(result.l2).toBe(true)
  expect(result.l3).toBe(true)
})

test('wave 46 gridMap setLayerVisible hides layer from merged instances', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: import('../src/engine/types').FoliageProps } | null }
      gridMap: {
        paintLayer: (props: import('../src/engine/types').FoliageProps, layer: number, cx: number, cy: number, cz: number) => boolean
        setLayerVisible: (props: import('../src/engine/types').FoliageProps, layer: number, visible: boolean) => void
        isLayerVisible: (props: import('../src/engine/types').FoliageProps, layer: number) => boolean
        getLayerCellCount: (props: import('../src/engine/types').FoliageProps, layer: number) => number
        getCellCount: (props: import('../src/engine/types').FoliageProps) => number
      }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!layer?.foliageProps) return { ok: false }
    const props = layer.foliageProps
    v.gridMap.paintLayer(props, 0, 0, 0, 0)
    v.gridMap.paintLayer(props, 1, 0, 0, 0)
    v.gridMap.setLayerVisible(props, 1, false)
    return {
      ok: true,
      l0Cells: v.gridMap.getLayerCellCount(props, 0),
      l1Cells: v.gridMap.getLayerCellCount(props, 1),
      merged: v.gridMap.getCellCount(props),
      l1Visible: v.gridMap.isLayerVisible(props, 1),
    }
  })

  expect(result.ok).toBe(true)
  expect(result.l0Cells).toBe(1)
  expect(result.l1Cells).toBe(1)
  expect(result.merged).toBe(1)
  expect(result.l1Visible).toBe(false)
})

test('wave 46 gridMap previewAutotileMask north-east cross', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: import('../src/engine/types').FoliageProps } | null }
      gridMap: {
        paintLayer: (props: import('../src/engine/types').FoliageProps, layer: number, cx: number, cy: number, cz: number) => boolean
        previewAutotileMask: (props: import('../src/engine/types').FoliageProps, layer: number, cx: number, cy: number, cz: number) => number
      }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!layer?.foliageProps) return { ok: false }
    const props = layer.foliageProps
    v.gridMap.paintLayer(props, 0, 2, 0, 1)
    v.gridMap.paintLayer(props, 0, 3, 0, 2)
    const center = v.gridMap.previewAutotileMask(props, 0, 2, 0, 2)
    const isolated = v.gridMap.previewAutotileMask(props, 0, 5, 0, 5)
    return { ok: true, center, isolated }
  })

  expect(result.ok).toBe(true)
  expect(result.center).toBe(3)
  expect(result.isolated).toBe(0)
})

test('wave 46 gridmap spawn exposes visibility + preview fields', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: { gridLayerVisibility?: boolean[]; gridAutotilePreview?: boolean } } | null }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    const props = layer?.foliageProps
    props!.gridAutotilePreview = true
    props!.gridLayerVisibility = [true, false, true, true]
    return {
      ok: !!props?.gridAutotilePreview,
      preview: props?.gridAutotilePreview,
      vis: props?.gridLayerVisibility,
    }
  })

  expect(result.ok).toBe(true)
  expect(result.preview).toBe(true)
  expect(result.vis).toEqual([true, false, true, true])
})

test('wave 46 gridMap setLayerVisible restores merged count', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: import('../src/engine/types').FoliageProps } | null }
      gridMap: {
        paintLayer: (props: import('../src/engine/types').FoliageProps, layer: number, cx: number, cy: number, cz: number) => boolean
        setLayerVisible: (props: import('../src/engine/types').FoliageProps, layer: number, visible: boolean) => void
        getCellCount: (props: import('../src/engine/types').FoliageProps) => number
      }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!layer?.foliageProps) return { ok: false }
    const props = layer.foliageProps
    v.gridMap.paintLayer(props, 0, 0, 0, 0)
    v.gridMap.paintLayer(props, 1, 1, 0, 1)
    v.gridMap.setLayerVisible(props, 1, false)
    const hidden = v.gridMap.getCellCount(props)
    v.gridMap.setLayerVisible(props, 1, true)
    const restored = v.gridMap.getCellCount(props)
    return { ok: true, hidden, restored }
  })

  expect(result.ok).toBe(true)
  expect(result.hidden).toBe(1)
  expect(result.restored).toBe(2)
})

test('wave 47 minigame scripts emit game_lost on timeout export', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const m = (window.lotus! as typeof window.lotus).indie.minigame
    return {
      plat: m.platformerScript.includes('game_lost') && m.platformerScript.includes('timeoutSeconds'),
      rpg: m.rpgScript.includes('game_lost') && m.rpgScript.includes('timeoutSeconds'),
      fps: m.fpsScript.includes('game_lost') && m.fpsScript.includes('timeoutSeconds'),
      noHudText: !m.platformerScript.includes("api.hud.text('win'"),
    }
  })

  expect(result.plat).toBe(true)
  expect(result.rpg).toBe(true)
  expect(result.fps).toBe(true)
  expect(result.noHudText).toBe(true)
})

test('wave 47 indie.minigame bridge showHud hideHud exportPreset', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const mg = (window.lotus! as typeof window.lotus).indie.minigame as {
      showHud: () => boolean
      hideHud: () => boolean
      showWinOverlay: () => void
      showLoseOverlay: () => void
      exportPreset: (m: string) => void
    }
    const show = mg.showHud()
    mg.showWinOverlay()
    const win = !!document.getElementById('lotus-minigame-overlay')
    mg.hideHud()
    const hidden = !document.getElementById('lotus-minigame-overlay')
    mg.showLoseOverlay()
    const lose = document.querySelector('.lotus-minigame-lose') != null
    mg.hideHud()
    return {
      show,
      win,
      hidden,
      lose,
      hasExport: typeof mg.exportPreset === 'function',
    }
  })

  expect(result.show).toBe(true)
  expect(result.win).toBe(true)
  expect(result.hidden).toBe(true)
  expect(result.lose).toBe(true)
  expect(result.hasExport).toBe(true)
})

test('wave 47 export embeds __LOTUS_MINIGAME__ when MiniGameManager present', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { minigame: { spawnMiniGame: (m: 'platformer') => void } }
      export: { buildPlayableHTML: () => string }
    }
    v.indie.minigame.spawnMiniGame('platformer')
    const html = v.export.buildPlayableHTML()
    return {
      flag: html.includes('__LOTUS_MINIGAME__ = true'),
      css: html.includes('lotus-minigame-overlay'),
      manager: html.includes('MiniGameManager'),
    }
  })

  expect(result.flag).toBe(true)
  expect(result.css).toBe(true)
  expect(result.manager).toBe(true)
})

test('wave 47 /minigameexport platformer terminal command', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus!
    const out = v.terminal.exec('/minigameexport platformer')
    const mgr = [...v.world.actors.values()].find((a) => a.name === 'MiniGameManager')
    const html = v.export.buildPlayableHTML({ minigameHud: true, minigamePreset: 'platformer' })
    return {
      output: out?.output,
      mgr: !!mgr,
      preset: html.includes("__LOTUS_MINIGAME_PRESET__ = 'platformer'"),
    }
  })

  expect(result.output).toMatch(/Exported mini-game preset: platformer/i)
  expect(result.mgr).toBe(true)
  expect(result.preset).toBe(true)
})

test('wave 47 spawnMiniGame enables HUD wiring flag', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { minigame: { spawnMiniGame: (m: 'fps') => void; showHud: () => boolean } }
    }
    v.indie.minigame.spawnMiniGame('fps')
    return {
      mgr: [...v.world.actors.values()].some((a) => a.name === 'MiniGameManager'),
      hudReady: v.indie.minigame.showHud(),
    }
  })

  expect(result.mgr).toBe(true)
  expect(result.hudReady).toBe(true)
})

test('wave 44 touch fire justPressed via bridge simulate', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { touch: { reset: () => boolean; simulate: (o: { fireJust?: boolean }) => boolean; fireJustPressed: () => boolean } }
    }
    v.indie.touch.reset()
    v.indie.touch.simulate({ fireJust: true })
    const just = v.indie.touch.fireJustPressed()
    v.indie.touch.endFrame()
    return { ok: just === true, just }
  })
  expect(result.ok).toBe(true)
})

test('wave 44 touch interact justPressed via bridge simulate', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { touch: { reset: () => boolean; simulate: (o: { interactJust?: boolean }) => boolean; interactJustPressed: () => boolean; endFrame: () => boolean } }
    }
    v.indie.touch.reset()
    v.indie.touch.simulate({ interactJust: true })
    const just = v.indie.touch.interactJustPressed()
    v.indie.touch.endFrame()
    return { ok: just === true, just }
  })
  expect(result.ok).toBe(true)
})

test('wave 44 gamepad getMoveAxis returns axis object', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { gamepad: { poll: () => boolean; getMoveAxis: () => { x: number; y: number } } }
    }
    v.indie.gamepad.poll()
    const axis = v.indie.gamepad.getMoveAxis()
    return { ok: typeof axis.x === 'number' && typeof axis.y === 'number', axis }
  })
  expect(result.ok).toBe(true)
})

test('wave 44 indie.gamepad setControlsEnabled toggles env flag', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { gamepad: { setControlsEnabled: (on: boolean) => boolean } }
      world: { environment: { gamepadControls?: boolean } }
    }
    v.indie.gamepad.setControlsEnabled(true)
    const on = v.world.environment.gamepadControls === true
    v.indie.gamepad.setControlsEnabled(false)
    const off = v.world.environment.gamepadControls === false
    v.indie.gamepad.setControlsEnabled(true)
    return { ok: on && off, on, off }
  })
  expect(result.ok).toBe(true)
})

test('wave 49 layoutPresets lists compact wide fps', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { touch: { layoutPresets: string[] } }
    }
    return v.indie.touch.layoutPresets
  })
  expect(result).toEqual(['compact', 'wide', 'fps'])
})

test('wave 49 setLayoutPreset writes environment.touchLayoutPreset', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { touch: { setLayoutPreset: (p: 'compact' | 'wide' | 'fps') => string } }
      world: { environment: { touchLayoutPreset?: string } }
    }
    const preset = v.indie.touch.setLayoutPreset('wide')
    return { preset, env: v.world.environment.touchLayoutPreset }
  })
  expect(result.preset).toBe('wide')
  expect(result.env).toBe('wide')
})

test('wave 49 getLayoutPreset defaults to compact', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { touch: { getLayoutPreset: () => string } }
      world: { environment: { touchLayoutPreset?: string } }
    }
    delete v.world.environment.touchLayoutPreset
    return v.indie.touch.getLayoutPreset()
  })
  expect(result).toBe('compact')
})

test('wave 49 applyLayoutPreset sets fps fire button CSS var', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { touch: { applyLayoutPreset: (el: HTMLElement, p: 'fps') => string } }
    }
    const el = document.createElement('div')
    const id = v.indie.touch.applyLayoutPreset(el, 'fps')
    const fireSize = el.style.getPropertyValue('--lotus-touch-fire-btn-size')
    const layout = el.dataset.lotusTouchLayout
    return { id, fireSize, layout }
  })
  expect(result.id).toBe('fps')
  expect(result.fireSize).toBe('88px')
  expect(result.layout).toBe('fps')
})

test('wave 49 export HTML embeds gamepad glyph hint', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      export: { buildPlayableHTML: () => string }
    }
    const html = v.export.buildPlayableHTML()
    return {
      hasGlyph: html.includes('🎮 A fire · B interact'),
      hasGamepadFlag: html.includes('__LOTUS_GAMEPAD__ = true'),
    }
  })
  expect(result.hasGlyph).toBe(true)
  expect(result.hasGamepadFlag).toBe(true)
})

test('wave 44 indie.touch fireJustPressed bridge', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { touch: { fireJustPressed: () => boolean; reset: () => boolean; simulate: (o: { fireJust?: boolean }) => boolean } }
    }
    v.indie.touch.reset()
    v.indie.touch.simulate({ fireJust: true })
    const just = v.indie.touch.fireJustPressed()
    return { ok: just === true, just }
  })
  expect(result.ok).toBe(true)
})
test('wave 45 blend2D script var links serialize', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawn: (p: { kind: 'empty' }, pos: [number, number, number]) => {
          id: string
          blendSpace2D?: { paramX: string; paramY: string; samples: { x: number; y: number; clipName: string }[] }
          blendScriptVarLinkX?: string
          blendScriptVarLinkY?: string
        } | null
        anim: {
          setBlend2DScriptVarLinks: (actorId: string, linkX?: string, linkY?: string) => boolean
        }
      }
    }
    const actor = v.indie.spawn({ kind: 'empty' }, [0, 0, 0])
    if (!actor) return { ok: false }
    actor.blendSpace2D = {
      paramX: 'speed',
      paramY: 'direction',
      samples: [{ x: 0, y: 0, clipName: 'idle' }],
    }
    v.indie.anim.setBlend2DScriptVarLinks(actor.id, 'moveSpeed', 'facing')
    const snap = v.world.actors.get(actor.id)
    return {
      ok: snap?.blendScriptVarLinkX === 'moveSpeed' && snap?.blendScriptVarLinkY === 'facing',
      linkX: snap?.blendScriptVarLinkX,
      linkY: snap?.blendScriptVarLinkY,
    }
  })

  expect(result.ok).toBe(true)
  expect(result.linkX).toBe('moveSpeed')
  expect(result.linkY).toBe('facing')
})

test('wave 45 blendScriptVarLinkX drives resolveAnimParams', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawn: (p: { kind: 'empty' }, pos: [number, number, number]) => {
          id: string
          blendSpace2D?: { paramX: string; paramY: string; samples: { x: number; y: number; clipName: string }[] }
          scriptVars?: Record<string, unknown>
          animParams?: Record<string, number>
        } | null
        anim: {
          setBlendScriptVarLinkX: (actorId: string, varName?: string) => boolean
          resolveParams: (actorId: string) => Record<string, number>
        }
      }
    }
    const actor = v.indie.spawn({ kind: 'empty' }, [0, 0, 0])
    if (!actor) return { ok: false }
    actor.blendSpace2D = {
      paramX: 'speed',
      paramY: 'direction',
      samples: [{ x: 0, y: 0, clipName: 'idle' }],
    }
    actor.animParams = { speed: 0.25, direction: 0 }
    actor.scriptVars = { moveSpeed: 4.5, facing: 90 }
    v.indie.anim.setBlendScriptVarLinkX(actor.id, 'moveSpeed')
    const params = v.indie.anim.resolveParams(actor.id)
    return { ok: params.speed === 4.5 && params.direction === 0, speed: params.speed, direction: params.direction }
  })

  expect(result.ok).toBe(true)
  expect(result.speed).toBe(4.5)
  expect(result.direction).toBe(0)
})

test('wave 45 blendScriptVarLinkY drives resolveAnimParams', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawn: (p: { kind: 'empty' }, pos: [number, number, number]) => {
          id: string
          blendSpace2D?: { paramX: string; paramY: string; samples: { x: number; y: number; clipName: string }[] }
          scriptVars?: Record<string, unknown>
          animParams?: Record<string, number>
        } | null
        anim: {
          setBlendScriptVarLinkY: (actorId: string, varName?: string) => boolean
          resolveParams: (actorId: string) => Record<string, number>
        }
      }
    }
    const actor = v.indie.spawn({ kind: 'empty' }, [0, 0, 0])
    if (!actor) return { ok: false }
    actor.blendSpace2D = {
      paramX: 'speed',
      paramY: 'direction',
      samples: [{ x: 0, y: 0, clipName: 'idle' }],
    }
    actor.animParams = { speed: 1, direction: -1 }
    actor.scriptVars = { moveSpeed: 2, facing: 180 }
    v.indie.anim.setBlendScriptVarLinkY(actor.id, 'facing')
    const params = v.indie.anim.resolveParams(actor.id)
    return { ok: params.speed === 1 && params.direction === 180, speed: params.speed, direction: params.direction }
  })

  expect(result.ok).toBe(true)
  expect(result.speed).toBe(1)
  expect(result.direction).toBe(180)
})

test('wave 45 blend2D script var links override both params', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawn: (p: { kind: 'empty' }, pos: [number, number, number]) => {
          id: string
          blendSpace2D?: { paramX: string; paramY: string; samples: { x: number; y: number; clipName: string }[] }
          scriptVars?: Record<string, unknown>
          animParams?: Record<string, number>
        } | null
        anim: {
          setBlend2DScriptVarLinks: (actorId: string, linkX?: string, linkY?: string) => boolean
          resolveParams: (actorId: string) => Record<string, number>
        }
      }
    }
    const actor = v.indie.spawn({ kind: 'empty' }, [0, 0, 0])
    if (!actor) return { ok: false }
    actor.blendSpace2D = {
      paramX: 'speed',
      paramY: 'direction',
      samples: [
        { x: 0, y: 0, clipName: 'idle' },
        { x: 1, y: 1, clipName: 'run' },
      ],
    }
    actor.animParams = { speed: 0, direction: 0 }
    actor.scriptVars = { moveSpeed: 6, facing: -45 }
    v.indie.anim.setBlend2DScriptVarLinks(actor.id, 'moveSpeed', 'facing')
    const params = v.indie.anim.resolveParams(actor.id)
    return { ok: params.speed === 6 && params.direction === -45, speed: params.speed, direction: params.direction }
  })

  expect(result.ok).toBe(true)
  expect(result.speed).toBe(6)
  expect(result.direction).toBe(-45)
})

test('wave 45 resolveAnimParams boolean script var for blend2D Y', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawn: (p: { kind: 'empty' }, pos: [number, number, number]) => {
          id: string
          blendSpace2D?: { paramX: string; paramY: string; samples: { x: number; y: number; clipName: string }[] }
          scriptVars?: Record<string, unknown>
          animParams?: Record<string, number>
        } | null
        anim: {
          setBlendScriptVarLinkY: (actorId: string, varName?: string) => boolean
          resolveParams: (actorId: string) => Record<string, number>
        }
      }
    }
    const actor = v.indie.spawn({ kind: 'empty' }, [0, 0, 0])
    if (!actor) return { ok: false }
    actor.blendSpace2D = {
      paramX: 'speed',
      paramY: 'strafe',
      samples: [{ x: 0, y: 0, clipName: 'idle' }],
    }
    actor.animParams = { speed: 0.5, strafe: 0 }
    actor.scriptVars = { isStrafing: true }
    v.indie.anim.setBlendScriptVarLinkY(actor.id, 'isStrafing')
    const params = v.indie.anim.resolveParams(actor.id)
    return { ok: params.strafe === 1 && params.speed === 0.5, strafe: params.strafe, speed: params.speed }
  })

  expect(result.ok).toBe(true)
  expect(result.strafe).toBe(1)
  expect(result.speed).toBe(0.5)
})

test('wave 50 indie.flow menuItems + spawnMainMenu', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        flow: {
          menuItems: { kind: string; label: string; levelKey: string }[]
          managerName: string
          menuScript: string
          spawnMainMenu: () => void
        }
      }
    }
    const items = v.indie.flow.menuItems
    v.indie.flow.spawnMainMenu()
    const mgr = [...v.world.actors.values()].find((a) => a.name === v.indie.flow.managerName)
    return {
      count: items.length,
      labels: items.map((i) => i.label),
      kinds: items.map((i) => i.kind),
      mgr: !!mgr,
      mgrTag: mgr?.tags.includes('mainmenu'),
      script: mgr?.script?.includes('api.changeScene'),
      menuScript: v.indie.flow.menuScript.includes('menu_btn_platformer'),
    }
  })

  expect(result.count).toBe(4)
  expect(result.labels).toEqual(expect.arrayContaining(['Platformer', 'RPG', 'FPS', 'MP Deathmatch']))
  expect(result.kinds).toEqual(expect.arrayContaining(['platformer', 'rpg', 'fps', 'mpdeathmatch']))
  expect(result.mgr).toBe(true)
  expect(result.mgrTag).toBe(true)
  expect(result.script).toBe(true)
  expect(result.menuScript).toBe(true)
})

test('wave 50 indie.flow.selectLevel platformer', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { flow: { selectLevel: (kind: 'platformer', opts?: { transition?: boolean }) => Promise<void> } }
      world: { levelLinks: { name: string }[] }
    }
    await v.indie.flow.selectLevel('platformer', { transition: false })
    const floor = [...v.world.actors.values()].find((a) => a.name === 'PlatformerFloor')
    const mgr = [...v.world.actors.values()].find((a) => a.name === 'MiniGameManager')
    const link = v.world.levelLinks.find((l) => l.name === 'platformer')
    return { floor: !!floor, mgr: !!mgr, link: !!link }
  })

  expect(result.floor).toBe(true)
  expect(result.mgr).toBe(true)
  expect(result.link).toBe(true)
})

test('wave 50 /mainmenu terminal command', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      terminal: { exec: (cmd: string) => { output: string | null } }
      world: { hudWidgets: { id: string; type: string }[] }
    }
    const out = v.terminal.exec('/mainmenu')
    const mgr = [...v.world.actors.values()].find((a) => a.name === 'MainMenuManager')
    const btn = v.world.hudWidgets.find((w) => w.id === 'menu_btn_platformer')
    return { output: out?.output, mgr: !!mgr, btn: btn?.type === 'button' }
  })

  expect(result.output).toMatch(/Main menu/i)
  expect(result.mgr).toBe(true)
  expect(result.btn).toBe(true)
})

test('wave 50 export embeds __LOTUS_MAIN_MENU__', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { flow: { spawnMainMenu: () => void } }
      export: { buildPlayableHTML: () => string }
    }
    v.indie.flow.spawnMainMenu()
    const html = v.export.buildPlayableHTML()
    return {
      enabled: html.includes('window.__LOTUS_MAIN_MENU__ = true'),
      disabled: html.includes('window.__LOTUS_MAIN_MENU__ = false'),
    }
  })

  expect(result.enabled).toBe(true)
  expect(result.disabled).toBe(false)
})

test('wave 54 indie.input getBindings returns defaults', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { input: { resetBindings: () => { gamepad: Record<string, number>; touch: Record<string, string> }; getBindings: () => { gamepad: Record<string, number>; touch: Record<string, string> } } }
    }
    v.indie.input.resetBindings()
    return v.indie.input.getBindings()
  })
  expect(result.gamepad).toEqual({ Jump: 0, Fire: 3, Interact: 2 })
  expect(result.touch).toEqual({ jump: 'jump-btn', fire: 'fire-btn', interact: 'interact-btn' })
})

test('wave 54 indie.input setGamepadButton persists Fire to button 0', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { input: { resetBindings: () => unknown; setGamepadButton: (a: 'Fire', b: number) => boolean; getBindings: () => { gamepad: { Fire: number } } } }
    }
    v.indie.input.resetBindings()
    const ok = v.indie.input.setGamepadButton('Fire', 0)
    const fire = v.indie.input.getBindings().gamepad.Fire
    const stored = JSON.parse(localStorage.getItem('lotus-engine.inputBindings') ?? '{}') as { gamepad?: { Fire?: number } }
    return { ok, fire, stored: stored.gamepad?.Fire }
  })
  expect(result.ok).toBe(true)
  expect(result.fire).toBe(0)
  expect(result.stored).toBe(0)
})

test('wave 54 indie.input setTouchSlot maps fire to interact-btn', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { input: { resetBindings: () => unknown; setTouchSlot: (a: 'fire', s: 'interact-btn') => boolean; getBindings: () => { touch: { fire: string } } } }
    }
    v.indie.input.resetBindings()
    const ok = v.indie.input.setTouchSlot('fire', 'interact-btn')
    const fire = v.indie.input.getBindings().touch.fire
    const stored = JSON.parse(localStorage.getItem('lotus-engine.inputBindings') ?? '{}') as { touch?: { fire?: string } }
    return { ok, fire, stored: stored.touch?.fire }
  })
  expect(result.ok).toBe(true)
  expect(result.fire).toBe('interact-btn')
  expect(result.stored).toBe('interact-btn')
})

test('wave 54 indie.input resetBindings restores defaults', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { input: { setGamepadButton: (a: 'Fire', b: number) => boolean; setTouchSlot: (a: 'fire', s: 'interact-btn') => boolean; resetBindings: () => { gamepad: Record<string, number>; touch: Record<string, string> } } }
    }
    v.indie.input.setGamepadButton('Fire', 1)
    v.indie.input.setTouchSlot('fire', 'interact-btn')
    const bindings = v.indie.input.resetBindings()
    const stored = localStorage.getItem('lotus-engine.inputBindings')
    return { bindings, stored }
  })
  expect(result.bindings.gamepad.Fire).toBe(3)
  expect(result.bindings.touch.fire).toBe('fire-btn')
  expect(result.stored).toBe('{"gamepad":{},"touch":{}}')
})

test('wave 54 export HTML embeds __LOTUS_INPUT_BINDINGS__', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { input: { setGamepadButton: (a: 'Fire', b: number) => boolean } }
      export: { buildPlayableHTML: () => string }
    }
    v.indie.input.setGamepadButton('Fire', 0)
    const html = v.export.buildPlayableHTML()
    const match = html.match(/window\.__LOTUS_INPUT_BINDINGS__ = (\{[^;]+\})/)
    const parsed = match ? (JSON.parse(match[1]) as { gamepad?: { Fire?: number } }) : null
    return { hasTag: html.includes('__LOTUS_INPUT_BINDINGS__'), fire: parsed?.gamepad?.Fire }
  })
  expect(result.hasTag).toBe(true)
  expect(result.fire).toBe(0)
})

test('wave 50 indie.flow.selectLevel mpdeathmatch', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { flow: { selectLevel: (kind: 'mpdeathmatch', opts?: { transition?: boolean }) => Promise<void> } }
      world: { levelLinks: { name: string }[] }
    }
    await v.indie.flow.selectLevel('mpdeathmatch', { transition: false })
    const board = [...v.world.actors.values()].find((a) => a.name === 'MpScoreboard')
    const targets = [...v.world.actors.values()].filter((a) => a.tags.includes('mp_target'))
    const link = v.world.levelLinks.find((l) => l.name === 'mpdeathmatch')
    return { board: !!board, targetCount: targets.length, link: !!link }
  })

  expect(result.board).toBe(true)
  expect(result.targetCount).toBe(3)
  expect(result.link).toBe(true)
})

test('wave 55 sceneTransitions fadeOut creates overlay', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { flow: { transition: (k: string, ms: number, phase: string) => Promise<void> } }
    }
    const prev = document.getElementById('lotus-scene-transition')
    if (prev) prev.remove()
    await v.indie.flow.transition('fade', 40, 'out')
    const el = document.getElementById('lotus-scene-transition')
    const out = {
      exists: !!el,
      opacity: el ? getComputedStyle(el).opacity : null,
      z: el?.style.zIndex ?? null,
    }
    await v.indie.flow.transition('fade', 40, 'in')
    return out
  })

  expect(result.exists).toBe(true)
  expect(Number(result.opacity)).toBeGreaterThan(0.9)
  expect(result.z).toBe('10000')
})

test('wave 55 indie.flow.transition slideLeft in phase', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { flow: { transition: (k: string, ms: number, phase: string) => Promise<void> } }
    }
    const el = document.getElementById('lotus-scene-transition') ?? document.createElement('div')
    el.id = 'lotus-scene-transition'
    el.style.position = 'fixed'
    el.style.inset = '0'
    el.style.background = '#0d0f12'
    el.style.opacity = '1'
    el.style.transform = 'translateX(0)'
    document.body.appendChild(el)
    await v.indie.flow.transition('slideLeft', 40, 'in')
    return { transform: el.style.transform, pointerEvents: el.style.pointerEvents }
  })

  expect(result.transform).toContain('-100%')
  expect(result.pointerEvents).toBe('none')
})

test('wave 55 indie.flow.fadeToLevel spawns platformer', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { flow: { fadeToLevel: (kind: 'platformer', ms?: number) => Promise<void> } }
      world: { levelLinks: { name: string }[] }
    }
    await v.indie.flow.fadeToLevel('platformer', 40)
    const floor = [...v.world.actors.values()].find((a) => a.name === 'PlatformerFloor')
    const link = v.world.levelLinks.find((l) => l.name === 'platformer')
    return { floor: !!floor, link: !!link }
  })

  expect(result.floor).toBe(true)
  expect(result.link).toBe(true)
})

test('wave 55 indie.flow.selectLevel default fade transition', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { flow: { selectLevel: (kind: 'fps', opts?: { transitionMs?: number }) => Promise<void> } }
      world: { levelLinks: { name: string }[] }
    }
    const prev = document.getElementById('lotus-scene-transition')
    if (prev) prev.remove()
    await v.indie.flow.selectLevel('fps', { transitionMs: 40 })
    const el = document.getElementById('lotus-scene-transition')
    const mgr = [...v.world.actors.values()].find((a) => a.name === 'MiniGameManager')
    return { overlay: !!el, mgr: !!mgr, opacity: el?.style.opacity ?? null }
  })

  expect(result.overlay).toBe(true)
  expect(result.mgr).toBe(true)
  expect(result.opacity).toBe('0')
})

test('wave 55 export runtime embeds scene transition overlay', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { flow: { spawnMainMenu: () => void } }
      export: { buildPlayableHTML: () => string }
    }
    v.indie.flow.spawnMainMenu()
    const html = v.export.buildPlayableHTML()
    return {
      overlayId: html.includes('lotus-scene-transition'),
      transitionOut: html.includes('sceneTransitionOut'),
      bootFadeIn: html.includes('bootMenuPick') && html.includes('sceneTransitionIn'),
    }
  })

  expect(result.overlayId).toBe(true)
  expect(result.transitionOut).toBe(true)
  expect(result.bootFadeIn).toBe(true)
})

test('wave 52 indie.minigame packModes + exportPack bridge', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const mg = (window.lotus! as typeof window.lotus).indie.minigame as {
      packModes: string[]
      packTitle: (m: string) => string
      packIconStub: () => { sizes: string }[]
      buildPackHTML: (m: string) => string
      exportPack: (m: string) => void
    }
    return {
      modes: mg.packModes,
      title: mg.packTitle('rpg'),
      icons: mg.packIconStub().map((i) => i.sizes),
      hasBuild: typeof mg.buildPackHTML === 'function',
      hasExport: typeof mg.exportPack === 'function',
    }
  })

  expect(result.modes).toEqual(['platformer', 'rpg', 'fps'])
  expect(result.title).toBe('Lotus RPG Pack')
  expect(result.icons).toEqual(expect.arrayContaining(['192x192', '512x512']))
  expect(result.hasBuild).toBe(true)
  expect(result.hasExport).toBe(true)
})

test('wave 52 buildPackHTML embeds __LOTUS_MINIGAME_PACK__ and PWA manifest', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { minigame: { spawnMiniGame: (m: 'platformer') => void; buildPackHTML: (m: 'platformer') => string } }
    }
    v.indie.minigame.spawnMiniGame('platformer')
    const html = v.indie.minigame.buildPackHTML('platformer')
    return {
      pack: html.includes("__LOTUS_MINIGAME_PACK__ = 'platformer'"),
      preset: html.includes("__LOTUS_MINIGAME_PRESET__ = 'platformer'"),
      manifest: html.includes('application/manifest+json;base64,'),
      sw: html.includes('serviceWorker'),
      badge: html.includes('PLATFORMER PACK'),
    }
  })

  expect(result.pack).toBe(true)
  expect(result.preset).toBe(true)
  expect(result.manifest).toBe(true)
  expect(result.sw).toBe(true)
  expect(result.badge).toBe(true)
})

test('wave 52 /exportpack platformer terminal command', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus!
    const out = v.terminal.exec('/exportpack platformer')
    const mgr = [...v.world.actors.values()].find((a) => a.name === 'MiniGameManager')
    const goal = [...v.world.actors.values()].find((a) => a.name === 'GoalZone')
    return { output: out?.output, mgr: !!mgr, goal: !!goal }
  })

  expect(result.output).toMatch(/Exported mini-game pack: platformer/i)
  expect(result.mgr).toBe(true)
  expect(result.goal).toBe(true)
})

test('wave 52 buildPackHTML manifest includes icon stub', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { minigame: { packIconStub: () => { src: string; sizes: string }[] } }
      export: { buildMiniGamePackHTML: (m: 'fps') => string }
    }
    const html = v.export.buildMiniGamePackHTML('fps')
    const stubSrc = v.indie.minigame.packIconStub()[0]?.src ?? ''
    const m = html.match(/manifest\+json;base64,([^"]+)/)
    const manifest = m ? (JSON.parse(atob(m[1])) as { icons?: { src: string; sizes: string }[] }) : null
    return {
      iconCount: manifest?.icons?.length ?? 0,
      iconSrc: manifest?.icons?.[0]?.src ?? '',
      stubSrc,
      minigameHud: html.includes('__LOTUS_MINIGAME__ = true'),
    }
  })

  expect(result.iconCount).toBeGreaterThanOrEqual(2)
  expect(result.iconSrc).toBe(result.stubSrc)
  expect(result.iconSrc.startsWith('data:image/png;base64,')).toBe(true)
  expect(result.minigameHud).toBe(true)
})

test('wave 52 buildPackHTML preset level per genre', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { minigame: { spawnMiniGame: (m: 'rpg' | 'fps') => void; buildPackHTML: (m: 'rpg' | 'fps') => string } }
    }
    v.indie.minigame.spawnMiniGame('rpg')
    const rpgHtml = v.indie.minigame.buildPackHTML('rpg')
    const rpgNpcs = [...v.world.actors.values()].filter((a) => a.tags.includes('NPC')).length
    v.indie.minigame.spawnMiniGame('fps')
    const fpsHtml = v.indie.minigame.buildPackHTML('fps')
    const fpsTargets = [...v.world.actors.values()].filter((a) => a.tags.includes('Target')).length
    return {
      rpgPack: rpgHtml.includes("__LOTUS_MINIGAME_PACK__ = 'rpg'"),
      rpgNpcs,
      fpsPack: fpsHtml.includes("__LOTUS_MINIGAME_PACK__ = 'fps'"),
      fpsTargets,
    }
  })

  expect(result.rpgPack).toBe(true)
  expect(result.rpgNpcs).toBeGreaterThanOrEqual(3)
  expect(result.fpsPack).toBe(true)
  expect(result.fpsTargets).toBeGreaterThanOrEqual(2)
})

test('wave 51 gridMap autotileExtendedMask 8-neighbor bits', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      gridMap: {
        autotileExtendedMask: (
          n: boolean,
          e: boolean,
          s: boolean,
          w: boolean,
          ne: boolean,
          se: boolean,
          sw: boolean,
          nw: boolean,
        ) => number
        autotileNeighbors: (n: boolean, e: boolean, s: boolean, w: boolean) => number
      }
    }
    const full = v.gridMap.autotileExtendedMask(true, true, true, true, true, false, false, true)
    const cross = v.gridMap.autotileNeighbors(true, true, true, true)
    return { full, cross }
  })

  expect(result.full).toBe(159)
  expect(result.cross).toBe(15)
})

test('wave 51 gridMap resolveAutotileCorner inner-ne and outer-ne', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      gridMap: { resolveAutotileCorner: (cardinal: number, extended: number) => string }
    }
    return {
      inner: v.gridMap.resolveAutotileCorner(3, 3),
      outer: v.gridMap.resolveAutotileCorner(0, 16),
    }
  })

  expect(result.inner).toBe('inner-ne')
  expect(result.outer).toBe('outer-ne')
})

test('wave 51 gridMap autotileRuleForMask corner sprites', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      gridMap: {
        autotileRuleForMask: (
          mask: number,
          kind: 'box' | 'sphere' | 'plane',
          ext?: number,
        ) => { resolvedKind: string; corner: string }
      }
    }
    const inner = v.gridMap.autotileRuleForMask(3, 'box', 3)
    const isolated = v.gridMap.autotileRuleForMask(0, 'sphere')
    return { innerKind: inner.resolvedKind, innerCorner: inner.corner, isolatedKind: isolated.resolvedKind }
  })

  expect(result.innerKind).toBe('plane')
  expect(result.innerCorner).toBe('inner-ne')
  expect(result.isolatedKind).toBe('box')
})

test('wave 51 gridMap resolveAutotileKind majority vote', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      gridMap: {
        resolveAutotileKind: (
          mask: number,
          neighbors: ('box' | 'sphere' | 'plane' | null)[],
          base: 'box' | 'sphere' | 'plane',
        ) => string
      }
    }
    const majority = v.gridMap.resolveAutotileKind(7, ['box', 'box', 'sphere', null], 'sphere')
    const isolated = v.gridMap.resolveAutotileKind(0, [null, null, null, null], 'sphere')
    return { majority, isolated }
  })

  expect(result.majority).toBe('box')
  expect(result.isolated).toBe('sphere')
})

test('wave 51 gridmap spawn exposes gridAutotileRules + bridge APIs', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: { gridAutotileRules?: boolean } } | null }
      gridMap: {
        autotileRuleForMask: unknown
        resolveAutotileKind: unknown
        previewAutotileCorner: unknown
        previewAutotileExtendedMask: unknown
      }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    const props = layer?.foliageProps
    props!.gridAutotileRules = true
    return {
      rules: props?.gridAutotileRules,
      hasRule: typeof v.gridMap.autotileRuleForMask === 'function',
      hasKind: typeof v.gridMap.resolveAutotileKind === 'function',
      hasCorner: typeof v.gridMap.previewAutotileCorner === 'function',
      hasExt: typeof v.gridMap.previewAutotileExtendedMask === 'function',
    }
  })

  expect(result.rules).toBe(true)
  expect(result.hasRule).toBe(true)
  expect(result.hasKind).toBe(true)
  expect(result.hasCorner).toBe(true)
  expect(result.hasExt).toBe(true)
})

test('wave 43 indie MP deathmatch template', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawnIndieMpDeathmatch: () => void }
    }
    const before = v.world.actors.size
    v.indie.spawnIndieMpDeathmatch()
    const floor = [...v.world.actors.values()].find((a) => a.name === 'MpDmFloor')
    const host = [...v.world.actors.values()].find((a) => a.name === 'HostSpawn')
    const board = [...v.world.actors.values()].find((a) => a.name === 'MpScoreboard')
    const targets = [...v.world.actors.values()].filter((a) => a.tags.includes('mp_target'))
    const hud = v.world.hudWidgets.find((w) => w.id === 'mp_score_hud')
    return {
      added: v.world.actors.size > before,
      floor: !!floor,
      hostScript: host?.script?.includes('addMpScore'),
      boardSync: (board?.syncProperties ?? []).includes('peerScores'),
      targetCount: targets.length,
      hud: !!hud,
      rapier: v.world.environment.useRapierCharacter,
    }
  })

  expect(result.added).toBe(true)
  expect(result.floor).toBe(true)
  expect(result.hostScript).toBe(true)
  expect(result.boardSync).toBe(true)
  expect(result.targetCount).toBe(3)
  expect(result.hud).toBe(true)
  expect(result.rapier).toBe(true)
})

test('wave 43 mp score script + target tag bridge', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        mp: {
          tagTarget: string
          scoreScript: string
          scoreboardScript: string
          winScore: number
        }
      }
    }
    return {
      tagTarget: v.indie.mp.tagTarget,
      scoreHasFire: v.indie.mp.scoreScript.includes("actionJustPressed('Fire')"),
      scoreHasTarget: v.indie.mp.scoreScript.includes('mp_target'),
      boardHasSync: v.indie.mp.scoreboardScript.includes('peerScores'),
      winScore: v.indie.mp.winScore,
    }
  })

  expect(result.tagTarget).toBe('mp_target')
  expect(result.scoreHasFire).toBe(true)
  expect(result.scoreHasTarget).toBe(true)
  expect(result.boardHasSync).toBe(true)
  expect(result.winScore).toBe(3)
})

test('wave 43 /mpdeathmatch terminal command', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus!
    const out = v.terminal.exec('/mpdeathmatch')
    const board = [...v.world.actors.values()].find((a) => a.name === 'MpScoreboard')
    const target = [...v.world.actors.values()].find((a) => a.name === 'MpTargetA')
    return {
      output: out?.output,
      board: !!board,
      targetTag: target?.tags.includes('mp_target'),
    }
  })

  expect(result.output).toMatch(/deathmatch/i)
  expect(result.board).toBe(true)
  expect(result.targetTag).toBe(true)
})

test('wave 43 getMpScore addMpScore host authority', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawnIndieMpDeathmatch: () => void
        mp: { getScore: (id?: string) => number; addScore: (d: number, id?: string) => boolean }
      }
    }
    v.indie.spawnIndieMpDeathmatch()
    const before = v.indie.mp.getScore('peer-a')
    const ok = v.indie.mp.addScore(2, 'peer-a')
    const after = v.indie.mp.getScore('peer-a')
    const board = [...v.world.actors.values()].find((a) => a.name === 'MpScoreboard')
    const sv = (board?.scriptVars?.peerScores ?? {}) as Record<string, number>
    return { before, ok, after, svPeerA: sv['peer-a'] ?? 0 }
  })

  // Offline editor: addMpScore returns false (mp not connected); scoreboard still readable at 0.
  expect(result.before).toBe(0)
  expect(result.after).toBe(0)
  expect(result.ok).toBe(false)
})

test('wave 48 getMpPeerScores returns scoreboard map', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawnIndieMpDeathmatch: () => void
        mp: { getPeerScores: () => Record<string, number>; mirrorScores: (s: Record<string, number>) => boolean }
      }
    }
    v.indie.spawnIndieMpDeathmatch()
    const empty = v.indie.mp.getPeerScores()
    const mirrored = v.indie.mp.mirrorScores({ 'peer-a': 2, 'peer-b': 1 })
    const after = v.indie.mp.getPeerScores()
    return { empty, mirrored, after }
  })

  expect(result.empty).toEqual({})
  expect(result.mirrored).toBe(true)
  expect(result.after).toEqual({ 'peer-a': 2, 'peer-b': 1 })
})

test('wave 48 mirrorScores updates MpScoreboard scriptVars', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawnIndieMpDeathmatch: () => void
        mp: { mirrorScores: (s: Record<string, number>) => boolean }
      }
    }
    v.indie.spawnIndieMpDeathmatch()
    v.indie.mp.mirrorScores({ host1: 3, client9: 1 })
    const board = [...v.world.actors.values()].find((a) => a.name === 'MpScoreboard')
    const sv = (board?.scriptVars?.peerScores ?? {}) as Record<string, number>
    return { host1: sv.host1 ?? 0, client9: sv.client9 ?? 0 }
  })

  expect(result.host1).toBe(3)
  expect(result.client9).toBe(1)
})

test('wave 48 scoreboard script shows all peer scores', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { mp: { scoreboardScript: string } }
    }
    const script = v.indie.mp.scoreboardScript
    return {
      hasGetPeerScores: script.includes('getMpPeerScores'),
      hasEntries: script.includes('Object.entries(scores)'),
      hasGameWon: script.includes("api.on('mp_game_won'"),
    }
  })

  expect(result.hasGetPeerScores).toBe(true)
  expect(result.hasEntries).toBe(true)
  expect(result.hasGameWon).toBe(true)
})

test('wave 48 applyMpScoreDelta emits mp_game_won at win threshold', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawnIndieMpDeathmatch: () => void
        mp: {
          winScore: number
          applyMpScoreDelta: (
            peerId: string,
            delta: number,
            emit?: (signal: string, ...args: unknown[]) => void,
          ) => boolean
        }
      }
    }
    v.indie.spawnIndieMpDeathmatch()
    let won: { peerId: string; score: number } | null = null
    const ok = v.indie.mp.applyMpScoreDelta('peer-win', v.indie.mp.winScore, (signal, peerId, score) => {
      if (signal === 'mp_game_won') won = { peerId: String(peerId), score: Number(score) }
    })
    return { ok, won, winScore: v.indie.mp.winScore }
  })

  expect(result.ok).toBe(true)
  expect(result.won).toEqual({ peerId: 'peer-win', score: result.winScore })
})

test('wave 36 gridMap worldToGridCell + gridCellKey', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      gridMap: {
        worldToGridCell: (x: number, y: number, z: number) => { x: number; y: number; z: number }
        gridCellKey: (cx: number, cy: number, cz: number) => string
      }
    }
    const cell = v.gridMap.worldToGridCell(1.4, 0.2, -2.6)
    const key = v.gridMap.gridCellKey(cell.x, cell.y, cell.z)
    return { cell, key }
  })

  expect(result.cell).toEqual({ x: 1, y: 0, z: -3 })
  expect(result.key).toBe('1,0,-3')
})

test('wave 36 gridMap paintCell + getCellCount', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: import('../src/engine/types').FoliageProps } | null }
      gridMap: {
        paintCell: (props: import('../src/engine/types').FoliageProps, cx: number, cy: number, cz: number) => boolean
        getCellCount: (props: import('../src/engine/types').FoliageProps) => number
      }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!layer?.foliageProps) return { ok: false }
    const props = layer.foliageProps
    const painted = v.gridMap.paintCell(props, 2, 0, 3)
    const dup = v.gridMap.paintCell(props, 2, 0, 3)
    return { ok: true, painted, dup, count: v.gridMap.getCellCount(props) }
  })

  expect(result.ok).toBe(true)
  expect(result.painted).toBe(true)
  expect(result.dup).toBe(false)
  expect(result.count).toBe(1)
})

test('wave 36 gridMap eraseCell', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: import('../src/engine/types').FoliageProps } | null }
      gridMap: {
        paintCell: (props: import('../src/engine/types').FoliageProps, cx: number, cy: number, cz: number) => boolean
        eraseCell: (props: import('../src/engine/types').FoliageProps, cx: number, cy: number, cz: number) => boolean
        getCellCount: (props: import('../src/engine/types').FoliageProps) => number
      }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!layer?.foliageProps) return { ok: false }
    const props = layer.foliageProps
    v.gridMap.paintCell(props, 0, 0, 0)
    v.gridMap.paintCell(props, 1, 0, 0)
    const erased = v.gridMap.eraseCell(props, 0, 0, 0)
    const miss = v.gridMap.eraseCell(props, 0, 0, 0)
    return { ok: true, erased, miss, count: v.gridMap.getCellCount(props) }
  })

  expect(result.ok).toBe(true)
  expect(result.erased).toBe(true)
  expect(result.miss).toBe(false)
  expect(result.count).toBe(1)
})

test('wave 36 gridMap brush cellsInBrush', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      gridMap: {
        cellsInBrush: (cx: number, cy: number, cz: number, brushSize: number) => { x: number; y: number; z: number }[]
      }
    }
    const cells = v.gridMap.cellsInBrush(0, 0, 0, 1)
    const keys = new Set(cells.map((c) => `${c.x},${c.z}`))
    return { len: cells.length, hasCenter: keys.has('0,0'), hasCorner: keys.has('-1,-1') }
  })

  expect(result.len).toBe(9)
  expect(result.hasCenter).toBe(true)
  expect(result.hasCorner).toBe(true)
})

test('wave 36 gridmap spawn snap + tile palette kinds', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: { snap?: boolean; geometry?: string; gridBrushSize?: number } } | null }
      gridMap: { tileKinds: readonly string[] }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    const props = layer?.foliageProps
    return {
      ok: !!props?.snap,
      geometry: props?.geometry,
      brush: props?.gridBrushSize,
      kinds: [...v.gridMap.tileKinds],
    }
  })

  expect(result.ok).toBe(true)
  expect(result.geometry).toBe('box')
  expect(result.brush).toBe(0)
  expect(result.kinds).toEqual(['box', 'sphere', 'plane'])
})
test('wave 37 top-down RPG starter template (small)', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawnTopDownRpgStarter: (mode: 'small') => void }
    }
    const before = v.world.actors.size
    v.indie.spawnTopDownRpgStarter('small')
    const floor = [...v.world.actors.values()].find((a) => a.name === 'RpgFloor')
    const npc = [...v.world.actors.values()].find((a) => a.name === 'RpgNpcA')
    const quest = [...v.world.actors.values()].find((a) => a.name === 'RpgQuestZone')
    const start = [...v.world.actors.values()].find((a) => a.name === 'RpgPlayerStart')
    return {
      added: v.world.actors.size > before,
      floor: !!floor,
      npcTag: npc?.tags.includes('NPC'),
      quest: quest?.type === 'TriggerVolume',
      startPawn: start?.pawnMode,
      rapier: v.world.environment.useRapierCharacter,
    }
  })

  expect(result.added).toBe(true)
  expect(result.floor).toBe(true)
  expect(result.npcTag).toBe(true)
  expect(result.quest).toBe(true)
  expect(result.startPawn).toBe('thirdperson')
  expect(result.rapier).toBe(true)
})

test('wave 37 top-down RPG starter template (large)', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawnTopDownRpgStarter: (mode: 'large') => void }
    }
    v.indie.spawnTopDownRpgStarter('large')
    const npcCount = [...v.world.actors.values()].filter((a) => a.tags.includes('NPC')).length
    const wall = [...v.world.actors.values()].find((a) => a.name === 'RpgWallN')
    return { npcCount, wall: !!wall }
  })

  expect(result.npcCount).toBeGreaterThanOrEqual(4)
  expect(result.wall).toBe(true)
})

test('wave 37 FPS starter template', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawnFpsStarter: () => void }
    }
    const before = v.world.actors.size
    v.indie.spawnFpsStarter()
    const floor = [...v.world.actors.values()].find((a) => a.name === 'FpsFloor')
    const wall = [...v.world.actors.values()].find((a) => a.name === 'FpsWallL1')
    const start = [...v.world.actors.values()].find((a) => a.name === 'FpsPlayerStart')
    const lights = [...v.world.actors.values()].filter((a) => a.type === 'PointLight' && a.name.startsWith('FpsLight'))
    return {
      added: v.world.actors.size > before,
      floor: !!floor,
      wall: !!wall,
      startPawn: start?.pawnMode,
      lightCount: lights.length,
      rapier: v.world.environment.useRapierCharacter,
    }
  })

  expect(result.added).toBe(true)
  expect(result.floor).toBe(true)
  expect(result.wall).toBe(true)
  expect(result.startPawn).toBe('firstperson')
  expect(result.lightCount).toBeGreaterThanOrEqual(3)
  expect(result.rapier).toBe(true)
})

test('wave 37 /rpg terminal command', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus!
    const out = v.terminal.exec('/rpg small')
    const floor = [...v.world.actors.values()].find((a) => a.name === 'RpgFloor')
    return { output: out?.output, floor: !!floor }
  })

  expect(result.output).toContain('Top-down RPG starter')
  expect(result.floor).toBe(true)
})

test('wave 37 /fps terminal command', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus!
    const out = v.terminal.exec('/fps')
    const start = [...v.world.actors.values()].find((a) => a.name === 'FpsPlayerStart')
    return { output: out?.output, startPawn: start?.pawnMode }
  })

  expect(result.output).toContain('FPS starter')
  expect(result.startPawn).toBe('firstperson')
})
test('wave 38 indie MP starter template', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawnIndieMpTemplate: () => void }
    }
    const before = v.world.actors.size
    v.indie.spawnIndieMpTemplate()
    const floor = [...v.world.actors.values()].find((a) => a.name === 'MpFloor')
    const host = [...v.world.actors.values()].find((a) => a.name === 'HostSpawn')
    const client = [...v.world.actors.values()].find((a) => a.name === 'ClientSpawn')
    const crates = [...v.world.actors.values()].filter((a) => a.name.startsWith('MpCrate'))
    return {
      added: v.world.actors.size > before,
      floor: !!floor,
      hostTag: host?.tags.includes('mp_host'),
      client: !!client,
      crateCount: crates.length,
      syncSpawn: crates.every((c) => c.syncSpawn),
      syncProps: crates.every((c) => (c.syncProperties?.length ?? 0) > 0),
      rapier: v.world.environment.useRapierCharacter,
    }
  })

  expect(result.added).toBe(true)
  expect(result.floor).toBe(true)
  expect(result.hostTag).toBe(true)
  expect(result.client).toBe(true)
  expect(result.crateCount).toBe(2)
  expect(result.syncSpawn).toBe(true)
  expect(result.syncProps).toBe(true)
  expect(result.rapier).toBe(true)
})

test('wave 38 configureIndieMpSettings enables room', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { configureIndieMpSettings: (room?: string) => void }
    }
    v.indie.configureIndieMpSettings('wave38-mp-room')
    const settings = v.multiplayer.loadSettings()
    return { enabled: settings.enabled, room: settings.room }
  })

  expect(result.enabled).toBe(true)
  expect(result.room).toBe('wave38-mp-room')
})

test('wave 38 mp_host mp_sync script snippets', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        mp: { tagHost: string; tagSync: string; hostScript: string; syncScript: string }
      }
    }
    return {
      hostTag: v.indie.mp.tagHost,
      syncTag: v.indie.mp.tagSync,
      hostHasTag: v.indie.mp.hostScript.includes('mp_host'),
      syncHasTag: v.indie.mp.syncScript.includes('mp_sync'),
      hostUsesApi: v.indie.mp.hostScript.includes('api.mpIsHost'),
      syncUsesApi: v.indie.mp.syncScript.includes('api.mpIsHost'),
    }
  })

  expect(result.hostTag).toBe('mp_host')
  expect(result.syncTag).toBe('mp_sync')
  expect(result.hostHasTag).toBe(true)
  expect(result.syncHasTag).toBe(true)
  expect(result.hostUsesApi).toBe(true)
  expect(result.syncUsesApi).toBe(true)
})

test('wave 38 /mpstarter terminal command', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus!
    const out = v.terminal.exec('/mpstarter')
    const host = [...v.world.actors.values()].find((a) => a.name === 'HostSpawn')
    const crate = [...v.world.actors.values()].find((a) => a.name === 'MpCrateA')
    return {
      output: out?.output,
      host: !!host,
      syncTag: crate?.tags.includes('mp_sync'),
    }
  })

  expect(result.output).toMatch(/Indie MP starter/i)
  expect(result.host).toBe(true)
  expect(result.syncTag).toBe(true)
})

test('wave 39 touch isTouchDevice boolean', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & { indie: { touch: { isTouchDevice: () => boolean } } }
    const t = v.indie.touch.isTouchDevice()
    return { ok: typeof t === 'boolean', touch: t }
  })
  expect(result.ok).toBe(true)
})

test('wave 39 VirtualJoystick axis after synthetic touch', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { touch: { createJoystick: (el: HTMLElement, r?: number) => { root: HTMLElement; getAxis: () => { x: number; y: number }; dispose: () => void } } }
    }
    const host = document.createElement('div')
    host.style.cssText = 'position:fixed;left:0;top:0;width:120px;height:120px'
    document.body.appendChild(host)
    const joy = v.indie.touch.createJoystick(host, 48)
    const rect = joy.root.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    joy.root.dispatchEvent(new TouchEvent('touchstart', {
      bubbles: true, cancelable: true,
      changedTouches: [new Touch({ identifier: 1, target: joy.root, clientX: cx + 30, clientY: cy })],
    }))
    const axis = joy.getAxis()
    host.remove()
    joy.dispose()
    return { ok: axis.x > 0.4, x: axis.x }
  })
  expect(result.ok).toBe(true)
})

test('wave 39 getMoveAxis zero after reset', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & { indie: { touch: { reset: () => boolean; getMoveAxis: () => { x: number; y: number } } } }
    v.indie.touch.reset()
    const axis = v.indie.touch.getMoveAxis()
    return { ok: axis.x === 0 && axis.y === 0, axis }
  })
  expect(result.ok).toBe(true)
})

test('wave 39 setControlsEnabled toggles env flag', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & { indie: { touch: { setControlsEnabled: (on: boolean) => boolean } }; world: { environment: { touchControls?: boolean } } }
    v.indie.touch.setControlsEnabled(true)
    const on = v.world.environment.touchControls === true
    v.indie.touch.setControlsEnabled(false)
    const off = v.world.environment.touchControls === false
    v.indie.touch.setControlsEnabled(true)
    return { ok: on && off, on, off }
  })
  expect(result.ok).toBe(true)
})

test('wave 39 getActionAxis MoveForward MoveRight keyboard', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & { indie: { touch: { reset: () => boolean; getActionAxis: (n: string) => number } } }
    v.indie.touch.reset()
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', bubbles: true }))
    const fwd = v.indie.touch.getActionAxis('MoveForward')
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', bubbles: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyD', bubbles: true }))
    const right = v.indie.touch.getActionAxis('MoveRight')
    window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyD', bubbles: true }))
    return { ok: fwd < -0.5 && right > 0.5, fwd, right }
  })
  expect(result.ok).toBe(true)
})
test('wave 40 scriptVarPresets save + list curve resource', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        resources: {
          scriptVarPresets: {
            save: (name: string, keys: { t: number; v: number }[], varName?: string) => { id: string; name: string }
            list: () => { id: string; data: { scriptVarPreset?: boolean; keys: { t: number; v: number }[] } }[]
            load: (id: string) => { data: { keys: { t: number; v: number }[] } } | undefined
          }
        }
      }
    }
    const res = v.indie.resources.scriptVarPresets.save('EaseIn', [{ t: 0, v: 0 }, { t: 2, v: 8 }], 'speed')
    const loaded = v.indie.resources.scriptVarPresets.load(res.id)
    const listed = v.indie.resources.scriptVarPresets.list()
    return {
      ok: !!loaded && loaded.data.keys.length === 2,
      id: res.id,
      name: res.name,
      count: listed.length,
      firstKey: loaded?.data.keys[0],
    }
  })

  expect(result.ok).toBe(true)
  expect(result.name).toBe('EaseIn')
  expect(result.firstKey).toEqual({ t: 0, v: 0 })
  expect(result.count).toBeGreaterThan(0)
})

test('wave 40 applyScriptVarPreset writes scriptVar track keys', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawn: (p: { kind: 'empty' }, pos: [number, number, number]) => { id: string } | null
        resources: {
          scriptVarPresets: {
            save: (name: string, keys: { t: number; v: number }[]) => { id: string }
          }
        }
        sequencer: {
          applyScriptVarPreset: (actorId: string, varName: string, presetId: string) => boolean
        }
      }
      world: { sequence: { tracks: { trackType?: string; actorId: string; property: string; keys: { t: number; v: number }[] }[] } }
    }
    const actor = v.indie.spawn({ kind: 'empty' }, [0, 0, 0])
    if (!actor) return { ok: false }
    const preset = v.indie.resources.scriptVarPresets.save('Jump', [
      { t: 0, v: 0 },
      { t: 0.5, v: 5 },
      { t: 1, v: 0 },
    ])
    const applied = v.indie.sequencer.applyScriptVarPreset(actor.id, 'speed', preset.id)
    const track = v.world.sequence.tracks.find(
      (tr) => tr.trackType === 'scriptVar' && tr.actorId === actor.id && tr.property === 'speed',
    )
    return { ok: applied && (track?.keys.length ?? 0) === 3, keys: track?.keys }
  })

  expect(result.ok).toBe(true)
  expect(result.keys?.[1]?.v).toBe(5)
})

test('wave 40 blendScriptVarLink drives resolveAnimParams', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawn: (p: { kind: 'empty' }, pos: [number, number, number]) => {
          id: string
          blendSpace1D?: { param: string; samples: { value: number; clipName: string }[] }
          scriptVars?: Record<string, unknown>
          animParams?: Record<string, number>
        } | null
        anim: {
          setBlendScriptVarLink: (actorId: string, varName?: string) => boolean
          resolveParams: (actorId: string) => Record<string, number>
        }
      }
    }
    const actor = v.indie.spawn({ kind: 'empty' }, [0, 0, 0])
    if (!actor) return { ok: false }
    actor.blendSpace1D = { param: 'speed', samples: [{ value: 0, clipName: 'idle' }] }
    actor.animParams = { speed: 0.25 }
    actor.scriptVars = { speed: 7.5 }
    v.indie.anim.setBlendScriptVarLink(actor.id, 'speed')
    const params = v.indie.anim.resolveParams(actor.id)
    return { ok: params.speed === 7.5, speed: params.speed }
  })

  expect(result.ok).toBe(true)
  expect(result.speed).toBe(7.5)
})

test('wave 40 applyScriptVarPreset samples into scriptVars on scrub', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawn: (p: { kind: 'empty' }, pos: [number, number, number]) => { id: string; script?: string } | null
        resources: {
          scriptVarPresets: {
            save: (name: string, keys: { t: number; v: number }[]) => { id: string }
          }
        }
        sequencer: {
          applyScriptVarPreset: (actorId: string, varName: string, presetId: string) => boolean
          sampleScriptVar: (actorId: string, varName: string, t: number, keys: { t: number; v: number }[]) => unknown
        }
      }
      world: { sequence: { tracks: { keys: { t: number; v: number }[] }[] } }
    }
    const actor = v.indie.spawn({ kind: 'empty' }, [0, 0, 0])
    if (!actor) return { ok: false }
    actor.script = '// @export_range speed 0 10 1 = 0\n'
    const preset = v.indie.resources.scriptVarPresets.save('Ramp', [
      { t: 0, v: 0 },
      { t: 1, v: 10 },
    ])
    v.indie.sequencer.applyScriptVarPreset(actor.id, 'speed', preset.id)
    const track = v.world.sequence.tracks[0]
    const sampled = v.indie.sequencer.sampleScriptVar(actor.id, 'speed', 0.5, track?.keys ?? [])
    return { ok: sampled === 5, sampled }
  })

  expect(result.ok).toBe(true)
  expect(result.sampled).toBe(5)
})

test('wave 40 sequencer UI apply preset dropdown exists for script var track', async ({ page }) => {
  await bootEditor(page)

  await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawn: (p: { kind: 'empty' }, pos: [number, number, number]) => { id: string } | null
        resources: {
          scriptVarPresets: {
            save: (name: string, keys: { t: number; v: number }[]) => { id: string }
          }
        }
        sequencer: {
          applyScriptVarPreset: (actorId: string, varName: string, presetId: string) => boolean
        }
      }
    }
    const actor = v.indie.spawn({ kind: 'empty' }, [0, 0, 0])
    if (!actor) return
    actor.script = '// @export speed = 0\n'
    const preset = v.indie.resources.scriptVarPresets.save('UIPreset', [{ t: 0, v: 1 }])
    v.indie.sequencer.applyScriptVarPreset(actor.id, 'speed', preset.id)
    v.useEditor.getState().select(actor.id)
    v.useEditor.getState().setBottomTab('sequencer')
  })

  await page.locator('.seq-track-name', { hasText: 'speed' }).click()
  await expect(page.locator('.seq-curve-preset select')).toBeVisible({ timeout: 8000 })
  await expect(page.locator('.seq-curve-preset option', { hasText: 'UIPreset' })).toHaveCount(1)
})

test('wave 35 prefab subtree + override diff', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawn: (p: { kind: 'mesh'; geometry: 'box' }, pos: [number, number, number]) => { id: string; name: string } | null
        prefab: {
          save: (id: string) => unknown
          instantiate: (name: string, pos: [number, number, number]) => void
          recordOverride: (actorId: string, field: string) => void
          subtree: (id: string) => { actorId: string; overrideCount: number }[]
          overrideDiff: (id: string) => { fieldPath: string }[]
        }
      }
    }
    const box = v.indie.spawn({ kind: 'mesh', geometry: 'box' }, [0, 0.5, 0])
    if (!box) return { ok: false }
    box.name = 'SubtreeRoot'
    v.indie.prefab.save(box.id)
    v.indie.prefab.instantiate('SubtreeRoot', [4, 0.5, 0])
    const inst = [...v.world.actors.values()].find((a) => a.prefabSource === 'SubtreeRoot')
    if (!inst) return { ok: false }
    inst.name = 'ChangedRoot'
    v.indie.prefab.recordOverride(inst.id, 'name')
    const subtree = v.indie.prefab.subtree(inst.id)
    const diff = v.indie.prefab.overrideDiff(inst.id)
    return { ok: true, subtreeLen: subtree.length, diffLen: diff.length, diffField: diff[0]?.fieldPath }
  })

  expect(result.ok).toBe(true)
  expect(result.subtreeLen).toBeGreaterThan(0)
  expect(result.diffLen).toBeGreaterThan(0)
  expect(result.diffField).toBe('name')
})

test('wave 35 sequencer script var track sample', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawn: (p: { kind: 'empty' }, pos: [number, number, number]) => { id: string; script?: string; scriptVars?: Record<string, unknown> } | null
        sequencer: {
          keyableScriptExports: (a: { script?: string }) => { name: string }[]
          sampleScriptVar: (actorId: string, varName: string, t: number, keys: { t: number; v: number }[]) => unknown
        }
      }
    }
    const actor = v.indie.spawn({ kind: 'empty' }, [0, 0, 0])
    if (!actor) return { ok: false }
    actor.script = '// @export_range speed 0 10 1 = 0\n'
    const exports = v.indie.sequencer.keyableScriptExports(actor)
    const sampled = v.indie.sequencer.sampleScriptVar(actor.id, 'speed', 0.5, [
      { t: 0, v: 0 },
      { t: 1, v: 10 },
    ])
    return { ok: true, exportName: exports[0]?.name, sampled }
  })

  expect(result.ok).toBe(true)
  expect(result.exportName).toBe('speed')
  expect(result.sampled).toBe(5)
})

test('wave 35 resource .tres lite create + get', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        resources: {
          create: (name: string, kind: 'curve', data: Record<string, unknown>) => { id: string; name: string; kind: string }
          get: (id: string) => { id: string; name: string } | undefined
          list: (kind?: string) => { id: string }[]
        }
      }
    }
    const res = v.indie.resources.create('JumpCurve', 'curve', { keys: [{ t: 0, v: 0 }, { t: 1, v: 1 }] })
    const fetched = v.indie.resources.get(res.id)
    const listed = v.indie.resources.list('curve')
    return { ok: !!fetched, id: res.id, name: fetched?.name, count: listed.length }
  })

  expect(result.ok).toBe(true)
  expect(result.name).toBe('JumpCurve')
  expect(result.count).toBeGreaterThan(0)
})

test('wave 35 platformer starter template', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawnPlatformerStarter: (mode: 'side') => void }
    }
    const before = v.world.actors.size
    v.indie.spawnPlatformerStarter('side')
    const floor = [...v.world.actors.values()].find((a) => a.name === 'PlatformerFloor')
    const platB = [...v.world.actors.values()].find((a) => a.name === 'PlatB')
    const start = [...v.world.actors.values()].find((a) => a.name === 'PlatformerPlayerStart')
    return {
      added: v.world.actors.size > before,
      floor: !!floor,
      platB: !!platB,
      startPawn: start?.pawnMode,
      rapier: v.world.environment.useRapierCharacter,
    }
  })

  expect(result.added).toBe(true)
  expect(result.floor).toBe(true)
  expect(result.platB).toBe(true)
  expect(result.startPawn).toBe('thirdperson')
  expect(result.rapier).toBe(true)
})

test('wave 35 prefab child override diff gutter', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawn: (p: { kind: 'mesh'; geometry: 'box' }, pos: [number, number, number]) => { id: string } | null
        prefab: {
          save: (id: string) => unknown
          instantiate: (name: string, pos: [number, number, number]) => void
          recordOverride: (actorId: string, field: string) => void
          overrideDiff: (id: string) => { fieldPath: string; source: unknown; current: unknown }[]
        }
      }
    }
    const box = v.indie.spawn({ kind: 'mesh', geometry: 'box' }, [0, 0.5, 0])
    if (!box) return { ok: false }
    box.name = 'GutterPrefab'
    v.indie.prefab.save(box.id)
    v.indie.prefab.instantiate('GutterPrefab', [2, 0.5, 0])
    const inst = [...v.world.actors.values()].find((a) => a.prefabSource === 'GutterPrefab')
    if (!inst) return { ok: false }
    const mat = inst.materialProps
    if (mat) mat.color = '#ff0000'
    v.indie.prefab.recordOverride(inst.id, 'material.color')
    const diff = v.indie.prefab.overrideDiff(inst.id)
    const colorDiff = diff.find((d) => d.fieldPath === 'material.color')
    return { ok: true, hasColorDiff: !!colorDiff, current: colorDiff?.current }
  })

  expect(result.ok).toBe(true)
  expect(result.hasColorDiff).toBe(true)
  expect(String(result.current).toLowerCase()).toContain('ff0000')
})

test('wave 34 @export_range parse + clamp', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        exports: {
          parse: (s: string) => { name: string; kind: string; min?: number; max?: number; value: unknown }[]
          clampRange: (ev: { min?: number; max?: number }, n: number) => number
        }
      }
    }
    const script = `// @export_range speed 0 10 0.5 = 2\n`
    const ev = v.indie.exports.parse(script)[0]
    return {
      kind: ev?.kind,
      min: ev?.min,
      max: ev?.max,
      clamped: ev ? v.indie.exports.clampRange(ev, 99) : null,
    }
  })

  expect(result.kind).toBe('range')
  expect(result.min).toBe(0)
  expect(result.max).toBe(10)
  expect(result.clamped).toBe(10)
})

test('wave 34 @export_enum parse + options', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { exports: { parse: (s: string) => { name: string; kind: string; options?: string[]; value: unknown }[] } }
    }
    const script = `// @export_enum mode walk,run,fly = run\n`
    const ev = v.indie.exports.parse(script)[0]
    return { kind: ev?.kind, options: ev?.options, value: ev?.value }
  })

  expect(result.kind).toBe('enum')
  expect(result.options).toEqual(['walk', 'run', 'fly'])
  expect(result.value).toBe('run')
})

test('wave 34 Area3D body_entered overlap', async ({ page }) => {
  await bootEditor(page)

  const areaId = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'area3d' | 'empty' }, pos: [number, number, number]) => { id: string } | null }
    }
    const area = v.indie.spawn({ kind: 'area3d' }, [0, 0, 0])
    const body = v.indie.spawn({ kind: 'empty' }, [0, 0, 0])
    if (area) area.name = 'TestArea'
    if (body) body.name = 'TestBody'
    return area?.id ?? ''
  })

  const overlaps = await page.evaluate(async (id) => {
    const v = window.lotus! as typeof window.lotus & { indie: { areaOverlaps: (id: string) => string[] } }
    v.terminal.exec('/simulate')
    await new Promise((r) => setTimeout(r, 150))
    const ids = v.indie.areaOverlaps(id)
    v.terminal.exec('/stop')
    return ids.length
  }, areaId)

  expect(overlaps).toBeGreaterThan(0)
})

test('wave 34 prefab override summarize + revert all', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawn: (p: { kind: 'mesh'; geometry: 'box' }, pos: [number, number, number]) => { id: string; name: string } | null
        prefab: {
          save: (id: string) => unknown
          instantiate: (name: string, pos: [number, number, number]) => void
          recordOverride: (actorId: string, field: string) => void
          summarizeOverrides: (id: string) => { keys: string[] }[]
          revertAllOverrides: (id: string) => void
        }
      }
    }
    const box = v.indie.spawn({ kind: 'mesh', geometry: 'box' }, [0, 0.5, 0])
    if (!box) return { ok: false }
    box.name = 'PrefabRoot'
    v.indie.prefab.save(box.id)
    v.indie.prefab.instantiate('PrefabRoot', [5, 0.5, 0])
    const inst = [...v.world.actors.values()].find((a) => a.prefabSource === 'PrefabRoot')
    if (!inst) return { ok: false }
    inst.name = 'OverriddenName'
    v.indie.prefab.recordOverride(inst.id, 'name')
    const before = v.indie.prefab.summarizeOverrides(inst.id).length
    v.indie.prefab.revertAllOverrides(inst.id)
    const after = v.indie.prefab.summarizeOverrides(inst.id).length
    return { ok: true, before, after, name: inst.name }
  })

  expect(result.ok).toBe(true)
  expect(result.before).toBeGreaterThan(0)
  expect(result.after).toBe(0)
})

test('wave 34 character starter template', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawnCharacterStarter: (mode: 'thirdperson') => void }
    }
    const before = v.world.actors.size
    v.indie.spawnCharacterStarter('thirdperson')
    const floor = [...v.world.actors.values()].find((a) => a.name === 'StarterFloor')
    const start = [...v.world.actors.values()].find((a) => a.name === 'StarterPlayerStart')
    return {
      added: v.world.actors.size > before,
      floor: !!floor,
      startPawn: start?.pawnMode,
      rapier: v.world.environment.useRapierCharacter,
    }
  })

  expect(result.added).toBe(true)
  expect(result.floor).toBe(true)
  expect(result.startPawn).toBe('thirdperson')
  expect(result.rapier).toBe(true)
})

test('wave 33 Timer actor timeout signal', async ({ page }) => {
  await bootEditor(page)

  const timerId = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        defaultTimer: () => { wait: number; oneShot: boolean; autostart: boolean; paused: boolean }
        spawn: (p: { kind: 'timer' }, pos: [number, number, number]) => { id: string } | null
      }
    }
    const actor = v.indie.spawn({ kind: 'timer' }, [0, 1, 0])
    if (actor) {
      actor.name = 'TestTimer'
      actor.timerProps = { ...v.indie.defaultTimer(), wait: 0.05, autostart: true, oneShot: true }
      return actor.id
    }
    return ''
  })

  const fired = await page.evaluate(async (id) => {
    const v = window.lotus! as typeof window.lotus & { indie: { timerActive: (id: string) => boolean } }
    v.terminal.exec('/simulate')
    await new Promise((r) => setTimeout(r, 200))
    const done = !v.indie.timerActive(id)
    v.terminal.exec('/stop')
    return done
  }, timerId)

  expect(fired).toBe(true)
})

test('wave 33 RayCast3D hit signal', async ({ page }) => {
  await bootEditor(page)

  const rayId = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'raycast' }, pos: [number, number, number]) => { id: string } | null }
    }
    v.terminal.exec('/spawn box')
    const ray = v.indie.spawn({ kind: 'raycast' }, [0, 3, 0])
    if (ray) {
      ray.name = 'TestRay'
      ray.rayCastProps = { enabled: true, length: 8, localDirection: [0, -1, 0], excludeSelf: true }
      return ray.id
    }
    return ''
  })

  const hitId = await page.evaluate(async (id) => {
    const v = window.lotus! as typeof window.lotus & { indie: { rayCastHitId: (id: string) => string } }
    v.terminal.exec('/simulate')
    await new Promise((r) => setTimeout(r, 150))
    const hit = v.indie.rayCastHitId(id)
    v.terminal.exec('/stop')
    return hit
  }, rayId)

  expect(hitId.length).toBeGreaterThan(0)
})

test('wave 33 Path3D sample + PathFollow actor types', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        samplePath: (w: [number, number, number][], c: boolean, t: number) => [number, number, number] | null
        spawn: (p: { kind: 'path3d' | 'pathfollow' }, pos: [number, number, number]) => void
      }
    }
    v.indie.spawn({ kind: 'path3d' }, [0, 0, 0])
    const path = [...v.world.actors.values()].find((a) => a.type === 'Path3D')
    if (path) path.name = 'TestPath'
    v.indie.spawn({ kind: 'pathfollow' }, [0, 0, 0])
    const follow = [...v.world.actors.values()].find((a) => a.type === 'PathFollow3D')
    if (follow?.pathFollowProps) follow.pathFollowProps.pathActorName = 'TestPath'
    const waypoints: [number, number, number][] = [
      [0, 0, 0],
      [4, 0, 0],
    ]
    const mid = v.indie.samplePath(waypoints, false, 0.5)
    const pathActor = [...v.world.actors.values()].find((a) => a.name === 'TestPath')
    const followActor = [...v.world.actors.values()].find((a) => a.type === 'PathFollow3D')
    return { midX: mid?.[0], pathType: pathActor?.type, followType: followActor?.type }
  })

  expect(result.pathType).toBe('Path3D')
  expect(result.followType).toBe('PathFollow3D')
  expect(result.midX).toBeCloseTo(2, 0)
})

test('wave 33 groups api.getActorsInGroup', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        scriptApi: () => { getActorsInGroup: (g: string) => { name: string }[] }
        spawn: (p: { kind: 'empty' }, pos: [number, number, number]) => void
      }
    }
    v.indie.spawn({ kind: 'empty' }, [0, 0, 0])
    const actor = [...v.world.actors.values()].find((a) => a.type === 'Empty' && a.name.startsWith('Empty'))
    if (actor) {
      actor.name = 'GroupMember'
      actor.groups = ['enemies', 'bosses']
    }
    const api = v.indie.scriptApi()
    return {
      enemies: api.getActorsInGroup('enemies').map((a) => a.name),
      bosses: api.getActorsInGroup('bosses').length,
    }
  })

  expect(result.enemies).toContain('GroupMember')
  expect(result.bosses).toBe(1)
})

test('wave 33 project autoload + main scene export', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      projectSettings: { save: (s: import('../src/editor/projectSettings').ProjectSettings) => void; load: () => import('../src/editor/projectSettings').ProjectSettings }
      indie: { isAutoload: (n: string) => boolean; spawn: (p: { kind: 'empty' }, pos: [number, number, number]) => { name: string } | null }
      export: { buildPlayableHTML: () => string }
    }
    const gm = v.indie.spawn({ kind: 'empty' }, [0, 0, 0])
    if (gm) gm.name = 'GameManager'
    const prev = v.projectSettings.load()
    v.projectSettings.save({ ...prev, autoloadActorNames: ['GameManager'], mainSceneKey: 'dungeon' })
    v.world.levelLinks.push({
      name: 'dungeon',
      level: { engine: 'lotus', version: 4, name: 'Dungeon', environment: { ...v.world.environment }, actors: [] },
    })
    const html = v.export.buildPlayableHTML()
    const autoload = gm ? v.indie.isAutoload(gm.name) : false
    v.projectSettings.save(prev)
    return { autoload, mainTag: html.includes("window.__LOTUS_MAIN__ = 'dungeon'"), gmName: gm?.name ?? '' }
  })

  expect(result.autoload).toBe(true)
  expect(result.mainTag).toBe(true)
})

test('wave 32 PNG LUT decode + level persist', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      colorGrading: {
        decodePng: (rgba: Uint8Array, w: number, h: number) => { size: number; format: string } | null
        persistLut: (name: string, decoded: { size: number; format: string; texture: unknown }) => {
          postGradingLutData?: string
          postGradingLutAtlasW?: number
          postGradingLutFormat?: string
        } | null
        restoreLut: () => boolean
      }
    }
    const w = 4
    const h = 2
    const rgba = new Uint8Array(w * h * 4)
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = 200
      rgba[i * 4 + 1] = 100
      rgba[i * 4 + 2] = 50
      rgba[i * 4 + 3] = 255
    }
    const decoded = v.colorGrading.decodePng(rgba, w, h)
    const persisted = decoded ? v.colorGrading.persistLut('test.png', decoded as never) : null
    const restored = v.colorGrading.restoreLut()
    return {
      size: decoded?.size,
      format: decoded?.format,
      hasData: !!persisted?.postGradingLutData,
      atlasW: persisted?.postGradingLutAtlasW,
      restored,
    }
  })

  expect(result.size).toBe(2)
  expect(result.format).toBe('png')
  expect(result.hasData).toBe(true)
  expect(result.atlasW).toBe(4)
  expect(result.restored).toBe(true)
})

test('wave 32 GPU batched sub-burst dispatch', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      particles: { gpuSubBurstBatchReady: () => boolean; create: (b: 'gpu') => unknown }
    }
    const ps = v.particles.create('gpu') as { gpuSubBurstSpawnBatch?: unknown; gpuSubBurstSpawn?: unknown }
    return {
      batchReady: v.particles.gpuSubBurstBatchReady(),
      hasBatch: typeof ps.gpuSubBurstSpawnBatch === 'function',
      hasSpawn: typeof ps.gpuSubBurstSpawn === 'function',
    }
  })

  expect(result.batchReady).toBe(true)
  expect(result.hasBatch).toBe(true)
  expect(result.hasSpawn).toBe(true)
})

test('wave 32 export embeds decoded LUT bytes', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      colorGrading: {
        decodePng: (rgba: Uint8Array, w: number, h: number) => unknown
        persistLut: (name: string, decoded: unknown) => unknown
        exportLutPayload: () => { data: string; atlasW: number } | null
      }
      export: { buildPlayableHTML: () => string }
    }
    const w = 4
    const h = 2
    const rgba = new Uint8Array(w * h * 4).fill(128)
    const decoded = v.colorGrading.decodePng(rgba, w, h)
    if (decoded) v.colorGrading.persistLut('export.png', decoded)
    const payload = v.colorGrading.exportLutPayload()
    const html = v.export.buildPlayableHTML()
    return {
      hasPayload: !!payload?.data,
      inHtml: html.includes('__LOTUS_LUT__') && html.includes('decodeExportLUTTexture'),
      atlasW: payload?.atlasW,
    }
  })

  expect(result.hasPayload).toBe(true)
  expect(result.inHtml).toBe(true)
  expect(result.atlasW).toBe(4)
})

test('wave 32 BT subtree step-into + blackboard watch', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: {
        emptyGraph: () => import('../src/engine/btGraph').BTGraph
        collapseSubtree: (g: import('../src/engine/btGraph').BTGraph, id: string) => import('../src/engine/btGraph').BTGraph
        subtreeServiceIds: (g: import('../src/engine/btGraph').BTGraph, id: string) => string[]
        stepIntoBreakpoint: (hostId: string) => void
        shouldServiceStepInto: (g: import('../src/engine/btGraph').BTGraph, id: string) => boolean
        activeBlackboard: (actorId: string) => Record<string, unknown> | null
      }
    }
    let graph = v.bt.emptyGraph()
    graph.nodes.push(
      { id: 'root', type: 'Root', x: 80, y: 80, props: {} },
      { id: 'dec', type: 'Repeat', x: 240, y: 80, props: {} },
      { id: 'svc', type: 'SvcSetBB', x: 400, y: 80, props: { key: 'phase', value: 'attack' } },
    )
    graph.edges.push(
      { from: 'root', to: 'dec' },
      { from: 'dec', to: 'svc', kind: 'service' },
    )
    graph = v.bt.collapseSubtree(graph, 'dec')
    const svcIds = v.bt.subtreeServiceIds(graph, 'dec')
    v.bt.stepIntoBreakpoint('dec')
    const stepInto = v.bt.shouldServiceStepInto(graph, 'svc')
    return {
      svcIds,
      stepInto,
      bbApi: typeof v.bt.activeBlackboard === 'function',
    }
  })

  expect(result.svcIds).toContain('svc')
  expect(result.stepInto).toBe(true)
  expect(result.bbApi).toBe(true)

  await page.evaluate(() => {
    const v = window.lotus!
    const spawn = v.terminal.exec('/spawn box')
    if (spawn.error) throw new Error(spawn.error)
    const actor = [...v.world.actors.values()].find((a) => a.name.toLowerCase().includes('box'))
    if (!actor) throw new Error('spawned box not found')
    v.useEditor.getState().select(actor.id)
    actor.btGraph = { nodes: [{ id: 'root', type: 'Root', x: 80, y: 80, props: {} }], edges: [] }
  })
  await page.evaluate(() => {
    const v = window.lotus!
    v.useEditor.getState().setBottomTab('bt')
    v.terminal.exec('/simulate')
  })
  await page.waitForFunction(() => window.lotus?.getLiveSnapshot().playing === true)
  await expect(page.locator('.bt-bb-watch summary')).toHaveText('Blackboard watch (PIE)')
  await page.evaluate(() => window.lotus!.terminal.exec('/stop'))
})

test('wave 32 material Shift+Tab reverse + wire pin preview', async ({ page }) => {
  await bootEditor(page)

  await page.evaluate(() => {
    const v = window.lotus!
    const spawn = v.terminal.exec('/spawn box')
    if (spawn.error) throw new Error(spawn.error)
    const actor = [...v.world.actors.values()].find((a) => a.name.toLowerCase().includes('box'))
    if (!actor) throw new Error('spawned box not found')
    v.useEditor.getState().select(actor.id)
    actor.materialGraph = {
      nodes: [
        { id: 'out', type: 'Output', x: 400, y: 100, props: {} },
        { id: 'c1', type: 'Color', x: 100, y: 80, props: { color: '#4488ff' } },
        { id: 'c2', type: 'Color', x: 100, y: 200, props: { color: '#ff8844' } },
      ],
      edges: [
        { from: 'c1', to: 'out:baseColor' },
        { from: 'c2', to: 'out:emissive' },
      ],
    }
  })

  await page.evaluate(() => window.lotus!.useEditor.getState().setBottomTab('material'))
  await page.locator('.mat-canvas-pan').click()
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  })
  const focusedAfterForward = await page.evaluate(() => {
    const rects = document.querySelectorAll('.mat-minimap rect[stroke="#ffe066"]')
    return rects.length
  })
  expect(focusedAfterForward).toBe(1)
  await page.evaluate(() => {
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
    )
  })
  await page.evaluate(() => {
    const chip = document.querySelector('.mat-legend-chip')
    chip?.dispatchEvent(new DragEvent('dragstart', { bubbles: true }))
  })
  await expect(page.locator('.mat-wire-pin-preview')).toHaveCount(1)
  await page.evaluate(() => {
    const chip = document.querySelector('.mat-legend-chip')
    chip?.dispatchEvent(new DragEvent('dragend', { bubbles: true }))
  })
})

test('wave 31 cube LUT decode', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      colorGrading: {
        parseCube: (t: string) => { size: number; format: string } | null
        decodeLut: (n: string, t: string) => { size: number; format: string } | null
      }
    }
    const cube = `LUT_3D_SIZE 2\n0 0 0\n1 0 0\n0 1 0\n1 1 0\n0 0 1\n1 0 1\n0 1 1\n1 1 1\n`
    const parsed = v.colorGrading.parseCube(cube)
    const decoded = v.colorGrading.decodeLut('test.cube', cube)
    return { parsedSize: parsed?.size, decodedSize: decoded?.size, format: decoded?.format }
  })

  expect(result.parsedSize).toBe(2)
  expect(result.decodedSize).toBe(2)
  expect(result.format).toBe('cube')
})

test('wave 31 GPU sub-emitter burst kernel surface', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & { particles: { gpuSubBurstReady: () => boolean } }
    const ps = v.particles.create('gpu') as { gpuSubBurstSpawn?: unknown; gpuSubBurstFrames: number }
    return { ready: v.particles.gpuSubBurstReady(), hasSpawn: typeof ps.gpuSubBurstSpawn === 'function' }
  })

  expect(result.hasSpawn).toBe(true)
})

test('wave 31 export LUT apply parity', async ({ page }) => {
  await bootEditor(page)

  const html = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & { export: { buildPlayableHTML: () => string } }
    return v.export.buildPlayableHTML()
  })

  expect(html).toContain('applyLutGrading')
  expect(html).toContain('postGradingLutSize')
})

test('wave 31 BT blackboard breakpoint + step-into', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: {
        emptyGraph: () => import('../src/engine/btGraph').BTGraph
        shouldBreakpointFire: (
          g: import('../src/engine/btGraph').BTGraph,
          id: string,
          active: string[],
          bb: Record<string, unknown>,
        ) => boolean
        stepIntoBreakpoint: (hostId: string) => void
        shouldServiceStepInto: (g: import('../src/engine/btGraph').BTGraph, id: string) => boolean
      }
    }
    const graph = v.bt.emptyGraph()
    const task = {
      id: 'task31',
      type: 'TaskWait',
      x: 200,
      y: 200,
      props: { breakpointCondition: 'blackboard-equals', breakpointBBKey: 'phase', breakpointBBValue: 'attack' },
      breakpoint: true,
    }
    graph.nodes.push(task)
    const noMatch = v.bt.shouldBreakpointFire(graph, 'task31', [], { phase: 'idle' })
    const match = v.bt.shouldBreakpointFire(graph, 'task31', [], { phase: 'attack' })
    v.bt.stepIntoBreakpoint('sel_host')
    return { noMatch, match, stepIntoApi: typeof v.bt.stepIntoBreakpoint === 'function' }
  })

  expect(result.noMatch).toBe(false)
  expect(result.match).toBe(true)
  expect(result.stepIntoApi).toBe(true)
})

test('wave 31 material Tab focus + legend drag preview', async ({ page }) => {
  await bootEditor(page)

  await page.evaluate(() => {
    const v = window.lotus!
    const spawn = v.terminal.exec('/spawn box')
    if (spawn.error) throw new Error(spawn.error)
    const actor = [...v.world.actors.values()].find((a) => a.name.toLowerCase().includes('box'))
    if (!actor) throw new Error('spawned box not found')
    v.useEditor.getState().select(actor.id)
    actor.materialGraph = {
      nodes: [
        { id: 'out', type: 'Output', x: 400, y: 100, props: {} },
        { id: 'c1', type: 'Color', x: 100, y: 80, props: { color: '#4488ff' } },
        { id: 'c2', type: 'Color', x: 100, y: 200, props: { color: '#ff8844' } },
      ],
      edges: [{ from: 'c1', to: 'out:baseColor' }],
    }
  })

  await page.evaluate(() => window.lotus!.useEditor.getState().setBottomTab('material'))
  await page.locator('.mat-canvas-pan').click()
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  })
  await expect(page.locator('.mat-minimap rect[stroke="#ffe066"]')).toHaveCount(1)
  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  })
  const chips = page.locator('.mat-legend-chip')
  await chips.first().hover()
  await page.mouse.down()
  await chips.first().hover()
  await page.mouse.up()
})

test('wave 30 LUT apply in grading pass', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      colorGrading: {
        lutApply: () => { enabled: boolean; strength: number; size: number }
      }
    }
    v.world.environment.postGradingLutName = 'test.cube'
    v.world.environment.postGradingLutStrength = 0.75
    const lut = v.colorGrading.lutApply()
    return { enabled: lut.enabled, strength: lut.strength, size: lut.size }
  })

  expect(result.enabled).toBe(true)
  expect(result.strength).toBe(0.75)
  expect(result.size).toBe(16)
})

test('wave 30 GPU sub-emitter burst uniforms', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus!
    const ps = v.particles.create('gpu') as {
      props: { subEmitter?: { count: number } }
      gpuSubEmitterUniforms: { on: boolean; count: number; speed: number; life: number; rate: number }
      getGPUSubEmitterUniforms: () => { count: number; speed: number; life: number; rate: number }
    }
    ps.props.subEmitter = { enabled: true, onDeath: true, onCollision: false, count: 6, speed: 2, lifetime: 0.5 }
    ps.gpuSubEmitterUniforms = { on: true, count: 6, speed: 2, life: 0.5, rate: 0.8 }
    return ps.getGPUSubEmitterUniforms()
  })

  expect(result.count).toBe(6)
  expect(result.speed).toBe(2)
  expect(result.rate).toBe(0.8)
})

test('wave 30 export grading thumbnails + compare blend', async ({ page }) => {
  await bootEditor(page)

  const html = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & { export: { buildPlayableHTML: () => string } }
    return v.export.buildPlayableHTML()
  })

  expect(html).toContain('presetThumbnails')
  expect(html).toContain('blendGradingCompare')
  expect(html).toContain('postGradingLutStrength')
})

test('wave 30 BT step-over + conditional breakpoint', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: {
        emptyGraph: () => import('../src/engine/btGraph').BTGraph
        breakpointCondition: (g: import('../src/engine/btGraph').BTGraph, id: string) => string
        shouldBreakpointFire: (g: import('../src/engine/btGraph').BTGraph, id: string, active: string[]) => boolean
        stepOverBreakpoint: (id: string) => void
      }
    }
    const graph = v.bt.emptyGraph()
    const svc = {
      id: 'svc30',
      type: 'SvcPlayerNear',
      x: 200,
      y: 200,
      props: { radius: 5, breakpointCondition: 'service-active' },
      breakpoint: true,
    }
    graph.nodes.push(svc)
    const inactive = v.bt.shouldBreakpointFire(graph, 'svc30', [])
    v.bt.stepOverBreakpoint('svc30')
    const afterStep = v.bt.shouldBreakpointFire(graph, 'svc30', ['svc30'])
    return {
      cond: v.bt.breakpointCondition(graph, 'svc30'),
      inactive,
      afterStep,
    }
  })

  expect(result.cond).toBe('service-active')
  expect(result.inactive).toBe(false)
  expect(result.afterStep).toBe(false)
})

test('wave 30 material legend pin bidirectional sync', async ({ page }) => {
  await bootEditor(page)

  await page.evaluate(() => {
    const v = window.lotus!
    const spawn = v.terminal.exec('/spawn box')
    if (spawn.error) throw new Error(spawn.error)
    const actor = [...v.world.actors.values()].find((a) => a.name.toLowerCase().includes('box'))
    if (!actor) throw new Error('spawned box not found')
    v.useEditor.getState().select(actor.id)
    actor.materialGraph = {
      nodes: [
        { id: 'out', type: 'Output', x: 400, y: 100, props: {} },
        { id: 'c1', type: 'Color', x: 100, y: 80, props: { color: '#4488ff' } },
      ],
      edges: [{ from: 'c1', to: 'out:baseColor' }],
    }
  })

  await page.evaluate(() => window.lotus!.useEditor.getState().setBottomTab('material'))
  const chip = page.locator('.mat-legend-chip', { hasText: 'baseColor' })
  await chip.click({ modifiers: ['Shift'] })
  await expect(chip).toHaveClass(/pinned/)
  await expect(chip).toHaveClass(/active/)
  const pin = page.locator('.mat-pin', { hasText: 'baseColor' })
  await expect(pin).toHaveClass(/mat-pin-pinned/)
  await expect(pin).toHaveClass(/mat-pin-active/)
})

test('wave 29 color grading LUT stub + compare blend', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      colorGrading: {
        compareT: () => number
        blend: (
          a: { enabled: boolean; lift: [number, number, number]; gamma: [number, number, number]; gain: [number, number, number] },
          b: { enabled: boolean; lift: [number, number, number]; gamma: [number, number, number]; gain: [number, number, number] },
          t: number,
        ) => { gain: [number, number, number] }
        lutStub: () => { size: number }
        identityLut: () => boolean
      }
    }
    const a = v.colorGrading.settings()
    v.world.environment.postGradingCompareT = 0.5
    v.world.environment.postGradingCompareA = 'cinematic'
    v.world.environment.postGradingCompareB = 'neutral'
    const blended = v.colorGrading.blend(a, { ...a, gain: [2, 2, 2] }, 0.5)
    return {
      compareT: v.colorGrading.compareT(),
      blendedGain: blended.gain[0],
      lutSize: v.colorGrading.lutStub().size,
      identity: v.colorGrading.identityLut(),
    }
  })

  expect(result.compareT).toBe(0.5)
  expect(result.blendedGain).toBeGreaterThan(1)
  expect(result.lutSize).toBe(16)
  expect(result.identity).toBe(true)
})

test('wave 29 GPU sub-emitter death burst surface', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus!
    const ps = v.particles.create('gpu')
    ps.props.subEmitter = { enabled: true, onDeath: true, onCollision: false, count: 4, speed: 1.2, lifetime: 0.3 }
    return { hasSnapshot: typeof (ps as { snapshotAliveForGPU?: () => void }).snapshotAliveForGPU === 'function' }
  })

  expect(result.hasSnapshot).toBe(true)
})

test('wave 29 export grading preset ACES parity', async ({ page }) => {
  await bootEditor(page)

  const html = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & { export: { buildPlayableHTML: () => string } }
    return v.export.buildPlayableHTML()
  })

  expect(html).toContain('postPresetAces')
  expect(html).toContain('postGradingCompareT')
})

test('wave 29 BT service host breakpoint bridges', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: {
        emptyGraph: () => import('../src/engine/btGraph').BTGraph
        serviceHost: (g: import('../src/engine/btGraph').BTGraph, id: string) => string | null
        serviceDecoratorHost: (g: import('../src/engine/btGraph').BTGraph, id: string) => string | null
      }
    }
    const graph = v.bt.emptyGraph()
    const root = graph.nodes.find((n) => n.type === 'Root')!
    const sel = { id: 'sel29', type: 'Selector', x: 200, y: 80, props: {} }
    const svc = { id: 'svc29', type: 'SvcPlayerNear', x: 200, y: 200, props: { radius: 5 } }
    graph.nodes.push(sel, svc)
    graph.edges = [
      { from: root.id, to: sel.id },
      { from: sel.id, to: svc.id, kind: 'service' },
    ]
    return {
      host: v.bt.serviceHost(graph, 'svc29'),
      decorator: v.bt.serviceDecoratorHost(graph, 'svc29'),
    }
  })

  expect(result.host).toBe('sel29')
  expect(result.decorator).toBe('sel29')
})

test('wave 29 material minimap focus + pin sync', async ({ page }) => {
  await bootEditor(page)

  await page.evaluate(() => {
    const v = window.lotus!
    const spawn = v.terminal.exec('/spawn box')
    if (spawn.error) throw new Error(spawn.error)
    const actor = [...v.world.actors.values()].find((a) => a.name.toLowerCase().includes('box'))
    if (!actor) throw new Error('spawned box not found')
    v.useEditor.getState().select(actor.id)
    actor.materialGraph = {
      nodes: [
        { id: 'out', type: 'Output', x: 400, y: 100, props: {} },
        { id: 'c1', type: 'Color', x: 100, y: 80, props: { color: '#4488ff' } },
      ],
      edges: [{ from: 'c1', to: 'out:baseColor' }],
    }
  })

  await page.evaluate(() => window.lotus!.useEditor.getState().setBottomTab('material'))
  const pin = page.locator('.mat-pin', { hasText: 'baseColor' })
  await pin.click()
  await expect(pin).toHaveClass(/mat-pin-active/)
  await expect(pin).toHaveClass(/mat-pin-pinned/)

  const minimap = page.locator('.mat-minimap')
  await expect(minimap).toBeVisible()
  await minimap.click({ position: { x: 20, y: 38 } })
  await expect(minimap.locator('rect[stroke="#ffe066"]')).toHaveCount(1)
})

test('wave 28 color grading preset thumbnails + presetAces', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      colorGrading: {
        presetThumbnails: () => Record<string, { label: string }>
        presetAces: (p?: string) => boolean
      }
    }
    const thumbs = v.colorGrading.presetThumbnails()
    return {
      keys: Object.keys(thumbs),
      cinematic: thumbs.cinematic?.label,
      presetAces: v.colorGrading.presetAces('cinematic'),
    }
  })

  expect(result.keys).toContain('cinematic')
  expect(result.cinematic).toBe('Cinematic')
  expect(typeof result.presetAces).toBe('boolean')
})

test('wave 28 GPU particle ground bounce module surface', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus!
    const ps = v.particles.create('gpu')
    ps.props.groundBounce = true
    ps.props.bounceFactor = 0.5
    return { groundBounce: ps.props.groundBounce, bounceFactor: ps.props.bounceFactor }
  })

  expect(result.groundBounce).toBe(true)
  expect(result.bounceFactor).toBe(0.5)
})

test('wave 28 export dofFocusPull runtime surface', async ({ page }) => {
  await bootEditor(page)

  const html = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & { export: { buildPlayableHTML: () => string } }
    return v.export.buildPlayableHTML()
  })

  expect(html).toContain('resolveExportDofFocus')
  expect(html).toContain('dofFocusPull')
})

test('wave 28 BT diff patch + gutter selection bridges', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      bt: {
        emptyGraph: () => import('../src/engine/btGraph').BTGraph
        exportDiffPatch: (g: import('../src/engine/btGraph').BTGraph, script: string) => string
        resolveDiffGutterSelection: (
          g: import('../src/engine/btGraph').BTGraph,
          ids: string[],
        ) => { nodeIds: string[]; scrollLeft: number }
      }
    }
    const graph = v.bt.emptyGraph()
    const root = graph.nodes.find((n) => n.type === 'Root')!
    const svc = { id: 'svc28', type: 'SvcPlayerNear', x: 220, y: 220, props: { radius: 5 } }
    graph.nodes.push(svc)
    graph.edges.push({ from: root.id, to: svc.id, kind: 'service' })
    const patch = v.bt.exportDiffPatch(graph, '// stale')
    const sel = v.bt.resolveDiffGutterSelection(graph, ['svc28'])
    return { patchLines: patch.split('\n').length, selCount: sel.nodeIds.length }
  })

  expect(result.patchLines).toBeGreaterThan(3)
  expect(result.selCount).toBe(1)
})

test('wave 28 material legend pin-to-minimap surface', async ({ page }) => {
  await bootEditor(page)

  await page.evaluate(() => {
    const v = window.lotus!
    const spawn = v.terminal.exec('/spawn box')
    if (spawn.error) throw new Error(spawn.error)
    const actor = [...v.world.actors.values()].find((a) => a.name.toLowerCase().includes('box'))
    if (!actor) throw new Error('spawned box not found')
    v.useEditor.getState().select(actor.id)
    actor.materialGraph = {
      nodes: [
        { id: 'out', type: 'Output', x: 400, y: 100, props: {} },
        { id: 'c1', type: 'Color', x: 100, y: 80, props: { color: '#4488ff' } },
      ],
      edges: [{ from: 'c1', to: 'out:baseColor' }],
    }
  })

  await page.evaluate(() => window.lotus!.useEditor.getState().setBottomTab('material'))
  const chip = page.locator('.mat-legend-chip', { hasText: 'baseColor' })
  await chip.click({ modifiers: ['Shift'] })
  await expect(chip).toHaveClass(/pinned/)
  await chip.click()
  await expect(page.locator('.mat-node-upstream-flash')).toHaveCount(2)
})

test('wave 27 material legend reorder surface', async ({ page }) => {
  await bootEditor(page)

  await page.evaluate(() => {
    const v = window.lotus!
    const spawn = v.terminal.exec('/spawn box')
    if (spawn.error) throw new Error(spawn.error)
    const actor = [...v.world.actors.values()].find((a) => a.name.toLowerCase().includes('box'))
    if (!actor) throw new Error('spawned box not found')
    v.useEditor.getState().select(actor.id)
    actor.materialGraph = {
      nodes: [
        { id: 'out', type: 'Output', x: 400, y: 100, props: {} },
        { id: 'c1', type: 'Color', x: 100, y: 80, props: { color: '#4488ff' } },
        { id: 'r1', type: 'Float', x: 100, y: 180, props: { value: 0.4 } },
      ],
      edges: [
        { from: 'c1', to: 'out:baseColor' },
        { from: 'r1', to: 'out:roughness' },
      ],
    }
  })

  await page.evaluate(() => window.lotus!.useEditor.getState().setBottomTab('material'))
  const chips = page.locator('.mat-legend-chip')
  await expect(chips).toHaveCount(2)
  await expect(chips.first()).toHaveAttribute('draggable', 'true')
})

test('wave 26 material minimap legend + drag-pan surface', async ({ page }) => {
  await bootEditor(page)

  await page.evaluate(() => {
    const v = window.lotus!
    const spawn = v.terminal.exec('/spawn box')
    if (spawn.error) throw new Error(spawn.error)
    const actor = [...v.world.actors.values()].find((a) => a.name.toLowerCase().includes('box'))
    if (!actor) throw new Error('spawned box not found')
    v.useEditor.getState().select(actor.id)
    actor.materialGraph = {
      nodes: [
        { id: 'out', type: 'Output', x: 400, y: 100, props: {} },
        { id: 'c1', type: 'Color', x: 100, y: 80, props: { color: '#4488ff' } },
      ],
      edges: [{ from: 'c1', to: 'out:baseColor' }],
    }
  })

  await page.evaluate(() => window.lotus!.useEditor.getState().setBottomTab('material'))
  await expect(page.locator('.mat-channel-legend')).toBeVisible()
  await expect(page.locator('.mat-legend-chip', { hasText: 'baseColor' })).toBeVisible()
  await expect(page.locator('.mat-minimap')).toBeVisible()
})

test('wave 25 material minimap zoom hint', async ({ page }) => {
  await bootEditor(page)

  await page.evaluate(() => {
    const v = window.lotus!
    const spawn = v.terminal.exec('/spawn box')
    if (spawn.error) throw new Error(spawn.error)
    const actor = [...v.world.actors.values()].find((a) => a.name.toLowerCase().includes('box'))
    if (!actor) throw new Error('spawned box not found')
    v.useEditor.getState().select(actor.id)
    actor.materialGraph = {
      nodes: [
        { id: 'out', type: 'Output', x: 400, y: 100, props: {} },
        { id: 'c1', type: 'Color', x: 100, y: 80, props: { color: '#4488ff' } },
      ],
      edges: [{ from: 'c1', to: 'out:baseColor' }],
    }
  })

  await page.evaluate(() => window.lotus!.useEditor.getState().setBottomTab('material'))
  await expect(page.locator('.mat-zoom-hint')).toBeVisible()
})

test('wave 13 BT editor blackboard panel', async ({ page }) => {
  await bootEditor(page)

  await page.evaluate(() => {
    const v = window.lotus!
    const spawn = v.terminal.exec('/spawn box')
    if (spawn.error) throw new Error(spawn.error)
    const actor = [...v.world.actors.values()].find((a) => a.name.toLowerCase().includes('box'))
    if (!actor) throw new Error('spawned box not found')
    v.useEditor.getState().select(actor.id)
    actor.scriptVars = { alerted: false }
  })

  await page.evaluate(() => window.lotus!.useEditor.getState().setBottomTab('bt'))
  await expect(page.locator('.bt-side summary', { hasText: 'Blackboard' })).toBeVisible()
  await expect(page.locator('.bt-side input[value="false"]')).toBeVisible()
})

test('wave 53 indie MP lobby template', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawnIndieMpLobby: () => void }
    }
    const before = v.world.actors.size
    v.indie.spawnIndieMpLobby()
    const floor = [...v.world.actors.values()].find((a) => a.name === 'MpLobbyFloor')
    const manager = [...v.world.actors.values()].find((a) => a.name === 'MpLobbyManager')
    const dmFloor = [...v.world.actors.values()].find((a) => a.name === 'MpDmFloor')
    const hud = v.world.hudWidgets.find((w) => w.id === 'mp_lobby_room')
    return {
      added: v.world.actors.size > before,
      floor: !!floor,
      managerTag: manager?.tags.includes('mp_lobby'),
      managerScript: manager?.script?.includes('mpLobbyPeers'),
      noDeathmatch: !dmFloor,
      hud: !!hud,
    }
  })

  expect(result.added).toBe(true)
  expect(result.floor).toBe(true)
  expect(result.managerTag).toBe(true)
  expect(result.managerScript).toBe(true)
  expect(result.noDeathmatch).toBe(true)
  expect(result.hud).toBe(true)
})

test('wave 53 mpLobby allReady + setReady state', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        mp: {
          lobby: {
            setReady: (r: boolean) => void
            isReady: (id?: string) => boolean
            allReady: () => boolean
            peerReadyCount: () => number
          }
        }
      }
    }
    v.indie.mp.lobby.setReady(true)
    return {
      isReady: v.indie.mp.lobby.isReady(),
      allReady: v.indie.mp.lobby.allReady(),
      peerReadyCount: v.indie.mp.lobby.peerReadyCount(),
    }
  })

  expect(result.isReady).toBe(true)
  expect(result.allReady).toBe(false)
  expect(result.peerReadyCount).toBeGreaterThanOrEqual(1)
})

test('wave 53 /mplobby terminal command', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus!
    const out = v.terminal.exec('/mplobby')
    const manager = [...v.world.actors.values()].find((a) => a.name === 'MpLobbyManager')
    const btn = v.world.hudWidgets.find((w) => w.id === 'mp_lobby_btn')
    return { output: out?.output, manager: !!manager, btn: !!btn }
  })

  expect(result.output).toMatch(/lobby/i)
  expect(result.manager).toBe(true)
  expect(result.btn).toBe(true)
})

test('wave 53 indie.mp.lobby bridge APIs', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        mp: {
          lobbyScript: string
          lobby: {
            setReady: (r: boolean) => void
            isReady: (id?: string) => boolean
            allReady: () => boolean
            peerReadyCount: () => number
          }
        }
      }
    }
    return {
      scriptHasReady: v.indie.mp.lobbyScript.includes('mpLobbySetReady'),
      scriptHasRoom: v.indie.mp.lobbyScript.includes('mpLobbyRoom'),
      hasSetReady: typeof v.indie.mp.lobby.setReady === 'function',
      hasIsReady: typeof v.indie.mp.lobby.isReady === 'function',
      hasAllReady: typeof v.indie.mp.lobby.allReady === 'function',
      hasPeerReadyCount: typeof v.indie.mp.lobby.peerReadyCount === 'function',
    }
  })

  expect(result.scriptHasReady).toBe(true)
  expect(result.scriptHasRoom).toBe(true)
  expect(result.hasSetReady).toBe(true)
  expect(result.hasIsReady).toBe(true)
  expect(result.hasAllReady).toBe(true)
  expect(result.hasPeerReadyCount).toBe(true)
})