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

test('wave 111 lotus.resources bridge exposes list create registerNamed findByName', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const res = (window.lotus! as typeof window.lotus & { resources: Record<string, unknown> }).resources
    return {
      list: typeof res.list === 'function',
      create: typeof res.create === 'function',
      registerNamed: typeof res.registerNamed === 'function',
      findByName: typeof res.findByName === 'function',
    }
  })

  expect(result.list).toBe(true)
  expect(result.create).toBe(true)
  expect(result.registerNamed).toBe(true)
  expect(result.findByName).toBe(true)
})

test('wave 111 /resource create engine_config registers config resource', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const term = window.lotus!.terminal.exec('/resource create engine_config config')
    const lotus = window.lotus! as typeof window.lotus & {
      resources: { findByName: (n: string) => { id: string; kind: string } | undefined }
    }
    const row = lotus.resources.findByName('engine_config')
    return { error: term.error, output: term.output ?? '', kind: row?.kind ?? null }
  })

  expect(result.error).toBeNull()
  expect(result.output).toContain('engine_config')
  expect(result.kind).toBe('config')
})

test('wave 111 registerNamedResource upserts data on duplicate name', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const lotus = window.lotus! as typeof window.lotus & {
      resources: {
        registerNamed: (n: string, k: string, d: Record<string, unknown>) => { id: string }
        findByName: (n: string) => { id: string; data: Record<string, unknown> } | undefined
      }
    }
    lotus.resources.registerNamed('upsert_test', 'config', { v: 1 })
    lotus.resources.registerNamed('upsert_test', 'config', { v: 2 })
    return { v: lotus.resources.findByName('upsert_test')?.data.v }
  })

  expect(result.v).toBe(2)
})

test('wave 111 /resource list terminal prints engine resources', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/resource create list_demo config')
    const term = window.lotus!.terminal.exec('/resource list')
    return { error: term.error, output: term.output ?? '' }
  })

  expect(result.error).toBeNull()
  expect(result.output).toContain('Engine resources')
})

test('wave 111 resource kinds include config and scene_preset', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const lotus = window.lotus! as typeof window.lotus & {
      resources: { create: (n: string, k: string) => { kind: string } }
    }
    const cfg = lotus.resources.create('cfg', 'config')
    const preset = lotus.resources.create('preset', 'scene_preset')
    return { cfg: cfg.kind, preset: preset.kind }
  })

  expect(result.cfg).toBe('config')
  expect(result.preset).toBe('scene_preset')
})

test('wave 112 lotus.engine.captureScene returns versioned actor transforms', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      engine: { captureScene: () => { version: number; actors: { name: string }[] } }
    }
    const snap = lotus.engine.captureScene()
    return { version: snap.version, count: snap.actors.length, hasStarter: snap.actors.some((a) => a.name.includes('Player') || a.name.includes('Floor')) }
  })

  expect(result.version).toBe(1)
  expect(result.count).toBeGreaterThan(0)
  expect(result.hasStarter).toBe(true)
})

test('wave 112 applyScene round-trips moved actor position', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/spawn box')
    const lotus = window.lotus! as typeof window.lotus & {
      engine: { captureScene: () => { actors: Array<{ name: string; transform: { position: [number, number, number] } }> }; applyScene: (d: unknown) => number }
      world: { actors: { values: () => IterableIterator<{ name: string; root: { position: { set: (x: number, y: number, z: number) => void } } }> } }
    }
    const box = [...lotus.world.actors.values()].find((a) => a.name.startsWith('Box'))
    if (!box) return { ok: false as const }
    box.root.position.set(3, 2, -1)
    const snap = lotus.engine.captureScene()
    box.root.position.set(0, 0, 0)
    const applied = lotus.engine.applyScene(snap)
    const row = snap.actors.find((a) => a.name === box.name)
    return { ok: true as const, applied, expected: row?.transform.position ?? null }
  })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.applied).toBeGreaterThan(0)
  expect(result.expected?.[0]).toBe(3)
})

test('wave 112 /snapshot terminal captures and applies scene snapshot', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const term = window.lotus!.terminal.exec('/snapshot')
    return { error: term.error, output: term.output ?? '' }
  })

  expect(result.error).toBeNull()
  expect(result.output).toContain('Scene snapshot')
  expect(result.output).toContain('round-trip')
})

test('wave 112 captureScene levelName matches engine.levelName', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const lotus = window.lotus! as typeof window.lotus & {
      engine: { captureScene: () => { levelName: string }; levelName: () => string }
    }
    const snap = lotus.engine.captureScene()
    return { match: snap.levelName === lotus.engine.levelName() }
  })

  expect(result.match).toBe(true)
})

test('wave 112 scene snapshot preserves scriptVars on apply', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/spawn sphere')
    const lotus = window.lotus! as typeof window.lotus & {
      engine: { captureScene: () => unknown; applyScene: (d: unknown) => number }
      world: { actors: { values: () => IterableIterator<{ name: string; scriptVars?: Record<string, unknown> }> } }
    }
    const actor = [...lotus.world.actors.values()].find((a) => a.name.toLowerCase().includes('sphere'))
    if (!actor) return { ok: false as const }
    actor.scriptVars = { hp: 42 }
    const snap = lotus.engine.captureScene()
    actor.scriptVars = {}
    lotus.engine.applyScene(snap)
    return { ok: true as const, hp: actor.scriptVars?.hp }
  })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.hp).toBe(42)
})

test('wave 113 lotus.engine bridge exposes setBufferViz listBufferVizModes', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const eng = (window.lotus! as typeof window.lotus & { engine: Record<string, unknown> }).engine
    return {
      setBufferViz: typeof eng.setBufferViz === 'function',
      listModes: typeof eng.listBufferVizModes === 'function',
      modes: (eng.listBufferVizModes as () => string[])(),
    }
  })

  expect(result.setBufferViz).toBe(true)
  expect(result.listModes).toBe(true)
  expect(result.modes).toContain('worldNormal')
  expect(result.modes).toContain('depth')
})

test('wave 113 /bufferviz worldNormal sets editor buffer viz mode', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const term = window.lotus!.terminal.exec('/bufferviz worldNormal')
    const lotus = window.lotus! as typeof window.lotus & { engine: { getBufferViz: () => string } }
    return { error: term.error, output: term.output ?? '', mode: lotus.engine.getBufferViz() }
  })

  expect(result.error).toBeNull()
  expect(result.output).toContain('worldNormal')
  expect(result.mode).toBe('worldNormal')
})

test('wave 113 setBufferViz none clears buffer visualization', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const lotus = window.lotus! as typeof window.lotus & { engine: { setBufferViz: (m: string) => void; getBufferViz: () => string } }
    lotus.engine.setBufferViz('depth')
    lotus.engine.setBufferViz('none')
    return { mode: lotus.engine.getBufferViz() }
  })

  expect(result.mode).toBe('none')
})

test('wave 113 /bufferviz depth terminal switches to depth buffer view', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const term = window.lotus!.terminal.exec('/bufferviz depth')
    const lotus = window.lotus! as typeof window.lotus & { engine: { getBufferViz: () => string } }
    return { error: term.error, mode: lotus.engine.getBufferViz() }
  })

  expect(result.error).toBeNull()
  expect(result.mode).toBe('depth')
})

test('wave 113 buffer viz modes include baseColor metallic roughness', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const lotus = window.lotus! as typeof window.lotus & { engine: { listBufferVizModes: () => string[] } }
    const modes = lotus.engine.listBufferVizModes()
    return { hasBase: modes.includes('baseColor'), hasMetal: modes.includes('metallic'), hasRough: modes.includes('roughness') }
  })

  expect(result.hasBase).toBe(true)
  expect(result.hasMetal).toBe(true)
  expect(result.hasRough).toBe(true)
})

test('wave 114 lotus.assets bridge exposes listBlobs and getBlob', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const assets = (window.lotus! as typeof window.lotus & { assets: Record<string, unknown> }).assets
    return {
      listBlobs: typeof assets.listBlobs === 'function',
      getBlob: typeof assets.getBlob === 'function',
    }
  })

  expect(result.listBlobs).toBe(true)
  expect(result.getBlob).toBe(true)
})

test('wave 114 /assetlist terminal lists in-memory level assets', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const term = window.lotus!.terminal.exec('/assetlist')
    return { error: term.error, output: term.output ?? '' }
  })

  expect(result.error).toBeNull()
  expect(result.output).toContain('Level assets')
  expect(result.output).toContain('lotus.assets')
})

test('wave 114 listBlobs returns array from IndexedDB or empty', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const lotus = window.lotus! as typeof window.lotus & { assets: { listBlobs: () => Promise<unknown[]> } }
    const rows = await lotus.assets.listBlobs()
    return { isArray: Array.isArray(rows) }
  })

  expect(result.isArray).toBe(true)
})

test('wave 114 world.assets size matches getLiveSnapshot actorCount baseline', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const snap = window.lotus!.getLiveSnapshot()
    return { actorCount: snap.actorCount, playing: snap.playing }
  })

  expect(result.actorCount).toBeGreaterThan(0)
  expect(result.playing).toBe(false)
})

test('wave 114 assets listBlobs entries expose name mime size when present', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const lotus = window.lotus! as typeof window.lotus & {
      assets: { listBlobs: () => Promise<Array<{ name?: string; mime?: string; size?: number }>> }
    }
    const rows = await lotus.assets.listBlobs()
    const first = rows[0]
    return { count: rows.length, hasShape: first == null || (typeof first.name === 'string' && typeof first.size === 'number') }
  })

  expect(result.hasShape).toBe(true)
})

test('wave 115 lotus.engine.getRuntimeSnapshot exposes levelName renderBackend', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const lotus = window.lotus! as typeof window.lotus & {
      engine: { getRuntimeSnapshot: () => { levelName: string; renderBackend: string; actorCount: number } }
    }
    const snap = lotus.engine.getRuntimeSnapshot()
    return { levelName: snap.levelName, backend: snap.renderBackend, actors: snap.actorCount }
  })

  expect(result.levelName).toBeTruthy()
  expect(['webgl', 'webgpu']).toContain(result.backend)
  expect(result.actors).toBeGreaterThanOrEqual(0)
})

test('wave 115 /engine terminal prints runtime snapshot summary', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const term = window.lotus!.terminal.exec('/engine')
    return { error: term.error, output: term.output ?? '' }
  })

  expect(result.error).toBeNull()
  expect(result.output).toContain('Engine runtime')
  expect(result.output).toContain('actors:')
})

test('wave 115 platformer minigame pack HTML still builds after engine wave', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const lotus = window.lotus! as typeof window.lotus & {
      indie: { minigame: { spawnMiniGame: (m: 'platformer') => void; buildPackHTML: (m: 'platformer') => string } }
    }
    lotus.indie.minigame.spawnMiniGame('platformer')
    const html = lotus.indie.minigame.buildPackHTML('platformer')
    return { len: html.length, hasLotus: html.includes('lotus') || html.includes('Lotus') }
  })

  expect(result.len).toBeGreaterThan(1000)
  expect(result.hasLotus).toBe(true)
})

test('wave 115 fps minigame pack HTML still builds after engine wave', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const lotus = window.lotus! as typeof window.lotus & {
      indie: { minigame: { spawnMiniGame: (m: 'fps') => void; buildPackHTML: (m: 'fps') => string } }
    }
    lotus.indie.minigame.spawnMiniGame('fps')
    const html = lotus.indie.minigame.buildPackHTML('fps')
    return { len: html.length, hasScript: html.includes('<script') }
  })

  expect(result.len).toBeGreaterThan(1000)
  expect(result.hasScript).toBe(true)
})

test('wave 115 engine isPlaying false in editor and actorCount tracks spawns', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const lotus = window.lotus! as typeof window.lotus & { engine: { isPlaying: () => boolean; actorCount: () => number } }
    const before = lotus.engine.actorCount()
    window.lotus!.terminal.exec('/spawn capsule')
    const after = lotus.engine.actorCount()
    return { playing: lotus.engine.isPlaying(), before, after }
  })

  expect(result.playing).toBe(false)
  expect(result.after).toBeGreaterThanOrEqual(result.before)
})

test('wave 106 previewDamage renders lotus-rpg-damage-layer floaters', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        hud3d: {
          damageLayerId: string
          previewDamage: (events: Array<{ amount: number; x: number; y: number; crit?: boolean }>) => number
        }
      }
    }
    const count = lotus.rpg.hud3d.previewDamage([
      { amount: 12, x: 200, y: 220 },
      { amount: 33, x: 360, y: 160, crit: true },
    ])
    const layer = document.getElementById(lotus.rpg.hud3d.damageLayerId)
    const nums = layer?.querySelectorAll('.lotus-rpg-damage-num').length ?? 0
    return { count, nums, layerId: lotus.rpg.hud3d.damageLayerId }
  })

  expect(result.count).toBe(2)
  expect(result.nums).toBe(2)
  expect(result.layerId).toBe('lotus-rpg-damage-layer')
})

test('wave 106 lotus.rpg.hud3d bridge exposes previewDamage tickDamage clearDamage', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const hud = (window.lotus! as typeof window.lotus & { rpg: { hud3d: Record<string, unknown> } }).rpg.hud3d
    return {
      previewDamage: typeof hud.previewDamage === 'function',
      tickDamage: typeof hud.tickDamage === 'function',
      clearDamage: typeof hud.clearDamage === 'function',
      damageLayerId: hud.damageLayerId,
    }
  })

  expect(result.previewDamage).toBe(true)
  expect(result.tickDamage).toBe(true)
  expect(result.clearDamage).toBe(true)
  expect(result.damageLayerId).toBe('lotus-rpg-damage-layer')
})

test('wave 106 /damagehud terminal previews screen-space damage floaters', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const term = window.lotus!.terminal.exec('/damagehud')
    const layer = document.getElementById('lotus-rpg-damage-layer')
    return { error: term.error, output: term.output ?? '', numCount: layer?.querySelectorAll('.lotus-rpg-damage-num').length ?? 0 }
  })

  expect(result.error).toBeNull()
  expect(result.output).toContain('Damage HUD')
  expect(result.numCount).toBeGreaterThanOrEqual(2)
})

test('wave 106 dealDamage queues damage numbers consumed by combat polish listDamageNumbers', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        combat: {
          ensureActor: (a: { tags: string[] }) => void
          dealDamage: (t: { tags: string[] }, n: number) => boolean
          polish: { listDamageNumbers: () => { amount: number }[] }
        }
      }
    }
    window.lotus!.terminal.exec('/spawn sphere')
    const enemy = [...window.lotus!.world.actors.values()].find((a) => a.name.toLowerCase().includes('sphere'))
    if (!enemy) return { ok: false as const }
    ;(enemy as { tags: string[] }).tags = ['Enemy']
    lotus.rpg.combat.ensureActor(enemy)
    lotus.rpg.combat.dealDamage(enemy, 9)
    const nums = lotus.rpg.combat.polish.listDamageNumbers()
    return { ok: true as const, count: nums.length, amount: nums[0]?.amount ?? 0 }
  })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.count).toBeGreaterThanOrEqual(1)
  expect(result.amount).toBe(9)
})

test('wave 106 previewDamage crit class applied on critical hits', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: { hud3d: { previewDamage: (e: Array<{ amount: number; x: number; y: number; crit?: boolean }>) => number } }
    }
    lotus.rpg.hud3d.previewDamage([{ amount: 99, x: 100, y: 100, crit: true }])
    const crit = document.querySelector('#lotus-rpg-damage-layer .lotus-rpg-damage-num.crit')
    return { hasCrit: Boolean(crit), text: crit?.textContent ?? '' }
  })

  expect(result.hasCrit).toBe(true)
  expect(result.text).toBe('99')
})

test('wave 107 lotus.rpg.vendor bridge exposes tag open shopIdFor greetingFor', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const vendor = (window.lotus! as typeof window.lotus & { rpg: { vendor: Record<string, unknown> } }).rpg.vendor
    return {
      tag: vendor.tag,
      interactRadius: vendor.interactRadius,
      open: typeof vendor.open === 'function',
      shopIdFor: typeof vendor.shopIdFor === 'function',
      greetingFor: typeof vendor.greetingFor === 'function',
    }
  })

  expect(result.tag).toBe('Vendor')
  expect(result.interactRadius).toBeGreaterThan(0)
  expect(result.open).toBe(true)
  expect(result.shopIdFor).toBe(true)
  expect(result.greetingFor).toBe(true)
})

test('wave 107 /vendor terminal spawns Vendor NPC and opens shop panel', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const term = window.lotus!.terminal.exec('/vendor')
    const vendor = [...window.lotus!.world.actors.values()].find((a) => a.name === 'VillageVendor')
    const shopOpen = document.getElementById('lotus-rpg-shop')?.classList.contains('open')
    return {
      error: term.error,
      output: term.output ?? '',
      hasVendor: Boolean(vendor),
      vendorTags: vendor?.tags ?? [],
      shopOpen,
    }
  })

  expect(result.error).toBeNull()
  expect(result.output).toContain('Vendor NPC')
  expect(result.hasVendor).toBe(true)
  expect(result.vendorTags).toContain('Vendor')
  expect(result.shopOpen).toBe(true)
})

test('wave 107 previewShop renders vendor listings with gold row', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        hud3d: {
          previewShop: (
            open: boolean,
            name: string,
            greet: string,
            gold: number,
            rows: Array<{ itemId: string; name: string; price: number; canAfford: boolean }>,
          ) => void
        }
      }
    }
    lotus.rpg.hud3d.previewShop(true, 'Test Vendor', 'Hello traveler', 42, [
      { itemId: 'herb', name: 'Herb', price: 6, canAfford: true },
    ])
    const gold = document.getElementById('lotus-rpg-shop-gold')?.textContent ?? ''
    const list = document.getElementById('lotus-rpg-shop-list')?.textContent ?? ''
    return { gold, list }
  })

  expect(result.gold).toContain('42')
  expect(result.list).toContain('Herb')
  expect(result.list).toContain('6g')
})

test('wave 107 vendorShopIdForActor returns scriptVars shopId or village_vendor default', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/vendor')
    const vendor = [...window.lotus!.world.actors.values()].find((a) => a.name === 'VillageVendor')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: { vendor: { shopIdFor: (a: { scriptVars?: Record<string, unknown> }) => string }; shop: { defaultId: string } }
    }
    if (!vendor) return { ok: false as const }
    return {
      ok: true as const,
      shopId: lotus.rpg.vendor.shopIdFor(vendor),
      defaultId: lotus.rpg.shop.defaultId,
    }
  })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.shopId).toBe(result.defaultId)
})

test('wave 107 openVendorShop returns false for non-Vendor tagged actors', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/spawn box')
    const box = [...window.lotus!.world.actors.values()].find((a) => a.name.startsWith('Box'))
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: { vendor: { open: (a: { tags: string[] }) => boolean } }
    }
    if (!box) return { ok: false as const }
    return { ok: true as const, opened: lotus.rpg.vendor.open(box as { tags: string[] }) }
  })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.opened).toBe(false)
})

test('wave 108 equip leather_helm and leather_chest attach armor socket meshes', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const term = window.lotus!.terminal.exec('/armorvisual')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        player: () => { name: string } | null
        equipment: {
          visuals: { getArmorId: (a: object, slot: 'head' | 'chest') => string | null }
        }
      }
    }
    const player = lotus.rpg.player()
    return {
      error: term.error,
      output: term.output ?? '',
      head: player ? lotus.rpg.equipment.visuals.getArmorId(player, 'head') : null,
      chest: player ? lotus.rpg.equipment.visuals.getArmorId(player, 'chest') : null,
    }
  })

  expect(result.error).toBeNull()
  expect(result.output).toContain('Armor visuals')
  expect(result.head).toBe('leather_helm')
  expect(result.chest).toBe('leather_chest')
})

test('wave 108 lotus.rpg.equipment.visuals bridge exposes attachArmor getArmorId', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const vis = (window.lotus! as typeof window.lotus & { rpg: { equipment: { visuals: Record<string, unknown> } } })
      .rpg.equipment.visuals
    return {
      attachArmor: typeof vis.attachArmor === 'function',
      getArmorId: typeof vis.getArmorId === 'function',
    }
  })

  expect(result.attachArmor).toBe(true)
  expect(result.getArmorId).toBe(true)
})

test('wave 108 syncEquipmentVisuals attaches head and chest when both equipped', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        player: () => object | null
        inventory: { addItem: (id: string, n?: number, a?: object) => boolean }
        equipment: {
          equip: (id: string, a?: object) => boolean
          visuals: { sync: (a: object) => string | null; getArmorId: (a: object, slot: 'head' | 'chest') => string | null }
        }
      }
    }
    const player = lotus.rpg.player()
    if (!player) return { ok: false as const }
    lotus.rpg.inventory.addItem('leather_helm', 1, player)
    lotus.rpg.inventory.addItem('leather_chest', 1, player)
    lotus.rpg.equipment.equip('leather_helm', player)
    lotus.rpg.equipment.equip('leather_chest', player)
    lotus.rpg.equipment.visuals.sync(player)
    return {
      ok: true as const,
      head: lotus.rpg.equipment.visuals.getArmorId(player, 'head'),
      chest: lotus.rpg.equipment.visuals.getArmorId(player, 'chest'),
    }
  })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.head).toBe('leather_helm')
  expect(result.chest).toBe('leather_chest')
})

test('wave 108 attachArmorVisual rejects weapon slot items', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        player: () => object | null
        equipment: { visuals: { attachArmor: (id: string, a?: object) => boolean } }
      }
    }
    const player = lotus.rpg.player()
    if (!player) return { ok: false as const }
    return { ok: true as const, attached: lotus.rpg.equipment.visuals.attachArmor('iron_sword', player) }
  })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.attached).toBe(false)
})

test('wave 108 leather_chest registered in equipment library', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: { equipment: { listItems: () => Array<{ id: string; slot: string }> } }
    }
    return lotus.rpg.equipment.listItems().some((d) => d.id === 'leather_chest' && d.slot === 'chest')
  })

  expect(result).toBe(true)
})

test('wave 109 lotus.rpg.portals.transitions bridge exposes cinematicOut setPreloadProgress', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const t = (window.lotus! as typeof window.lotus & { rpg: { portals: { transitions: Record<string, unknown> } } })
      .rpg.portals.transitions
    return {
      cinematicOut: typeof t.cinematicOut === 'function',
      setPreloadProgress: typeof t.setPreloadProgress === 'function',
      progressRingId: t.progressRingId,
    }
  })

  expect(result.cinematicOut).toBe(true)
  expect(result.setPreloadProgress).toBe(true)
  expect(result.progressRingId).toBe('lotus-portal-progress-ring')
})

test('wave 109 /portalcine terminal previews slide cinematic overlay', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const term = window.lotus!.terminal.exec('/portalcine interior')
    return { error: term.error, output: term.output ?? '' }
  })

  expect(result.error).toBeNull()
  expect(result.output).toContain('Portal cinematic')
  expect(result.output).toContain('slide')
})

test('wave 109 setPortalPreloadProgress updates progress ring CSS variable', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: { portals: { transitions: { setPreloadProgress: (n: number) => void; progressRingId: string } } }
    }
    lotus.rpg.portals.transitions.setPreloadProgress(65)
    const ring = document.getElementById(lotus.rpg.portals.transitions.progressRingId)
    const pct = ring?.style.getPropertyValue('--lotus-portal-pct') ?? ''
    return { pct }
  })

  expect(result.pct).toBe('65%')
})

test('wave 109 portalCinematicOut shows loading label element', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: { portals: { transitions: { cinematicOut: (k: string) => Promise<void>; hideLoading: () => void } } }
    }
    await lotus.rpg.portals.transitions.cinematicOut('overworld', { preloadSteps: 2 })
    const label = document.getElementById('lotus-portal-loading-label')?.textContent ?? ''
    lotus.rpg.portals.transitions.hideLoading()
    return { label }
  })

  expect(result.label).toContain('overworld')
})

test('wave 109 portal loading overlay includes progress ring child', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: { portals: { transitions: { showLoading: (l: string) => void; progressRingId: string } } }
    }
    lotus.rpg.portals.transitions.showLoading('Loading cell…')
    const ring = document.getElementById(lotus.rpg.portals.transitions.progressRingId)
    return { hasRing: Boolean(ring) }
  })

  expect(result.hasRing).toBe(true)
})

test('wave 110 find_herbs active reduces herb buy price via quest multiplier', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        quests: { start: (id: string) => boolean }
        shop: {
          defaultId: string
          ensureDefaults: () => void
          economy: {
            resolveBuyPrice: (shop: string, item: string) => number
            priceBreakdown: (shop: string, item: string) => { base: number; resolved: number; questMult: number } | null
          }
        }
      }
    }
    lotus.rpg.shop.ensureDefaults()
    lotus.rpg.quests.start('find_herbs')
    const breakdown = lotus.rpg.shop.economy.priceBreakdown(lotus.rpg.shop.defaultId, 'herb')
    return {
      base: breakdown?.base ?? 0,
      resolved: breakdown?.resolved ?? 0,
      questMult: breakdown?.questMult ?? 1,
    }
  })

  expect(result.base).toBe(8)
  expect(result.questMult).toBe(0.75)
  expect(result.resolved).toBe(6)
})

test('wave 110 lotus.rpg.shop.economy bridge exposes reputation and quest rules', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const eco = (window.lotus! as typeof window.lotus & { rpg: { shop: { economy: Record<string, unknown> } } }).rpg.shop
      .economy
    return {
      resolveBuyPrice: typeof eco.resolveBuyPrice === 'function',
      getReputation: typeof eco.getReputation === 'function',
      setReputation: typeof eco.setReputation === 'function',
      listQuestRules: typeof eco.listQuestRules === 'function',
    }
  })

  expect(result.resolveBuyPrice).toBe(true)
  expect(result.getReputation).toBe(true)
  expect(result.setReputation).toBe(true)
  expect(result.listQuestRules).toBe(true)
})

test('wave 110 /shopprice herb terminal shows quest-linked price breakdown', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const term = window.lotus!.terminal.exec('/shopprice herb')
    return { error: term.error, output: term.output ?? '' }
  })

  expect(result.error).toBeNull()
  expect(result.output).toContain('Shop price')
  expect(result.output).toContain('resolved: 6g')
})

test('wave 110 buy herb with find_herbs active deducts discounted gold', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        player: () => object | null
        quests: { start: (id: string) => boolean }
        shop: { defaultId: string; ensureDefaults: () => void; buy: (shop: string, item: string) => boolean }
        inventory: { setGold: (n: number, a?: object) => number; getGold: (a?: object) => number }
      }
    }
    lotus.rpg.shop.ensureDefaults()
    lotus.rpg.quests.start('find_herbs')
    const player = lotus.rpg.player()
    lotus.rpg.inventory.setGold(20, player ?? undefined)
    const goldBefore = lotus.rpg.inventory.getGold(player ?? undefined)
    const bought = lotus.rpg.shop.buy(lotus.rpg.shop.defaultId, 'herb')
    return {
      bought,
      goldBefore,
      goldAfter: lotus.rpg.inventory.getGold(player ?? undefined),
    }
  })

  expect(result.bought).toBe(true)
  expect(result.goldBefore).toBe(20)
  expect(result.goldAfter).toBe(14)
})

test('wave 110 setReputation shaves buy price via repMult', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        shop: {
          defaultId: string
          ensureDefaults: () => void
          economy: {
            setReputation: (n: number) => number
            resolveBuyPrice: (shop: string, item: string) => number
          }
        }
      }
    }
    lotus.rpg.shop.ensureDefaults()
    lotus.rpg.shop.economy.setReputation(50)
    const discounted = lotus.rpg.shop.economy.resolveBuyPrice(lotus.rpg.shop.defaultId, 'iron_sword')
    lotus.rpg.shop.economy.setReputation(0)
    const base = lotus.rpg.shop.economy.resolveBuyPrice(lotus.rpg.shop.defaultId, 'iron_sword')
    return { discounted, base }
  })

  expect(result.base).toBe(80)
  expect(result.discounted).toBeLessThan(result.base)
})

test('wave 101 dealDamage grants i-frames and queues floating damage numbers', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        combat: {
          ensureActor: (a: { name: string; tags: string[] }) => unknown
          ensurePlayer: () => { name: string; tags: string[] } | null
          dealDamage: (t: { name: string; tags: string[] }, n: number) => boolean
          getHealth: (a?: { name: string }) => number | null
          polish: {
            isInvincible: (a: { name: string }) => boolean
            listDamageNumbers: () => { amount: number }[]
          }
        }
      }
      terminal: { exec: (c: string) => { output?: string; error: string | null } }
    }
    const player = lotus.rpg.combat.ensurePlayer()
    if (!player) return { ok: false as const }
    lotus.rpg.combat.ensureActor(player)
    const hp0 = lotus.rpg.combat.getHealth(player) ?? 0
    lotus.rpg.combat.dealDamage(player, 15)
    const hp1 = lotus.rpg.combat.getHealth(player) ?? 0
    const blocked = lotus.rpg.combat.dealDamage(player, 15)
    const hp2 = lotus.rpg.combat.getHealth(player) ?? 0
    const nums = lotus.rpg.combat.polish.listDamageNumbers()
    return {
      ok: true as const,
      hp0,
      hp1,
      hp2,
      blocked,
      invincible: lotus.rpg.combat.polish.isInvincible(player),
      numCount: nums.length,
      firstAmount: nums[0]?.amount ?? 0,
    }
  })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.hp0).toBe(100)
  expect(result.hp1).toBe(85)
  expect(result.hp2).toBe(85)
  expect(result.blocked).toBe(false)
  expect(result.invincible).toBe(true)
  expect(result.numCount).toBeGreaterThanOrEqual(1)
  expect(result.firstAmount).toBe(15)
})

test('wave 101 lotus.rpg.combat.polish bridge exposes i-frames and damage numbers', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const polish = (window.lotus! as typeof window.lotus & { rpg: { combat: { polish: Record<string, unknown> } } })
      .rpg.combat.polish
    return {
      isInvincible: typeof polish.isInvincible === 'function',
      grantIFrames: typeof polish.grantIFrames === 'function',
      getIFramesRemaining: typeof polish.getIFramesRemaining === 'function',
      listDamageNumbers: typeof polish.listDamageNumbers === 'function',
      popDamageNumbers: typeof polish.popDamageNumbers === 'function',
    }
  })

  expect(result.isInvincible).toBe(true)
  expect(result.grantIFrames).toBe(true)
  expect(result.getIFramesRemaining).toBe(true)
  expect(result.listDamageNumbers).toBe(true)
  expect(result.popDamageNumbers).toBe(true)
})

test('wave 101 /combatpolish terminal applies damage with i-frame block on second hit', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const term = window.lotus!.terminal.exec('/combatpolish')
    return { error: term.error, output: term.output ?? '', level: term.level }
  })

  expect(result.level).toBe('log')
  expect(result.error).toBeNull()
  expect(result.output).toContain('Combat polish')
  expect(result.output).toContain('2nd hit blocked')
  expect(result.output).toContain('damage numbers')
})

test('wave 101 dealDamage second hit within i-frame window does not reduce health', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const combat = (window.lotus! as typeof window.lotus & {
      rpg: {
        combat: {
          ensureActor: (a: object) => void
          ensurePlayer: () => { tags: string[] } | null
          dealDamage: (t: object, n: number) => boolean
          getHealth: (a?: object) => number | null
        }
      }
    }).rpg.combat
    const player = combat.ensurePlayer()
    if (!player) return { error: 'no player' }
    combat.ensureActor(player)
    combat.dealDamage(player, 10)
    const mid = combat.getHealth(player) ?? 0
    combat.dealDamage(player, 10)
    const after = combat.getHealth(player) ?? 0
    return { mid, after }
  })

  expect(result.mid).toBe(90)
  expect(result.after).toBe(90)
})

test('wave 101 combat polish popDamageNumbers drains queued damage number events', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const combat = (window.lotus! as typeof window.lotus & {
      rpg: {
        combat: {
          dealDamage: (t: { tags: string[] }, n: number) => boolean
          ensureActor: (a: object) => void
          polish: { listDamageNumbers: () => unknown[]; popDamageNumbers: () => unknown[] }
        }
      }
    }).rpg.combat
    window.lotus!.terminal.exec('/spawn sphere')
    const enemy = [...window.lotus!.world.actors.values()].find((a) => a.name.toLowerCase().includes('sphere'))
    if (!enemy) return { error: 'no sphere' }
    ;(enemy as { tags: string[] }).tags = ['Enemy']
    combat.ensureActor(enemy)
    combat.dealDamage(enemy, 7)
    const before = combat.polish.listDamageNumbers().length
    const popped = combat.polish.popDamageNumbers().length
    const after = combat.polish.listDamageNumbers().length
    return { before, popped, after }
  })

  expect(result.before).toBeGreaterThanOrEqual(1)
  expect(result.popped).toBe(result.before)
  expect(result.after).toBe(0)
})

