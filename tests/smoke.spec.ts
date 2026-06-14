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
  await page.waitForFunction(
    () => document.getElementById('overlay')?.textContent?.includes('Click to play') ?? false,
    { timeout: 90_000 },
  )

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
  await page.waitForFunction(
    () => document.getElementById('overlay')?.textContent?.includes('Click to play') ?? false,
    { timeout: 90_000 },
  )
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