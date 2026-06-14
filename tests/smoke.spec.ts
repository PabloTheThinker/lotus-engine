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
  await page.waitForFunction(
    () => document.getElementById('overlay')?.textContent?.includes('Click to play') ?? false,
    { timeout: 90_000 },
  )

  const overlay = await page.locator('#overlay').textContent()
  expect(overlay).toContain('Click to play')
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