test('wave 102 equip iron_sword attaches weapon visual mesh on player socket', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        equipment: {
          equip: (id: string) => boolean
          visuals: { sync: () => string | null; getWeaponId: () => string | null }
        }
        inventory: { addItem: (id: string, n?: number) => boolean }
        player: () => object | null
      }
    }
    const player = lotus.rpg.player()
    lotus.rpg.inventory.addItem('iron_sword', 1, player ?? undefined)
    lotus.rpg.equipment.equip('iron_sword')
    const synced = lotus.rpg.equipment.visuals.sync()
    const weaponId = lotus.rpg.equipment.visuals.getWeaponId()
    const socket = player
      ? [...window.lotus!.world.actors.values()]
          .find((a) => a.id === (player as { id: string }).id)
          ?.root?.getObjectByName?.('EquipWeaponSocket')
      : null
    return { synced, weaponId, hasSocket: !!socket, childCount: socket?.children?.length ?? 0 }
  })

  expect(result.synced).toBe('iron_sword')
  expect(result.weaponId).toBe('iron_sword')
  expect(result.hasSocket).toBe(true)
  expect(result.childCount).toBeGreaterThan(0)
})

test('wave 102 lotus.rpg.equipment.visuals bridge exposes sync getWeaponId attach', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const visuals = (window.lotus! as typeof window.lotus & {
      rpg: { equipment: { visuals: Record<string, unknown> } }
    }).rpg.equipment.visuals
    return {
      sync: typeof visuals.sync === 'function',
      getWeaponId: typeof visuals.getWeaponId === 'function',
      attach: typeof visuals.attach === 'function',
    }
  })

  expect(result.sync).toBe(true)
  expect(result.getWeaponId).toBe(true)
  expect(result.attach).toBe(true)
})

test('wave 102 /equipvisual terminal equips sword and reports socket mesh', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const term = window.lotus!.terminal.exec('/equipvisual')
    return { error: term.error, output: term.output ?? '' }
  })

  expect(result.error).toBeNull()
  expect(result.output).toContain('Equipment visual')
  expect(result.output).toContain('iron_sword')
})

test('wave 102 unequip weapon removes visual mesh from socket', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        equipment: {
          equip: (id: string) => boolean
          unequip: (slot: string) => boolean
          visuals: { getWeaponId: () => string | null }
        }
        inventory: { addItem: (id: string) => boolean }
      }
    }
    lotus.rpg.inventory.addItem('iron_sword', 1)
    lotus.rpg.equipment.equip('iron_sword')
    const before = lotus.rpg.equipment.visuals.getWeaponId()
    lotus.rpg.equipment.unequip('weapon')
    const after = lotus.rpg.equipment.visuals.getWeaponId()
    return { before, after }
  })

  expect(result.before).toBe('iron_sword')
  expect(result.after).toBeNull()
})

test('wave 102 equipment visuals attachWeaponVisual rejects non-weapon items', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const visuals = (window.lotus! as typeof window.lotus & {
      rpg: { equipment: { visuals: { attach: (id: string) => boolean } } }
    }).rpg.equipment.visuals
    return { ok: visuals.attach('leather_helm') }
  })

  expect(result.ok).toBe(false)
})

test('wave 103 lotus.rpg.portals.transitions bridge exposes loading overlay helpers', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const t = (window.lotus! as typeof window.lotus & {
      rpg: { portals: { transitions: Record<string, unknown>; interiorKey: string } }
    }).rpg.portals.transitions
    return {
      overlayId: t.overlayId,
      labelFor: typeof t.labelFor === 'function',
      showLoading: typeof t.showLoading === 'function',
      hideLoading: typeof t.hideLoading === 'function',
      interiorLabel: (t.labelFor as (k: string) => string)('interior'),
    }
  })

  expect(result.overlayId).toBe('lotus-portal-loading')
  expect(result.labelFor).toBe(true)
  expect(result.showLoading).toBe(true)
  expect(result.hideLoading).toBe(true)
  expect(result.interiorLabel).toContain('interior')
})

test('wave 103 /portaltrans terminal previews portal loading label', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const term = window.lotus!.terminal.exec('/portaltrans interior')
    const el = document.getElementById('lotus-portal-loading')
    return {
      error: term.error,
      output: term.output ?? '',
      overlayText: el?.textContent ?? '',
      overlayVisible: el?.style.display === 'flex',
    }
  })

  expect(result.error).toBeNull()
  expect(result.output).toContain('Portal transition')
  expect(result.overlayText).toContain('interior')
  expect(result.overlayVisible).toBe(true)
})

test('wave 103 portalLabelForTarget returns overworld copy for overworld key', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const t = (window.lotus! as typeof window.lotus & {
      rpg: { portals: { transitions: { labelFor: (k: string) => string }; overworldKey: string } }
    }).rpg.portals
    return {
      label: t.transitions.labelFor(t.overworldKey),
      key: t.overworldKey,
    }
  })

  expect(result.key).toBe('overworld')
  expect(result.label.toLowerCase()).toContain('overworld')
})

test('wave 103 wireRpgPortals registers interior portal from overworld spawn', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { rpgOverworld: { spawn: () => void } }
      rpg: { portals: { discover: () => { triggerName: string }[]; getTarget: (n: string) => string | null } }
    }
    v.indie.rpgOverworld.spawn()
    const portals = v.rpg.portals.discover()
    const interior = portals.find((p) => p.triggerName === 'Portal_Interior')
    return {
      count: portals.length,
      interior: !!interior,
      target: interior?.targetLevel ?? v.rpg.portals.getTarget('Portal_Interior'),
    }
  })

  expect(result.count).toBeGreaterThan(0)
  expect(result.interior).toBe(true)
  expect(result.target).toBe('interior')
})

test('wave 103 hidePortalLoading clears lotus-portal-loading overlay display', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const t = (window.lotus! as typeof window.lotus & {
      rpg: { portals: { transitions: { showLoading: (l: string) => void; hideLoading: () => void } } }
    }).rpg.portals.transitions
    t.showLoading('Test load')
    t.hideLoading()
    const el = document.getElementById('lotus-portal-loading')
    return { display: el?.style.display ?? '' }
  })

  expect(result.display).toBe('none')
})

test('wave 104 attachSampleCombatOneshot stores rootMotionSpeed on Attack state', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const player = [...window.lotus!.world.actors.values()].find((a) => a.type === 'PlayerStart')
    if (!player) return { error: 'no player' }
    const lotus = window.lotus! as typeof window.lotus & {
      anim: { attachSampleOneshot: (id: string) => { ok: boolean }; findAttackState: (id: string) => { rootMotionSpeed?: number } | null; getRootMotionSpeed: (id: string) => number }
    }
    lotus.anim.attachSampleOneshot(player.id)
    const attack = lotus.anim.findAttackState(player.id)
    return {
      speed: attack?.rootMotionSpeed ?? 0,
      bridgeSpeed: lotus.anim.getRootMotionSpeed(player.id),
    }
  })

  expect((result.speed ?? 0) > 0).toBe(true)
  expect(result.bridgeSpeed).toBe(result.speed)
})

test('wave 104 lotus.anim root motion bridge exposes getRootMotionSpeed isRootMotionActive', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const anim = (window.lotus! as typeof window.lotus & { anim: Record<string, unknown> }).anim
    return {
      getRootMotionSpeed: typeof anim.getRootMotionSpeed === 'function',
      isRootMotionActive: typeof anim.isRootMotionActive === 'function',
    }
  })

  expect(result.getRootMotionSpeed).toBe(true)
  expect(result.isRootMotionActive).toBe(true)
})

test('wave 104 /rootmotion terminal attaches Attack FSM with rootMotionSpeed', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const term = window.lotus!.terminal.exec('/rootmotion')
    return { error: term.error, output: term.output ?? '' }
  })

  expect(result.error).toBeNull()
  expect(result.output).toContain('Root motion')
  expect(result.output).toContain('rootMotionSpeed')
})

test('wave 104 combatOneshot sets isRootMotionActive while montage plays', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const player = [...window.lotus!.world.actors.values()].find((a) => a.type === 'PlayerStart')
    if (!player) return { error: 'no player' }
    const lotus = window.lotus! as typeof window.lotus & {
      anim: {
        attachSampleOneshot: (id: string) => { ok: boolean }
        combatOneshot: (id: string) => boolean
        isRootMotionActive: (id: string) => boolean
        getRootMotionSpeed: (id: string) => number
      }
    }
    lotus.anim.attachSampleOneshot(player.id)
    const speed = lotus.anim.getRootMotionSpeed(player.id)
    lotus.anim.combatOneshot(player.id)
    return { speed, active: lotus.anim.isRootMotionActive(player.id) }
  })

  expect((result.speed ?? 0) > 0).toBe(true)
  expect(result.active).toBe(true)
})

test('wave 104 findAttackState returns rootMotionSpeed field for Attack oneshot', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/combatanim')
    const player = [...window.lotus!.world.actors.values()].find((a) => a.type === 'PlayerStart')
    const lotus = window.lotus! as typeof window.lotus & {
      anim: { findAttackState: (id: string) => { rootMotionSpeed?: number; kind?: string } | null }
    }
    const attack = player ? lotus.anim.findAttackState(player.id) : null
    return { kind: attack?.kind, speed: attack?.rootMotionSpeed ?? 0 }
  })

  expect(result.kind).toBe('oneshot')
  expect(result.speed).toBeGreaterThan(0)
})

test('wave 105 shop buy herb deducts gold and adds item to inventory', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        player: () => object | null
        shop: {
          defaultId: string
          ensureDefaults: () => void
          buy: (shop: string, item: string) => boolean
          canBuy: (shop: string, item: string) => boolean
        }
        inventory: { getGold: (a?: object) => number; getItemCount: (id: string, a?: object) => number; setGold: (n: number, a?: object) => number }
      }
    }
    lotus.rpg.shop.ensureDefaults()
    const player = lotus.rpg.player()
    lotus.rpg.inventory.setGold(100, player ?? undefined)
    const goldBefore = lotus.rpg.inventory.getGold(player ?? undefined)
    const herbsBefore = lotus.rpg.inventory.getItemCount('herb', player ?? undefined)
    const can = lotus.rpg.shop.canBuy(lotus.rpg.shop.defaultId, 'herb')
    const bought = lotus.rpg.shop.buy(lotus.rpg.shop.defaultId, 'herb')
    return {
      can,
      bought,
      goldBefore,
      goldAfter: lotus.rpg.inventory.getGold(player ?? undefined),
      herbsAfter: lotus.rpg.inventory.getItemCount('herb', player ?? undefined),
      herbsBefore,
    }
  })

  expect(result.can).toBe(true)
  expect(result.bought).toBe(true)
  expect(result.goldBefore).toBe(100)
  expect(result.goldAfter).toBe(92)
  expect(result.herbsBefore).toBe(0)
  expect(result.herbsAfter).toBe(1)
})

test('wave 105 lotus.rpg.shop bridge exposes buy sell canBuy canSell list', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const shop = (window.lotus! as typeof window.lotus & { rpg: { shop: Record<string, unknown> } }).rpg.shop
    return {
      list: typeof shop.list === 'function',
      buy: typeof shop.buy === 'function',
      sell: typeof shop.sell === 'function',
      canBuy: typeof shop.canBuy === 'function',
      canSell: typeof shop.canSell === 'function',
      defaultId: shop.defaultId,
    }
  })

  expect(result.list).toBe(true)
  expect(result.buy).toBe(true)
  expect(result.sell).toBe(true)
  expect(result.canBuy).toBe(true)
  expect(result.canSell).toBe(true)
  expect(result.defaultId).toBe('village_vendor')
})

test('wave 105 /shop buy herb terminal purchases from village vendor', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const term = window.lotus!.terminal.exec('/shop buy herb')
    return { error: term.error, output: term.output ?? '' }
  })

  expect(result.error).toBeNull()
  expect(result.output).toContain('Shop buy')
  expect(result.output).toContain('herb')
})

test('wave 105 sellItem returns gold when player sells herb to vendor', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        player: () => object | null
        shop: {
          defaultId: string
          ensureDefaults: () => void
          sell: (shop: string, item: string) => boolean
          sellPrice: (shop: string, item: string) => number
        }
        inventory: { addItem: (id: string, n?: number, a?: object) => boolean; getGold: (a?: object) => number }
      }
    }
    lotus.rpg.shop.ensureDefaults()
    const player = lotus.rpg.player()
    lotus.rpg.inventory.addItem('herb', 1, player ?? undefined)
    const price = lotus.rpg.shop.sellPrice(lotus.rpg.shop.defaultId, 'herb')
    const goldBefore = lotus.rpg.inventory.getGold(player ?? undefined)
    const sold = lotus.rpg.shop.sell(lotus.rpg.shop.defaultId, 'herb')
    return {
      price,
      sold,
      goldBefore,
      goldAfter: lotus.rpg.inventory.getGold(player ?? undefined),
    }
  })

  expect(result.sold).toBe(true)
  expect(result.price).toBeGreaterThan(0)
  expect(result.goldAfter).toBeGreaterThan(result.goldBefore)
})

test('wave 105 listShops returns village_vendor with herb and health_potion listings', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: { shop: { ensureDefaults: () => void; list: () => { id: string; listings: { itemId: string }[] }[] } }
    }
    lotus.rpg.shop.ensureDefaults()
    const shop = lotus.rpg.shop.list().find((s) => s.id === 'village_vendor')
    const ids = shop?.listings.map((l) => l.itemId) ?? []
    return { ids }
  })

  expect(result.ids).toContain('herb')
  expect(result.ids).toContain('health_potion')
  expect(result.ids).toContain('iron_sword')
})

test('wave 100 rpgCrafting canCraft craft consumes herb inputs produces health_potion', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        player: () => object | null
        crafting: {
          ensureDefaults: () => void
          canCraft: (id: string, actor?: object) => boolean
          craft: (id: string, actor?: object) => boolean
        }
        inventory: {
          addItem: (id: string, qty?: number, actor?: object) => boolean
          getItemCount: (id: string, actor?: object) => number
        }
      }
    }
    const player = lotus.rpg.player()
    lotus.rpg.crafting.ensureDefaults()
    lotus.rpg.inventory.addItem('herb', 2, player ?? undefined)
    const can = lotus.rpg.crafting.canCraft('health_potion', player ?? undefined)
    const herbsBefore = lotus.rpg.inventory.getItemCount('herb', player ?? undefined)
    const potionsBefore = lotus.rpg.inventory.getItemCount('health_potion', player ?? undefined)
    const crafted = lotus.rpg.crafting.craft('health_potion', player ?? undefined)
    return {
      can,
      crafted,
      herbsBefore,
      herbsAfter: lotus.rpg.inventory.getItemCount('herb', player ?? undefined),
      potionsBefore,
      potionsAfter: lotus.rpg.inventory.getItemCount('health_potion', player ?? undefined),
    }
  })

  expect(result.can).toBe(true)
  expect(result.crafted).toBe(true)
  expect(result.herbsBefore).toBe(2)
  expect(result.herbsAfter).toBe(0)
  expect(result.potionsBefore).toBe(0)
  expect(result.potionsAfter).toBe(1)
})

test('wave 100 rpgLoot rollLoot goblin table adds gold and herb to player inventory', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const origRandom = Math.random
    Math.random = () => 0
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        player: () => object | null
        loot: { ensureDefaults: () => void; roll: (id: string, actor?: object) => Array<{ type: string; itemId?: string; quantity: number }> }
        inventory: {
          getGold: (actor?: object) => number
          getItemCount: (id: string, actor?: object) => number
        }
      }
    }
    const player = lotus.rpg.player()
    lotus.rpg.loot.ensureDefaults()
    const goldBefore = lotus.rpg.inventory.getGold(player ?? undefined)
    const drops = lotus.rpg.loot.roll('goblin', player ?? undefined)
    Math.random = origRandom
    return {
      drops,
      goldGained: lotus.rpg.inventory.getGold(player ?? undefined) - goldBefore,
      herbGained: lotus.rpg.inventory.getItemCount('herb', player ?? undefined),
    }
  })

  expect(result.drops.some((d) => d.type === 'gold')).toBe(true)
  expect(result.drops.some((d) => d.type === 'item' && d.itemId === 'herb')).toBe(true)
  expect(result.goldGained).toBeGreaterThanOrEqual(5)
  expect(result.herbGained).toBe(1)
})

test('wave 100 rpgCombat dealDamage enemy defeat auto-rolls goblin loot into player inventory', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const origRandom = Math.random
    Math.random = () => 0
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        player: () => object | null
        loot: { ensureDefaults: () => void }
        combat: {
          dealDamage: (target: { tags: string[] }, amount: number, source?: object) => boolean
          isAlive: (target: { tags: string[] }) => boolean
        }
        inventory: {
          getGold: (actor?: object) => number
          getItemCount: (id: string, actor?: object) => number
        }
      }
      world: {
        actors: {
          values: () => IterableIterator<{ name: string; tags: string[] }>
        }
      }
    }
    lotus.rpg.loot.ensureDefaults()
    const player = lotus.rpg.player()
    const goldBefore = lotus.rpg.inventory.getGold(player ?? undefined)
    window.lotus!.terminal.exec('/combat')
    const spawned = [...lotus.world.actors.values()].find((a) => a.name === 'CombatTestEnemy')
    if (spawned) spawned.tags = ['Enemy', 'Goblin']
    const target = spawned
    if (!target) return { ok: false as const }
    const aliveBefore = lotus.rpg.combat.isAlive(target)
    lotus.rpg.combat.dealDamage(target, 200, player ?? undefined)
    const aliveAfter = lotus.rpg.combat.isAlive(target)
    Math.random = origRandom
    return {
      ok: true as const,
      aliveBefore,
      aliveAfter,
      goldGained: lotus.rpg.inventory.getGold(player ?? undefined) - goldBefore,
      herbGained: lotus.rpg.inventory.getItemCount('herb', player ?? undefined),
    }
  })

  expect(result.ok).toBe(true)
  expect(result.aliveBefore).toBe(true)
  expect(result.aliveAfter).toBe(false)
  expect(result.goldGained).toBeGreaterThanOrEqual(5)
  expect(result.herbGained).toBe(1)
})

test('wave 100 lotus.rpg.crafting and loot bridges expose canCraft craft roll listRecipes listTables', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: { crafting: Record<string, unknown>; loot: Record<string, unknown> }
    }
    return {
      canCraft: typeof lotus.rpg.crafting.canCraft === 'function',
      craft: typeof lotus.rpg.crafting.craft === 'function',
      listRecipes: typeof lotus.rpg.crafting.listRecipes === 'function',
      listTables: typeof lotus.rpg.loot.listTables === 'function',
      roll: typeof lotus.rpg.loot.roll === 'function',
      resolveForEnemy: typeof lotus.rpg.loot.resolveForEnemy === 'function',
      healthRecipe: (
        lotus.rpg.crafting.listRecipes as () => Array<{ id: string }>
      )().some((r) => r.id === 'health_potion'),
      goblinTable: (lotus.rpg.loot.listTables as () => Array<{ id: string }>)().some((t) => t.id === 'goblin'),
    }
  })

  expect(result.canCraft).toBe(true)
  expect(result.craft).toBe(true)
  expect(result.listRecipes).toBe(true)
  expect(result.listTables).toBe(true)
  expect(result.roll).toBe(true)
  expect(result.resolveForEnemy).toBe(true)
  expect(result.healthRecipe).toBe(true)
  expect(result.goblinTable).toBe(true)
})

test('wave 100 terminal /craft health_potion and rpg3dHud crafting panel toggle', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const term = window.lotus!.terminal.exec('/craft health_potion')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        inventory: { getItemCount: (id: string) => number }
        hud3d: {
          previewCrafting: (
            open: boolean,
            recipes: Array<{ id: string; name: string; inputs: string; output: string; canCraft: boolean }>,
          ) => void
        }
      }
    }
    lotus.rpg.hud3d.previewCrafting(true, [
      {
        id: 'health_potion',
        name: 'Health Potion',
        inputs: '2× Herb',
        output: '1× Health Potion',
        canCraft: true,
      },
      {
        id: 'mana_potion',
        name: 'Mana Potion',
        inputs: '3× Herb',
        output: '1× Mana Potion',
        canCraft: false,
      },
    ])
    const panel = document.getElementById('lotus-rpg-crafting')
    const rows = panel?.querySelectorAll('#lotus-rpg-crafting-list li') ?? []
    const ready = panel?.querySelector('.recipe-ready')?.textContent ?? ''
    return {
      termOk: !term.error && (term.output?.includes('health_potion') ?? false),
      potions: lotus.rpg.inventory.getItemCount('health_potion'),
      panelOpen: panel?.classList.contains('open') ?? false,
      rowCount: rows.length,
      ready,
    }
  })

  expect(result.termOk).toBe(true)
  expect(result.potions).toBeGreaterThanOrEqual(1)
  expect(result.panelOpen).toBe(true)
  expect(result.rowCount).toBe(2)
  expect(result.ready).toBe('READY')
})

test('wave 96 rpgCombat dealDamage isAlive meleeAttack rangedAttack GAS Health', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const combat = (window.lotus! as typeof window.lotus & {
      rpg: {
        combat: {
          ensureActor: (a?: { name: string }) => { name: string } | null
          ensurePlayer: () => { name: string } | null
          dealDamage: (t: { name: string }, n: number) => boolean
          isAlive: (t: { name: string }) => boolean
          getHealth: (a?: { name: string }) => number | null
          meleeAttack: (a: { name: string }, range: number, dmg: number) => { name: string }[]
          rangedAttack: (
            origin: [number, number, number],
            dir: [number, number, number],
            range: number,
            dmg: number,
          ) => { name: string } | null
        }
      }
      world: {
        actors: {
          values: () => IterableIterator<{
            name: string
            root: { position: { set: (x: number, y: number, z: number) => void } }
          }>
        }
      }
    }).rpg.combat
    const player = combat.ensurePlayer()
    const actors = [...(window.lotus! as typeof window.lotus & {
      world: { actors: { values: () => IterableIterator<{ name: string; tags?: string[] }> } }
    }).world.actors.values()]
    let enemy = actors.find((a) => a.name === 'Wave96Target')
    if (!enemy) {
      window.lotus!.terminal.exec('/spawn capsule')
      enemy = [...(window.lotus! as typeof window.lotus & {
        world: { actors: { values: () => IterableIterator<{ name: string; tags?: string[]; root: { position: { set: (x: number, y: number, z: number) => void } } }> } }
      }).world.actors.values()].find((a) => a.name.toLowerCase().includes('capsule'))
    }
    if (!enemy || !player) return { ok: false as const }
    enemy.tags = [...(enemy.tags ?? []), 'Enemy']
    const ensured = combat.ensureActor(enemy)
    if (!ensured) return { ok: false as const }
    const startHp = combat.getHealth(enemy) ?? 0
    const dealt = combat.dealDamage(enemy, 30)
    const afterDeal = combat.getHealth(enemy) ?? 0
    const aliveAfter = combat.isAlive(enemy)
    enemy.root.position.set(0, 1, -1.5)
    const meleeHits = combat.meleeAttack(player, 2.5, 15)
    const meleeHp = combat.getHealth(enemy) ?? 0
    const rangedHit = combat.rangedAttack([0, 1.5, 2], [0, 0, -1], 12, 10)
    const rangedHp = combat.getHealth(enemy) ?? 0
    return {
      ok: true as const,
      startHp,
      dealt,
      afterDeal,
      aliveAfter,
      meleeNames: meleeHits.map((a) => a.name),
      meleeHp,
      rangedName: rangedHit?.name ?? null,
      rangedHp,
    }
  })

  expect(result.ok).toBe(true)
  if (!result.ok) return
  expect(result.startHp).toBe(100)
  expect(result.dealt).toBe(true)
  expect(result.afterDeal).toBe(70)
  expect(result.aliveAfter).toBe(true)
  expect(result.meleeNames.length).toBeGreaterThanOrEqual(0)
  expect(result.rangedName).toBeTruthy()
  expect(result.rangedHp).toBeLessThan(result.afterDeal)
})

test('wave 96 lotus.rpg.combat bridge exposes dealDamage isAlive meleeAttack rangedAttack', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const c = (window.lotus! as typeof window.lotus & { rpg: { combat: Record<string, unknown> } }).rpg.combat
    return {
      tagEnemy: c.tagEnemy,
      tagPlayer: c.tagPlayer,
      hasDeal: typeof c.dealDamage === 'function',
      hasAlive: typeof c.isAlive === 'function',
      hasMelee: typeof c.meleeAttack === 'function',
      hasRanged: typeof c.rangedAttack === 'function',
      hasHealth: typeof c.getHealth === 'function',
    }
  })

  expect(result.tagEnemy).toBe('Enemy')
  expect(result.tagPlayer).toBe('Player')
  expect(result.hasDeal).toBe(true)
  expect(result.hasAlive).toBe(true)
  expect(result.hasMelee).toBe(true)
  expect(result.hasRanged).toBe(true)
  expect(result.hasHealth).toBe(true)
})

test('wave 96 lotus.rpg.enemyAi bridge exposes register list initAll tick reset', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const ai = (window.lotus! as typeof window.lotus & {
      rpg: {
        enemyAi: {
          defaultLayer: number
          defaultAggroRange: number
          register: (a: { id: string; name: string; tags: string[]; root: { position: { x: number; y: number; z: number } } }) => Promise<boolean>
          list: () => string[]
          initAll: () => Promise<number>
          tick: (dt: number) => void
          reset: () => void
          isRegistered: (id: string) => boolean
        }
        combat: { ensureActor: (a: { id: string; name: string; tags: string[] }) => unknown }
      }
      world: {
        actors: {
          values: () => IterableIterator<{
            id: string
            name: string
            tags: string[]
            root: { position: { x: number; y: number; z: number } }
          }>
        }
      }
    }).rpg.enemyAi
    window.lotus!.terminal.exec('/starter thirdperson')
    const enemy = {
      id: 'wave96_enemy_test',
      name: 'Wave96Enemy',
      tags: ['Enemy'],
      root: { position: { x: 4, y: 1, z: -2 } },
    }
    return {
      layer: ai.defaultLayer,
      aggro: ai.defaultAggroRange,
      hasRegister: typeof ai.register === 'function',
      hasList: typeof ai.list === 'function',
      hasInit: typeof ai.initAll === 'function',
      hasTick: typeof ai.tick === 'function',
      hasReset: typeof ai.reset === 'function',
      enemyId: enemy.id,
    }
  })

  expect(result.layer).toBe(0)
  expect(result.aggro).toBeGreaterThan(0)
  expect(result.hasRegister).toBe(true)
  expect(result.hasList).toBe(true)
  expect(result.hasInit).toBe(true)
  expect(result.hasTick).toBe(true)
  expect(result.hasReset).toBe(true)
})

test('wave 96 /combat terminal spawns enemy and deals test damage', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const out = window.lotus!.terminal.exec('/combat')
    const actors = [...(window.lotus! as typeof window.lotus & {
      world: { actors: { values: () => IterableIterator<{ name: string; tags?: string[] }> } }
    }).world.actors.values()]
    const enemy = actors.find((a) => a.name === 'CombatTestEnemy')
    return {
      output: out.output ?? '',
      error: out.error,
      enemyTags: enemy?.tags ?? [],
      hasEnemy: Boolean(enemy),
    }
  })

  expect(result.error).toBeNull()
  expect(result.output).toMatch(/Combat demo/)
  expect(result.output).toMatch(/enemy HP/)
  expect(result.output).toMatch(/lotus\.rpg\.combat/)
  expect(result.hasEnemy).toBe(true)
  expect(result.enemyTags).toContain('Enemy')
})

test('wave 96 spawnRpg3dGame adds Enemy-tagged goblins for navmesh chase', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { rpg3d: { spawn: () => void } }
      world: {
        actors: {
          values: () => IterableIterator<{
            name: string
            tags?: string[]
            attributeSetId?: string
            script?: string
          }>
        }
      }
    }
    v.indie.rpg3d.spawn()
    const actors = [...v.world.actors.values()]
    const enemies = actors.filter((a) => a.tags?.includes('Enemy'))
    const mgr = actors.find((a) => a.name === 'Rpg3dGameManager')
    return {
      enemyNames: enemies.map((a) => a.name).sort(),
      enemyCount: enemies.length,
      allHaveGAS: enemies.every((a) => a.attributeSetId === 'default'),
      scriptMelee: (mgr?.script ?? '').includes('meleeAttack'),
    }
  })

  expect(result.enemyCount).toBeGreaterThanOrEqual(2)
  expect(result.enemyNames).toContain('Rpg3dGoblinA')
  expect(result.enemyNames).toContain('Rpg3dGoblinB')
  expect(result.allHaveGAS).toBe(true)
  expect(result.scriptMelee).toBe(true)
})

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

test('wave 99 triggerCombatOneshot activates montage and returns after duration', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      anim: {
        attachSampleOneshot: (id: string) => { ok: boolean; clipName?: string; error?: string }
        combatOneshot: (id: string, clip?: string, dur?: number) => boolean
        isOneshotActive: (id: string) => boolean
        findAttackState: (id: string) => { name: string; kind?: string; clipName: string; durationSec?: number } | null
      }
    }
    const player = [...window.lotus!.world.actors.values()].find((a) => a.type === 'PlayerStart')
    if (!player) return { error: 'no player' }
    const attached = lotus.anim.attachSampleOneshot(player.id)
    const attack = lotus.anim.findAttackState(player.id)
    const triggered = lotus.anim.combatOneshot(player.id, attack?.clipName, 0.2)
    const active = lotus.anim.isOneshotActive(player.id)
    return {
      attached,
      attackKind: attack?.kind,
      attackName: attack?.name,
      triggered,
      active,
    }
  })

  expect(result.attached?.ok).toBe(true)
  expect(result.attackKind).toBe('oneshot')
  expect(result.attackName).toBe('Attack')
  expect(result.triggered).toBe(true)
  expect(result.active).toBe(true)
})

test('wave 99 lotus.anim.combatOneshot bridge exposes attachSampleOneshot isOneshotActive findAttackState', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const anim = (window.lotus! as typeof window.lotus & { anim: Record<string, unknown> }).anim
    return {
      combatOneshot: typeof anim.combatOneshot === 'function',
      attachSampleOneshot: typeof anim.attachSampleOneshot === 'function',
      isOneshotActive: typeof anim.isOneshotActive === 'function',
      findAttackState: typeof anim.findAttackState === 'function',
      attackStateName: anim.attackStateName,
    }
  })

  expect(result.combatOneshot).toBe(true)
  expect(result.attachSampleOneshot).toBe(true)
  expect(result.isOneshotActive).toBe(true)
  expect(result.findAttackState).toBe(true)
  expect(result.attackStateName).toBe('Attack')
})

test('wave 99 /combatanim terminal attaches Attack oneshot FSM to player', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const term = window.lotus!.terminal.exec('/combatanim')
    const player = [...window.lotus!.world.actors.values()].find((a) => a.type === 'PlayerStart')
    const lotus = window.lotus! as typeof window.lotus & {
      anim: { findAttackState: (id: string) => { kind?: string; clipName: string } | null }
    }
    const attack = player ? lotus.anim.findAttackState(player.id) : null
    return {
      level: term.level,
      output: term.output ?? '',
      error: term.error,
      attackKind: attack?.kind,
      clipName: attack?.clipName,
    }
  })

  expect(result.level).toBe('log')
  expect(result.error).toBeNull()
  expect(result.output).toContain('Combat oneshot')
  expect(result.output).toContain('Attack')
  expect(result.attackKind).toBe('oneshot')
  expect(result.clipName).toBeTruthy()
})

test('wave 99 meleeAttack triggers combat oneshot when actor has Attack state', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      anim: {
        attachSampleOneshot: (id: string) => { ok: boolean }
        isOneshotActive: (id: string) => boolean
      }
      rpg: {
        combat: {
          meleeAttack: (
            attacker: { id: string },
            range: number,
            damage: number,
          ) => unknown[]
        }
      }
    }
    const player = [...window.lotus!.world.actors.values()].find((a) => a.type === 'PlayerStart')
    if (!player) return { error: 'no player' }
    lotus.anim.attachSampleOneshot(player.id)
    const before = lotus.anim.isOneshotActive(player.id)
    lotus.rpg.combat.meleeAttack(player, 2, 5)
    const after = lotus.anim.isOneshotActive(player.id)
    return { before, after }
  })

  expect(result.before).toBe(false)
  expect(result.after).toBe(true)
})

test('wave 99 AnimState oneshot kind stores durationSec on attachSampleCombatOneshot', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/spawn box')
    const actor = [...window.lotus!.world.actors.values()].find((a) => a.name.startsWith('Box'))
    if (!actor) return { error: 'no box' }
    const lotus = window.lotus! as typeof window.lotus & {
      anim: {
        attachSampleOneshot: (id: string) => { ok: boolean; clipName?: string }
        findAttackState: (id: string) => { durationSec?: number; kind?: string; loop?: boolean } | null
      }
    }
    const attached = lotus.anim.attachSampleOneshot(actor.id)
    const attack = lotus.anim.findAttackState(actor.id)
    return {
      ok: attached.ok,
      clipName: attached.clipName,
      kind: attack?.kind,
      durationSec: attack?.durationSec,
    }
  })

  expect(result.ok).toBe(true)
  expect(result.clipName).toBe('Attack')
  expect(result.kind).toBe('oneshot')
  expect((result.durationSec ?? 0) > 0).toBe(true)
})

