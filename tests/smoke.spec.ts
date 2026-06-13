import { execSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))

interface VektraBridge {
  getLiveSnapshot: () => {
    actorCount: number
    playing: boolean
    tree: Array<{ type: string; name: string; children?: Array<{ type: string; name: string }> }>
  }
  terminal: { exec: (source: string) => { output: string | null; error: string | null; level: string } }
  world: {
    actors: { size: number }
    serialize: () => { engine: string; name: string; actors: unknown[] }
    load: (level: unknown) => Promise<void>
  }
  undo: () => void
  redo: () => void
}

declare global {
  interface Window {
    vektra?: VektraBridge
    vektraGfx?: { renderer: unknown; composer: unknown }
  }
}

async function bootEditor(page: import('@playwright/test').Page) {
  await page.addInitScript(() => localStorage.clear())
  await page.goto('/')
  await page.waitForFunction(() => {
    const v = window.vektra
    return Boolean(v?.world && v.world.actors.size > 0 && v.terminal?.exec && v.getLiveSnapshot)
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

test('window.vektra bridge is exposed', async ({ page }) => {
  await bootEditor(page)
  const api = await page.evaluate(() => {
    const v = window.vektra!
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
    const v = window.vektra!
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

  const before = await page.evaluate(() => window.vektra!.getLiveSnapshot().actorCount)
  await page.evaluate(() => {
    const spawn = window.vektra!.terminal.exec('/spawn box')
    if (spawn.error) throw new Error(spawn.error)
  })
  const afterSpawn = await page.evaluate(() => window.vektra!.getLiveSnapshot().actorCount)
  expect(afterSpawn).toBeGreaterThan(before)

  await page.keyboard.press('Control+KeyZ')
  await page.waitForFunction((expected) => window.vektra?.getLiveSnapshot().actorCount === expected, before)
  const afterUndo = await page.evaluate(() => window.vektra!.getLiveSnapshot().actorCount)
  expect(afterUndo).toBe(before)
})

test('play mode starts and stops (Alt+P / vektra API)', async ({ page }) => {
  await bootEditor(page)

  await page.keyboard.press('Alt+KeyP')
  await page.waitForFunction(() => window.vektra?.getLiveSnapshot().playing === true)
  await expect(page.locator('.play-button.stop')).toBeVisible()

  const playing = await page.evaluate(() => window.vektra!.getLiveSnapshot().playing)
  expect(playing).toBe(true)

  const stop = await page.evaluate(() => window.vektra!.terminal.exec('/stop'))
  expect(stop.error).toBeNull()
  expect(stop.output).toContain('Stopped')
  await page.waitForFunction(() => window.vektra?.getLiveSnapshot().playing === false)

  const stopped = await page.evaluate(() => window.vektra!.getLiveSnapshot().playing)
  expect(stopped).toBe(false)
})

test('command palette opens (Ctrl+Shift+P)', async ({ page }) => {
  await bootEditor(page)

  await page.keyboard.press('Control+Shift+KeyP')
  await expect(page.locator('.palette')).toBeVisible()
  await expect(page.locator('.palette input')).toHaveAttribute('placeholder', 'Type a command…')
  await expect(page.locator('.palette-list button').first()).toBeVisible()
})

test('level save/load roundtrip via terminal world API', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.vektra!
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

  expect(result.engine).toBe('vektra')
  expect(result.afterSpawn).toBeGreaterThan(result.baseline)
  expect(result.afterLoad).toBe(result.baseline)
  expect(result.levelName.length).toBeGreaterThan(0)
})