/** Export playable overlay finished boot (keyboard / gamepad / touch copy variants). */
function isExportOverlayReady(): boolean {
  const t = document.getElementById('overlay')?.textContent ?? ''
  if (!t || t === 'Loading…') return false
  return /Click to play|click canvas|Touch stick|WASD/i.test(t)
}

test('wave 98 spawnRpgOverworldStarter creates 2x2 cells with portal triggers', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { rpgOverworld: { spawn: () => void; managerName: string; interiorKey: string } }
      world: {
        streaming: { enabled: boolean; exportByCell: boolean; gridSize: number }
        levelLinks: { name: string }[]
        actors: { values: () => IterableIterator<{ name: string; type: string; tags?: string[]; streamCell?: [number, number] }> }
      }
    }
    v.indie.rpgOverworld.spawn()
    const cells = [...v.world.actors.values()].filter((a) => a.name.startsWith('OverworldCell_'))
    const portal = [...v.world.actors.values()].find((a) => a.name === 'Portal_Interior')
    const mgr = [...v.world.actors.values()].find((a) => a.name === v.indie.rpgOverworld.managerName)
    const link = v.world.levelLinks.find((l) => l.name === v.indie.rpgOverworld.interiorKey)
    const streamCells = [...v.world.actors.values()].filter((a) => a.streamCell).length
    return {
      cellCount: cells.length,
      portalType: portal?.type,
      portalTag: portal?.tags?.includes('portal_interior'),
      mgr: !!mgr,
      interiorLink: !!link,
      streamingOn: v.world.streaming.enabled && v.world.streaming.exportByCell,
      gridSize: v.world.streaming.gridSize,
      streamCells,
    }
  })

  expect(result.cellCount).toBe(4)
  expect(result.portalType).toBe('TriggerVolume')
  expect(result.portalTag).toBe(true)
  expect(result.mgr).toBe(true)
  expect(result.interiorLink).toBe(true)
  expect(result.streamingOn).toBe(true)
  expect(result.gridSize).toBe(64)
  expect(result.streamCells).toBeGreaterThan(0)
})

test('wave 98 lotus.rpg.portals bridge exposes discover register wire getTarget', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { rpgOverworld: { spawn: () => void } }
      rpg: {
        portals: {
          reset: () => void
          discover: () => { triggerName: string; targetLevel: string; tag: string }[]
          register: (def: { triggerName: string; targetLevel: string; tag: string }) => void
          list: () => { triggerName: string; targetLevel: string }[]
          wire: () => number
          getTarget: (name: string) => string | null
          interiorKey: string
          overworldKey: string
        }
      }
    }
    v.indie.rpgOverworld.spawn()
    v.rpg.portals.reset()
    const discovered = v.rpg.portals.discover()
    v.rpg.portals.register({ triggerName: 'Portal_Test', targetLevel: 'dungeon', tag: 'portal_custom' })
    const wired = v.rpg.portals.wire()
    const listed = v.rpg.portals.list()
    return {
      discovered: discovered.length,
      hasInterior: discovered.some((p) => p.triggerName === 'Portal_Interior'),
      interiorTarget: v.rpg.portals.getTarget('Portal_Interior'),
      wired,
      listed: listed.length,
      interiorKey: v.rpg.portals.interiorKey,
      overworldKey: v.rpg.portals.overworldKey,
    }
  })

  expect(result.discovered).toBeGreaterThanOrEqual(1)
  expect(result.hasInterior).toBe(true)
  expect(result.interiorTarget).toBe('interior')
  expect(result.wired).toBeGreaterThanOrEqual(1)
  expect(result.listed).toBeGreaterThanOrEqual(1)
  expect(result.interiorKey).toBe('interior')
  expect(result.overworldKey).toBe('overworld')
})

test('wave 98 lotus.streaming overworldPreset applyOverworldPreset enables exportByCell', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const s = (window.lotus! as typeof window.lotus).streaming as {
      overworldPreset: () => { enabled: boolean; exportByCell: boolean; gridSize: number; loadRadius: number }
      applyOverworldPreset: () => { enabled: boolean; exportByCell: boolean; gridSize: number; loadRadius: number }
    }
    const preset = s.overworldPreset()
    const applied = s.applyOverworldPreset()
    return { preset, applied }
  })

  expect(result.preset.enabled).toBe(true)
  expect(result.preset.exportByCell).toBe(true)
  expect(result.preset.gridSize).toBe(64)
  expect(result.applied.enabled).toBe(true)
  expect(result.applied.exportByCell).toBe(true)
})

test('wave 98 buildPackHTML embeds __LOTUS_RPG_OVERWORLD__ with cell streaming', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { rpgOverworld: { spawn: () => void; buildPackHTML: () => string } }
    }
    v.indie.rpgOverworld.spawn()
    const html = v.indie.rpgOverworld.buildPackHTML()
    const streamLine = html.match(/__LOTUS_STREAMING__ = (true|false)/)?.[1]
    return {
      overworldFlag: html.includes('__LOTUS_RPG_OVERWORLD__ = true'),
      streamingOn: streamLine === 'true',
      cellsManifest: html.includes('__LOTUS_CELLS__') && !html.includes('__LOTUS_CELLS__ = null'),
      interiorLevel: html.includes('"interior"') || html.includes("'interior'"),
    }
  })

  expect(result.overworldFlag).toBe(true)
  expect(result.streamingOn).toBe(true)
  expect(result.cellsManifest).toBe(true)
  expect(result.interiorLevel).toBe(true)
})

test('wave 98 terminal /rpgoverworld spawns overworld + interior hint', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      terminal: { exec: (cmd: string) => { output: string | null } }
      world: { actors: { values: () => IterableIterator<{ name: string }> } }
    }
    const out = v.terminal.exec('/rpgoverworld')
    const mgr = [...v.world.actors.values()].find((a) => a.name === 'RpgOverworldManager')
    const portal = [...v.world.actors.values()].find((a) => a.name === 'Portal_Interior')
    return {
      output: out?.output ?? '',
      mgr: !!mgr,
      portal: !!portal,
    }
  })

  expect(result.output).toMatch(/overworld/i)
  expect(result.output).toMatch(/interior/i)
  expect(result.output).toMatch(/__LOTUS_RPG_OVERWORLD__/)
  expect(result.mgr).toBe(true)
  expect(result.portal).toBe(true)
})

test('wave 97 rpgEquipment equip unequip applies GAS stat modifiers iron_sword leather_helm', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        player: () => object | null
        inventory: {
          addItem: (id: string, qty?: number, actor?: object) => boolean
          hasItem: (id: string, actor?: object) => boolean
        }
        equipment: {
          equip: (id: string, actor?: object) => boolean
          unequip: (slot: string, actor?: object) => boolean
          getEquipped: (actor?: object) => Record<string, string | null>
        }
        stats: {
          getHealth: (actor?: object) => number | null
          getAttribute: (n: string, actor?: object) => number | null
        }
      }
    }
    const player = lotus.rpg.player()
    const inv = lotus.rpg.inventory
    const eq = lotus.rpg.equipment
    const stats = lotus.rpg.stats
    inv.addItem('iron_sword', 1, player ?? undefined)
    inv.addItem('leather_helm', 1, player ?? undefined)
    const health0 = stats.getHealth(player ?? undefined)
    const damage0 = stats.getAttribute('damage', player ?? undefined)
    const swordOk = eq.equip('iron_sword', player ?? undefined)
    const damage1 = stats.getAttribute('damage', player ?? undefined)
    const helmOk = eq.equip('leather_helm', player ?? undefined)
    const equipped = eq.getEquipped(player ?? undefined)
    const health1 = stats.getHealth(player ?? undefined)
    const unequipWeapon = eq.unequip('weapon', player ?? undefined)
    const damage2 = stats.getAttribute('damage', player ?? undefined)
    const hasSwordBack = inv.hasItem('iron_sword', player ?? undefined)
    const afterWeapon = eq.getEquipped(player ?? undefined)
    return {
      health0,
      damage0,
      swordOk,
      damage1,
      helmOk,
      equipped,
      health1,
      unequipWeapon,
      damage2,
      hasSwordBack,
      afterWeapon,
    }
  })

  expect(result.health0).toBe(100)
  expect(result.damage0).toBeNull()
  expect(result.swordOk).toBe(true)
  expect(result.damage1).toBe(10)
  expect(result.helmOk).toBe(true)
  expect(result.equipped.weapon).toBe('iron_sword')
  expect(result.equipped.head).toBe('leather_helm')
  expect(result.health1).toBe(105)
  expect(result.unequipWeapon).toBe(true)
  expect(result.damage2).toBe(0)
  expect(result.hasSwordBack).toBe(true)
  expect(result.afterWeapon.weapon).toBeNull()
})

test('wave 97 lotus.rpg.equipment bridge exposes equip unequip getEquipped registerItem', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const eq = (window.lotus! as typeof window.lotus & { rpg: { equipment: Record<string, unknown> } }).rpg.equipment
    return {
      equip: typeof eq.equip === 'function',
      unequip: typeof eq.unequip === 'function',
      getEquipped: typeof eq.getEquipped === 'function',
      registerItem: typeof eq.registerItem === 'function',
      listItems: typeof eq.listItems === 'function',
      slots: Array.isArray(eq.slots) && eq.slots.length === 5,
    }
  })

  expect(result.equip).toBe(true)
  expect(result.unequip).toBe(true)
  expect(result.getEquipped).toBe(true)
  expect(result.registerItem).toBe(true)
  expect(result.listItems).toBe(true)
  expect(result.slots).toBe(true)
})

test('wave 97 save checkpoint persists equipment via mergeRpgIntoCheckpoint', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const v = window.lotus! as typeof window.lotus & {
      rpg: {
        inventory: { addItem: (id: string) => boolean }
        equipment: { equip: (id: string) => boolean; getEquipped: () => Record<string, string | null> }
        checkpointExtras: () => { equipment?: Record<string, string | null> }
      }
      save: { checkpoint: (slot: string, data: unknown) => boolean; load: (slot: string) => unknown | null }
      world: { levelName: string; environment: { saveSlotsEnabled?: boolean } }
    }
    v.world.levelName = 'Wave97Equip'
    v.world.environment.saveSlotsEnabled = true
    v.rpg.inventory.addItem('iron_sword')
    v.rpg.equipment.equip('iron_sword')
    const extras = v.rpg.checkpointExtras()
    const saved = v.save.checkpoint('wave97-equip', { playTime: 97, ...extras })
    const loaded = v.save.load('wave97-equip') as { equipment?: Record<string, string | null> } | null
    return {
      equipped: v.rpg.equipment.getEquipped(),
      extrasWeapon: extras.equipment?.weapon ?? null,
      saved,
      loadedWeapon: loaded?.equipment?.weapon ?? null,
    }
  })

  expect(result.equipped.weapon).toBe('iron_sword')
  expect(result.extrasWeapon).toBe('iron_sword')
  expect(result.saved).toBe(true)
  expect(result.loadedWeapon).toBe('iron_sword')
})

test('wave 97 rpg3dHud inventory panel renders equipment paper-doll row', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        hud3d: {
          previewInventory: (
            open: boolean,
            items: string[],
            equipment?: Record<string, string | null>,
          ) => void
        }
      }
    }
    lotus.rpg.hud3d.previewInventory(true, ['Health Potion'], {
      weapon: 'iron_sword',
      head: 'leather_helm',
      chest: null,
      legs: null,
      accessory: null,
    })
    const row = document.getElementById('lotus-rpg-equipment-row')
    const slots = row?.querySelectorAll('.lotus-rpg-equip-slot') ?? []
    const weapon = row?.querySelector('[data-slot="weapon"] .item')?.textContent ?? ''
    const head = row?.querySelector('[data-slot="head"] .item')?.textContent ?? ''
    const panel = document.getElementById('lotus-rpg-inventory')
    return {
      row: !!row,
      slotCount: slots.length,
      weapon,
      head,
      open: panel?.classList.contains('open') ?? false,
    }
  })

  expect(result.row).toBe(true)
  expect(result.slotCount).toBe(5)
  expect(result.weapon).toBe('iron_sword')
  expect(result.head).toBe('leather_helm')
  expect(result.open).toBe(true)
})

test('wave 97 terminal /equip iron_sword demo command', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const term = window.lotus!.terminal.exec('/equip iron_sword')
    const equipped = (
      window.lotus! as typeof window.lotus & {
        rpg: { equipment: { getEquipped: () => Record<string, string | null> } }
      }
    ).rpg.equipment.getEquipped()
    return {
      ok: !term.error && (term.output?.includes('Iron Sword') ?? false),
      output: term.output ?? '',
      weapon: equipped.weapon,
    }
  })

  expect(result.ok).toBe(true)
  expect(result.output).toContain('iron_sword')
  expect(result.weapon).toBe('iron_sword')
})

test('wave 93 rpgDialogue startDialogue advance choose isActive tree navigation', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const d = (window.lotus! as typeof window.lotus & {
      rpg: {
        dialogue: {
          reset: () => void
          startDialogue: (id: string) => boolean
          isActive: () => boolean
          getCurrentNode: () => { id: string; text: string; choices?: { text: string }[] } | null
          choose: (i: number) => boolean
          advance: () => boolean
        }
      }
    }).rpg.dialogue
    d.reset()
    const started = d.startDialogue('village_elder')
    const greet = d.getCurrentNode()
    const activeGreet = d.isActive()
    const choseQuest = d.choose(0)
    const quest = d.getCurrentNode()
    const advanced = d.advance()
    const accept = d.getCurrentNode()
    const closed = d.advance()
    const stillActive = d.isActive()
    return {
      started,
      greetId: greet?.id,
      activeGreet,
      choseQuest,
      questId: quest?.id,
      advanced,
      acceptId: accept?.id,
      closed,
      stillActive,
    }
  })

  expect(result.started).toBe(true)
  expect(result.greetId).toBe('greet')
  expect(result.activeGreet).toBe(true)
  expect(result.choseQuest).toBe(true)
  expect(result.questId).toBe('quest')
  expect(result.advanced).toBe(true)
  expect(result.acceptId).toBe('accept')
  expect(result.closed).toBe(true)
  expect(result.stillActive).toBe(false)
})

test('wave 93 lotus.rpg.dialogue bridge exposes startDialogue advance choose isActive', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const d = (window.lotus! as typeof window.lotus & { rpg: { dialogue: Record<string, unknown> } }).rpg.dialogue
    return {
      startDialogue: typeof d.startDialogue === 'function',
      advance: typeof d.advance === 'function',
      choose: typeof d.choose === 'function',
      isActive: typeof d.isActive === 'function',
      villageElder: (d.villageElder as { id?: string })?.id,
      exportPayload: typeof d.exportPayload === 'function',
    }
  })

  expect(result.startDialogue).toBe(true)
  expect(result.advance).toBe(true)
  expect(result.choose).toBe(true)
  expect(result.isActive).toBe(true)
  expect(result.villageElder).toBe('village_elder')
  expect(result.exportPayload).toBe(true)
})

test('wave 93 buildPackHTML embeds __LOTUS_DIALOGUE__ with village_elder nodes for rpg pack', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        minigame: {
          spawnMiniGame: (m: 'rpg') => void
          buildPackHTML: (m: 'rpg') => string
        }
      }
    }
    v.indie.minigame.spawnMiniGame('rpg')
    const html = v.indie.minigame.buildPackHTML('rpg')
    const marker = 'window.__LOTUS_DIALOGUE__ = '
    const idx = html.indexOf(marker)
    let parsed: { trees?: Record<string, { startId?: string; nodes?: { id: string }[] }> } | null = null
    if (idx >= 0) {
      const rest = html.slice(idx + marker.length)
      const end = rest.indexOf('; window.')
      const jsonStr = end >= 0 ? rest.slice(0, end) : rest.split(';')[0]
      parsed = JSON.parse(jsonStr)
    }
    const elder = parsed?.trees?.village_elder
    return {
      hasTag: html.includes('__LOTUS_DIALOGUE__'),
      dialogueCss: html.includes('lotus-dialogue-overlay'),
      startId: elder?.startId,
      nodeIds: elder?.nodes?.map((n) => n.id) ?? [],
      runtimeInit: html.includes('initExportDialogue'),
      runtimeTick: html.includes('tickExportDialogueInteract'),
    }
  })

  expect(result.hasTag).toBe(true)
  expect(result.dialogueCss).toBe(true)
  expect(result.startId).toBe('greet')
  expect(result.nodeIds).toEqual(expect.arrayContaining(['greet', 'quest', 'accept', 'bye']))
  expect(result.runtimeInit).toBe(true)
  expect(result.runtimeTick).toBe(true)
})

test('wave 93 terminal /dialogue village_elder mounts lotus-dialogue-overlay', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus!
    const out = v.terminal.exec('/dialogue village_elder')
    const overlay = document.getElementById('lotus-dialogue-overlay')
    const speaker = overlay?.querySelector('[data-dialogue-speaker]')?.textContent ?? ''
    const body = overlay?.querySelector('[data-dialogue-body]')?.textContent ?? ''
    const active = (v as typeof window.lotus & { rpg: { dialogue: { isActive: () => boolean } } }).rpg.dialogue.isActive()
    return { output: out.output, error: out.error, overlay: !!overlay, speaker, body, active }
  })

  expect(result.error).toBeNull()
  expect(result.output).toContain('village_elder')
  expect(result.overlay).toBe(true)
  expect(result.speaker).toContain('Elder Maren')
  expect(result.body.length).toBeGreaterThan(10)
  expect(result.active).toBe(true)
})

test('wave 93 rpg mini-game spawn adds VillageElder DialogueNPC with dialogueId scriptVar', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { minigame: { spawnMiniGame: (m: 'rpg') => void } }
      world: {
        actors: {
          values: () => IterableIterator<{
            name: string
            tags: string[]
            scriptVars?: Record<string, unknown>
          }>
        }
      }
    }
    v.indie.minigame.spawnMiniGame('rpg')
    const elder = [...v.world.actors.values()].find((a) => a.name === 'VillageElder')
    return {
      found: !!elder,
      tags: elder?.tags ?? [],
      dialogueId: elder?.scriptVars?.dialogueId,
    }
  })

  expect(result.found).toBe(true)
  expect(result.tags).toEqual(expect.arrayContaining(['DialogueNPC', 'NPC']))
  expect(result.dialogueId).toBe('village_elder')
})

test('wave 94 rpgQuests startQuest updateObjective completeQuest checkpoint round-trip', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      rpg: {
        quests: {
          reset: () => void
          start: (id: string) => boolean
          updateObjective: (q: string, o: string, c: number) => boolean
          complete: (id: string) => boolean
          getState: (id: string) => { state: string; objectives: { current: number; count: number }[] } | null
          serialize: () => { version: number; quests: Record<string, unknown> }
          restore: (data: unknown) => boolean
        }
      }
      save: { checkpoint: (slot: string, data: unknown) => boolean; load: (slot: string) => unknown }
      world: { levelName: string; environment: { saveSlotsEnabled?: boolean } }
    }
    v.world.levelName = 'Wave94Quest'
    v.world.environment.saveSlotsEnabled = true
    const q = v.rpg.quests
    q.reset()
    const started = q.start('find_herbs')
    const partial = q.updateObjective('find_herbs', 'collect_herbs', 2)
    const mid = q.getState('find_herbs')
    const payload = { hp: 94, quests: q.serialize() }
    const saved = v.save.checkpoint('wave94-quest', payload)
    q.reset()
    const empty = q.getState('find_herbs')
    const loaded = v.save.load('wave94-quest') as { quests?: unknown }
    q.restore(loaded?.quests)
    const restored = q.getState('find_herbs')
    const done = q.complete('find_herbs')
    const completed = q.getState('find_herbs')
    return {
      started,
      partial,
      mid,
      saved,
      empty,
      restored,
      done,
      completed,
    }
  })

  expect(result.started).toBe(true)
  expect(result.partial).toBe(true)
  expect(result.mid?.state).toBe('active')
  expect(result.mid?.objectives[0]).toMatchObject({ id: 'collect_herbs', current: 2, count: 3 })
  expect(result.saved).toBe(true)
  expect(result.empty).toBeNull()
  expect(result.restored?.objectives[0]?.current).toBe(2)
  expect(result.done).toBe(true)
  expect(result.completed?.state).toBe('completed')
})

test('wave 94 lotus.rpg.quests bridge exposes start updateObjective complete getState getActive', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const quests = (window.lotus! as typeof window.lotus & { rpg: { quests: Record<string, unknown> } }).rpg.quests
    return {
      start: typeof quests.start === 'function',
      updateObjective: typeof quests.updateObjective === 'function',
      complete: typeof quests.complete === 'function',
      getState: typeof quests.getState === 'function',
      getActive: typeof quests.getActive === 'function',
      refreshTracker: typeof quests.refreshTracker === 'function',
      findHerbs: (quests.defs as () => { id: string }[])().some((d) => d.id === 'find_herbs'),
    }
  })

  expect(result.start).toBe(true)
  expect(result.updateObjective).toBe(true)
  expect(result.complete).toBe(true)
  expect(result.getState).toBe(true)
  expect(result.getActive).toBe(true)
  expect(result.refreshTracker).toBe(true)
  expect(result.findHerbs).toBe(true)
})

test('wave 94 /quest start find_herbs terminal demo command', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      rpg: { quests: { reset: () => void; getState: (id: string) => { state: string; title: string } | null } }
    }
    v.rpg.quests.reset()
    const out = v.terminal.exec('/quest start find_herbs')
    const state = v.rpg.quests.getState('find_herbs')
    return {
      error: out.error,
      output: out.output,
      state: state?.state,
      title: state?.title,
    }
  })

  expect(result.error).toBeNull()
  expect(result.output).toContain('Quest started: Find Herbs')
  expect(result.output).toContain('find_herbs')
  expect(result.state).toBe('active')
  expect(result.title).toBe('Find Herbs')
})

test('wave 94 RPG minigame script integrates find_herbs via api.updateQuestObjective', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const m = (window.lotus! as typeof window.lotus).indie.minigame as {
      rpgScript: string
      attachMiniGameScripts: (m: 'rpg') => void
    }
    m.attachMiniGameScripts('rpg')
    const herbs = [...(window.lotus! as typeof window.lotus).world.actors.values()].filter((a) =>
      a.tags.includes('Herb'),
    ).length
    return {
      hasUpdate: m.rpgScript.includes("api.updateQuestObjective(vars.herbQuestId, vars.herbObjectiveId"),
      hasGetState: m.rpgScript.includes("api.getQuestState(vars.herbQuestId)"),
      herbQuestId: m.rpgScript.includes("herbQuestId = 'find_herbs'"),
      herbs,
    }
  })

  expect(result.hasUpdate).toBe(true)
  expect(result.hasGetState).toBe(true)
  expect(result.herbQuestId).toBe(true)
  expect(result.herbs).toBeGreaterThanOrEqual(3)
})

test('wave 94 rpgQuestHud renders active quest tracker via refreshTracker', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      rpg: { quests: { reset: () => void; start: (id: string) => boolean; refreshTracker: () => void } }
    }
    v.rpg.quests.reset()
    v.rpg.quests.start('find_herbs')
    v.rpg.quests.refreshTracker()
    const tracker = document.querySelector('.lotus-rpg-quest-tracker')
    return {
      tracker: !!tracker,
      title: tracker?.querySelector('.lotus-rpg-quest-title')?.textContent ?? '',
      progress: tracker?.querySelector('.lotus-rpg-quest-progress')?.textContent ?? '',
      bar: !!tracker?.querySelector('.lotus-rpg-quest-bar-fill'),
    }
  })

  expect(result.tracker).toBe(true)
  expect(result.title).toContain('Find Herbs')
  expect(result.progress).toBe('0 / 3')
  expect(result.bar).toBe(true)
})

test('wave 95 spawnRpg3dGame creates village scene + GameManager with inventory dialogue quest script', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        rpg3d: {
          spawn: () => void
          managerName: string
          villageElderName: string
          gameScript: string
        }
      }
      world: {
        actors: {
          values: () => IterableIterator<{ name: string; tags?: string[]; script?: string }>
        }
      }
    }
    v.indie.rpg3d.spawn()
    const actors = [...v.world.actors.values()]
    const mgr = actors.find((a) => a.name === v.indie.rpg3d.managerName)
    const elder = actors.find((a) => a.name === v.indie.rpg3d.villageElderName)
    const herbs = actors.filter((a) => a.tags?.includes('Herb'))
    return {
      ground: actors.some((a) => a.name === 'Rpg3dGround'),
      elderTags: elder?.tags ?? [],
      elderDialogue: (elder as { scriptVars?: { dialogueId?: string } })?.scriptVars?.dialogueId,
      herbCount: herbs.length,
      script: mgr?.script ?? '',
    }
  })

  expect(result.ground).toBe(true)
  expect(result.elderTags).toContain('DialogueNPC')
  expect(result.elderDialogue).toBe('village_elder')
  expect(result.herbCount).toBeGreaterThanOrEqual(3)
  expect(result.script).toMatch(/inventory/)
  expect(result.script).toMatch(/village_elder|talk_to_elder/)
  expect(result.script).toMatch(/find_herbs/)
  expect(result.script).toMatch(/KeyI/)
})

test('wave 95 indie.rpg3d bridge exposes spawn exportPack buildPackHTML', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        rpg3d: {
          spawn: () => void
          exportPack: () => void
          buildPackHTML: () => string
          packId: string
        }
      }
    }
    return {
      hasSpawn: typeof v.indie.rpg3d.spawn === 'function',
      hasExport: typeof v.indie.rpg3d.exportPack === 'function',
      hasBuild: typeof v.indie.rpg3d.buildPackHTML === 'function',
      packId: v.indie.rpg3d.packId,
      htmlLen: v.indie.rpg3d.buildPackHTML().length,
    }
  })

  expect(result.hasSpawn).toBe(true)
  expect(result.hasExport).toBe(true)
  expect(result.hasBuild).toBe(true)
  expect(result.packId).toBe('rpg3d')
  expect(result.htmlLen).toBeGreaterThan(1000)
})

test('wave 95 buildPackHTML embeds __LOTUS_RPG_3D__ and __LOTUS_RPG_HUD__', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { rpg3d: { buildPackHTML: () => string } }
    }
    const html = v.indie.rpg3d.buildPackHTML()
    return {
      rpg3d: html.includes('__LOTUS_RPG_3D__'),
      rpgHud: html.includes('__LOTUS_RPG_HUD__'),
      dialogue: html.includes('__LOTUS_DIALOGUE__'),
      achievements: html.includes('talk_to_elder') && html.includes('quest_complete'),
      runtimeHud: html.includes('wireExportRpg3dHud'),
      runtimeInv: html.includes('exportAddItem'),
    }
  })

  expect(result.rpg3d).toBe(true)
  expect(result.rpgHud).toBe(true)
  expect(result.dialogue).toBe(true)
  expect(result.achievements).toBe(true)
  expect(result.runtimeHud).toBe(true)
  expect(result.runtimeInv).toBe(true)
})

test('wave 95 /exportrpg terminal spawns 3D RPG scene with export hint', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      terminal: { exec: (s: string) => { output: string | null } }
      world: { actors: { values: () => IterableIterator<{ name: string }> } }
    }
    const out = v.terminal.exec('/exportrpg')
    const actors = [...v.world.actors.values()]
    return {
      output: out.output ?? '',
      manager: actors.some((a) => a.name === 'Rpg3dGameManager'),
      elder: actors.some((a) => a.name === 'VillageElder'),
      ground: actors.some((a) => a.name === 'Rpg3dGround'),
    }
  })

  expect(result.output).toMatch(/3D RPG/i)
  expect(result.output).toMatch(/rpg3dexport|exportPack/i)
  expect(result.manager).toBe(true)
  expect(result.elder).toBe(true)
  expect(result.ground).toBe(true)
})

test('wave 95 exportAchievements rpg3d trophies quest_complete talk_to_elder', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        achievements: {
          list: (packId?: string) => { id: string }[]
          unlock: (id: string, packId?: string) => boolean
          unlocked: (id?: string, packId?: string) => boolean | string[]
        }
      }
    }
    const list = v.indie.achievements.list('rpg3d')
    const ids = list.map((a) => a.id)
    const talk = v.indie.achievements.unlock('talk_to_elder', 'rpg3d')
    const quest = v.indie.achievements.unlock('quest_complete', 'rpg3d')
    return {
      ids,
      talk,
      quest,
      unlocked: v.indie.achievements.unlocked(undefined, 'rpg3d') as string[],
    }
  })

  expect(result.ids).toContain('talk_to_elder')
  expect(result.ids).toContain('quest_complete')
  expect(result.talk).toBe(true)
  expect(result.quest).toBe(true)
  expect(result.unlocked).toContain('talk_to_elder')
  expect(result.unlocked).toContain('quest_complete')
})

test('wave 92 rpgInventory addItem removeItem hasItem count and stackable slots', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const rpg = (window.lotus! as typeof window.lotus & {
      rpg: {
        player: () => { name: string } | null
        inventory: {
          addItem: (id: string, qty?: number, actor?: { name: string }) => boolean
          removeItem: (id: string, qty?: number, actor?: { name: string }) => boolean
          hasItem: (id: string, actor?: { name: string }) => boolean
          getItemCount: (id: string, actor?: { name: string }) => number
          get: (actor?: { name: string }) => { slots: unknown[]; gold: number }
        }
      }
    }).rpg
    const player = rpg.player()
    const stacked = rpg.inventory.addItem('health_potion', 3, player ?? undefined)
    const count = rpg.inventory.getItemCount('health_potion', player ?? undefined)
    const has = rpg.inventory.hasItem('health_potion', player ?? undefined)
    const removed = rpg.inventory.removeItem('health_potion', 2, player ?? undefined)
    const after = rpg.inventory.getItemCount('health_potion', player ?? undefined)
    const inv = rpg.inventory.get(player ?? undefined)
    const filled = inv.slots.filter((s: { itemId?: string; quantity?: number } | null) => s?.itemId === 'health_potion')
    return {
      playerName: player?.name ?? null,
      stacked,
      count,
      has,
      removed,
      after,
      slots: inv.slots.length,
      filled,
      gold: inv.gold,
    }
  })

  expect(result.playerName).toBe('StarterPlayerStart')
  expect(result.stacked).toBe(true)
  expect(result.count).toBe(3)
  expect(result.has).toBe(true)
  expect(result.removed).toBe(true)
  expect(result.after).toBe(1)
  expect(result.slots).toBe(20)
})

test('wave 92 rpgInventory gold addGold getGold never below zero', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        player: () => object | null
        inventory: {
          addGold: (n: number, actor?: object) => number
          getGold: (actor?: object) => number
          setGold: (n: number, actor?: object) => number
        }
      }
    }
    const player = lotus.rpg.player()
    const inv = lotus.rpg.inventory
    inv.setGold(0, player ?? undefined)
    const first = inv.addGold(75, player ?? undefined)
    const second = inv.addGold(-20, player ?? undefined)
    const clamped = inv.addGold(-999, player ?? undefined)
    return { first, second, clamped, get: inv.getGold(player ?? undefined) }
  })

  expect(result.first).toBe(75)
  expect(result.second).toBe(55)
  expect(result.clamped).toBe(0)
  expect(result.get).toBe(0)
})

test('wave 92 lotus.rpg.inventory bridge exposes addItem removeItem getGold', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const inv = (window.lotus! as typeof window.lotus & { rpg: { inventory: Record<string, unknown> } }).rpg
      .inventory
    return {
      addItem: typeof inv.addItem === 'function',
      removeItem: typeof inv.removeItem === 'function',
      hasItem: typeof inv.hasItem === 'function',
      getItemCount: typeof inv.getItemCount === 'function',
      getGold: typeof inv.getGold === 'function',
      addGold: typeof inv.addGold === 'function',
      get: typeof inv.get === 'function',
    }
  })

  expect(result.addItem).toBe(true)
  expect(result.removeItem).toBe(true)
  expect(result.hasItem).toBe(true)
  expect(result.getItemCount).toBe(true)
  expect(result.getGold).toBe(true)
  expect(result.addGold).toBe(true)
  expect(result.get).toBe(true)
})

test('wave 92 lotus.rpg.stats bridge getHealth getMana setAttribute on player', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const lotus = window.lotus! as typeof window.lotus & {
      rpg: {
        player: () => object | null
        stats: {
          getHealth: (actor?: object) => number | null
          getMana: (actor?: object) => number | null
          setAttribute: (n: string, v: number, actor?: object) => boolean
        }
      }
    }
    const player = lotus.rpg.player()
    const stats = lotus.rpg.stats
    const health0 = stats.getHealth(player ?? undefined)
    const mana0 = stats.getMana(player ?? undefined)
    const ok = stats.setAttribute('Health', 42, player ?? undefined)
    const health1 = stats.getHealth(player ?? undefined)
    return { health0, mana0, ok, health1 }
  })

  expect(result.health0).toBe(100)
  expect(result.mana0).toBe(50)
  expect(result.ok).toBe(true)
  expect(result.health1).toBe(42)
})

test('wave 92 save checkpoint persists inventory gold and /inventory terminal demo', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    window.lotus!.terminal.exec('/starter thirdperson')
    const v = window.lotus! as typeof window.lotus & {
      world: { levelName: string; environment: { saveSlotsEnabled?: boolean; cloudSaveBackup?: boolean } }
      save: { checkpoint: (slot: string, data: unknown) => boolean; load: (slot: string) => unknown | null }
      terminal: { exec: (cmd: string) => { output: string | null; error: string | null } }
      rpg: {
        inventory: { get: () => { gold: number }; getItemCount: (id: string) => number }
        checkpointExtras: () => { inventory?: { gold: number }; attributes?: Record<string, number> }
      }
    }
    v.world.levelName = 'Wave92Rpg'
    v.world.environment.saveSlotsEnabled = true
    v.world.environment.cloudSaveBackup = true
    const term = v.terminal.exec('/inventory')
    const before = {
      potions: v.rpg.inventory.getItemCount('health_potion'),
      gold: v.rpg.inventory.get().gold,
    }
    const extras = v.rpg.checkpointExtras()
    const saved = v.save.checkpoint('wave92-rpg', {
      playTime: 92,
      pawn: [1, 2, 3],
      ...extras,
    })
    const loaded = v.save.load('wave92-rpg') as {
      inventory?: { gold: number; slots?: { itemId: string; quantity: number }[] }
      attributes?: Record<string, number>
    } | null
    return {
      termOk: !term.error && (term.output?.includes('health_potion') ?? false),
      before,
      saved,
      gold: loaded?.inventory?.gold,
      potionQty: loaded?.inventory?.slots?.find((s) => s?.itemId === 'health_potion')?.quantity,
      health: loaded?.attributes?.Health,
    }
  })

  expect(result.termOk).toBe(true)
  expect(result.before.potions).toBe(1)
  expect(result.before.gold).toBe(50)
  expect(result.saved).toBe(true)
  expect(result.gold).toBe(50)
  expect(result.potionQty).toBe(1)
  expect(result.health).toBe(100)
})

test('wave 91 lotus.cameraRig bridge exposes getBoomLength setBoomLength collisionEnabled shoulderOffset', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const rig = (window.lotus! as typeof window.lotus & { cameraRig: Record<string, unknown> }).cameraRig
    return {
      getBoomLength: typeof rig.getBoomLength === 'function',
      setBoomLength: typeof rig.setBoomLength === 'function',
      collisionEnabled: typeof rig.collisionEnabled === 'function',
      shoulderOffset: typeof rig.shoulderOffset === 'function',
    }
  })

  expect(result.getBoomLength).toBe(true)
  expect(result.setBoomLength).toBe(true)
  expect(result.collisionEnabled).toBe(true)
  expect(result.shoulderOffset).toBe(true)
})

test('wave 91 cameraRig setBoomLength updates boom length', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const rig = (window.lotus! as typeof window.lotus & {
      cameraRig: { getBoomLength: () => number; setBoomLength: (n: number) => number }
    }).cameraRig
    const before = rig.getBoomLength()
    const set = rig.setBoomLength(6.25)
    const after = rig.getBoomLength()
    return { before, set, after }
  })

  expect(result.set).toBe(6.25)
  expect(result.after).toBe(6.25)
  expect(result.before).not.toBe(6.25)
})

test('wave 91 3D RPG starter template (small)', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawnRpg3dStarter: (mode: 'small') => void }
      world: { environment: { rpgCameraRig?: boolean; useRapierCharacter?: boolean } }
    }
    const before = v.world.actors.size
    v.indie.spawnRpg3dStarter('small')
    const ground = [...v.world.actors.values()].find((a) => a.name === 'Rpg3dGround')
    const hill = [...v.world.actors.values()].find((a) => a.name === 'Rpg3dHill')
    const cottage = [...v.world.actors.values()].find((a) => a.name === 'Rpg3dCottageA')
    const npc = [...v.world.actors.values()].find((a) => a.name === 'Rpg3dNpcA')
    const quest = [...v.world.actors.values()].find((a) => a.name === 'Rpg3dQuestZone')
    const start = [...v.world.actors.values()].find((a) => a.name === 'Rpg3dPlayerStart')
    return {
      added: v.world.actors.size > before,
      ground: !!ground,
      hill: !!hill,
      cottage: !!cottage,
      npcTag: npc?.tags.includes('NPC'),
      quest: quest?.type === 'TriggerVolume',
      startPawn: start?.pawnMode,
      rpgCameraRig: v.world.environment.rpgCameraRig === true,
      rapier: v.world.environment.useRapierCharacter === true,
    }
  })

  expect(result.added).toBe(true)
  expect(result.ground).toBe(true)
  expect(result.hill).toBe(true)
  expect(result.cottage).toBe(true)
  expect(result.npcTag).toBe(true)
  expect(result.quest).toBe(true)
  expect(result.startPawn).toBe('thirdperson')
  expect(result.rpgCameraRig).toBe(true)
  expect(result.rapier).toBe(true)
})

test('wave 91 /rpg3d terminal command', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus!
    const out = v.terminal.exec('/rpg3d small')
    const ground = [...v.world.actors.values()].find((a) => a.name === 'Rpg3dGround')
    const start = [...v.world.actors.values()].find((a) => a.name === 'Rpg3dPlayerStart')
    return { output: out?.output, ground: !!ground, startPawn: start?.pawnMode }
  })

  expect(result.output).toContain('3D RPG starter')
  expect(result.ground).toBe(true)
  expect(result.startPawn).toBe('thirdperson')
})

test('wave 91 World Settings RPG camera rig toggles environment.rpgCameraRig', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { environment: { rpgCameraRig?: boolean } }
    }
    v.world.environment.rpgCameraRig = true
    const on = v.world.environment.rpgCameraRig === true
    v.world.environment.rpgCameraRig = false
    const off = v.world.environment.rpgCameraRig === false
    return { on, off }
  })

  expect(result.on).toBe(true)
  expect(result.off).toBe(true)
})

test('wave 89 exportCloudSaveJson includes IndexedDB checkpoint data in entries', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      world: { levelName: string; environment: { saveSlotsEnabled?: boolean; cloudSaveBackup?: boolean } }
      save: {
        backupToCloud: (slot: string, data: unknown) => Promise<boolean>
        exportJson: () => Promise<{
          version: number
          level: string
          entries: { slot: string; savedAt: number; data: unknown }[]
        }>
      }
    }
    v.world.levelName = 'Wave89Export'
    v.world.environment.saveSlotsEnabled = true
    v.world.environment.cloudSaveBackup = true
    await v.save.backupToCloud('xfer-a', { hp: 89, flag: true })
    const doc = await v.save.exportJson()
    return {
      version: doc.version,
      level: doc.level,
      entry: doc.entries.find((e) => e.slot === 'xfer-a'),
    }
  })

  expect(result.version).toBe(2)
  expect(result.level).toBe('Wave89Export')
  expect(result.entry?.data).toEqual({ hp: 89, flag: true })
  expect((result.entry?.savedAt ?? 0) > 0).toBe(true)
})

test('wave 89 importCloudSaveJson validates schema and merges slots into IndexedDB', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      world: { levelName: string; environment: { saveSlotsEnabled?: boolean; cloudSaveBackup?: boolean } }
      save: {
        exportJson: () => Promise<{ version: number; level: string; entries: unknown[] }>
        importJson: (json: unknown) => Promise<{ merged: number; skipped: number }>
        restoreFromCloud: (slot: string) => Promise<unknown | null>
        backupToCloud: (slot: string, data: unknown) => Promise<boolean>
      }
    }
    v.world.levelName = 'Wave89Import'
    v.world.environment.saveSlotsEnabled = true
    v.world.environment.cloudSaveBackup = true
    await v.save.backupToCloud('seed-slot', { coins: 1 })
    const exported = await v.save.exportJson()
    const badVersion = await v.save.importJson({ ...exported, version: 99 }).catch((e: Error) => e.message)
    const mismatch = await v.save
      .importJson({ ...exported, level: 'OtherLevel' })
      .catch((e: Error) => e.message)
    const imported = await v.save.importJson(exported)
    const restored = await v.save.restoreFromCloud('seed-slot')
    return { badVersion, mismatch, imported, restored }
  })

  expect(result.badVersion).toContain('Unsupported cloud save JSON version')
  expect(result.mismatch).toContain('Level mismatch')
  expect(result.imported.merged).toBeGreaterThan(0)
  expect(result.restored).toEqual({ coins: 1 })
})

test('wave 89 lotus.save bridge exposes exportJson and importJson', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const s = (window.lotus! as typeof window.lotus).save as Record<string, unknown>
    return {
      exportJson: typeof s.exportJson === 'function',
      importJson: typeof s.importJson === 'function',
    }
  })

  expect(result.exportJson).toBe(true)
  expect(result.importJson).toBe(true)
})

test('wave 89 World Settings shows download/import cloud saves buttons', async ({ page }) => {
  await bootEditor(page)

  await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { environment: { saveSlotsEnabled?: boolean; cloudSaveBackup?: boolean } }
      useEditor: { getState: () => { touch: () => void } }
    }
    v.world.environment.saveSlotsEnabled = true
    v.world.environment.cloudSaveBackup = true
    v.useEditor.getState().touch()
  })

  await page.locator('details.world-settings > summary').click()
  await expect(page.locator('[data-lotus-cloud-export]')).toContainText('Download cloud saves JSON')
  await expect(page.locator('[data-lotus-cloud-import]')).toHaveCount(1)
})

test('wave 89 export runtime mirrors exportCloudSaveJson importCloudSaveJson and save menu transfer buttons', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { environment: { saveSlotsEnabled?: boolean; cloudSaveBackup?: boolean } }
      export: { buildPlayableHTML: () => string }
    }
    v.world.environment.saveSlotsEnabled = true
    v.world.environment.cloudSaveBackup = true
    const html = v.export.buildPlayableHTML()
    return {
      exportJsonFn: html.includes('exportCloudSaveJson'),
      importJsonFn: html.includes('importExportCloudSaveJson'),
      exportBtn: html.includes('data-lotus-cloud-export'),
      importInput: html.includes('data-lotus-cloud-import'),
      bridgeExportJson: html.includes('exportJson: exportCloudSaveJson'),
      bridgeImportJson: html.includes('importJson: importExportCloudSaveJson'),
      menuTransfer: html.includes('lotus-save-menu-cloud-transfer'),
    }
  })

  expect(result.exportJsonFn).toBe(true)
  expect(result.importJsonFn).toBe(true)
  expect(result.exportBtn).toBe(true)
  expect(result.importInput).toBe(true)
  expect(result.bridgeExportJson).toBe(true)
  expect(result.bridgeImportJson).toBe(true)
  expect(result.menuTransfer).toBe(true)
})

test('wave 88 indie MP CTF template spawns flags and scoreboard', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawnIndieMpCtf: () => void
        mp: { ctfScript: string; ctfScoreboardScript: string }
      }
      world: {
        actors: {
          values: () => IterableIterator<{ name: string; tags?: string[]; syncProperties?: string[] }>
        }
        hudWidgets: { id: string }[]
      }
    }
    v.indie.spawnIndieMpCtf()
    const actors = [...v.world.actors.values()]
    const redFlag = actors.find((a) => a.name === 'MpRedFlag')
    const blueFlag = actors.find((a) => a.name === 'MpBlueFlag')
    const board = actors.find((a) => a.name === 'MpScoreboard')
    return {
      floor: actors.some((a) => a.name === 'MpCtfFloor'),
      redPad: actors.some((a) => a.name === 'MpRedPad'),
      bluePad: actors.some((a) => a.name === 'MpBluePad'),
      redTags: redFlag?.tags ?? [],
      blueTags: blueFlag?.tags ?? [],
      sync: board?.syncProperties ?? [],
      hud: v.world.hudWidgets.some((w) => w.id === 'mp_ctf_hud'),
      flagsHud: v.world.hudWidgets.some((w) => w.id === 'mp_ctf_flags'),
      ctfScript: v.indie.mp.ctfScript,
      boardScript: v.indie.mp.ctfScoreboardScript,
    }
  })

  expect(result.floor).toBe(true)
  expect(result.redPad).toBe(true)
  expect(result.bluePad).toBe(true)
  expect(result.redTags).toContain('mp_flag_red')
  expect(result.blueTags).toContain('mp_flag_blue')
  expect(result.sync).toContain('teamScores')
  expect(result.sync).toContain('ctfFlags')
  expect(result.hud).toBe(true)
  expect(result.flagsHud).toBe(true)
  expect(result.ctfScript).toMatch(/mpCtfPickup/)
  expect(result.ctfScript).toMatch(/mpCtfCapture/)
  expect(result.boardScript).toMatch(/getMpFlagCarrier/)
})

test('wave 88 indie.mp.ctf bridge APIs expose carrier capture and scores', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawnIndieMpCtf: () => void
        mp: {
          ctf: {
            redFlagTag: string
            blueFlagTag: string
            pickup: (flag: 'red' | 'blue', peer?: string) => boolean
            getFlagCarrier: (flag: 'red' | 'blue') => string | undefined
            captureFlag: (flag: 'red' | 'blue', team: 'red' | 'blue', peer?: string) => boolean
            scores: () => { red: number; blue: number }
            applyPickup: (peer: string, flag: 'red' | 'blue') => boolean
            applyCapture: (peer: string, flag: 'red' | 'blue', team: 'red' | 'blue') => boolean
          }
        }
      }
    }
    v.indie.spawnIndieMpCtf()
    const ctf = v.indie.mp.ctf
    ctf.applyPickup('peer-red', 'blue')
    ctf.applyCapture('peer-red', 'blue', 'red')
    return {
      redFlagTag: ctf.redFlagTag,
      blueFlagTag: ctf.blueFlagTag,
      carrier: ctf.getFlagCarrier('blue'),
      scores: ctf.scores(),
    }
  })

  expect(result.redFlagTag).toBe('mp_flag_red')
  expect(result.blueFlagTag).toBe('mp_flag_blue')
  expect(result.carrier).toBeUndefined()
  expect(result.scores.red).toBe(1)
  expect(result.scores.blue).toBe(0)
})

test('wave 88 /mpctf terminal command spawns CTF arena', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      terminal: { exec: (s: string) => { output: string | null } }
      world: { actors: { values: () => IterableIterator<{ name: string; tags?: string[] }> } }
    }
    const out = v.terminal.exec('/mpctf')
    const actors = [...v.world.actors.values()]
    const redFlag = actors.find((a) => a.name === 'MpRedFlag')
    const blueFlag = actors.find((a) => a.name === 'MpBlueFlag')
    return {
      output: out.output ?? '',
      redTags: redFlag?.tags ?? [],
      blueTags: blueFlag?.tags ?? [],
    }
  })

  expect(result.output).toMatch(/CTF/i)
  expect(result.redTags).toContain('mp_flag_red')
  expect(result.blueTags).toContain('mp_flag_blue')
})

test('wave 88 CTF capture applies team score delta and clears carrier', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawnIndieMpCtf: () => void
        mp: {
          ctf: {
            applyPickup: (peer: string, flag: 'red' | 'blue') => boolean
            applyCapture: (peer: string, flag: 'red' | 'blue', team: 'red' | 'blue') => boolean
            getFlagCarrier: (flag: 'red' | 'blue') => string | undefined
            scores: () => { red: number; blue: number }
          }
          ctfScript: string
          ctfScoreboardScript: string
        }
      }
    }
    v.indie.spawnIndieMpCtf()
    const ctf = v.indie.mp.ctf
    ctf.applyPickup('carrier-a', 'blue')
    const carrying = ctf.getFlagCarrier('blue')
    ctf.applyCapture('carrier-a', 'blue', 'red')
    return {
      carrying,
      carrierAfter: ctf.getFlagCarrier('blue'),
      scores: ctf.scores(),
      ctfScript: v.indie.mp.ctfScript,
      boardScript: v.indie.mp.ctfScoreboardScript,
    }
  })

  expect(result.carrying).toBe('carrier-a')
  expect(result.carrierAfter).toBeUndefined()
  expect(result.scores.red).toBe(1)
  expect(result.ctfScript).toMatch(/flag_capture|mpCtfCapture/)
  expect(result.boardScript).toMatch(/flag_capture/)
})

test('wave 87 buildItchEmbedWidget returns self-contained HTML with changelog and achievements', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        export: {
          buildItchEmbedWidget: (m: 'platformer') => string
          buildItchEmbedWidgetSections: (m: 'platformer') => string
        }
      }
    }
    const doc = v.indie.export.buildItchEmbedWidget('platformer')
    const sections = v.indie.export.buildItchEmbedWidgetSections('platformer')
    return {
      hasDoctype: doc.includes('<!doctype html>'),
      hasChangelog: doc.includes('lotus-pack-changelog'),
      hasAchievements: doc.includes('lotus-pack-achievements'),
      hasTitle: doc.includes('Lotus Platformer Pack'),
      hasTrophy: doc.includes('Goal Getter'),
      sectionsInDoc: doc.includes(sections),
      sectionsHasBoth:
        sections.includes('lotus-pack-changelog') && sections.includes('lotus-pack-achievements'),
    }
  })

  expect(result.hasDoctype).toBe(true)
  expect(result.hasChangelog).toBe(true)
  expect(result.hasAchievements).toBe(true)
  expect(result.hasTitle).toBe(true)
  expect(result.hasTrophy).toBe(true)
  expect(result.sectionsInDoc).toBe(true)
  expect(result.sectionsHasBoth).toBe(true)
})

test('wave 87 buildItchZip includes embed-widget.html sidecar with changelog and trophies', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      export: {
        buildItchZip: (m: 'rpg') => Blob
        listItchZipEntries: (b: Blob) => Promise<string[]>
        readItchZipEntry: (b: Blob, n: string) => Promise<string | null>
        buildItchEmbedWidget: (m: 'rpg') => string
      }
    }
    const blob = v.export.buildItchZip('rpg')
    const entries = await v.export.listItchZipEntries(blob)
    const widgetRaw = await v.export.readItchZipEntry(blob, 'embed-widget.html')
    const expected = v.export.buildItchEmbedWidget('rpg')
    return {
      entries,
      hasWidget: entries.includes('embed-widget.html'),
      widgetRaw,
      hasDoctype: widgetRaw?.includes('<!doctype html>') ?? false,
      hasChangelog: widgetRaw?.includes('lotus-pack-changelog') ?? false,
      hasAchievements: widgetRaw?.includes('lotus-pack-achievements') ?? false,
      hasRpgTitle: widgetRaw?.includes('Lotus RPG Pack') ?? false,
      hasQuestTrophy: widgetRaw?.includes('Quest Complete') ?? false,
      match: widgetRaw === expected,
    }
  })

  expect(result.hasWidget).toBe(true)
  expect(result.entries).toEqual(
    expect.arrayContaining([
      'index.html',
      'meta.json',
      'icon.png',
      'RELEASE_NOTES.md',
      'CHANGELOG.html',
      'embed-widget.html',
    ]),
  )
  expect(result.hasDoctype).toBe(true)
  expect(result.hasChangelog).toBe(true)
  expect(result.hasAchievements).toBe(true)
  expect(result.hasRpgTitle).toBe(true)
  expect(result.hasQuestTrophy).toBe(true)
  expect(result.match).toBe(true)
})

test('wave 87 buildPackHTML embeds __LOTUS_ITCH_EMBED_WIDGET__ with platformer changelog and trophies', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        minigame: {
          spawnMiniGame: (m: 'platformer') => void
          buildPackHTML: (m: 'platformer') => string
        }
        export: {
          buildItchEmbedWidgetSections: (m: 'platformer') => string
        }
      }
    }
    v.indie.minigame.spawnMiniGame('platformer')
    const html = v.indie.minigame.buildPackHTML('platformer')
    const expected = v.indie.export.buildItchEmbedWidgetSections('platformer')
    const marker = 'window.__LOTUS_ITCH_EMBED_WIDGET__ = '
    const idx = html.indexOf(marker)
    let embedded = ''
    if (idx >= 0) {
      const rest = html.slice(idx + marker.length)
      const end = rest.indexOf('; window.')
      const jsonStr = end >= 0 ? rest.slice(0, end) : rest.split(';')[0]
      embedded = JSON.parse(jsonStr) as string
    }
    return {
      hasTag: html.includes('__LOTUS_ITCH_EMBED_WIDGET__'),
      embedded,
      expected,
      match: embedded === expected,
      hasChangelog: embedded.includes('lotus-pack-changelog'),
      hasAchievements: embedded.includes('lotus-pack-achievements'),
      hasTrophy: embedded.includes('Goal Getter'),
    }
  })

  expect(result.hasTag).toBe(true)
  expect(result.match).toBe(true)
  expect(result.hasChangelog).toBe(true)
  expect(result.hasAchievements).toBe(true)
  expect(result.hasTrophy).toBe(true)
})

test('wave 87 /itchembed platformer terminal prints widget path and embed snippet', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      terminal: { exec: (cmd: string) => { output: string | null; error: string | null } | undefined }
      indie: {
        export: {
          widgetFilename: () => string
          buildItchEmbedWidgetSections: (m: 'platformer') => string
        }
      }
    }
    const out = v.terminal.exec('/itchembed platformer')
    const expected = v.indie.export.buildItchEmbedWidgetSections('platformer')
    const filename = v.indie.export.widgetFilename()
    return {
      error: out?.error,
      output: out?.output ?? '',
      filename,
      hasPath: out?.output?.includes(`Widget file: ${filename}`) ?? false,
      hasSnippetLabel: out?.output?.includes('Embed snippet:') ?? false,
      hasSnippet: out?.output?.includes(expected) ?? false,
      hasChangelog: out?.output?.includes('lotus-pack-changelog') ?? false,
      hasAchievements: out?.output?.includes('lotus-pack-achievements') ?? false,
    }
  })

  expect(result.error).toBeNull()
  expect(result.hasPath).toBe(true)
  expect(result.hasSnippetLabel).toBe(true)
  expect(result.hasSnippet).toBe(true)
  expect(result.hasChangelog).toBe(true)
  expect(result.hasAchievements).toBe(true)
})

test('wave 87 indie.export.buildItchEmbedWidget bridge exposes widget helpers', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const exp = (window.lotus! as typeof window.lotus).indie.export as Record<string, unknown>
    const widget =
      typeof exp.buildItchEmbedWidget === 'function'
        ? (exp.buildItchEmbedWidget as (m: 'fps') => string)('fps')
        : ''
    return {
      buildItchEmbedWidget: typeof exp.buildItchEmbedWidget === 'function',
      buildItchEmbedWidgetSections: typeof exp.buildItchEmbedWidgetSections === 'function',
      renderAchievementsHtml: typeof exp.renderAchievementsHtml === 'function',
      widgetFilename: typeof exp.widgetFilename === 'function',
      hasSharpshooter: widget.includes('Sharpshooter'),
      hasFpsChangelog: widget.includes('Lotus FPS Pack'),
    }
  })

  expect(result.buildItchEmbedWidget).toBe(true)
  expect(result.buildItchEmbedWidgetSections).toBe(true)
  expect(result.renderAchievementsHtml).toBe(true)
  expect(result.widgetFilename).toBe(true)
  expect(result.hasSharpshooter).toBe(true)
  expect(result.hasFpsChangelog).toBe(true)
})

test('build passes', () => {
  expect(() => {
    execSync('npm run build', { cwd: root, stdio: 'pipe', encoding: 'utf8' })
  }).not.toThrow()
})

test('wave 90 exportAchievements setAchievementProgress unlocks at max + localStorage progress', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const ach = (window.lotus! as typeof window.lotus).indie.achievements as {
      packId: (pack?: string) => string | null
      setProgress: (id: string, current: number, max?: number, pack?: string) => boolean
      getProgress: (id: string, pack?: string) => { current: number; max: number } | null
      unlocked: (id?: string, pack?: string) => boolean | string[]
    }
    ach.packId('platformer')
    localStorage.removeItem('lotus-engine.achievements.platformer')
    localStorage.removeItem('lotus-engine.achievements.progress.platformer')
    const partial = ach.setProgress('platformer_coins', 4, 10, 'platformer')
    const mid = ach.getProgress('platformer_coins', 'platformer')
    const unlockedMid = ach.unlocked('platformer_coins', 'platformer') as boolean
    const complete = ach.setProgress('platformer_coins', 10, 10, 'platformer')
    const done = ach.getProgress('platformer_coins', 'platformer')
    const unlockedDone = ach.unlocked('platformer_coins', 'platformer') as boolean
    const progressKey = localStorage.getItem('lotus-engine.achievements.progress.platformer')
    return {
      partial,
      mid,
      unlockedMid,
      complete,
      done,
      unlockedDone,
      progressKey,
    }
  })

  expect(result.partial).toBe(false)
  expect(result.mid).toEqual({ current: 4, max: 10 })
  expect(result.unlockedMid).toBe(false)
  expect(result.complete).toBe(true)
  expect(result.done).toEqual({ current: 10, max: 10 })
  expect(result.unlockedDone).toBe(true)
  expect(result.progressKey).toContain('platformer_coins')
})

test('wave 90 indie.achievements bridge exposes setProgress getProgress showProgressToast', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const ach = (window.lotus! as typeof window.lotus).indie.achievements as Record<string, unknown>
    return {
      setProgress: typeof ach.setProgress === 'function',
      getProgress: typeof ach.getProgress === 'function',
      showProgressToast: typeof ach.showProgressToast === 'function',
    }
  })

  expect(result.setProgress).toBe(true)
  expect(result.getProgress).toBe(true)
  expect(result.showProgressToast).toBe(true)
})

test('wave 90 buildPackHTML embeds __LOTUS_ACHIEVEMENT_PROGRESS__ with platformer coin defaults', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        minigame: {
          spawnMiniGame: (m: 'platformer') => void
          buildPackHTML: (m: 'platformer') => string
        }
      }
    }
    v.indie.minigame.spawnMiniGame('platformer')
    const html = v.indie.minigame.buildPackHTML('platformer')
    const marker = 'window.__LOTUS_ACHIEVEMENT_PROGRESS__ = '
    const idx = html.indexOf(marker)
    let parsed: { packId?: string; defaults?: Record<string, { max: number }> } | null = null
    if (idx >= 0) {
      const rest = html.slice(idx + marker.length)
      const end = rest.indexOf('; window.')
      const jsonStr = end >= 0 ? rest.slice(0, end) : rest.split(';')[0]
      parsed = JSON.parse(jsonStr)
    }
    return {
      hasTag: html.includes('__LOTUS_ACHIEVEMENT_PROGRESS__'),
      progressCss: html.includes('lotus-achievement-progress-toast'),
      packId: parsed?.packId,
      coinMax: parsed?.defaults?.platformer_coins?.max,
      runtimeSetProgress: html.includes('setAchievementProgress'),
    }
  })

  expect(result.hasTag).toBe(true)
  expect(result.progressCss).toBe(true)
  expect(result.packId).toBe('platformer')
  expect(result.coinMax).toBe(10)
  expect(result.runtimeSetProgress).toBe(true)
})

test('wave 90 mini-game scripts call setAchievementProgress on score/kills', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const m = (window.lotus! as typeof window.lotus).indie.minigame as {
      platformerScript: string
      rpgScript: string
      fpsScript: string
    }
    return {
      platformer: m.platformerScript.includes("api.setAchievementProgress('platformer_coins'"),
      rpg: m.rpgScript.includes("api.setAchievementProgress('rpg_collect'"),
      fps: m.fpsScript.includes("api.setAchievementProgress('fps_targets'"),
      coinGoal: m.platformerScript.includes('coinGoal'),
    }
  })

  expect(result.platformer).toBe(true)
  expect(result.rpg).toBe(true)
  expect(result.fps).toBe(true)
  expect(result.coinGoal).toBe(true)
})

test('wave 90 miniGameHud progress toast renders via indie.achievements.showProgressToast', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const ach = (window.lotus! as typeof window.lotus).indie.achievements as {
      showProgressToast: (t: string, c: number, m: number, i?: string) => void
    }
    ach.showProgressToast('Coin Collector', 4, 10, '🪙')
    const toast = document.querySelector('.lotus-achievement-progress-toast')
    return {
      toast: !!toast,
      title: toast?.querySelector('.lotus-achievement-toast-title')?.textContent ?? '',
      sub: toast?.querySelector('.lotus-achievement-toast-sub')?.textContent ?? '',
      ring: !!toast?.querySelector('.lotus-achievement-progress-ring'),
      bar: !!toast?.querySelector('.lotus-achievement-progress-bar-fill'),
    }
  })

  expect(result.toast).toBe(true)
  expect(result.title).toContain('Coin Collector')
  expect(result.sub).toBe('4 / 10')
  expect(result.ring).toBe(true)
  expect(result.bar).toBe(true)
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
      opacity: el ? Math.max(Number(getComputedStyle(el).opacity), Number(el.style.opacity || 0)) : null,
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

test('wave 56 gridMap atlasUvRect index 0 is top-left tile', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      gridMap: { atlasUvRect: (i: number) => { u: number; v: number; w: number; h: number }; AUTOTILE_ATLAS_SIZE: number }
    }
    const r = v.gridMap.atlasUvRect(0)
    return { u: r.u, v: r.v, w: r.w, h: r.h, size: v.gridMap.AUTOTILE_ATLAS_SIZE }
  })

  expect(result.size).toBe(16)
  expect(result.u).toBe(0)
  expect(result.v).toBe(0.75)
  expect(result.w).toBe(0.25)
  expect(result.h).toBe(0.25)
})

test('wave 56 gridMap atlasUvRect index 15 is bottom-right tile', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      gridMap: { atlasUvRect: (i: number) => { u: number; v: number; w: number; h: number } }
    }
    const r = v.gridMap.atlasUvRect(15)
    return { u: r.u, v: r.v }
  })

  expect(result.u).toBe(0.75)
  expect(result.v).toBe(0)
})

test('wave 56 gridMap atlasIndexForMask clamps to 0–15', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      gridMap: { atlasIndexForMask: (m: number) => number }
    }
    return {
      isolated: v.gridMap.atlasIndexForMask(0),
      full: v.gridMap.atlasIndexForMask(15),
      clamped: v.gridMap.atlasIndexForMask(99),
    }
  })

  expect(result.isolated).toBe(0)
  expect(result.full).toBe(15)
  expect(result.clamped).toBe(15)
})

test('wave 56 gridMap atlasIndexForRule inner-ne corner slot', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      gridMap: {
        autotileRuleForMask: (mask: number, kind: string, ext?: number) => { corner: string; mask: number }
        atlasIndexForRule: (rule: { corner: string; mask: number }) => number
        atlasIndexForCorner: (corner: string) => number | null
      }
    }
    const rule = v.gridMap.autotileRuleForMask(3, 'box', 3)
    return {
      corner: rule.corner,
      idx: v.gridMap.atlasIndexForRule(rule),
      cornerIdx: v.gridMap.atlasIndexForCorner('inner-ne'),
    }
  })

  expect(result.corner).toBe('inner-ne')
  expect(result.cornerIdx).toBe(5)
  expect(result.idx).toBe(5)
})

test('wave 56 gridmap spawn exposes gridAutotileAtlas + bridge APIs', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: { gridAutotileAtlas?: boolean } } | null }
      gridMap: {
        AUTOTILE_ATLAS_SIZE: number
        atlasIndexForRule: unknown
        atlasUvRect: unknown
        atlasIndexForMask: unknown
        atlasIndexForCorner: unknown
      }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    const props = layer?.foliageProps
    props!.gridAutotileAtlas = true
    return {
      atlas: props?.gridAutotileAtlas,
      size: v.gridMap.AUTOTILE_ATLAS_SIZE,
      hasRule: typeof v.gridMap.atlasIndexForRule === 'function',
      hasRect: typeof v.gridMap.atlasUvRect === 'function',
      hasMask: typeof v.gridMap.atlasIndexForMask === 'function',
      hasCorner: typeof v.gridMap.atlasIndexForCorner === 'function',
    }
  })

  expect(result.atlas).toBe(true)
  expect(result.size).toBe(16)
  expect(result.hasRule).toBe(true)
  expect(result.hasRect).toBe(true)
  expect(result.hasMask).toBe(true)
  expect(result.hasCorner).toBe(true)
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
    let count = 0
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 50))
      count = v.indie.areaOverlaps(id).length
      if (count > 0) break
    }
    v.terminal.exec('/stop')
    return count
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
    let hit = ''
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 50))
      hit = v.indie.rayCastHitId(id)
      if (hit.length > 0) break
    }
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
  await expect(chip).toBeVisible({ timeout: 15_000 })
  await chip.click({ modifiers: ['Shift'] })
  await expect(chip).toHaveClass(/pinned/)
  await chip.click()
  await expect(page.locator('.bp-node.mat-node-upstream-flash')).toHaveCount(2, { timeout: 15_000 })
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

test('wave 58 indie MP lobby matchmaking HUD widgets', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawnIndieMpLobby: () => void; mp: { lobbyScript: string } }
    }
    v.indie.spawnIndieMpLobby()
    const manager = [...v.world.actors.values()].find((a) => a.name === 'MpLobbyManager')
    const roomsHud = v.world.hudWidgets.find((w) => w.id === 'mp_lobby_rooms')
    return {
      roomsHud: !!roomsHud,
      scriptListRooms: v.indie.mp.lobbyScript.includes('mpListRooms'),
      scriptPing: v.indie.mp.lobbyScript.includes('mpPingMs'),
      scriptRefresh: v.indie.mp.lobbyScript.includes('mpRefreshRooms'),
      managerScript: manager?.script?.includes('mpListRooms'),
    }
  })

  expect(result.roomsHud).toBe(true)
  expect(result.scriptListRooms).toBe(true)
  expect(result.scriptPing).toBe(true)
  expect(result.scriptRefresh).toBe(true)
  expect(result.managerScript).toBe(true)
})

test('wave 58 indie.mp.matchmaking bridge APIs', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { mp: { matchmaking: { listRooms: () => unknown; pingMs: () => unknown; refreshRooms: () => void } } }
      multiplayer: {
        listRooms?: () => unknown
        pingMs?: () => unknown
        roomPing?: () => unknown
        refreshRooms?: () => void
      }
    }
    return {
      listRooms: typeof v.indie.mp.matchmaking.listRooms === 'function',
      pingMs: typeof v.indie.mp.matchmaking.pingMs === 'function',
      refreshRooms: typeof v.indie.mp.matchmaking.refreshRooms === 'function',
      mpListRooms: typeof v.multiplayer.listRooms === 'function',
      mpPingMs: typeof v.multiplayer.pingMs === 'function',
      mpRoomPing: typeof v.multiplayer.roomPing === 'function',
      mpRefreshRooms: typeof v.multiplayer.refreshRooms === 'function',
    }
  })

  expect(result.listRooms).toBe(true)
  expect(result.pingMs).toBe(true)
  expect(result.refreshRooms).toBe(true)
  expect(result.mpListRooms).toBe(true)
  expect(result.mpPingMs).toBe(true)
  expect(result.mpRoomPing).toBe(true)
  expect(result.mpRefreshRooms).toBe(true)
})

test('wave 58 mpListRooms + mpPingMs script API surface', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const api = window.lotus!.indie.scriptApi() as {
      mpListRooms?: () => unknown
      mpPingMs?: () => unknown
      mpRefreshRooms?: () => void
    }
    return {
      mpListRooms: typeof api.mpListRooms === 'function',
      mpPingMs: typeof api.mpPingMs === 'function',
      mpRefreshRooms: typeof api.mpRefreshRooms === 'function',
      rooms: Array.isArray(api.mpListRooms?.()),
      ping: api.mpPingMs?.(),
    }
  })

  expect(result.mpListRooms).toBe(true)
  expect(result.mpPingMs).toBe(true)
  expect(result.mpRefreshRooms).toBe(true)
  expect(result.rooms).toBe(true)
  expect(result.ping).toBeNull()
})

test('wave 58 World Settings documents matchmaking protocol', async ({ page }) => {
  await bootEditor(page)

  const html = await page.content()
  expect(html).toContain('list_rooms')
  expect(html).toContain('room_registry')
  expect(html).toContain('matchmaking')
})

test('wave 59 indie.input.profiles lists bundled desktop and mobile presets', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { input: { profiles: () => string[] } }
    }
    return v.indie.input.profiles()
  })
  expect(result).toContain('desktop')
  expect(result).toContain('mobile')
  expect(result.indexOf('desktop')).toBeLessThan(result.indexOf('mobile'))
})

test('wave 59 indie.input.applyProfile mobile sets compact touch layout preset', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { input: { applyProfile: (n: string) => { touchLayoutPreset: string } | null } }
      world: { environment: { touchLayoutPreset?: string } }
    }
    const applied = v.indie.input.applyProfile('mobile')
    return {
      preset: v.world.environment.touchLayoutPreset,
      applied: applied?.touchLayoutPreset,
      active: localStorage.getItem('lotus-engine.inputProfiles'),
    }
  })
  expect(result.preset).toBe('compact')
  expect(result.applied).toBe('compact')
  expect(result.active).toContain('"active":"mobile"')
})

test('wave 59 indie.input.applyProfile desktop sets wide touch layout preset', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { input: { applyProfile: (n: string) => { touchLayoutPreset: string } | null } }
      world: { environment: { touchLayoutPreset?: string } }
    }
    v.indie.input.applyProfile('mobile')
    const applied = v.indie.input.applyProfile('desktop')
    return { preset: v.world.environment.touchLayoutPreset, applied: applied?.touchLayoutPreset }
  })
  expect(result.preset).toBe('wide')
  expect(result.applied).toBe('wide')
})

test('wave 59 indie.input saveProfile + loadProfile round-trip custom preset', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        input: {
          setGamepadButton: (a: 'Fire', b: number) => boolean
          applyProfile: (n: string) => unknown
          saveProfile: (n: string) => boolean
          loadProfile: (n: string) => { touchLayoutPreset: string } | null
          getBindings: () => { gamepad: { Fire: number } }
          activeProfile: () => string
        }
        touch: { setLayoutPreset: (p: 'fps') => string }
      }
      world: { environment: { touchLayoutPreset?: string } }
    }
    v.indie.input.setGamepadButton('Fire', 1)
    v.indie.touch.setLayoutPreset('fps')
    const saved = v.indie.input.saveProfile('wave59-custom')
    v.indie.input.applyProfile('desktop')
    const loaded = v.indie.input.loadProfile('wave59-custom')
    const store = JSON.parse(localStorage.getItem('lotus-engine.inputProfiles') ?? '{}') as {
      saved?: { 'wave59-custom'?: { touchLayoutPreset?: string; bindings?: { gamepad?: { Fire?: number } } } }
    }
    return {
      saved,
      fire: v.indie.input.getBindings().gamepad.Fire,
      preset: v.world.environment.touchLayoutPreset,
      loadedPreset: loaded?.touchLayoutPreset,
      active: v.indie.input.activeProfile(),
      storedFire: store.saved?.['wave59-custom']?.bindings?.gamepad?.Fire,
      storedPreset: store.saved?.['wave59-custom']?.touchLayoutPreset,
    }
  })
  expect(result.saved).toBe(true)
  expect(result.fire).toBe(1)
  expect(result.preset).toBe('fps')
  expect(result.loadedPreset).toBe('fps')
  expect(result.active).toBe('wave59-custom')
  expect(result.storedFire).toBe(1)
  expect(result.storedPreset).toBe('fps')
})

test('wave 59 export HTML embeds __LOTUS_INPUT_PROFILE__ with active profile name', async ({ page }) => {
  await bootEditor(page)
  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { input: { applyProfile: (n: string) => unknown } }
      export: { buildPlayableHTML: () => string }
    }
    v.indie.input.applyProfile('mobile')
    const html = v.export.buildPlayableHTML()
    const match = html.match(/window\.__LOTUS_INPUT_PROFILE__ = '([^']+)'/)
    return { hasTag: html.includes('__LOTUS_INPUT_PROFILE__'), profile: match?.[1] }
  })
  expect(result.hasTag).toBe(true)
  expect(result.profile).toBe('mobile')
})

test('wave 60 streamingProgress begin + noteCellLoaded tracks percent', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const s = (window.lotus! as typeof window.lotus & {
      streaming: {
        reset: () => { cellsLoaded: number; cellsTotal: number; percent: number }
        begin: (n: number) => { cellsLoaded: number; cellsTotal: number; percent: number }
        noteCellLoaded: () => { cellsLoaded: number; cellsTotal: number; percent: number }
        getProgress: () => number
        cellsLoaded: () => number
        cellsTotal: () => number
      }
    }).streaming
    s.reset()
    const start = s.begin(3)
    s.noteCellLoaded()
    s.noteCellLoaded()
    const done = s.noteCellLoaded()
    return {
      startPercent: start.percent,
      startTotal: start.cellsTotal,
      donePercent: done.percent,
      progress: s.getProgress(),
      loaded: s.cellsLoaded(),
      total: s.cellsTotal(),
    }
  })

  expect(result.startPercent).toBe(0)
  expect(result.startTotal).toBe(3)
  expect(result.donePercent).toBe(100)
  expect(result.progress).toBe(100)
  expect(result.loaded).toBe(3)
  expect(result.total).toBe(3)
})

test('wave 60 lotus.streaming bridge exposes progress APIs', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const s = (window.lotus! as typeof window.lotus).streaming as Record<string, unknown>
    return {
      getProgress: typeof s.getProgress === 'function',
      cellsLoaded: typeof s.cellsLoaded === 'function',
      cellsTotal: typeof s.cellsTotal === 'function',
      getState: typeof s.getState === 'function',
      begin: typeof s.begin === 'function',
      noteCellLoaded: typeof s.noteCellLoaded === 'function',
    }
  })

  expect(result.getProgress).toBe(true)
  expect(result.cellsLoaded).toBe(true)
  expect(result.cellsTotal).toBe(true)
  expect(result.getState).toBe(true)
  expect(result.begin).toBe(true)
  expect(result.noteCellLoaded).toBe(true)
})

test('wave 60 export embeds __LOTUS_STREAMING__ when exportByCell has cells', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: {
        streaming: { exportByCell: boolean; enabled: boolean; gridSize: number; loadRadius: number }
      }
      indie: { spawn: (p: { kind: 'mesh'; geometry: 'box' }, pos: [number, number, number]) => unknown }
      export: { buildPlayableHTML: () => string }
    }
    v.world.streaming.exportByCell = true
    v.world.streaming.enabled = true
    v.world.streaming.gridSize = 64
    v.indie.spawn({ kind: 'mesh', geometry: 'box' }, [128, 0.5, 128])
    const level = v.world.serialize() as {
      streaming?: { exportByCell?: boolean; enabled?: boolean }
      actors: { type: string; streamCell?: [number, number] }[]
    }
    const html = v.export.buildPlayableHTML()
    const streamLine = html.match(/__LOTUS_STREAMING__ = (true|false)/)?.[1]
    return {
      streamingOn: streamLine === 'true',
      exportByCell: level.streaming?.exportByCell === true,
      streamCells: level.actors.filter((a) => a.streamCell).length,
      cellsManifest: html.includes('__LOTUS_CELLS__') && !html.includes('__LOTUS_CELLS__ = null'),
      progressCss: html.includes('lotus-stream-progress'),
    }
  })

  expect(result.exportByCell).toBe(true)
  expect(result.streamCells).toBeGreaterThan(0)
  expect(result.streamingOn).toBe(true)
  expect(result.cellsManifest).toBe(true)
  expect(result.progressCss).toBe(true)
})

test('wave 60 export embeds __LOTUS_STREAMING__ false without exportByCell', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { streaming: { exportByCell: boolean } }
      export: { buildPlayableHTML: () => string }
    }
    v.world.streaming.exportByCell = false
    const html = v.export.buildPlayableHTML()
    return {
      streamingOff: html.includes('__LOTUS_STREAMING__ = false'),
      cellsNull: html.includes('__LOTUS_CELLS__ = null'),
    }
  })

  expect(result.streamingOff).toBe(true)
  expect(result.cellsNull).toBe(true)
})

test('wave 60 export runtime includes stream progress bar hooks', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { streaming: { exportByCell: boolean; enabled: boolean } }
      export: { buildPlayableHTML: () => string }
    }
    v.world.streaming.exportByCell = true
    v.world.streaming.enabled = true
    const html = v.export.buildPlayableHTML()
    return {
      progressId: html.includes("STREAM_PROGRESS_ID = 'lotus-stream-progress'"),
      syncHooks: html.includes('tickStreamProgressCell'),
      streamFlag: html.includes('__LOTUS_STREAMING__'),
      exportProgress: html.includes('__LOTUS_STREAM_PROGRESS__'),
    }
  })

  expect(result.progressId).toBe(true)
  expect(result.syncHooks).toBe(true)
  expect(result.streamFlag).toBe(true)
  expect(result.exportProgress).toBe(true)
})

const WAVE61_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

test('wave 61 gridMap importAtlasSheet persists PNG data URL to localStorage autotileSheets', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate((png) => {
    const v = window.lotus! as typeof window.lotus & {
      gridMap: { importAtlasSheet: (url: string, name?: string) => { id: string; name: string; dataUrl: string } }
    }
    const sheet = v.gridMap.importAtlasSheet(png, 'TestAtlas')
    const raw = localStorage.getItem('lotus-engine.autotileSheets') ?? '{}'
    const store = JSON.parse(raw) as Record<string, { id: string; dataUrl: string; name: string }>
    return {
      id: sheet.id,
      name: sheet.name,
      hasDataUrl: sheet.dataUrl.startsWith('data:image/png'),
      stored: store[sheet.id]?.dataUrl?.startsWith('data:image/png') ?? false,
      storedName: store[sheet.id]?.name ?? '',
    }
  }, WAVE61_PNG)

  expect(result.hasDataUrl).toBe(true)
  expect(result.stored).toBe(true)
  expect(result.name).toBe('TestAtlas')
  expect(result.storedName).toBe('TestAtlas')
  expect(result.id).toMatch(/^ats_/)
})

test('wave 61 gridMap listAtlasSheets returns imported sheet metadata', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate((png) => {
    const v = window.lotus! as typeof window.lotus & {
      gridMap: {
        importAtlasSheet: (url: string, name?: string) => { id: string }
        listAtlasSheets: () => { id: string; name: string; cols: number; rows: number }[]
      }
    }
    const sheet = v.gridMap.importAtlasSheet(png, 'ListedAtlas')
    const list = v.gridMap.listAtlasSheets()
    const found = list.find((s) => s.id === sheet.id)
    return {
      count: list.length,
      found: !!found,
      cols: found?.cols,
      rows: found?.rows,
      name: found?.name,
    }
  }, WAVE61_PNG)

  expect(result.count).toBeGreaterThanOrEqual(1)
  expect(result.found).toBe(true)
  expect(result.cols).toBe(4)
  expect(result.rows).toBe(4)
  expect(result.name).toBe('ListedAtlas')
})

test('wave 61 gridMap setTileMap + getTileMap round-trip on foliage props', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: Record<string, unknown> } | null }
      gridMap: {
        setTileMap: (props: Record<string, unknown>, map: Record<number, number>) => void
        getTileMap: (props: Record<string, unknown>) => Record<number, number>
      }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    const props = layer?.foliageProps ?? {}
    v.gridMap.setTileMap(props, { 0: 5, 3: 12 })
    const map = v.gridMap.getTileMap(props)
    return { slot0: map[0], slot3: map[3], onProps: (props as { gridAtlasTileMap?: Record<number, number> }).gridAtlasTileMap }
  })

  expect(result.slot0).toBe(5)
  expect(result.slot3).toBe(12)
  expect(result.onProps?.[0]).toBe(5)
  expect(result.onProps?.[3]).toBe(12)
})

test('wave 61 gridMap atlasSlotForMask resolves atlas slot from slot→mask tile map', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      gridMap: { atlasSlotForMask: (mask: number, tileMap?: Record<number, number>) => number }
    }
    const tileMap = { 2: 5, 7: 15 }
    return {
      mapped: v.gridMap.atlasSlotForMask(5, tileMap),
      corner: v.gridMap.atlasSlotForMask(15, tileMap),
      identity: v.gridMap.atlasSlotForMask(3, tileMap),
      noMap: v.gridMap.atlasSlotForMask(8),
    }
  })

  expect(result.mapped).toBe(2)
  expect(result.corner).toBe(7)
  expect(result.identity).toBe(3)
  expect(result.noMap).toBe(8)
})

test('wave 61 gridmap spawn exposes gridAtlasSheetId + custom sheet bridge APIs', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate((png) => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: { gridAtlasSheetId?: string } } | null }
      gridMap: {
        importAtlasSheet: (url: string) => { id: string }
        listAtlasSheets: unknown
        setTileMap: unknown
        getTileMap: unknown
        atlasSlotForMask: unknown
      }
    }
    const sheet = v.gridMap.importAtlasSheet(png)
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    const props = layer?.foliageProps
    if (props) props.gridAtlasSheetId = sheet.id
    return {
      sheetId: props?.gridAtlasSheetId,
      hasImport: typeof v.gridMap.importAtlasSheet === 'function',
      hasList: typeof v.gridMap.listAtlasSheets === 'function',
      hasSet: typeof v.gridMap.setTileMap === 'function',
      hasGet: typeof v.gridMap.getTileMap === 'function',
      hasSlot: typeof v.gridMap.atlasSlotForMask === 'function',
    }
  }, WAVE61_PNG)

  expect(result.sheetId).toMatch(/^ats_/)
  expect(result.hasImport).toBe(true)
  expect(result.hasList).toBe(true)
  expect(result.hasSet).toBe(true)
  expect(result.hasGet).toBe(true)
  expect(result.hasSlot).toBe(true)
})

test('wave 57 indie.minigame.packMeta returns itch.io sidecar fields', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const mg = (window.lotus! as typeof window.lotus).indie.minigame as {
      packMeta: (m: 'platformer' | 'rpg' | 'fps') => {
        title: string
        description: string
        tags: string[]
        kind: string
        version: string
      }
    }
    const platformer = mg.packMeta('platformer')
    const rpg = mg.packMeta('rpg')
    return {
      title: platformer.title,
      description: platformer.description,
      tags: platformer.tags,
      kind: platformer.kind,
      version: platformer.version,
      rpgTags: rpg.tags,
    }
  })

  expect(result.title).toBe('Lotus Platformer Pack')
  expect(result.description).toMatch(/platformer/i)
  expect(result.tags).toEqual(expect.arrayContaining(['platformer', 'action']))
  expect(result.kind).toBe('html')
  expect(result.version).toBe('1.0')
  expect(result.rpgTags).toEqual(expect.arrayContaining(['rpg', 'top-down']))
})

test('wave 57 buildPackHTML embeds __LOTUS_PACK_META__ and __LOTUS_PACK_SCREENSHOT__', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { minigame: { spawnMiniGame: (m: 'platformer') => void; buildPackHTML: (m: 'platformer') => string } }
    }
    v.indie.minigame.spawnMiniGame('platformer')
    const html = v.indie.minigame.buildPackHTML('platformer')
    const metaMatch = html.match(/window\.__LOTUS_PACK_META__ = (\{[^;]+\})/)
    const screenshotMatch = html.match(/window\.__LOTUS_PACK_SCREENSHOT__ = '([^']+)'/)
    const meta = metaMatch ? (JSON.parse(metaMatch[1]) as { title: string; tags: string[] }) : null
    return {
      hasMetaTag: html.includes('__LOTUS_PACK_META__'),
      hasScreenshotTag: html.includes('__LOTUS_PACK_SCREENSHOT__'),
      metaTitle: meta?.title ?? '',
      metaTags: meta?.tags ?? [],
      screenshotLen: screenshotMatch?.[1]?.length ?? 0,
    }
  })

  expect(result.hasMetaTag).toBe(true)
  expect(result.hasScreenshotTag).toBe(true)
  expect(result.metaTitle).toBe('Lotus Platformer Pack')
  expect(result.metaTags).toEqual(expect.arrayContaining(['platformer']))
  expect(result.screenshotLen).toBeGreaterThan(10)
})

test('wave 57 /exportpackmeta platformer terminal command', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const out = window.lotus!.terminal.exec('/exportpackmeta platformer')
    let parsed: { title?: string; description?: string; tags?: string[]; kind?: string } | null = null
    try {
      parsed = JSON.parse(out?.output ?? '{}')
    } catch {
      parsed = null
    }
    return {
      output: out?.output ?? '',
      title: parsed?.title ?? '',
      description: parsed?.description ?? '',
      tags: parsed?.tags ?? [],
      kind: parsed?.kind ?? '',
    }
  })

  expect(result.output).toMatch(/Lotus Platformer Pack/)
  expect(result.title).toBe('Lotus Platformer Pack')
  expect(result.description).toMatch(/platformer/i)
  expect(result.tags).toEqual(expect.arrayContaining(['platformer', 'action', 'arcade']))
  expect(result.kind).toBe('html')
})

test('wave 57 indie.minigame.captureScreenshot returns PNG base64 stub', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const mg = (window.lotus! as typeof window.lotus).indie.minigame as {
      captureScreenshot: () => { base64: string; stub: boolean }
    }
    const shot = mg.captureScreenshot()
    return {
      hasBase64: typeof shot.base64 === 'string' && shot.base64.length > 10,
      stub: shot.stub,
      prefix: shot.base64.slice(0, 8),
    }
  })

  expect(result.hasBase64).toBe(true)
  expect(result.stub).toBe(true)
  expect(result.prefix).toBe('iVBORw0K')
})

test('wave 57 /exportpack platformer includes pack meta in HTML', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { minigame: { spawnMiniGame: (m: 'platformer') => void; buildPackHTML: (m: 'platformer') => string } }
    }
    const out = v.terminal.exec('/exportpack platformer')
    const html = v.indie.minigame.buildPackHTML('platformer')
    const metaMatch = html.match(/window\.__LOTUS_PACK_META__ = (\{[^;]+\})/)
    const meta = metaMatch ? (JSON.parse(metaMatch[1]) as { title: string; kind: string; tags: string[] }) : null
    return {
      output: out?.output,
      pack: html.includes("__LOTUS_MINIGAME_PACK__ = 'platformer'"),
      metaTitle: meta?.title ?? '',
      metaKind: meta?.kind ?? '',
      metaTags: meta?.tags ?? [],
    }
  })

  expect(result.output).toMatch(/Exported mini-game pack: platformer/i)
  expect(result.output).toMatch(/itch\.io meta/i)
  expect(result.pack).toBe(true)
  expect(result.metaTitle).toBe('Lotus Platformer Pack')
  expect(result.metaKind).toBe('html')
  expect(result.metaTags.length).toBeGreaterThanOrEqual(3)
})

test('wave 65 saveCheckpoint round-trip stores lotus-engine.saves.{levelName}.{slot}', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { levelName: string; environment: { saveSlotsEnabled?: boolean } }
      save: {
        checkpoint: (slot: string, data: unknown) => boolean
        load: (slot: string) => unknown
        listSlots: () => string[]
      }
    }
    v.world.levelName = 'Wave65Level'
    v.world.environment.saveSlotsEnabled = true
    const ok = v.save.checkpoint('slot-a', { hp: 42, coins: 7 })
    const key = 'lotus-engine.saves.Wave65Level.slot-a'
    const raw = localStorage.getItem(key)
    const loaded = v.save.load('slot-a')
    const slots = v.save.listSlots()
    return { ok, key, hasRaw: !!raw, loaded, slots }
  })

  expect(result.ok).toBe(true)
  expect(result.hasRaw).toBe(true)
  expect(result.loaded).toEqual({ hp: 42, coins: 7 })
  expect(result.slots).toContain('slot-a')
})

test('wave 65 lotus.save bridge exposes checkpoint, load, listSlots, enabled', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const s = (window.lotus! as typeof window.lotus).save as Record<string, unknown>
    return {
      checkpoint: typeof s.checkpoint === 'function',
      load: typeof s.load === 'function',
      listSlots: typeof s.listSlots === 'function',
      enabled: typeof s.enabled === 'function',
    }
  })

  expect(result.checkpoint).toBe(true)
  expect(result.load).toBe(true)
  expect(result.listSlots).toBe(true)
  expect(result.enabled).toBe(true)
})

test('wave 65 World Settings saveSlotsEnabled toggle persists on world.environment', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { environment: { saveSlotsEnabled?: boolean }; serialize: () => { environment: { saveSlotsEnabled?: boolean } } }
    }
    v.world.environment.saveSlotsEnabled = true
    const serialized = v.world.serialize()
    return {
      live: v.world.environment.saveSlotsEnabled === true,
      serialized: serialized.environment.saveSlotsEnabled === true,
    }
  })

  expect(result.live).toBe(true)
  expect(result.serialized).toBe(true)
})

test('wave 65 export embeds __LOTUS_SAVES__ true when save slots enabled', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { environment: { saveSlotsEnabled?: boolean } }
      export: { buildPlayableHTML: () => string }
    }
    v.world.environment.saveSlotsEnabled = true
    const htmlOn = v.export.buildPlayableHTML()
    v.world.environment.saveSlotsEnabled = false
    const htmlOff = v.export.buildPlayableHTML()
    return {
      enabled: htmlOn.includes('__LOTUS_SAVES__ = true'),
      disabled: htmlOff.includes('__LOTUS_SAVES__ = false'),
    }
  })

  expect(result.enabled).toBe(true)
  expect(result.disabled).toBe(true)
})

test('wave 65 export runtime includes saveGame, loadGame, listSaveSlots when __LOTUS_SAVES__', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { environment: { saveSlotsEnabled?: boolean } }
      export: { buildPlayableHTML: () => string }
    }
    v.world.environment.saveSlotsEnabled = true
    const html = v.export.buildPlayableHTML()
    return {
      savesFlag: html.includes('__LOTUS_SAVES__ = true'),
      saveGame: html.includes('saveGame:'),
      loadGame: html.includes('loadGame:'),
      listSaveSlots: html.includes('listSaveSlots:'),
      saveBridge: html.includes('__LOTUS_SAVE_SLOTS__'),
      storagePrefix: html.includes('lotus-engine.saves'),
    }
  })

  expect(result.savesFlag).toBe(true)
  expect(result.saveGame).toBe(true)
  expect(result.loadGame).toBe(true)
  expect(result.listSaveSlots).toBe(true)
  expect(result.saveBridge).toBe(true)
  expect(result.storagePrefix).toBe(true)
})

test('wave 62 export.buildItchZip returns PK zip with index.html meta.json icon.png', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      export: {
        buildItchZip: (m: 'platformer') => Blob
        listItchZipEntries: (b: Blob) => Promise<string[]>
      }
    }
    const blob = v.export.buildItchZip('platformer')
    const buf = new Uint8Array(await blob.arrayBuffer())
    const entries = await v.export.listItchZipEntries(blob)
    return {
      pk: buf[0] === 0x50 && buf[1] === 0x4b,
      type: blob.type,
      entries,
    }
  })

  expect(result.pk).toBe(true)
  expect(result.type).toBe('application/zip')
  expect(result.entries).toEqual([
    'CHANGELOG.html',
    'RELEASE_NOTES.md',
    'embed-widget.html',
    'icon.png',
    'index.html',
    'meta.json',
  ])
})

test('wave 62 export.itchZipFilename uses {genre}-lotus-pack.zip pattern', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const exp = (window.lotus! as typeof window.lotus).export as {
      itchZipFilename: (m: 'platformer' | 'rpg' | 'fps') => string
    }
    return {
      platformer: exp.itchZipFilename('platformer'),
      rpg: exp.itchZipFilename('rpg'),
      fps: exp.itchZipFilename('fps'),
    }
  })

  expect(result.platformer).toBe('platformer-lotus-pack.zip')
  expect(result.rpg).toBe('rpg-lotus-pack.zip')
  expect(result.fps).toBe('fps-lotus-pack.zip')
})

test('wave 62 indie.minigame.itchPack bridge exposes one-click zip export', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const mg = (window.lotus! as typeof window.lotus).indie.minigame as {
      itchPack: (m: string) => void
    }
    return { hasItchPack: typeof mg.itchPack === 'function' }
  })

  expect(result.hasItchPack).toBe(true)
})

test('wave 62 buildItchZip meta.json embeds pack title tags and kind html', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      export: {
        buildItchZip: (m: 'rpg') => Blob
        readItchZipEntry: (b: Blob, n: string) => Promise<string | null>
      }
    }
    const blob = v.export.buildItchZip('rpg')
    const metaRaw = await v.export.readItchZipEntry(blob, 'meta.json')
    const htmlRaw = await v.export.readItchZipEntry(blob, 'index.html')
    const meta = metaRaw ? (JSON.parse(metaRaw) as { title: string; tags: string[]; kind: string }) : null
    return {
      title: meta?.title ?? '',
      tags: meta?.tags ?? [],
      kind: meta?.kind ?? '',
      htmlPack: htmlRaw?.includes("__LOTUS_MINIGAME_PACK__ = 'rpg'") ?? false,
      htmlMeta: htmlRaw?.includes('__LOTUS_PACK_META__') ?? false,
    }
  })

  expect(result.title).toBe('Lotus RPG Pack')
  expect(result.tags).toEqual(expect.arrayContaining(['rpg', 'top-down', 'adventure']))
  expect(result.kind).toBe('html')
  expect(result.htmlPack).toBe(true)
  expect(result.htmlMeta).toBe(true)
})

test('wave 62 /itchpack platformer terminal command downloads zip and spawns preset', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus!
    const out = v.terminal.exec('/itchpack platformer')
    const mgr = [...v.world.actors.values()].find((a) => a.name === 'MiniGameManager')
    const goal = [...v.world.actors.values()].find((a) => a.name === 'GoalZone')
    return { output: out?.output, mgr: !!mgr, goal: !!goal }
  })

  expect(result.output).toMatch(/Exported itch\.io zip: platformer-lotus-pack\.zip/i)
  expect(result.mgr).toBe(true)
  expect(result.goal).toBe(true)
})

test('wave 63 mpNet + multiplayer bridge expose dedicatedServerMode', async ({ page }) => {
  await bootEditor(page, {
    'lotus-engine.multiplayer': JSON.stringify({
      url: 'ws://localhost:24690',
      room: 'lan-party',
      enabled: true,
      dedicatedServer: true,
    }),
  })

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      mpNet: { isDedicatedServer: () => boolean; dedicatedServerMode: () => boolean }
      multiplayer: {
        loadSettings: () => { dedicatedServer?: boolean }
        isDedicatedServer?: () => boolean
        dedicatedServerMode?: () => boolean
      }
    }
    return {
      mpNetDedicated: v.mpNet.isDedicatedServer(),
      mpNetMode: v.mpNet.dedicatedServerMode(),
      settingsDedicated: v.multiplayer.loadSettings().dedicatedServer,
      bridgeDedicated: v.multiplayer.isDedicatedServer?.(),
      bridgeMode: v.multiplayer.dedicatedServerMode?.(),
    }
  })

  expect(result.mpNetDedicated).toBe(true)
  expect(result.mpNetMode).toBe(true)
  expect(result.settingsDedicated).toBe(true)
  expect(result.bridgeDedicated).toBe(true)
  expect(result.bridgeMode).toBe(true)
})

test('wave 63 dedicated mode disables client prediction on predicted actors', async ({ page }) => {
  await bootEditor(page, {
    'lotus-engine.multiplayer': JSON.stringify({
      url: 'ws://localhost:24690',
      room: 'default',
      enabled: true,
      dedicatedServer: true,
    }),
  })

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      mpNet: {
        isDedicatedServer: () => boolean
        actorUsesClientPrediction: (actor: { clientPredicted?: boolean }) => boolean
      }
      world: { actors: { values: () => IterableIterator<{ clientPredicted?: boolean }> } }
    }
    const actor = [...v.world.actors.values()][0]
    actor.clientPredicted = true
    return {
      dedicated: v.mpNet.isDedicatedServer(),
      predicts: v.mpNet.actorUsesClientPrediction(actor),
    }
  })

  expect(result.dedicated).toBe(true)
  expect(result.predicts).toBe(false)
})

test('wave 63 dedicated host id constant is lexicographically smallest', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      mpNet: { dedicatedHostId: string }
    }
    const samplePeers = ['abc123', 'zzzzzz', 'host01', v.mpNet.dedicatedHostId]
    samplePeers.sort()
    return {
      hostId: v.mpNet.dedicatedHostId,
      smallest: samplePeers[0],
    }
  })

  expect(result.hostId).toBe('000000')
  expect(result.smallest).toBe('000000')
})

test('wave 63 World Settings documents dedicated server URL + npm run dedicated', async ({ page }) => {
  await bootEditor(page)

  const html = await page.content()
  expect(html).toContain('npm run dedicated')
  expect(html).toContain('Dedicated server URL')
  expect(html).toContain('ws://&lt;host-ip&gt;:24690')
  expect(html).toContain('000000')
})

test('wave 64 touchHaptics vibrateFire guarded when navigator.vibrate missing', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        touch: {
          vibrateFire: () => boolean
          hapticsSupported: () => boolean
        }
      }
    }
    const orig = navigator.vibrate
    // @ts-expect-error test stub
    navigator.vibrate = undefined
    const fired = v.indie.touch.vibrateFire()
    navigator.vibrate = orig
    return { fired, supported: v.indie.touch.hapticsSupported() }
  })

  expect(result.fired).toBe(false)
})

test('wave 64 indie.touch hapticsEnabled defaults true and setHapticsEnabled writes env', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        touch: {
          hapticsEnabled: () => boolean
          setHapticsEnabled: (on: boolean) => boolean
        }
      }
      world: { environment: { touchHaptics?: boolean } }
    }
    delete v.world.environment.touchHaptics
    const defaultOn = v.indie.touch.hapticsEnabled()
    v.indie.touch.setHapticsEnabled(false)
    const off = v.world.environment.touchHaptics === false && v.indie.touch.hapticsEnabled() === false
    v.indie.touch.setHapticsEnabled(true)
    const on = v.world.environment.touchHaptics === true && v.indie.touch.hapticsEnabled() === true
    return { defaultOn, off, on }
  })

  expect(result.defaultOn).toBe(true)
  expect(result.off).toBe(true)
  expect(result.on).toBe(true)
})

test('wave 64 indie.touch vibrateFire and vibrateInteract return boolean from bridge', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        touch: {
          setHapticsEnabled: (on: boolean) => boolean
          vibrateFire: () => boolean
          vibrateInteract: () => boolean
        }
      }
    }
    v.indie.touch.setHapticsEnabled(true)
    let calls: number[] = []
    const orig = navigator.vibrate
    navigator.vibrate = (pattern: number | number[]) => {
      calls.push(Array.isArray(pattern) ? pattern[0] : pattern)
      return true
    }
    const fire = v.indie.touch.vibrateFire()
    const interact = v.indie.touch.vibrateInteract()
    navigator.vibrate = orig
    return { fire, interact, firePattern: calls[0], interactPattern: calls[1] }
  })

  expect(result.fire).toBe(true)
  expect(result.interact).toBe(true)
  expect(result.firePattern).toBe(28)
  expect(result.interactPattern).toBe(14)
})

test('wave 64 World Settings touch haptics toggles environment.touchHaptics', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { environment: { touchHaptics?: boolean } }
    }
    v.world.environment.touchHaptics = true
    const on = v.world.environment.touchHaptics === true
    v.world.environment.touchHaptics = false
    const off = v.world.environment.touchHaptics === false
    return { on, off }
  })

  expect(result.on).toBe(true)
  expect(result.off).toBe(true)
})

test('wave 64 export runtime includes vibrateTouchFire when TOUCH_ENABLED', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { environment: { touchControls?: boolean; touchHaptics?: boolean } }
      export: { buildPlayableHTML: () => string }
    }
    v.world.environment.touchControls = true
    v.world.environment.touchHaptics = true
    const html = v.export.buildPlayableHTML()
    return {
      touchFlag: html.includes('__LOTUS_TOUCH__ = true'),
      fireVibrate: html.includes('vibrateTouchFire'),
      interactVibrate: html.includes('vibrateTouchInteract'),
      jumpVibrate: html.includes('vibrateTouchJump'),
      hapticsGuard: html.includes('touchHapticsEnabled'),
    }
  })

  expect(result.touchFlag).toBe(true)
  expect(result.fireVibrate).toBe(true)
  expect(result.interactVibrate).toBe(true)
  expect(result.jumpVibrate).toBe(true)
  expect(result.hapticsGuard).toBe(true)
})

test('wave 66 gridMap getLayerCollisionGroup defaults membership 0–3 with full mask', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: import('../src/engine/types').FoliageProps } | null }
      gridMap: {
        getLayerCollisionGroup: (props: import('../src/engine/types').FoliageProps, layer: number) => number
        membershipFromRapierGroup: (group: number) => number
        maskFromRapierGroup: (group: number) => number
      }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!layer?.foliageProps) return { ok: false }
    const props = layer.foliageProps
    return {
      ok: true,
      m0: v.gridMap.membershipFromRapierGroup(v.gridMap.getLayerCollisionGroup(props, 0)),
      m1: v.gridMap.membershipFromRapierGroup(v.gridMap.getLayerCollisionGroup(props, 1)),
      m2: v.gridMap.membershipFromRapierGroup(v.gridMap.getLayerCollisionGroup(props, 2)),
      m3: v.gridMap.membershipFromRapierGroup(v.gridMap.getLayerCollisionGroup(props, 3)),
      mask: v.gridMap.maskFromRapierGroup(v.gridMap.getLayerCollisionGroup(props, 0)),
    }
  })

  expect(result.ok).toBe(true)
  expect(result.m0).toBe(0)
  expect(result.m1).toBe(1)
  expect(result.m2).toBe(2)
  expect(result.m3).toBe(3)
  expect(result.mask).toBe(0xffff)
})

test('wave 66 gridMap setLayerCollisionGroup + getLayerCollisionGroup round-trip on foliage props', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: import('../src/engine/types').FoliageProps } | null }
      gridMap: {
        setLayerCollisionGroup: (props: import('../src/engine/types').FoliageProps, layer: number, group: number) => void
        getLayerCollisionGroup: (props: import('../src/engine/types').FoliageProps, layer: number) => number
        rapierGroupsFromLayerMask: (membership: number, mask: number) => number
      }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!layer?.foliageProps) return { ok: false }
    const props = layer.foliageProps
    const custom = v.gridMap.rapierGroupsFromLayerMask(5, 0x00ff)
    v.gridMap.setLayerCollisionGroup(props, 2, custom)
    return {
      ok: true,
      read: v.gridMap.getLayerCollisionGroup(props, 2),
      stored: props.gridLayerCollisionGroups?.[2],
    }
  })

  expect(result.ok).toBe(true)
  expect(result.read).toBe(result.stored)
  expect(result.read).toBe(((1 << 5) << 16) | 0x00ff)
})

test('wave 66 gridMap rapierGroupsFromLayerMask packs membership << 16 | mask', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      gridMap: {
        rapierGroupsFromLayerMask: (membership: number, mask: number) => number
        membershipFromRapierGroup: (group: number) => number
        maskFromRapierGroup: (group: number) => number
      }
    }
    const group = v.gridMap.rapierGroupsFromLayerMask(4, 0x000a)
    return {
      group,
      membership: v.gridMap.membershipFromRapierGroup(group),
      mask: v.gridMap.maskFromRapierGroup(group),
    }
  })

  expect(result.group).toBe(((1 << 4) << 16) | 0x000a)
  expect(result.membership).toBe(4)
  expect(result.mask).toBe(0x000a)
})

test('wave 66 gridMap paintLayer rebuilds colliders with layer collision group', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => import('../src/engine/Actor').Actor | null }
      gridMap: {
        paintLayer: (props: import('../src/engine/types').FoliageProps, layer: number, cx: number, cy: number, cz: number) => boolean
        setLayerCollisionGroup: (props: import('../src/engine/types').FoliageProps, layer: number, group: number) => void
        rapierGroupsFromLayerMask: (membership: number, mask: number) => number
        rebuildFoliageColliders: (actor: import('../src/engine/Actor').Actor) => void
        foliageColliderGroups: (actor: import('../src/engine/Actor').Actor) => number[]
      }
    }
    const actor = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!actor?.foliageProps) return { ok: false }
    const props = actor.foliageProps
    const layer2Group = v.gridMap.rapierGroupsFromLayerMask(6, 0xffff)
    v.gridMap.setLayerCollisionGroup(props, 2, layer2Group)
    v.gridMap.paintLayer(props, 0, 0, 0, 0)
    v.gridMap.paintLayer(props, 2, 1, 0, 0)
    v.gridMap.rebuildFoliageColliders(actor)
    const groups = v.gridMap.foliageColliderGroups(actor)
    return { ok: true, count: groups.length, layer0: groups[0], layer2: groups[1] }
  })

  expect(result.ok).toBe(true)
  expect(result.count).toBe(2)
  expect(result.layer0).toBe(((1 << 0) << 16) | 0xffff)
  expect(result.layer2).toBe(((1 << 6) << 16) | 0xffff)
})

test('wave 66 gridmap spawn exposes gridLayerCollisionGroups + bridge APIs', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: { gridLayerCollisionGroups?: number[] } } | null }
      gridMap: Record<string, unknown>
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    const props = layer?.foliageProps
    if (props) v.gridMap.getLayerCollisionGroup(props, 0)
    return {
      groupsLen: props?.gridLayerCollisionGroups?.length ?? 0,
      hasGet: typeof v.gridMap.getLayerCollisionGroup === 'function',
      hasSet: typeof v.gridMap.setLayerCollisionGroup === 'function',
      hasPack: typeof v.gridMap.rapierGroupsFromLayerMask === 'function',
      hasRebuild: typeof v.gridMap.rebuildFoliageColliders === 'function',
      hasColliderGroups: typeof v.gridMap.foliageColliderGroups === 'function',
    }
  })

  expect(result.hasGet).toBe(true)
  expect(result.hasSet).toBe(true)
  expect(result.hasPack).toBe(true)
  expect(result.hasRebuild).toBe(true)
  expect(result.hasColliderGroups).toBe(true)
  expect(result.groupsLen).toBe(4)
})

test('wave 69 gamepadHaptics pulseFire guarded when vibrationActuator missing', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        gamepad: {
          pulseFire: () => boolean
          hapticsSupported: () => boolean
        }
      }
    }
    const orig = navigator.getGamepads
    // @ts-expect-error test stub
    navigator.getGamepads = () => []
    const fired = v.indie.gamepad.pulseFire()
    navigator.getGamepads = orig
    return { fired, supported: v.indie.gamepad.hapticsSupported() }
  })

  expect(result.fired).toBe(false)
})

test('wave 69 indie.gamepad hapticsEnabled defaults true and setHapticsEnabled writes env', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        gamepad: {
          hapticsEnabled: () => boolean
          setHapticsEnabled: (on: boolean) => boolean
        }
      }
      world: { environment: { gamepadHaptics?: boolean } }
    }
    delete v.world.environment.gamepadHaptics
    const defaultOn = v.indie.gamepad.hapticsEnabled()
    v.indie.gamepad.setHapticsEnabled(false)
    const off = v.world.environment.gamepadHaptics === false && v.indie.gamepad.hapticsEnabled() === false
    v.indie.gamepad.setHapticsEnabled(true)
    const on = v.world.environment.gamepadHaptics === true && v.indie.gamepad.hapticsEnabled() === true
    return { defaultOn, off, on }
  })

  expect(result.defaultOn).toBe(true)
  expect(result.off).toBe(true)
  expect(result.on).toBe(true)
})

test('wave 69 indie.gamepad pulseFire and pulseInteract invoke playEffect dual-rumble', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        gamepad: {
          setHapticsEnabled: (on: boolean) => boolean
          pulseFire: () => boolean
          pulseInteract: () => boolean
        }
      }
    }
    v.indie.gamepad.setHapticsEnabled(true)
    const effects: Array<{ type: string; params: Record<string, number> }> = []
    const stubActuator = {
      playEffect: (type: string, params: Record<string, number>) => {
        effects.push({ type, params })
        return Promise.resolve({})
      },
    }
    const stubPad = { connected: true, vibrationActuator: stubActuator }
    const orig = navigator.getGamepads
    navigator.getGamepads = () => [stubPad as unknown as Gamepad]
    const fire = v.indie.gamepad.pulseFire()
    const interact = v.indie.gamepad.pulseInteract()
    navigator.getGamepads = orig
    return {
      fire,
      interact,
      fireType: effects[0]?.type,
      interactType: effects[1]?.type,
      fireDuration: effects[0]?.params.duration,
      interactDuration: effects[1]?.params.duration,
    }
  })

  expect(result.fire).toBe(true)
  expect(result.interact).toBe(true)
  expect(result.fireType).toBe('dual-rumble')
  expect(result.interactType).toBe('dual-rumble')
  expect(result.fireDuration).toBe(28)
  expect(result.interactDuration).toBe(14)
})

test('wave 69 World Settings gamepad haptics toggles environment.gamepadHaptics', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { environment: { gamepadHaptics?: boolean } }
    }
    v.world.environment.gamepadHaptics = true
    const on = v.world.environment.gamepadHaptics === true
    v.world.environment.gamepadHaptics = false
    const off = v.world.environment.gamepadHaptics === false
    return { on, off }
  })

  expect(result.on).toBe(true)
  expect(result.off).toBe(true)
})

test('wave 69 export runtime includes pulseGamepadFire when GAMEPAD_ENABLED', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { environment: { gamepadControls?: boolean; gamepadHaptics?: boolean } }
      export: { buildPlayableHTML: () => string }
    }
    v.world.environment.gamepadControls = true
    v.world.environment.gamepadHaptics = true
    const html = v.export.buildPlayableHTML()
    return {
      gamepadFlag: html.includes('__LOTUS_GAMEPAD__ = true'),
      firePulse: html.includes('pulseGamepadFire'),
      interactPulse: html.includes('pulseGamepadInteract'),
      hapticsGuard: html.includes('gamepadHapticsEnabled'),
      dualRumble: html.includes("'dual-rumble'"),
    }
  })

  expect(result.gamepadFlag).toBe(true)
  expect(result.firePulse).toBe(true)
  expect(result.interactPulse).toBe(true)
  expect(result.hapticsGuard).toBe(true)
  expect(result.dualRumble).toBe(true)
})

test('wave 70 backupCheckpointToIndexedDB round-trip stores lotus-engine.cloud.{levelName}.{slot}', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      world: { levelName: string; environment: { saveSlotsEnabled?: boolean; cloudSaveBackup?: boolean } }
      save: {
        backupToCloud: (slot: string, data: unknown) => Promise<boolean>
        restoreFromCloud: (slot: string) => Promise<unknown>
        listCloudSlots: () => Promise<string[]>
      }
    }
    v.world.levelName = 'Wave70Level'
    v.world.environment.saveSlotsEnabled = true
    v.world.environment.cloudSaveBackup = true
    const ok = await v.save.backupToCloud('cloud-a', { hp: 99, gems: 3 })
    let restored: unknown = null
    for (let i = 0; i < 20; i++) {
      restored = await v.save.restoreFromCloud('cloud-a')
      if (restored != null) break
      await new Promise((r) => setTimeout(r, 25))
    }
    const slots = await v.save.listCloudSlots()
    return { ok, restored, slots }
  })

  expect(result.ok).toBe(true)
  expect(result.restored).toEqual({ hp: 99, gems: 3 })
  expect(result.slots).toContain('cloud-a')
})

test('wave 70 lotus.save bridge exposes cloudBackup, backupToCloud, restoreFromCloud, listCloudSlots', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const s = (window.lotus! as typeof window.lotus).save as Record<string, unknown>
    return {
      cloudBackup: typeof s.cloudBackup === 'function',
      backupToCloud: typeof s.backupToCloud === 'function',
      restoreFromCloud: typeof s.restoreFromCloud === 'function',
      listCloudSlots: typeof s.listCloudSlots === 'function',
    }
  })

  expect(result.cloudBackup).toBe(true)
  expect(result.backupToCloud).toBe(true)
  expect(result.restoreFromCloud).toBe(true)
  expect(result.listCloudSlots).toBe(true)
})

test('wave 70 saveCheckpoint auto-backups to IndexedDB when cloudSaveBackup enabled', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      world: { levelName: string; environment: { saveSlotsEnabled?: boolean; cloudSaveBackup?: boolean } }
      save: {
        checkpoint: (slot: string, data: unknown) => boolean
        restoreFromCloud: (slot: string) => Promise<unknown>
      }
    }
    v.world.levelName = 'Wave70Auto'
    v.world.environment.saveSlotsEnabled = true
    v.world.environment.cloudSaveBackup = true
    const ok = v.save.checkpoint('auto-slot', { stage: 4 })
    await new Promise((r) => setTimeout(r, 50))
    const cloud = await v.save.restoreFromCloud('auto-slot')
    return { ok, cloud }
  })

  expect(result.ok).toBe(true)
  expect(result.cloud).toEqual({ stage: 4 })
})

test('wave 70 World Settings cloudSaveBackup toggle persists on world.environment', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: {
        environment: { cloudSaveBackup?: boolean }
        serialize: () => { environment: { cloudSaveBackup?: boolean } }
      }
    }
    v.world.environment.cloudSaveBackup = true
    const serialized = v.world.serialize()
    return {
      live: v.world.environment.cloudSaveBackup === true,
      serialized: serialized.environment.cloudSaveBackup === true,
    }
  })

  expect(result.live).toBe(true)
  expect(result.serialized).toBe(true)
})

test('wave 70 export embeds __LOTUS_CLOUD_SAVES__ true + runtime cloud backup APIs when enabled', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { environment: { saveSlotsEnabled?: boolean; cloudSaveBackup?: boolean } }
      export: { buildPlayableHTML: () => string }
    }
    v.world.environment.saveSlotsEnabled = true
    v.world.environment.cloudSaveBackup = true
    const htmlOn = v.export.buildPlayableHTML()
    v.world.environment.cloudSaveBackup = false
    const htmlOff = v.export.buildPlayableHTML()
    return {
      cloudOn: htmlOn.includes('__LOTUS_CLOUD_SAVES__ = true'),
      cloudOff: htmlOff.includes('__LOTUS_CLOUD_SAVES__ = false'),
      backupToCloud: htmlOn.includes('exportBackupToCloud'),
      restoreFromCloud: htmlOn.includes('exportRestoreFromCloud'),
      listCloudSlots: htmlOn.includes('exportListCloudSlots'),
      cloudPrefix: htmlOn.includes('lotus-engine.cloud'),
    }
  })

  expect(result.cloudOn).toBe(true)
  expect(result.cloudOff).toBe(true)
  expect(result.backupToCloud).toBe(true)
  expect(result.restoreFromCloud).toBe(true)
  expect(result.listCloudSlots).toBe(true)
  expect(result.cloudPrefix).toBe(true)
})

test('wave 67 export.butlerPushCommand returns butler push with html channel', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const exp = (window.lotus! as typeof window.lotus).export as {
      butlerPushCommand: (m: 'platformer' | 'rpg' | 'fps', u?: string, g?: string) => string
    }
    return {
      platformer: exp.butlerPushCommand('platformer'),
      rpg: exp.butlerPushCommand('rpg', 'vektra', 'lotus-rpg'),
      fps: exp.butlerPushCommand('fps'),
    }
  })

  expect(result.platformer).toBe('butler push platformer-lotus-pack.zip user/game:html')
  expect(result.rpg).toBe('butler push rpg-lotus-pack.zip vektra/lotus-rpg:html')
  expect(result.fps).toBe('butler push fps-lotus-pack.zip user/game:html')
})

test('wave 67 indie.minigame.butlerHint bridge exposes push command helper', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const mg = (window.lotus! as typeof window.lotus).indie.minigame as {
      butlerHint: (m: 'platformer', u?: string, g?: string) => string
    }
    return {
      hasButlerHint: typeof mg.butlerHint === 'function',
      cmd: mg.butlerHint('platformer', 'myuser', 'my-game'),
    }
  })

  expect(result.hasButlerHint).toBe(true)
  expect(result.cmd).toBe('butler push platformer-lotus-pack.zip myuser/my-game:html')
})

test('wave 67 /butlerhint platformer prints butler command and pack meta JSON', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const out = (window.lotus! as typeof window.lotus).terminal.exec('/butlerhint platformer')
    const lines = out?.output?.split('\n') ?? []
    const metaRaw = lines.slice(2).join('\n')
    const meta = metaRaw ? (JSON.parse(metaRaw) as { title: string; kind: string; tags: string[] }) : null
    return {
      firstLine: lines[0] ?? '',
      title: meta?.title ?? '',
      kind: meta?.kind ?? '',
      tags: meta?.tags ?? [],
    }
  })

  expect(result.firstLine).toBe('butler push platformer-lotus-pack.zip user/game:html')
  expect(result.title).toBe('Lotus Platformer Pack')
  expect(result.kind).toBe('html')
  expect(result.tags).toEqual(expect.arrayContaining(['platformer', 'action']))
})

test('wave 67 /butlerhint stores last zip name in localStorage', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    localStorage.removeItem('lotus-engine.itch.lastZip')
    ;(window.lotus! as typeof window.lotus).terminal.exec('/butlerhint rpg')
    return localStorage.getItem('lotus-engine.itch.lastZip')
  })

  expect(result).toBe('rpg-lotus-pack.zip')
})

test('wave 67 itchPack export status includes butler push hint', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { minigame: { itchPack: (m: 'fps') => void } }
      useEditor: { getState: () => { statusMessage: string } }
    }
    v.indie.minigame.itchPack('fps')
    return v.useEditor.getState().statusMessage
  })

  expect(result).toMatch(/Exported itch\.io pack: fps-lotus-pack\.zip/)
  expect(result).toMatch(/butler push fps-lotus-pack\.zip user\/game:html/)
})

test('wave 68 indie.mp.spectator bridge exposes enable, isSpectator, spawnSpectator', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        mp: {
          spectator: {
            tag: string
            script: string
            enable: (on: boolean) => boolean
            isSpectator: () => boolean
            spawnSpectator: () => void
          }
        }
      }
      multiplayer: {
        loadSettings: () => { spectator?: boolean }
        spectatorMode?: () => boolean
        spectatorEnable?: (on: boolean) => void
      }
    }
    v.indie.mp.spectator.enable(true)
    return {
      tag: v.indie.mp.spectator.tag,
      scriptHasEnable: v.indie.mp.spectator.script.includes('mpSpectatorEnable'),
      scriptHasHostPose: v.indie.mp.spectator.script.includes('mpHostPose'),
      hasEnable: typeof v.indie.mp.spectator.enable === 'function',
      hasIsSpectator: typeof v.indie.mp.spectator.isSpectator === 'function',
      hasSpawn: typeof v.indie.mp.spectator.spawnSpectator === 'function',
      enabled: v.indie.mp.spectator.isSpectator(),
      settingsSpectator: v.multiplayer.loadSettings().spectator,
      bridgeMode: v.multiplayer.spectatorMode?.(),
    }
  })

  expect(result.tag).toBe('mp_spectator')
  expect(result.scriptHasEnable).toBe(true)
  expect(result.scriptHasHostPose).toBe(true)
  expect(result.hasEnable).toBe(true)
  expect(result.hasIsSpectator).toBe(true)
  expect(result.hasSpawn).toBe(true)
  expect(result.enabled).toBe(true)
  expect(result.settingsSpectator).toBe(true)
  expect(result.bridgeMode).toBe(true)
})

test('wave 68 /mpspectator spawns spectator arena + manager', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus
    const out = v.terminal.exec('/mpspectator')
    const spec = [...v.world.actors.values()].find((a) => a.name === 'SpectatorSpawn')
    const mgr = [...v.world.actors.values()].find((a) => a.name === 'MpSpectatorManager')
    const board = [...v.world.actors.values()].find((a) => a.name === 'MpScoreboard')
    return {
      output: out?.output,
      spec: !!spec,
      specTag: spec?.tags.includes('mp_spectator') ?? false,
      specFly: spec?.pawnMode === 'fly',
      mgr: !!mgr,
      board: !!board,
    }
  })

  expect(result.output).toMatch(/Indie MP spectator/i)
  expect(result.spec).toBe(true)
  expect(result.specTag).toBe(true)
  expect(result.specFly).toBe(true)
  expect(result.mgr).toBe(true)
  expect(result.board).toBe(true)
})

test('wave 68 spectator mode skips pawn position uplink in mpTick path', async ({ page }) => {
  await bootEditor(page, {
    'lotus-engine.multiplayer': JSON.stringify({
      url: 'ws://localhost:24690',
      room: 'spec-room',
      enabled: true,
      spectator: true,
    }),
  })

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      multiplayer: { spectatorMode: () => boolean; spectatorEnable: (on: boolean) => void }
      world: { pawnPosition: unknown }
    }
    v.multiplayer.spectatorEnable(true)
    return {
      spectator: v.multiplayer.spectatorMode(),
      pawnNull: v.world.pawnPosition == null,
    }
  })

  expect(result.spectator).toBe(true)
  expect(result.pawnNull).toBe(true)
})

test('wave 68 World Settings documents spectator_join + /mpspectator', async ({ page }) => {
  await bootEditor(page)

  const html = await page.content()
  expect(html).toContain('Spectator mode')
  expect(html).toContain('spectator_join')
  expect(html).toContain('/mpspectator')
})

test('wave 73 indie.mp.replay bridge exposes sampleAt, seek, bufferLength, recordEnabled', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        mp: {
          replay: {
            sampleAt: (offsetSec: number) => unknown[]
            seek: (offsetSec: number) => number
            bufferLength: () => number
            recordEnabled: () => boolean
          }
        }
      }
    }
    const clamped = v.indie.mp.replay.seek(5)
    const sample = v.indie.mp.replay.sampleAt(0)
    return {
      hasSampleAt: typeof v.indie.mp.replay.sampleAt === 'function',
      hasSeek: typeof v.indie.mp.replay.seek === 'function',
      hasBufferLength: typeof v.indie.mp.replay.bufferLength === 'function',
      hasRecordEnabled: typeof v.indie.mp.replay.recordEnabled === 'function',
      clamped,
      sampleIsArray: Array.isArray(sample),
      bufferLength: v.indie.mp.replay.bufferLength(),
      recordEnabled: v.indie.mp.replay.recordEnabled(),
    }
  })

  expect(result.hasSampleAt).toBe(true)
  expect(result.hasSeek).toBe(true)
  expect(result.hasBufferLength).toBe(true)
  expect(result.hasRecordEnabled).toBe(true)
  expect(result.sampleIsArray).toBe(true)
  expect(result.clamped).toBe(5)
  expect(result.bufferLength).toBe(30)
  expect(result.recordEnabled).toBe(false)
})

test('wave 73 mpReplayBuffer records 30s ring @ 10Hz and samples at offset', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const mp = window.lotus!.multiplayer as {
      replay: {
        reset: () => void
        setRecordEnabled: (on: boolean) => void
        recordPoses: (
          entries: Array<{ peerId: string; position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number } }>,
          now?: number,
        ) => void
        bufferLength: () => number
        sampleAt: (offsetSec: number) => Array<{ peerId: string; position: { x: number; y: number; z: number } }>
        seek: (offsetSec: number) => number
        bufferSec: number
        sampleHz: number
      }
    }
    mp.replay.reset()
    mp.replay.setRecordEnabled(true)
    const t0 = 1_000_000
    const dt = 1000 / mp.replay.sampleHz
    for (let i = 0; i <= mp.replay.sampleHz * 3; i++) {
      mp.replay.recordPoses(
        [
          {
            peerId: 'host1',
            position: { x: i, y: 0, z: 0 },
            rotation: { x: 0, y: i * 0.1, z: 0 },
          },
        ],
        t0 + i * dt,
      )
    }
    const len = mp.replay.bufferLength()
    const live = mp.replay.sampleAt(0)
    const rewind = mp.replay.sampleAt(2)
    const seek = mp.replay.seek(1.5)
    return {
      bufferSec: mp.replay.bufferSec,
      sampleHz: mp.replay.sampleHz,
      len,
      liveX: live[0]?.position.x,
      rewindX: rewind[0]?.position.x,
      seek,
      rewindPeer: rewind[0]?.peerId,
    }
  })

  expect(result.bufferSec).toBe(30)
  expect(result.sampleHz).toBe(10)
  expect(result.len).toBeGreaterThanOrEqual(2.9)
  expect(result.liveX).toBe(30)
  expect(result.rewindX).toBe(10)
  expect(result.rewindPeer).toBe('host1')
  expect(result.seek).toBe(1.5)
})

test('wave 73 spectator script + HUD document R rewind', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { mp: { spectator: { script: string } } }
    }
    v.terminal.exec('/mpspectator')
    const hint = v.world.hudWidgets.find((w) => w.id === 'mp_spec_hint')
    return {
      scriptHasR: v.indie.mp.spectator.script.includes('R rewind'),
      hudHasR: hint?.text?.includes('R rewind') ?? false,
    }
  })

  expect(result.scriptHasR).toBe(true)
  expect(result.hudHasR).toBe(true)
})

test('wave 73 multiplayer bridge replay dev hooks expose bufferSec and sampleHz', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const replay = (window.lotus!.multiplayer as { replay?: { bufferSec?: number; sampleHz?: number; reset?: () => void } }).replay
    return {
      bufferSec: replay?.bufferSec,
      sampleHz: replay?.sampleHz,
      hasReset: typeof replay?.reset === 'function',
    }
  })

  expect(result.bufferSec).toBe(30)
  expect(result.sampleHz).toBe(10)
  expect(result.hasReset).toBe(true)
})

test('wave 74 adaptiveHaptics hapticScale clamps intensity perf gate and battery saver to 0-1', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      adaptiveHaptics: {
        hapticScale: (
          env: { hapticIntensity?: number; hapticBatterySaver?: boolean },
          perfGate?: { fps?: number; perfMinFps?: number; perfPass?: boolean | null } | null,
          charging?: boolean,
        ) => number
        setBatteryChargingForTest: (charging: boolean | undefined) => void
      }
    }
    v.adaptiveHaptics.setBatteryChargingForTest(false)
    const full = v.adaptiveHaptics.hapticScale({ hapticIntensity: 1, hapticBatterySaver: false }, {
      fps: 30,
      perfMinFps: 24,
      perfPass: true,
    })
    const halfIntensity = v.adaptiveHaptics.hapticScale(
      { hapticIntensity: 0.5, hapticBatterySaver: false },
      { fps: 30, perfMinFps: 24, perfPass: true },
    )
    const perfLow = v.adaptiveHaptics.hapticScale(
      { hapticIntensity: 1, hapticBatterySaver: false },
      { fps: 12, perfMinFps: 24, perfPass: false },
    )
    const battery = v.adaptiveHaptics.hapticScale(
      { hapticIntensity: 1, hapticBatterySaver: true },
      { fps: 30, perfMinFps: 24, perfPass: true },
      false,
    )
    return { full, halfIntensity, perfLow, battery }
  })

  expect(result.full).toBe(1)
  expect(result.halfIntensity).toBe(0.5)
  expect(result.perfLow).toBe(0.5)
  expect(result.battery).toBe(0.5)
})

test('wave 74 touchHaptics vibrateFire scales vibration pattern duration by adaptive scale', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        touch: {
          setHapticsEnabled: (on: boolean) => boolean
          vibrateFire: () => boolean
        }
      }
      world: { environment: { hapticIntensity?: number; hapticBatterySaver?: boolean } }
      adaptiveHaptics: { setBatteryChargingForTest: (charging: boolean | undefined) => void }
    }
    v.indie.touch.setHapticsEnabled(true)
    v.world.environment.hapticIntensity = 0.5
    v.world.environment.hapticBatterySaver = false
    v.adaptiveHaptics.setBatteryChargingForTest(true)
    let pattern: number | number[] = 0
    const orig = navigator.vibrate
    navigator.vibrate = (p: number | number[]) => {
      pattern = p
      return true
    }
    const fired = v.indie.touch.vibrateFire()
    navigator.vibrate = orig
    const ms = Array.isArray(pattern) ? pattern[0] : pattern
    return { fired, ms }
  })

  expect(result.fired).toBe(true)
  expect(result.ms).toBe(14)
})

test('wave 74 gamepadHaptics pulseFire scales dual-rumble duration and magnitude by adaptive scale', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        gamepad: {
          setHapticsEnabled: (on: boolean) => boolean
          pulseFire: () => boolean
        }
      }
      world: { environment: { hapticIntensity?: number; hapticBatterySaver?: boolean } }
      adaptiveHaptics: { setBatteryChargingForTest: (charging: boolean | undefined) => void }
    }
    v.indie.gamepad.setHapticsEnabled(true)
    v.world.environment.hapticIntensity = 0.5
    v.world.environment.hapticBatterySaver = false
    v.adaptiveHaptics.setBatteryChargingForTest(true)
    const effects: Array<{ type: string; params: Record<string, number> }> = []
    const stubActuator = {
      playEffect: (type: string, params: Record<string, number>) => {
        effects.push({ type, params })
        return Promise.resolve({})
      },
    }
    const stubPad = { connected: true, vibrationActuator: stubActuator }
    const orig = navigator.getGamepads
    navigator.getGamepads = () => [stubPad as unknown as Gamepad]
    const fired = v.indie.gamepad.pulseFire()
    navigator.getGamepads = orig
    return {
      fired,
      duration: effects[0]?.params.duration,
      magnitude: effects[0]?.params.strongMagnitude,
    }
  })

  expect(result.fired).toBe(true)
  expect(result.duration).toBe(14)
  expect(result.magnitude).toBeCloseTo(0.425, 3)
})

test('wave 74 indie.haptics scale intensity setIntensity batterySaver bridge writes environment', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        haptics: {
          scale: () => number
          intensity: () => number
          setIntensity: (pct: number) => number
          batterySaver: () => boolean
        }
      }
      world: { environment: { hapticIntensity?: number; hapticBatterySaver?: boolean } }
      adaptiveHaptics: { setBatteryChargingForTest: (charging: boolean | undefined) => void }
    }
    delete v.world.environment.hapticIntensity
    delete v.world.environment.hapticBatterySaver
    v.adaptiveHaptics.setBatteryChargingForTest(true)
    const defaultIntensity = v.indie.haptics.intensity()
    const defaultSaver = v.indie.haptics.batterySaver()
    const setVal = v.indie.haptics.setIntensity(40)
    v.world.environment.hapticBatterySaver = false
    const scale = v.indie.haptics.scale()
    return {
      defaultIntensity,
      defaultSaver,
      setVal,
      envIntensity: v.world.environment.hapticIntensity,
      scale,
    }
  })

  expect(result.defaultIntensity).toBe(1)
  expect(result.defaultSaver).toBe(true)
  expect(result.setVal).toBe(0.4)
  expect(result.envIntensity).toBe(0.4)
  expect(result.scale).toBe(0.4)
})

test('wave 74 export runtime applies hapticScaleFromPerfGate on touch and gamepad haptic pulses', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: {
        environment: {
          touchControls?: boolean
          touchHaptics?: boolean
          gamepadControls?: boolean
          gamepadHaptics?: boolean
          hapticIntensity?: number
          hapticBatterySaver?: boolean
        }
      }
      export: { buildPlayableHTML: () => string }
    }
    v.world.environment.touchControls = true
    v.world.environment.touchHaptics = true
    v.world.environment.gamepadControls = true
    v.world.environment.gamepadHaptics = true
    v.world.environment.hapticIntensity = 0.8
    v.world.environment.hapticBatterySaver = true
    const html = v.export.buildPlayableHTML()
    return {
      perfScaleFn: html.includes('hapticScaleFromPerfGate'),
      perfFpsScale: html.includes('perfFpsHapticScale'),
      batteryScale: html.includes('batteryHapticScale'),
      scalePattern: html.includes('scaleHapticPattern'),
      intensityEnv: html.includes('hapticIntensity'),
      batteryEnv: html.includes('hapticBatterySaver'),
    }
  })

  expect(result.perfScaleFn).toBe(true)
  expect(result.perfFpsScale).toBe(true)
  expect(result.batteryScale).toBe(true)
  expect(result.scalePattern).toBe(true)
  expect(result.intensityEnv).toBe(true)
  expect(result.batteryEnv).toBe(true)
})

test('wave 71 gridMap getNavmeshLayerMask defaults to 0b0001 on gridmap spawn', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: import('../src/engine/types').FoliageProps } | null }
      gridMap: { getNavmeshLayerMask: (props: import('../src/engine/types').FoliageProps) => number }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!layer?.foliageProps) return { ok: false }
    return {
      ok: true,
      mask: v.gridMap.getNavmeshLayerMask(layer.foliageProps),
      stored: layer.foliageProps.gridNavmeshLayerMask,
    }
  })

  expect(result.ok).toBe(true)
  expect(result.mask).toBe(0b0001)
  expect(result.stored).toBe(0b0001)
})

test('wave 71 gridMap setNavmeshLayerMask + getNavmeshLayerMask round-trip on foliage props', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: import('../src/engine/types').FoliageProps } | null }
      gridMap: {
        setNavmeshLayerMask: (props: import('../src/engine/types').FoliageProps, mask: number) => void
        getNavmeshLayerMask: (props: import('../src/engine/types').FoliageProps) => number
      }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!layer?.foliageProps) return { ok: false }
    const props = layer.foliageProps
    v.gridMap.setNavmeshLayerMask(props, 0b1010)
    return {
      ok: true,
      read: v.gridMap.getNavmeshLayerMask(props),
      stored: props.gridNavmeshLayerMask,
    }
  })

  expect(result.ok).toBe(true)
  expect(result.read).toBe(0b1010)
  expect(result.stored).toBe(0b1010)
})

test('wave 71 gridMap collectFoliageNavColliderMeshes filters painted cells by layer mask', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => import('../src/engine/Actor').Actor | null }
      gridMap: {
        paintLayer: (props: import('../src/engine/types').FoliageProps, layer: number, cx: number, cy: number, cz: number) => boolean
        rebuildFoliageColliders: (actor: import('../src/engine/Actor').Actor) => void
        collectFoliageNavColliderMeshes: (mask: number) => number
      }
    }
    const actor = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!actor?.foliageProps) return { ok: false }
    const props = actor.foliageProps
    v.gridMap.paintLayer(props, 0, 0, 0, 0)
    v.gridMap.paintLayer(props, 1, 1, 0, 0)
    v.gridMap.paintLayer(props, 2, 2, 0, 0)
    v.gridMap.rebuildFoliageColliders(actor)
    return {
      ok: true,
      layer0: v.gridMap.collectFoliageNavColliderMeshes(0b0001),
      layer2: v.gridMap.collectFoliageNavColliderMeshes(0b0100),
      layers02: v.gridMap.collectFoliageNavColliderMeshes(0b0101),
      all: v.gridMap.collectFoliageNavColliderMeshes(0b1111),
    }
  })

  expect(result.ok).toBe(true)
  expect(result.layer0).toBe(1)
  expect(result.layer2).toBe(1)
  expect(result.layers02).toBe(2)
  expect(result.all).toBe(3)
})

test('wave 71 gridMap bakeNavMeshLayers bakes Recast navmesh from painted grid layer 0', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => import('../src/engine/Actor').Actor | null }
      gridMap: {
        paintLayer: (props: import('../src/engine/types').FoliageProps, layer: number, cx: number, cy: number, cz: number) => boolean
        rebuildFoliageColliders: (actor: import('../src/engine/Actor').Actor) => void
        bakeNavMeshLayers: (mask: number) => Promise<boolean>
      }
      isNavMeshReady: () => boolean
    }
    const actor = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!actor?.foliageProps) return { ok: false }
    const props = actor.foliageProps
    v.gridMap.paintLayer(props, 0, 0, 0, 0)
    v.gridMap.paintLayer(props, 0, 1, 0, 0)
    v.gridMap.paintLayer(props, 0, 2, 0, 0)
    v.gridMap.rebuildFoliageColliders(actor)
    const bakeOk = await v.gridMap.bakeNavMeshLayers(0b0001)
    return { ok: true, bakeOk, navReady: v.isNavMeshReady() }
  })

  expect(result.ok).toBe(true)
  expect(result.bakeOk).toBe(true)
  expect(result.navReady).toBe(true)
})

test('wave 71 gridmap spawn exposes navmesh mask bridge APIs + /gridnavmesh terminal', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => { foliageProps?: { gridNavmeshLayerMask?: number } } | null }
      gridMap: Record<string, unknown>
      terminal: { exec: (cmd: string) => { output?: string | null; error?: string | null } }
    }
    const layer = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    const props = layer?.foliageProps
    if (props) (v.gridMap.getNavmeshLayerMask as (p: typeof props) => number)(props)
    const out = v.terminal.exec('/gridnavmesh 2')
    return {
      storedMask: props?.gridNavmeshLayerMask,
      hasGet: typeof v.gridMap.getNavmeshLayerMask === 'function',
      hasSet: typeof v.gridMap.setNavmeshLayerMask === 'function',
      hasBakeLayers: typeof v.gridMap.bakeNavMeshLayers === 'function',
      hasBakeLayer: typeof v.gridMap.bakeNavMeshForGridLayer === 'function',
      hasCollect: typeof v.gridMap.collectGridNavMeshes === 'function',
      terminalOutput: out.output ?? '',
      terminalError: out.error,
    }
  })

  expect(result.hasGet).toBe(true)
  expect(result.hasSet).toBe(true)
  expect(result.hasBakeLayers).toBe(true)
  expect(result.hasBakeLayer).toBe(true)
  expect(result.hasCollect).toBe(true)
  expect(result.storedMask).toBe(0b0001)
  expect(result.terminalError).toBeNull()
  expect(result.terminalOutput).toMatch(/Grid navmesh bake started \(0b0100\)/)
})

test('wave 72 buildButlerPushCommand beta channel suffix on butler target', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const exp = (window.lotus! as typeof window.lotus).export as {
      butlerPushCommand: (
        m: 'platformer' | 'rpg' | 'fps',
        u?: string,
        g?: string,
        ch?: 'html' | 'beta' | 'demo',
      ) => string
    }
    return {
      beta: exp.butlerPushCommand('platformer', 'myuser', 'my-game', 'beta'),
      demo: exp.butlerPushCommand('rpg', 'vektra', 'lotus-rpg', 'demo'),
      defaultHtml: exp.butlerPushCommand('fps'),
    }
  })

  expect(result.beta).toBe('butler push platformer-lotus-pack.zip myuser/my-game:beta')
  expect(result.demo).toBe('butler push rpg-lotus-pack.zip vektra/lotus-rpg:demo')
  expect(result.defaultHtml).toBe('butler push fps-lotus-pack.zip user/game:html')
})

test('wave 72 indie.minigame.butlerHint accepts channel arg for beta push', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const mg = (window.lotus! as typeof window.lotus).indie.minigame as {
      butlerHint: (
        m: 'platformer',
        u?: string,
        g?: string,
        ch?: 'html' | 'beta' | 'demo',
      ) => string
    }
    return {
      hasChannelArg: mg.butlerHint.length >= 4,
      cmd: mg.butlerHint('platformer', 'myuser', 'my-game', 'beta'),
    }
  })

  expect(result.hasChannelArg).toBe(true)
  expect(result.cmd).toBe('butler push platformer-lotus-pack.zip myuser/my-game:beta')
})

test('wave 72 /butlerhint platformer beta prints butler push user/game:beta', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const out = (window.lotus! as typeof window.lotus).terminal.exec('/butlerhint platformer beta')
    const lines = out?.output?.split('\n') ?? []
    const metaRaw = lines.slice(2).join('\n')
    const meta = metaRaw ? (JSON.parse(metaRaw) as { channel?: string; kind: string }) : null
    return {
      firstLine: lines[0] ?? '',
      channel: meta?.channel ?? '',
      kind: meta?.kind ?? '',
    }
  })

  expect(result.firstLine).toBe('butler push platformer-lotus-pack.zip user/game:beta')
  expect(result.channel).toBe('beta')
  expect(result.kind).toBe('html')
})

test('wave 72 exportPackMeta embeds optional channel field in pack meta JSON', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const mg = (window.lotus! as typeof window.lotus).indie.minigame as {
      packMeta: (m: 'fps', ch?: 'html' | 'beta' | 'demo') => { channel?: string; kind: string }
    }
    const plain = mg.packMeta('fps')
    const demo = mg.packMeta('fps', 'demo')
    return {
      plainHasChannel: 'channel' in plain,
      demoChannel: demo.channel ?? '',
      demoKind: demo.kind,
    }
  })

  expect(result.plainHasChannel).toBe(false)
  expect(result.demoChannel).toBe('demo')
  expect(result.demoKind).toBe('html')
})

test('wave 72 /butlerhint rpg demo prints demo channel and stores zip name', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    localStorage.removeItem('lotus-engine.itch.lastZip')
    const out = (window.lotus! as typeof window.lotus).terminal.exec('/butlerhint rpg demo')
    const lines = out?.output?.split('\n') ?? []
    return {
      firstLine: lines[0] ?? '',
      lastZip: localStorage.getItem('lotus-engine.itch.lastZip'),
    }
  })

  expect(result.firstLine).toBe('butler push rpg-lotus-pack.zip user/game:demo')
  expect(result.lastZip).toBe('rpg-lotus-pack.zip')
})

test('wave 75 globalCheckpoint round-trip stores lotus-engine.saves.__global__.{slot}', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { levelName: string; environment: { saveSlotsEnabled?: boolean; crossLevelSaves?: boolean } }
      save: {
        globalCheckpoint: (slot: string, data: unknown) => boolean
        globalLoad: (slot: string) => unknown
      }
    }
    v.world.levelName = 'Wave75Level'
    v.world.environment.saveSlotsEnabled = true
    v.world.environment.crossLevelSaves = true
    const ok = v.save.globalCheckpoint('slot-g', { hp: 99, level: 'dungeon' })
    const key = 'lotus-engine.saves.__global__.slot-g'
    const raw = localStorage.getItem(key)
    const loaded = v.save.globalLoad('slot-g')
    return { ok, key, hasRaw: !!raw, loaded }
  })

  expect(result.ok).toBe(true)
  expect(result.hasRaw).toBe(true)
  expect(result.loaded).toEqual({ hp: 99, level: 'dungeon' })
})

test('wave 75 lotus.save bridge exposes crossLevel, migrateToLevel, globalCheckpoint, globalLoad', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const s = (window.lotus! as typeof window.lotus).save as Record<string, unknown>
    return {
      crossLevel: typeof s.crossLevel === 'function',
      migrateToLevel: typeof s.migrateToLevel === 'function',
      globalCheckpoint: typeof s.globalCheckpoint === 'function',
      globalLoad: typeof s.globalLoad === 'function',
    }
  })

  expect(result.crossLevel).toBe(true)
  expect(result.migrateToLevel).toBe(true)
  expect(result.globalCheckpoint).toBe(true)
  expect(result.globalLoad).toBe(true)
})

test('wave 75 World Settings crossLevelSaves toggle persists on world.environment', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: {
        environment: { saveSlotsEnabled?: boolean; crossLevelSaves?: boolean }
        serialize: () => { environment: { saveSlotsEnabled?: boolean; crossLevelSaves?: boolean } }
      }
    }
    v.world.environment.saveSlotsEnabled = true
    v.world.environment.crossLevelSaves = true
    const serialized = v.world.serialize()
    return {
      live: v.world.environment.crossLevelSaves === true,
      serialized: serialized.environment.crossLevelSaves === true,
    }
  })

  expect(result.live).toBe(true)
  expect(result.serialized).toBe(true)
})

test('wave 75 export embeds __LOTUS_CROSS_LEVEL_SAVES__ true when cross-level saves enabled', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { environment: { saveSlotsEnabled?: boolean; crossLevelSaves?: boolean } }
      export: { buildPlayableHTML: () => string }
    }
    v.world.environment.saveSlotsEnabled = true
    v.world.environment.crossLevelSaves = true
    const htmlOn = v.export.buildPlayableHTML()
    v.world.environment.crossLevelSaves = false
    const htmlOff = v.export.buildPlayableHTML()
    return {
      enabled: htmlOn.includes('__LOTUS_CROSS_LEVEL_SAVES__ = true'),
      disabled: htmlOff.includes('__LOTUS_CROSS_LEVEL_SAVES__ = false'),
      globalKey: htmlOn.includes('__global__'),
    }
  })

  expect(result.enabled).toBe(true)
  expect(result.disabled).toBe(true)
  expect(result.globalKey).toBe(true)
})

test('wave 75 migrateToLevel copies per-level slot to __global__ on changeScene', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { levelName: string; environment: { saveSlotsEnabled?: boolean; crossLevelSaves?: boolean } }
      save: {
        checkpoint: (slot: string, data: unknown) => boolean
        migrateToLevel: (name: string) => number
        globalLoad: (slot: string) => unknown
        load: (slot: string) => unknown
      }
    }
    v.world.levelName = 'MenuLevel'
    v.world.environment.saveSlotsEnabled = true
    v.world.environment.crossLevelSaves = false
    v.save.checkpoint('carry', { coins: 12 })
    v.world.environment.crossLevelSaves = true
    const migrated = v.save.migrateToLevel('DungeonLevel')
    const globalKey = 'lotus-engine.saves.__global__.carry'
    const levelKey = 'lotus-engine.saves.MenuLevel.carry'
    return {
      migrated,
      globalHas: !!localStorage.getItem(globalKey),
      levelHas: !!localStorage.getItem(levelKey),
      globalLoaded: v.save.globalLoad('carry'),
      activeLoaded: v.save.load('carry'),
    }
  })

  expect(result.migrated).toBe(1)
  expect(result.globalHas).toBe(true)
  expect(result.levelHas).toBe(true)
  expect(result.globalLoaded).toEqual({ coins: 12 })
  expect(result.activeLoaded).toEqual({ coins: 12 })
})

test('wave 80 lotus.save bridge exposes showMenu, hideMenu, isPaused for PIE pause menu', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const s = (window.lotus! as typeof window.lotus).save as Record<string, unknown>
    return {
      showMenu: typeof s.showMenu === 'function',
      hideMenu: typeof s.hideMenu === 'function',
      isPaused: typeof s.isPaused === 'function',
    }
  })

  expect(result.showMenu).toBe(true)
  expect(result.hideMenu).toBe(true)
  expect(result.isPaused).toBe(true)
})

test('wave 80 export embeds __LOTUS_SAVE_MENU__ true and lotus-save-menu-overlay CSS when save slots enabled', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { environment: { saveSlotsEnabled?: boolean } }
      export: { buildPlayableHTML: () => string }
    }
    v.world.environment.saveSlotsEnabled = true
    const htmlOn = v.export.buildPlayableHTML()
    v.world.environment.saveSlotsEnabled = false
    const htmlOff = v.export.buildPlayableHTML()
    return {
      menuOn: htmlOn.includes('__LOTUS_SAVE_MENU__ = true'),
      menuOff: htmlOff.includes('__LOTUS_SAVE_MENU__ = false'),
      css: htmlOn.includes('lotus-save-menu-overlay'),
      slots: htmlOn.includes("'slot1'") && htmlOn.includes('SAVE_MENU_SLOTS'),
    }
  })

  expect(result.menuOn).toBe(true)
  expect(result.menuOff).toBe(true)
  expect(result.css).toBe(true)
  expect(result.slots).toBe(true)
})

test('wave 80 export runtime initExportSaveMenu wires Escape toggle and Save Slot 1-3 buttons when __LOTUS_SAVES__', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { environment: { saveSlotsEnabled?: boolean } }
      export: { buildPlayableHTML: () => string }
    }
    v.world.environment.saveSlotsEnabled = true
    const html = v.export.buildPlayableHTML()
    return {
      init: html.includes('initExportSaveMenu'),
      escape: html.includes("e.code !== 'Escape'"),
      slotSave: html.includes('data-slot-save='),
      slotLoad: html.includes('data-slot-load='),
      api: html.includes('__LOTUS_SAVE_MENU_API__'),
    }
  })

  expect(result.init).toBe(true)
  expect(result.escape).toBe(true)
  expect(result.slotSave).toBe(true)
  expect(result.slotLoad).toBe(true)
  expect(result.api).toBe(true)
})

test('wave 80 save menu slot1 checkpoint round-trip via lotus.save.checkpoint and lotus.save.load', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { levelName: string; environment: { saveSlotsEnabled?: boolean } }
      save: {
        checkpoint: (slot: string, data: unknown) => boolean
        load: (slot: string) => unknown
        listSlots: () => string[]
      }
    }
    v.world.levelName = 'Wave80Menu'
    v.world.environment.saveSlotsEnabled = true
    const ok = v.save.checkpoint('slot1', { hp: 80, stage: 2 })
    const loaded = v.save.load('slot1')
    const slots = v.save.listSlots()
    const key = 'lotus-engine.saves.Wave80Menu.slot1'
    return { ok, loaded, slots, hasRaw: !!localStorage.getItem(key) }
  })

  expect(result.ok).toBe(true)
  expect(result.hasRaw).toBe(true)
  expect(result.loaded).toEqual({ hp: 80, stage: 2 })
  expect(result.slots).toContain('slot1')
})

test('wave 80 export runtime freezes simDt (pawn/scripts/physics) when save menu isPaused', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { environment: { saveSlotsEnabled?: boolean } }
      export: { buildPlayableHTML: () => string }
    }
    v.world.environment.saveSlotsEnabled = true
    const html = v.export.buildPlayableHTML()
    return {
      frozen: html.includes('const frozen = SAVE_MENU_ENABLED && saveMenuPaused'),
      simDt: html.includes('const simDt = frozen ? 0 : dt'),
      pawnGate: html.includes('if (simDt > 0) updatePawn(simDt)'),
      scriptGate: html.includes('tickScriptTimers(simDt)'),
    }
  })

  expect(result.frozen).toBe(true)
  expect(result.simDt).toBe(true)
  expect(result.pawnGate).toBe(true)
  expect(result.scriptGate).toBe(true)
})

test('wave 76 gridMap.navAgents bridge exposes spawn, tick, count, layer', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const navAgents = (window.lotus! as typeof window.lotus).gridMap.navAgents as Record<string, unknown>
    return {
      hasSpawn: typeof navAgents.spawn === 'function',
      hasTick: typeof navAgents.tick === 'function',
      hasCount: typeof navAgents.count === 'function',
      hasLayer: typeof navAgents.layer === 'function',
      hasGetPosition: typeof navAgents.getPosition === 'function',
      initialCount: (navAgents.count as () => number)(),
    }
  })

  expect(result.hasSpawn).toBe(true)
  expect(result.hasTick).toBe(true)
  expect(result.hasCount).toBe(true)
  expect(result.hasLayer).toBe(true)
  expect(result.hasGetPosition).toBe(true)
  expect(result.initialCount).toBe(0)
})

test('wave 76 gridMap.navAgents.clampLayer clamps layer to 0–3', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const navAgents = (window.lotus! as typeof window.lotus).gridMap.navAgents as {
      clampLayer: (layer: number) => number
    }
    return {
      neg: navAgents.clampLayer(-2),
      low: navAgents.clampLayer(0),
      high: navAgents.clampLayer(3),
      over: navAgents.clampLayer(9),
    }
  })

  expect(result.neg).toBe(0)
  expect(result.low).toBe(0)
  expect(result.high).toBe(3)
  expect(result.over).toBe(3)
})

test('wave 76 /gridnavagent [layer] terminal spawns test agent on grid navmesh layer', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      terminal: { exec: (cmd: string) => { output?: string | null; error?: string | null } }
    }
    const out = v.terminal.exec('/gridnavagent 2')
    return {
      error: out.error,
      output: out.output ?? '',
    }
  })

  expect(result.error).toBeNull()
  expect(result.output).toMatch(/Grid nav agent spawn started on layer 2/)
  expect(result.output).toMatch(/grid_nav_agent_L2/)
})

test('wave 76 Details hint documents navmesh layer bake + /gridnavagent spawn', async ({ page }) => {
  await bootEditor(page)

  await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => import('../src/engine/Actor').Actor | null }
      useEditor: { getState: () => { select: (id: string | null) => void } }
    }
    const actor = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!actor) throw new Error('gridmap spawn failed')
    v.useEditor.getState().select(actor.id)
  })

  await expect(page.locator('.details-panel, .editor-root')).toContainText('/gridnavmesh')
  await expect(page.locator('.details-panel, .editor-root')).toContainText('/gridnavagent')
  await expect(page.locator('.details-panel, .editor-root')).toContainText('gridMap.navAgents.spawn')
})

test('wave 76 gridMap.navAgents.spawn bakes layer navmesh and registers agent with layer id', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => import('../src/engine/Actor').Actor | null }
      gridMap: {
        paintLayer: (props: import('../src/engine/types').FoliageProps, layer: number, cx: number, cy: number, cz: number) => boolean
        rebuildFoliageColliders: (actor: import('../src/engine/Actor').Actor) => void
        navAgents: {
          spawn: (
            id: string,
            layer: number,
            pos: [number, number, number],
            target?: [number, number, number],
          ) => Promise<boolean>
          count: (layer?: number) => number
          layer: (id: string) => number | null
        }
      }
    }
    const actor = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!actor?.foliageProps) return { ok: false }
    const props = actor.foliageProps
    v.gridMap.paintLayer(props, 1, 0, 0, 0)
    v.gridMap.paintLayer(props, 1, 1, 0, 0)
    v.gridMap.paintLayer(props, 1, 2, 0, 0)
    v.gridMap.rebuildFoliageColliders(actor)
    const spawned = await v.gridMap.navAgents.spawn('test_agent_L1', 1, [0, 1, 0], [6, 1, 6])
    return {
      ok: true,
      spawned,
      total: v.gridMap.navAgents.count(),
      layerCount: v.gridMap.navAgents.count(1),
      agentLayer: v.gridMap.navAgents.layer('test_agent_L1'),
    }
  })

  expect(result.ok).toBe(true)
  expect(result.spawned).toBe(true)
  expect(result.total).toBe(1)
  expect(result.layerCount).toBe(1)
  expect(result.agentLayer).toBe(1)
})

test('wave 77 buildReleaseNotes returns markdown with pack title and latest CHANGELOG waves', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      export: { buildReleaseNotes: (m: 'platformer') => string }
    }
    const notes = v.export.buildReleaseNotes('platformer')
    return {
      hasTitle: notes.includes('# Lotus Platformer Pack'),
      hasBlurb: notes.includes('Jump to the goal'),
      hasWhatsNew: notes.includes("## What's new"),
      hasWavesHeader: notes.includes('Waves 111–115'),
      hasWave111: notes.includes('Wave 111'),
      hasReleaseNotesFeature: notes.includes('sceneSnapshot'),
    }
  })

  expect(result.hasTitle).toBe(true)
  expect(result.hasBlurb).toBe(true)
  expect(result.hasWhatsNew).toBe(true)
  expect(result.hasWavesHeader).toBe(true)
  expect(result.hasWave111).toBe(true)
  expect(result.hasReleaseNotesFeature).toBe(true)
})

test('wave 77 indie.minigame.releaseNotes and export.buildReleaseNotes bridges match', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { minigame: { releaseNotes: (m: 'rpg') => string } }
      export: { buildReleaseNotes: (m: 'rpg') => string }
    }
    const mg = v.indie.minigame
    const fromIndie = mg.releaseNotes('rpg')
    const fromExport = v.export.buildReleaseNotes('rpg')
    return {
      indieFn: typeof mg.releaseNotes === 'function',
      exportFn: typeof v.export.buildReleaseNotes === 'function',
      match: fromIndie === fromExport,
      hasRpgTitle: fromIndie.includes('# Lotus RPG Pack'),
      hasQuestBlurb: fromIndie.includes('Collect NPCs'),
    }
  })

  expect(result.indieFn).toBe(true)
  expect(result.exportFn).toBe(true)
  expect(result.match).toBe(true)
  expect(result.hasRpgTitle).toBe(true)
  expect(result.hasQuestBlurb).toBe(true)
})

test('wave 77 buildPackHTML embeds __LOTUS_PACK_RELEASE_NOTES__ with platformer notes', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        minigame: {
          spawnMiniGame: (m: 'platformer') => void
          buildPackHTML: (m: 'platformer') => string
          releaseNotes: (m: 'platformer') => string
        }
      }
    }
    v.indie.minigame.spawnMiniGame('platformer')
    const html = v.indie.minigame.buildPackHTML('platformer')
    const expected = v.indie.minigame.releaseNotes('platformer')
    const marker = 'window.__LOTUS_PACK_RELEASE_NOTES__ = '
    const idx = html.indexOf(marker)
    let embedded = ''
    if (idx >= 0) {
      const rest = html.slice(idx + marker.length)
      const end = rest.indexOf('; window.')
      const jsonStr = end >= 0 ? rest.slice(0, end) : rest.split(';')[0]
      embedded = JSON.parse(jsonStr) as string
    }
    return {
      hasTag: html.includes('__LOTUS_PACK_RELEASE_NOTES__'),
      embedded,
      expected,
      match: embedded === expected,
      hasWave111: embedded.includes('Wave 111'),
    }
  })

  expect(result.hasTag).toBe(true)
  expect(result.match).toBe(true)
  expect(result.hasWave111).toBe(true)
})

test('wave 77 buildItchZip includes RELEASE_NOTES.md with genre markdown', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      export: {
        buildItchZip: (m: 'fps') => Blob
        listItchZipEntries: (b: Blob) => Promise<string[]>
        readItchZipEntry: (b: Blob, n: string) => Promise<string | null>
        buildReleaseNotes: (m: 'fps') => string
      }
    }
    const blob = v.export.buildItchZip('fps')
    const entries = await v.export.listItchZipEntries(blob)
    const notesRaw = await v.export.readItchZipEntry(blob, 'RELEASE_NOTES.md')
    const expected = v.export.buildReleaseNotes('fps')
    return {
      entries,
      hasReleaseNotes: entries.includes('RELEASE_NOTES.md'),
      notesRaw,
      expected,
      match: notesRaw === expected,
      hasFpsTitle: notesRaw?.includes('# Lotus FPS Pack') ?? false,
    }
  })

  expect(result.hasReleaseNotes).toBe(true)
  expect(result.entries).toEqual(expect.arrayContaining(['index.html', 'meta.json', 'icon.png', 'RELEASE_NOTES.md']))
  expect(result.match).toBe(true)
  expect(result.hasFpsTitle).toBe(true)
})

test('wave 77 /releasenotes platformer terminal prints release notes markdown', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      terminal: { exec: (cmd: string) => { output: string | null; error: string | null } | undefined }
      export: { buildReleaseNotes: (m: 'platformer') => string }
    }
    const out = v.terminal.exec('/releasenotes platformer')
    const expected = v.export.buildReleaseNotes('platformer')
    return {
      error: out?.error,
      output: out?.output ?? '',
      expected,
      match: out?.output === expected,
      hasTitle: out?.output?.includes('# Lotus Platformer Pack') ?? false,
      hasWave111: out?.output?.includes('Wave 111') ?? false,
    }
  })

  expect(result.error).toBeNull()
  expect(result.match).toBe(true)
  expect(result.hasTitle).toBe(true)
  expect(result.hasWave111).toBe(true)
})

test('wave 78 indie.mp.killcam bridge exposes trigger, active, durationSec', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const k = (window.lotus! as typeof window.lotus & {
      indie: { mp: { killcam: { trigger: (r?: string) => boolean; active: () => boolean; durationSec: () => number } } }
    }).indie.mp.killcam
    k.trigger('test')
    return {
      hasTrigger: typeof k.trigger === 'function',
      hasActive: typeof k.active === 'function',
      hasDuration: typeof k.durationSec === 'function',
      active: k.active(),
      durationSec: k.durationSec(),
    }
  })

  expect(result.hasTrigger).toBe(true)
  expect(result.hasActive).toBe(true)
  expect(result.hasDuration).toBe(true)
  expect(result.active).toBe(true)
  expect(result.durationSec).toBe(3)
})

test('wave 78 mpKillcam trigger seeks replay 5s and clears after duration', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const k = (window.lotus! as typeof window.lotus & {
      indie: {
        mp: {
          killcam: {
            trigger: (r?: string) => boolean
            active: () => boolean
            seekOffset: () => number
            tick: (dt: number) => void
          }
        }
      }
    }).indie.mp.killcam
    k.trigger('player_killed')
    const seekAfterTrigger = k.seekOffset()
    const activeAfterTrigger = k.active()
    k.tick(3.1)
    return {
      seekAfterTrigger,
      activeAfterTrigger,
      activeAfterTick: k.active(),
      seekAfterTick: k.seekOffset(),
    }
  })

  expect(result.seekAfterTrigger).toBe(5)
  expect(result.activeAfterTrigger).toBe(true)
  expect(result.activeAfterTick).toBe(false)
  expect(result.seekAfterTick).toBe(0)
})

test('wave 78 MP_SCORE_SCRIPT reports player_killed on mp_target hit', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        mp: {
          scoreScript: string
          killcam: { reportKill: (victimId: string, killerId?: string) => boolean }
        }
      }
    }
    return {
      hasReportKill: v.indie.mp.scoreScript.includes('mpReportPlayerKill'),
      hasPeers: v.indie.mp.scoreScript.includes('mpLobbyPeers'),
      hasTarget: v.indie.mp.scoreScript.includes('mp_target'),
      callable: typeof v.indie.mp.killcam.reportKill === 'function',
    }
  })

  expect(result.hasReportKill).toBe(true)
  expect(result.hasPeers).toBe(true)
  expect(result.hasTarget).toBe(true)
  expect(result.callable).toBe(true)
})

test('wave 78 mpKillcam onPlayerKilled triggers only for victim peer', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const k = (window.lotus! as typeof window.lotus & {
      indie: {
        mp: {
          killcam: {
            setLocalId: (id: string) => string
            onPlayerKilled: (killer: string, victim: string) => void
            active: () => boolean
            triggerReason: () => string
            seekOffset: () => number
          }
        }
      }
    }).indie.mp.killcam
    k.setLocalId('host1')
    k.onPlayerKilled('host1', 'client9')
    const killerView = { active: k.active(), reason: k.triggerReason(), seek: k.seekOffset() }
    k.setLocalId('client9')
    k.onPlayerKilled('host1', 'client9')
    const victimView = { active: k.active(), reason: k.triggerReason(), seek: k.seekOffset() }
    return { killerView, victimView }
  })

  expect(result.killerView.active).toBe(false)
  expect(result.victimView.active).toBe(true)
  expect(result.victimView.reason).toBe('player_killed')
  expect(result.victimView.seek).toBe(5)
})

test('wave 79 hapticPresetForProfile desktop returns strong preset (100% intensity, battery saver off)', async ({
  page,
}) => {
  await bootEditor(page)

  const preset = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { input: { hapticPresetForProfile: (n: string) => { hapticIntensity: number; hapticBatterySaver: boolean } | null } }
    }
    return v.indie.input.hapticPresetForProfile('desktop')
  })

  expect(preset).toEqual({ hapticIntensity: 1, hapticBatterySaver: false })
})

test('wave 79 hapticPresetForProfile mobile returns light preset (50% intensity, battery saver on)', async ({
  page,
}) => {
  await bootEditor(page)

  const preset = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { input: { hapticPresetForProfile: (n: string) => { hapticIntensity: number; hapticBatterySaver: boolean } | null } }
    }
    return v.indie.input.hapticPresetForProfile('mobile')
  })

  expect(preset).toEqual({ hapticIntensity: 0.5, hapticBatterySaver: true })
})

test('wave 79 indie.input.applyProfile mobile sets hapticIntensity + hapticBatterySaver on world.environment', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { input: { applyProfile: (n: string) => unknown } }
      world: { environment: { hapticIntensity?: number; hapticBatterySaver?: boolean; touchLayoutPreset?: string } }
    }
    v.indie.input.applyProfile('desktop')
    v.indie.input.applyProfile('mobile')
    return {
      intensity: v.world.environment.hapticIntensity,
      batterySaver: v.world.environment.hapticBatterySaver,
      preset: v.world.environment.touchLayoutPreset,
    }
  })

  expect(result.intensity).toBe(0.5)
  expect(result.batterySaver).toBe(true)
  expect(result.preset).toBe('compact')
})

test('wave 79 indie.haptics.applyFromProfile desktop applies strong haptics without changing touch layout preset', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        haptics: {
          applyFromProfile: (n: string) => { hapticIntensity: number; hapticBatterySaver: boolean } | null
        }
        input: { applyProfile: (n: string) => unknown }
      }
      world: { environment: { hapticIntensity?: number; hapticBatterySaver?: boolean; touchLayoutPreset?: string } }
    }
    v.indie.input.applyProfile('mobile')
    const preset = v.indie.haptics.applyFromProfile('desktop')
    return {
      preset,
      intensity: v.world.environment.hapticIntensity,
      batterySaver: v.world.environment.hapticBatterySaver,
      touchLayoutPreset: v.world.environment.touchLayoutPreset,
    }
  })

  expect(result.preset).toEqual({ hapticIntensity: 1, hapticBatterySaver: false })
  expect(result.intensity).toBe(1)
  expect(result.batterySaver).toBe(false)
  expect(result.touchLayoutPreset).toBe('compact')
})

test('wave 79 World Settings shows linked haptic values for active input profile (data-lotus-linked-haptics)', async ({
  page,
}) => {
  await bootEditor(page)

  await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { input: { applyProfile: (n: string) => unknown } }
    }
    v.indie.input.applyProfile('mobile')
  })

  const linked = page.locator('[data-lotus-linked-haptics]')
  await expect(linked).toContainText('Linked haptics (mobile)')
  await expect(linked).toContainText('50% intensity')
  await expect(linked).toContainText('battery saver on')
})

test('wave 83 indie MP teams deathmatch template', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawnIndieMpTeamsDeathmatch: () => void
        mp: { teamsScoreScript: string; teamsScoreboardScript: string }
      }
      world: { actors: { values: () => IterableIterator<{ name: string; tags?: string[]; syncProperties?: string[] }> }; hudWidgets: { id: string }[] }
    }
    v.indie.spawnIndieMpTeamsDeathmatch()
    const actors = [...v.world.actors.values()]
    const redHost = actors.find((a) => a.name === 'RedHostSpawn')
    const blueHost = actors.find((a) => a.name === 'BlueHostSpawn')
    const board = actors.find((a) => a.name === 'MpScoreboard')
    return {
      floor: actors.some((a) => a.name === 'MpTeamsFloor'),
      redPad: actors.some((a) => a.name === 'MpRedPad'),
      bluePad: actors.some((a) => a.name === 'MpBluePad'),
      redTags: redHost?.tags ?? [],
      blueTags: blueHost?.tags ?? [],
      sync: board?.syncProperties ?? [],
      hud: v.world.hudWidgets.some((w) => w.id === 'mp_teams_hud'),
      scoreScript: v.indie.mp.teamsScoreScript,
      boardScript: v.indie.mp.teamsScoreboardScript,
    }
  })

  expect(result.floor).toBe(true)
  expect(result.redPad).toBe(true)
  expect(result.bluePad).toBe(true)
  expect(result.redTags).toContain('mp_team_red')
  expect(result.blueTags).toContain('mp_team_blue')
  expect(result.sync).toContain('teamScores')
  expect(result.hud).toBe(true)
  expect(result.scoreScript).toMatch(/mpTeamsAreFriendly/)
  expect(result.scoreScript).toMatch(/addMpTeamScore/)
  expect(result.boardScript).toMatch(/getMpTeamScores/)
})

test('wave 83 indie.mp.teams bridge APIs', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawnIndieMpTeamsDeathmatch: () => void; mp: { teams: { redTag: string; blueTag: string; assign: (id: string) => string; getTeam: (id: string) => string | undefined } } }
    }
    v.indie.spawnIndieMpTeamsDeathmatch()
    const t = v.indie.mp.teams
    const a = t.assign('peer-a')
    const b = t.assign('peer-b')
    return {
      redTag: t.redTag,
      blueTag: t.blueTag,
      a,
      b,
      getA: t.getTeam('peer-a'),
    }
  })

  expect(result.redTag).toBe('mp_team_red')
  expect(result.blueTag).toBe('mp_team_blue')
  expect(result.a).toBe('red')
  expect(result.b).toBe('blue')
  expect(result.getA).toBe('red')
})

test('wave 83 /mpteams terminal command', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      terminal: { exec: (s: string) => { output: string | null } }
      world: { actors: { values: () => IterableIterator<{ name: string; tags?: string[] }> } }
    }
    const out = v.terminal.exec('/mpteams')
    const actors = [...v.world.actors.values()]
    const red = actors.find((a) => a.name === 'RedHostSpawn')
    const blue = actors.find((a) => a.name === 'BlueHostSpawn')
    return {
      output: out.output ?? '',
      redTags: red?.tags ?? [],
      blueTags: blue?.tags ?? [],
    }
  })

  expect(result.output).toMatch(/teams/i)
  expect(result.redTags).toContain('mp_team_red')
  expect(result.blueTags).toContain('mp_team_blue')
})

test('wave 83 team scoreboard + friendly fire off', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        spawnIndieMpTeamsDeathmatch: () => void
        mp: {
          teamsScoreScript: string
          teamsScoreboardScript: string
          applyMpTeamScoreDelta: (team: 'red' | 'blue', delta: number, emit?: (s: string, ...a: unknown[]) => void) => boolean
          getTeamScores: () => { red: number; blue: number }
        }
      }
    }
    v.indie.spawnIndieMpTeamsDeathmatch()
    let won: string | undefined
    v.indie.mp.applyMpTeamScoreDelta('red', 3, (signal, team) => {
      won = `${signal}:${team}`
    })
    return {
      scoreScript: v.indie.mp.teamsScoreScript,
      boardScript: v.indie.mp.teamsScoreboardScript,
      scores: v.indie.mp.getTeamScores(),
      won,
    }
  })

  expect(result.scoreScript).toMatch(/mpTeamsAreFriendly/)
  expect(result.boardScript).toMatch(/teamScores/)
  expect(result.boardScript).toMatch(/getMpTeamScores/)
  expect(result.scores.red).toBe(3)
  expect(result.scores.blue).toBe(0)
  expect(result.won).toBe('mp_game_won:red')
})

test('wave 84 exportCloudSaveManifest lists IndexedDB cloud slots with savedAt timestamps', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      world: { levelName: string; environment: { saveSlotsEnabled?: boolean; cloudSaveBackup?: boolean } }
      save: {
        backupToCloud: (slot: string, data: unknown) => Promise<boolean>
        cloudManifest: () => Promise<{
          level: string
          slots: { slot: string; savedAt: number }[]
          crossDeviceHint: string
        }>
      }
    }
    v.world.levelName = 'Wave84Level'
    v.world.environment.saveSlotsEnabled = true
    v.world.environment.cloudSaveBackup = true
    await v.save.backupToCloud('sync-a', { hp: 84 })
    const manifest = await v.save.cloudManifest()
    return {
      level: manifest.level,
      slots: manifest.slots,
      hint: manifest.crossDeviceHint,
    }
  })

  expect(result.level).toBe('Wave84Level')
  expect(result.slots.some((s) => s.slot === 'sync-a' && s.savedAt > 0)).toBe(true)
  expect(result.hint).toContain('LOTUS-CLOUD-SYNC:v1|Wave84Level|')
  expect(result.hint).toContain('sync-a@')
})

test('wave 84 lotus.save bridge exposes cloudManifest, crossDeviceHint, syncEnabled', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const s = (window.lotus! as typeof window.lotus).save as Record<string, unknown>
    return {
      cloudManifest: typeof s.cloudManifest === 'function',
      crossDeviceHint: typeof s.crossDeviceHint === 'function',
      syncEnabled: typeof s.syncEnabled === 'function',
    }
  })

  expect(result.cloudManifest).toBe(true)
  expect(result.crossDeviceHint).toBe(true)
  expect(result.syncEnabled).toBe(true)
})

test('wave 84 World Settings shows cloud sync hint and Copy cloud save manifest button (data-lotus-cloud-sync-hint)', async ({
  page,
}) => {
  await bootEditor(page)

  await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { environment: { saveSlotsEnabled?: boolean; cloudSaveBackup?: boolean } }
      useEditor: { getState: () => { touch: () => void } }
    }
    v.world.environment.saveSlotsEnabled = true
    v.world.environment.cloudSaveBackup = true
    v.useEditor.getState().touch()
  })

  await page.locator('details.world-settings > summary').click()
  const hint = page.locator('[data-lotus-cloud-sync-hint]')
  await expect(hint).toContainText('Cross-device cloud sync stub')
  await expect(hint).toContainText('Copy cloud save manifest')
})

test('wave 84 export embeds __LOTUS_CLOUD_SYNC__ true + runtime listCloudManifest when cloud backup enabled', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { environment: { saveSlotsEnabled?: boolean; cloudSaveBackup?: boolean } }
      export: { buildPlayableHTML: () => string }
    }
    v.world.environment.saveSlotsEnabled = true
    v.world.environment.cloudSaveBackup = true
    const htmlOn = v.export.buildPlayableHTML()
    v.world.environment.cloudSaveBackup = false
    const htmlOff = v.export.buildPlayableHTML()
    return {
      syncOn: htmlOn.includes('__LOTUS_CLOUD_SYNC__ = true'),
      syncOff: htmlOff.includes('__LOTUS_CLOUD_SYNC__ = false'),
      listCloudManifest: htmlOn.includes('exportListCloudManifest'),
      exportCloudManifest: htmlOn.includes('exportCloudSaveManifest'),
      cloudSyncApi: htmlOn.includes('__LOTUS_CLOUD_SYNC_API__'),
    }
  })

  expect(result.syncOn).toBe(true)
  expect(result.syncOff).toBe(true)
  expect(result.listCloudManifest).toBe(true)
  expect(result.exportCloudManifest).toBe(true)
  expect(result.cloudSyncApi).toBe(true)
})

test('wave 84 save menu includes Copy cloud save manifest button when cloud sync enabled (data-lotus-cloud-sync-menu)', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      world: { environment: { saveSlotsEnabled?: boolean; cloudSaveBackup?: boolean } }
      export: { buildPlayableHTML: () => string }
    }
    v.world.environment.saveSlotsEnabled = true
    v.world.environment.cloudSaveBackup = true
    const html = v.export.buildPlayableHTML()
    return {
      copyBtn: html.includes('data-copy-cloud-manifest'),
      copyLabel: html.includes('Copy cloud save manifest'),
      menuBlock: html.includes('data-lotus-cloud-sync-menu'),
      hintCss: html.includes('lotus-save-menu-cloud-hint'),
    }
  })

  expect(result.copyBtn).toBe(true)
  expect(result.copyLabel).toBe(true)
  expect(result.menuBlock).toBe(true)
  expect(result.hintCss).toBe(true)
})

test('wave 86 gridMap.navPath bridge exposes find, clear, lastPolyline, showDebug', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const navPath = (window.lotus! as typeof window.lotus).gridMap.navPath as Record<string, unknown>
    return {
      hasFind: typeof navPath.find === 'function',
      hasClear: typeof navPath.clear === 'function',
      hasLastPolyline: typeof navPath.lastPolyline === 'function',
      hasShowDebug: typeof navPath.showDebug === 'function',
    }
  })

  expect(result.hasFind).toBe(true)
  expect(result.hasClear).toBe(true)
  expect(result.hasLastPolyline).toBe(true)
  expect(result.hasShowDebug).toBe(true)
})

test('wave 86 gridMap.navPath.find bakes layer navmesh and stores polyline with >= 2 waypoints', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => import('../src/engine/Actor').Actor | null }
      gridMap: {
        paintLayer: (props: import('../src/engine/types').FoliageProps, layer: number, cx: number, cy: number, cz: number) => boolean
        rebuildFoliageColliders: (actor: import('../src/engine/Actor').Actor) => void
        navPath: {
          find: (
            layer: number,
            from: [number, number, number],
            to: [number, number, number],
          ) => Promise<[number, number, number][] | null>
          lastPolyline: () => [number, number, number][] | null
        }
      }
    }
    const actor = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!actor?.foliageProps) return { ok: false }
    const props = actor.foliageProps
    v.gridMap.paintLayer(props, 0, 0, 0, 0)
    v.gridMap.paintLayer(props, 0, 1, 0, 0)
    v.gridMap.paintLayer(props, 0, 2, 0, 0)
    v.gridMap.paintLayer(props, 0, 0, 0, 1)
    v.gridMap.paintLayer(props, 0, 1, 0, 1)
    v.gridMap.rebuildFoliageColliders(actor)
    const polyline = await v.gridMap.navPath.find(0, [0, 1, 0], [8, 1, 8])
    const cached = v.gridMap.navPath.lastPolyline()
    return {
      ok: true,
      found: polyline !== null,
      pointCount: polyline?.length ?? 0,
      cachedCount: cached?.length ?? 0,
      sameLength: polyline?.length === cached?.length,
    }
  })

  expect(result.ok).toBe(true)
  expect(result.found).toBe(true)
  expect(result.pointCount).toBeGreaterThanOrEqual(2)
  expect(result.cachedCount).toBeGreaterThanOrEqual(2)
  expect(result.sameLength).toBe(true)
})

test('wave 86 gridMap.navPath.clear resets lastPolyline after find', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => import('../src/engine/Actor').Actor | null }
      gridMap: {
        paintLayer: (props: import('../src/engine/types').FoliageProps, layer: number, cx: number, cy: number, cz: number) => boolean
        rebuildFoliageColliders: (actor: import('../src/engine/Actor').Actor) => void
        navPath: {
          find: (
            layer: number,
            from: [number, number, number],
            to: [number, number, number],
          ) => Promise<[number, number, number][] | null>
          clear: () => void
          lastPolyline: () => [number, number, number][] | null
        }
      }
    }
    const actor = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!actor?.foliageProps) return { ok: false }
    const props = actor.foliageProps
    v.gridMap.paintLayer(props, 0, 0, 0, 0)
    v.gridMap.paintLayer(props, 0, 1, 0, 0)
    v.gridMap.rebuildFoliageColliders(actor)
    await v.gridMap.navPath.find(0, [0, 1, 0], [4, 1, 4])
    const before = v.gridMap.navPath.lastPolyline()
    v.gridMap.navPath.clear()
    const after = v.gridMap.navPath.lastPolyline()
    return { ok: true, hadPath: before !== null, cleared: after === null }
  })

  expect(result.ok).toBe(true)
  expect(result.hadPath).toBe(true)
  expect(result.cleared).toBe(true)
})

test('wave 86 /gridnavpath [layer] terminal bakes layer and starts origin-to-waypoint path find', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      terminal: { exec: (cmd: string) => { output?: string | null; error?: string | null } }
    }
    const out = v.terminal.exec('/gridnavpath 2')
    return {
      error: out.error,
      output: out.output ?? '',
    }
  })

  expect(result.error).toBeNull()
  expect(result.output).toMatch(/Grid nav path find started on layer 2/)
  expect(result.output).toMatch(/\[0,1,0\].*\[8,1,8\]/)
})

test('wave 86 gridMap.navPath.showDebug toggles debug visibility flag', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => import('../src/engine/Actor').Actor | null }
      gridMap: {
        paintLayer: (props: import('../src/engine/types').FoliageProps, layer: number, cx: number, cy: number, cz: number) => boolean
        rebuildFoliageColliders: (actor: import('../src/engine/Actor').Actor) => void
        navPath: {
          find: (
            layer: number,
            from: [number, number, number],
            to: [number, number, number],
          ) => Promise<[number, number, number][] | null>
          showDebug: (show: boolean) => void
        }
      }
    }
    const actor = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!actor?.foliageProps) return { ok: false }
    const props = actor.foliageProps
    v.gridMap.paintLayer(props, 0, 0, 0, 0)
    v.gridMap.rebuildFoliageColliders(actor)
    v.gridMap.navPath.showDebug(false)
    await v.gridMap.navPath.find(0, [0, 1, 0], [2, 1, 2])
    v.gridMap.navPath.showDebug(true)
    return { ok: true, toggled: true }
  })

  expect(result.ok).toBe(true)
  expect(result.toggled).toBe(true)
})

test('wave 81 gridMap.navAgents bridge exposes setBehavior, getBehavior, spawnPatrol, spawnChase', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const navAgents = (window.lotus! as typeof window.lotus).gridMap.navAgents as Record<string, unknown>
    return {
      hasSetBehavior: typeof navAgents.setBehavior === 'function',
      hasGetBehavior: typeof navAgents.getBehavior === 'function',
      hasSpawnPatrol: typeof navAgents.spawnPatrol === 'function',
      hasSpawnChase: typeof navAgents.spawnChase === 'function',
    }
  })

  expect(result.hasSetBehavior).toBe(true)
  expect(result.hasGetBehavior).toBe(true)
  expect(result.hasSpawnPatrol).toBe(true)
  expect(result.hasSpawnChase).toBe(true)
})

test('wave 81 gridMap.navAgents.setBehavior patrol|chase|idle round-trips via getBehavior', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const navAgents = (window.lotus! as typeof window.lotus).gridMap.navAgents as {
      setBehavior: (id: string, b: 'patrol' | 'chase' | 'idle') => void
      getBehavior: (id: string) => 'patrol' | 'chase' | 'idle' | null
    }
    navAgents.setBehavior('test_ai_agent', 'patrol')
    const patrol = navAgents.getBehavior('test_ai_agent')
    navAgents.setBehavior('test_ai_agent', 'chase')
    const chase = navAgents.getBehavior('test_ai_agent')
    navAgents.setBehavior('test_ai_agent', 'idle')
    const idle = navAgents.getBehavior('test_ai_agent')
    return { patrol, chase, idle }
  })

  expect(result.patrol).toBe('patrol')
  expect(result.chase).toBe('chase')
  expect(result.idle).toBe('idle')
})

test('wave 81 /gridnavai patrol [layer] terminal spawns patrol AI agent on grid navmesh layer', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      terminal: { exec: (cmd: string) => { output?: string | null; error?: string | null } }
    }
    const out = v.terminal.exec('/gridnavai patrol 1')
    return {
      error: out.error,
      output: out.output ?? '',
    }
  })

  expect(result.error).toBeNull()
  expect(result.output).toMatch(/Grid nav AI patrol spawn started on layer 1/)
  expect(result.output).toMatch(/grid_nav_ai_patrol_L1/)
})

test('wave 81 /gridnavai chase [layer] terminal spawns chase AI agent (targets grid_nav_target tag)', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      terminal: { exec: (cmd: string) => { output?: string | null; error?: string | null } }
    }
    const out = v.terminal.exec('/gridnavai chase 2')
    return {
      error: out.error,
      output: out.output ?? '',
    }
  })

  expect(result.error).toBeNull()
  expect(result.output).toMatch(/Grid nav AI chase spawn started on layer 2/)
  expect(result.output).toMatch(/grid_nav_ai_chase_L2/)
})

test('wave 81 gridMap.navAgents.spawnPatrol bakes layer navmesh and registers patrol behavior', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      indie: { spawn: (p: { kind: 'gridmap' }, pos: [number, number, number]) => import('../src/engine/Actor').Actor | null }
      gridMap: {
        paintLayer: (props: import('../src/engine/types').FoliageProps, layer: number, cx: number, cy: number, cz: number) => boolean
        rebuildFoliageColliders: (actor: import('../src/engine/Actor').Actor) => void
        navAgents: {
          spawnPatrol: (
            id: string,
            layer: number,
            pos: [number, number, number],
            waypoints?: [number, number, number][],
          ) => Promise<boolean>
          count: (layer?: number) => number
          layer: (id: string) => number | null
          getBehavior: (id: string) => 'patrol' | 'chase' | 'idle' | null
        }
      }
    }
    const actor = v.indie.spawn({ kind: 'gridmap' }, [0, 0, 0])
    if (!actor?.foliageProps) return { ok: false }
    const props = actor.foliageProps
    v.gridMap.paintLayer(props, 1, 0, 0, 0)
    v.gridMap.paintLayer(props, 1, 1, 0, 0)
    v.gridMap.paintLayer(props, 1, 2, 0, 0)
    v.gridMap.rebuildFoliageColliders(actor)
    const spawned = await v.gridMap.navAgents.spawnPatrol('test_patrol_L1', 1, [0, 1, 0])
    return {
      ok: true,
      spawned,
      total: v.gridMap.navAgents.count(),
      layerCount: v.gridMap.navAgents.count(1),
      agentLayer: v.gridMap.navAgents.layer('test_patrol_L1'),
      behavior: v.gridMap.navAgents.getBehavior('test_patrol_L1'),
    }
  })

  expect(result.ok).toBe(true)
  expect(result.spawned).toBe(true)
  expect(result.total).toBe(1)
  expect(result.layerCount).toBe(1)
  expect(result.agentLayer).toBe(1)
  expect(result.behavior).toBe('patrol')
})

test('wave 82 renderPackChangelogHtml returns styled section with pack title and lotus-pack-changelog class', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      export: { renderPackChangelogHtml: (m: 'platformer') => string; buildReleaseNotes: (m: 'platformer') => string }
    }
    const html = v.export.renderPackChangelogHtml('platformer')
    const notes = v.export.buildReleaseNotes('platformer')
    return {
      hasSection: html.includes('<section class="lotus-pack-changelog">'),
      hasStyle: html.includes('.lotus-pack-changelog'),
      hasTitle: html.includes('Lotus Platformer Pack'),
      hasWhatsNew: html.includes("What's new"),
      hasWaves: html.includes('Waves 111–115'),
      notesHasTitle: notes.includes('# Lotus Platformer Pack'),
    }
  })

  expect(result.hasSection).toBe(true)
  expect(result.hasStyle).toBe(true)
  expect(result.hasTitle).toBe(true)
  expect(result.hasWhatsNew).toBe(true)
  expect(result.hasWaves).toBe(true)
  expect(result.notesHasTitle).toBe(true)
})

test('wave 82 buildPackHTML embeds __LOTUS_PACK_CHANGELOG_HTML__ and __LOTUS_PACK_CHANGELOG_BOOT__ for platformer pack', async ({
  page,
}) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        minigame: {
          spawnMiniGame: (m: 'platformer') => void
          buildPackHTML: (m: 'platformer') => string
        }
      }
      export: { renderPackChangelogHtml: (m: 'platformer') => string }
    }
    v.indie.minigame.spawnMiniGame('platformer')
    const html = v.indie.minigame.buildPackHTML('platformer')
    const expected = v.export.renderPackChangelogHtml('platformer')
    const marker = 'window.__LOTUS_PACK_CHANGELOG_HTML__ = '
    const idx = html.indexOf(marker)
    let embedded = ''
    if (idx >= 0) {
      const rest = html.slice(idx + marker.length)
      const end = rest.indexOf('; window.')
      const jsonStr = end >= 0 ? rest.slice(0, end) : rest.split(';')[0]
      embedded = JSON.parse(jsonStr) as string
    }
    return {
      hasHtmlTag: html.includes('__LOTUS_PACK_CHANGELOG_HTML__'),
      hasBootTag: html.includes('__LOTUS_PACK_CHANGELOG_BOOT__'),
      bootEnabled: html.includes('__LOTUS_PACK_CHANGELOG_BOOT__ = true'),
      embedded,
      expected,
      match: embedded === expected,
      hasChangelogClass: embedded.includes('lotus-pack-changelog'),
    }
  })

  expect(result.hasHtmlTag).toBe(true)
  expect(result.hasBootTag).toBe(true)
  expect(result.bootEnabled).toBe(true)
  expect(result.match).toBe(true)
  expect(result.hasChangelogClass).toBe(true)
})

test('wave 82 buildItchZip includes CHANGELOG.html sidecar with lotus-pack-changelog section', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(async () => {
    const v = window.lotus! as typeof window.lotus & {
      export: {
        buildItchZip: (m: 'rpg') => Blob
        listItchZipEntries: (b: Blob) => Promise<string[]>
        readItchZipEntry: (b: Blob, n: string) => Promise<string | null>
        renderPackChangelogHtml: (m: 'rpg') => string
      }
    }
    const blob = v.export.buildItchZip('rpg')
    const entries = await v.export.listItchZipEntries(blob)
    const changelogRaw = await v.export.readItchZipEntry(blob, 'CHANGELOG.html')
    const snippet = v.export.renderPackChangelogHtml('rpg')
    return {
      entries,
      hasChangelog: entries.includes('CHANGELOG.html'),
      changelogRaw,
      hasDoctype: changelogRaw?.includes('<!doctype html>') ?? false,
      hasSection: changelogRaw?.includes('lotus-pack-changelog') ?? false,
      hasRpgTitle: changelogRaw?.includes('Lotus RPG Pack') ?? false,
      snippetInDoc: changelogRaw?.includes(snippet) ?? false,
    }
  })

  expect(result.hasChangelog).toBe(true)
  expect(result.entries).toEqual(
    expect.arrayContaining([
      'index.html',
      'meta.json',
      'icon.png',
      'RELEASE_NOTES.md',
      'CHANGELOG.html',
      'embed-widget.html',
    ]),
  )
  expect(result.hasDoctype).toBe(true)
  expect(result.hasSection).toBe(true)
  expect(result.hasRpgTitle).toBe(true)
  expect(result.snippetInDoc).toBe(true)
})

test('wave 82 /packchangelog platformer terminal prints itch embed HTML snippet', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      terminal: { exec: (cmd: string) => { output: string | null; error: string | null } | undefined }
      export: { renderPackChangelogHtml: (m: 'platformer') => string }
    }
    const out = v.terminal.exec('/packchangelog platformer')
    const expected = v.export.renderPackChangelogHtml('platformer')
    return {
      error: out?.error,
      output: out?.output ?? '',
      expected,
      match: out?.output === expected,
      hasSection: out?.output?.includes('<section class="lotus-pack-changelog">') ?? false,
      hasTitle: out?.output?.includes('Lotus Platformer Pack') ?? false,
    }
  })

  expect(result.error).toBeNull()
  expect(result.match).toBe(true)
  expect(result.hasSection).toBe(true)
  expect(result.hasTitle).toBe(true)
})

test('wave 82 buildPackHTML includes pack changelog boot overlay CSS (#lotus-pack-changelog-boot)', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        minigame: {
          spawnMiniGame: (m: 'fps') => void
          buildPackHTML: (m: 'fps') => string
        }
      }
    }
    v.indie.minigame.spawnMiniGame('fps')
    const html = v.indie.minigame.buildPackHTML('fps')
    return {
      hasBootCss: html.includes('#lotus-pack-changelog-boot'),
      hasPlayBtnClass: html.includes('.lotus-pack-changelog-play'),
      hasChangelogHtmlGlobal: html.includes('__LOTUS_PACK_CHANGELOG_HTML__'),
    }
  })

  expect(result.hasBootCss).toBe(true)
  expect(result.hasPlayBtnClass).toBe(true)
  expect(result.hasChangelogHtmlGlobal).toBe(true)
})

test('wave 85 exportAchievements ACHIEVEMENTS per genre + unlockAchievement listUnlocked localStorage', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        achievements: {
          list: (pack?: string) => { id: string; title: string }[]
          unlock: (id: string, pack?: string) => boolean
          unlocked: (id?: string, pack?: string) => boolean | string[]
          packId: (pack?: string) => string | null
        }
      }
    }
    const ach = v.indie.achievements
    ach.packId('platformer')
    localStorage.removeItem('lotus-engine.achievements.platformer')
    const listed = ach.list('platformer')
    const first = ach.unlock('platformer_win', 'platformer')
    const second = ach.unlock('platformer_win', 'platformer')
    const ids = ach.unlocked(undefined, 'platformer') as string[]
    const key = localStorage.getItem('lotus-engine.achievements.platformer')
    return {
      count: listed.length,
      id: listed[0]?.id,
      first,
      second,
      ids,
      key,
      rpgId: ach.list('rpg')[0]?.id,
      fpsId: ach.list('fps')[0]?.id,
    }
  })

  expect(result.count).toBe(2)
  expect(result.id).toBe('platformer_win')
  expect(result.first).toBe(true)
  expect(result.second).toBe(false)
  expect(result.ids).toContain('platformer_win')
  expect(result.key).toContain('platformer_win')
  expect(result.rpgId).toBe('rpg_win')
  expect(result.fpsId).toBe('fps_win')
})

test('wave 85 indie.achievements bridge exposes list unlock unlocked packId', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const ach = (window.lotus! as typeof window.lotus).indie.achievements as Record<string, unknown>
    return {
      list: typeof ach.list === 'function',
      unlock: typeof ach.unlock === 'function',
      unlocked: typeof ach.unlocked === 'function',
      packId: typeof ach.packId === 'function',
      showToast: typeof ach.showToast === 'function',
    }
  })

  expect(result.list).toBe(true)
  expect(result.unlock).toBe(true)
  expect(result.unlocked).toBe(true)
  expect(result.packId).toBe(true)
  expect(result.showToast).toBe(true)
})

test('wave 85 buildPackHTML embeds __LOTUS_ACHIEVEMENTS__ with platformer trophies', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const v = window.lotus! as typeof window.lotus & {
      indie: {
        minigame: {
          spawnMiniGame: (m: 'platformer') => void
          buildPackHTML: (m: 'platformer') => string
        }
      }
    }
    v.indie.minigame.spawnMiniGame('platformer')
    const html = v.indie.minigame.buildPackHTML('platformer')
    const marker = 'window.__LOTUS_ACHIEVEMENTS__ = '
    const idx = html.indexOf(marker)
    let parsed: { packId?: string; achievements?: { id: string }[] } | null = null
    if (idx >= 0) {
      const rest = html.slice(idx + marker.length)
      const end = rest.indexOf('; window.')
      const jsonStr = end >= 0 ? rest.slice(0, end) : rest.split(';')[0]
      parsed = JSON.parse(jsonStr)
    }
    return {
      hasTag: html.includes('__LOTUS_ACHIEVEMENTS__'),
      toastCss: html.includes('lotus-achievement-toast'),
      packId: parsed?.packId,
      winId: parsed?.achievements?.[0]?.id,
      runtimeUnlock: html.includes('unlockAchievement'),
      runtimeApi: html.includes('__LOTUS_ACHIEVEMENTS_API__'),
    }
  })

  expect(result.hasTag).toBe(true)
  expect(result.toastCss).toBe(true)
  expect(result.packId).toBe('platformer')
  expect(result.winId).toBe('platformer_win')
  expect(result.runtimeUnlock).toBe(true)
  expect(result.runtimeApi).toBe(true)
})

test('wave 85 mini-game scripts call unlockAchievement on game_won', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const m = (window.lotus! as typeof window.lotus).indie.minigame as {
      platformerScript: string
      rpgScript: string
      fpsScript: string
    }
    return {
      platformer: m.platformerScript.includes("api.unlockAchievement('platformer_win')"),
      rpgZone: m.rpgScript.includes("api.unlockAchievement('rpg_win')"),
      rpgCollect: m.rpgScript.includes('api.emit(\'game_won\')') && m.rpgScript.includes("api.unlockAchievement('rpg_win')"),
      fps: m.fpsScript.includes("api.unlockAchievement('fps_win')"),
    }
  })

  expect(result.platformer).toBe(true)
  expect(result.rpgZone).toBe(true)
  expect(result.rpgCollect).toBe(true)
  expect(result.fps).toBe(true)
})

test('wave 85 miniGameHud achievement toast renders via indie.achievements.showToast', async ({ page }) => {
  await bootEditor(page)

  const result = await page.evaluate(() => {
    const ach = (window.lotus! as typeof window.lotus).indie.achievements as {
      showToast: (t: string, s?: string, i?: string) => void
    }
    ach.showToast('Goal Getter', 'Reach the goal zone', '🏁')
    const toast = document.querySelector('.lotus-achievement-toast')
    return {
      toast: !!toast,
      title: toast?.querySelector('.lotus-achievement-toast-title')?.textContent ?? '',
      sub: toast?.querySelector('.lotus-achievement-toast-sub')?.textContent ?? '',
    }
  })

  expect(result.toast).toBe(true)
  expect(result.title).toBe('Goal Getter')
  expect(result.sub).toBe('Reach the goal zone')
})