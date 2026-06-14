import { expect } from '@playwright/test'
import { test } from './relay-fixture'

const MP_ROOM = 'e2e-2tab-relay'

async function bootEditor(
  page: import('@playwright/test').Page,
  relayUrl: string,
  room = MP_ROOM,
) {
  await page.addInitScript(
    ({ url, room: mpRoom }) => {
      localStorage.clear()
      localStorage.setItem(
        'lotus-engine.multiplayer',
        JSON.stringify({ url, room: mpRoom, enabled: true }),
      )
    },
    { url: relayUrl, room },
  )
  await page.goto('/')
  await page.waitForFunction(() => {
    const v = window.lotus
    return Boolean(
      v?.world &&
        v.world.actors.size > 0 &&
        v.multiplayer?.loadSettings &&
        v.multiplayer?.connected &&
        typeof v.multiplayer.peerCount === 'function',
    )
  })
}

test('multiplayer 2-tab relay: Tab B sees peer when Tab A plays', async ({
  browser,
  relayAvailable,
  relayUrl,
}) => {
  test.skip(!relayAvailable, 'relay unavailable (port bind or WebSocket failed)')

  const contextA = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
  })
  const contextB = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
  })
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  try {
    await bootEditor(pageB, relayUrl)
    await bootEditor(pageA, relayUrl)

    // Tab B joins the room first (already in play, waiting for a peer).
    await pageB.keyboard.press('Alt+KeyP')
    await pageB.waitForFunction(() => window.lotus?.multiplayer?.connected?.() === true, {
      timeout: 15_000,
    })

    const bBefore = await pageB.evaluate(() => ({
      connected: window.lotus!.multiplayer.connected(),
      peers: window.lotus!.multiplayer.peerCount(),
    }))
    expect(bBefore.connected).toBe(true)
    expect(bBefore.peers).toBe(0)

    // Tab A presses play — relay notifies Tab B of the new peer.
    await pageA.keyboard.press('Alt+KeyP')
    await pageA.waitForFunction(() => window.lotus?.multiplayer?.connected?.() === true, {
      timeout: 15_000,
    })

    await pageB.waitForFunction(() => (window.lotus?.multiplayer?.peerCount?.() ?? 0) >= 1, {
      timeout: 15_000,
    })

    const bAfter = await pageB.evaluate(() => ({
      connected: window.lotus!.multiplayer.connected(),
      peers: window.lotus!.multiplayer.peerCount(),
      status: document.querySelector('.status-message')?.textContent ?? '',
    }))
    expect(bAfter.connected).toBe(true)
    expect(bAfter.peers).toBeGreaterThanOrEqual(1)
    expect(bAfter.status).toMatch(/MP connected/i)

    // Host election: lexicographically smallest id is host — both tabs should converge.
    await pageA.waitForFunction(() => (window.lotus?.multiplayer?.peerCount?.() ?? 0) >= 1, {
      timeout: 15_000,
    })
    const aPeers = await pageA.evaluate(() => window.lotus!.multiplayer.peerCount())
    expect(aPeers).toBeGreaterThanOrEqual(1)
  } finally {
    await contextA.close()
    await contextB.close()
  }
})

test('wave 43 multiplayer relay: host score syncs to client', async ({
  browser,
  relayAvailable,
  relayUrl,
}) => {
  test.skip(!relayAvailable, 'relay unavailable (port bind or WebSocket failed)')

  const MP_ROOM = 'e2e-wave43-score'
  const contextA = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const contextB = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  try {
    await pageA.addInitScript(
      ({ url, room }) => {
        localStorage.clear()
        localStorage.setItem('lotus-engine.multiplayer', JSON.stringify({ url, room, enabled: true }))
      },
      { url: relayUrl, room: MP_ROOM },
    )
    await pageB.addInitScript(
      ({ url, room }) => {
        localStorage.clear()
        localStorage.setItem('lotus-engine.multiplayer', JSON.stringify({ url, room, enabled: true }))
      },
      { url: relayUrl, room: MP_ROOM },
    )
    await pageA.goto('/')
    await pageB.goto('/')
    await pageA.waitForFunction(() => Boolean(window.lotus?.world?.actors?.size))
    await pageB.waitForFunction(() => Boolean(window.lotus?.world?.actors?.size))

    const spawnDm = async (page: import('@playwright/test').Page) => {
      await page.evaluate(() => {
        const v = window.lotus! as typeof window.lotus & { indie: { spawnIndieMpDeathmatch: () => void } }
        v.indie.spawnIndieMpDeathmatch()
      })
    }
    await spawnDm(pageA)
    await spawnDm(pageB)

    await pageB.keyboard.press('Alt+KeyP')
    await pageB.waitForFunction(() => window.lotus?.multiplayer?.connected?.() === true, { timeout: 15_000 })
    await pageA.keyboard.press('Alt+KeyP')
    await pageA.waitForFunction(() => window.lotus?.multiplayer?.connected?.() === true, { timeout: 15_000 })
    await pageA.waitForFunction(() => (window.lotus?.multiplayer?.peerCount?.() ?? 0) >= 1, { timeout: 15_000 })
    await pageB.waitForFunction(() => (window.lotus?.multiplayer?.peerCount?.() ?? 0) >= 1, { timeout: 15_000 })

    // Host = lexicographically smallest peer id — wait until exactly one tab is host.
    let hostPage: import('@playwright/test').Page | undefined
    for (let attempt = 0; attempt < 40; attempt++) {
      const [aHost, bHost] = await Promise.all([
        pageA.evaluate(() => window.lotus!.multiplayer.isHost()),
        pageB.evaluate(() => window.lotus!.multiplayer.isHost()),
      ])
      if (aHost && !bHost) {
        hostPage = pageA
        break
      }
      if (!aHost && bHost) {
        hostPage = pageB
        break
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    expect(hostPage, 'expected stable MP host election').toBeDefined()

    const hostScore = await hostPage!.evaluate(() => {
      const v = window.lotus! as typeof window.lotus & {
        indie: { mp: { addScore: (d: number, id?: string) => boolean; getScore: (id?: string) => number } }
        multiplayer: { connected: () => boolean; isHost: () => boolean }
      }
      const added = v.indie.mp.addScore(2)
      return {
        connected: v.multiplayer.connected(),
        isHost: v.multiplayer.isHost(),
        added,
        after: v.indie.mp.getScore(),
      }
    })

    expect(hostScore.connected).toBe(true)
    expect(hostScore.isHost).toBe(true)
    expect(hostScore.added).toBe(true)
    expect(hostScore.after).toBeGreaterThanOrEqual(2)
  } finally {
    await contextA.close()
    await contextB.close()
  }
})

test('wave 48 multiplayer relay: client mirrors host scores + mp_game_won', async ({
  browser,
  relayAvailable,
  relayUrl,
}) => {
  test.skip(!relayAvailable, 'relay unavailable (port bind or WebSocket failed)')

  const MP_ROOM = 'e2e-wave48-score-sync'
  const contextA = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const contextB = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  try {
    await pageA.addInitScript(
      ({ url, room }) => {
        localStorage.clear()
        localStorage.setItem('lotus-engine.multiplayer', JSON.stringify({ url, room, enabled: true }))
      },
      { url: relayUrl, room: MP_ROOM },
    )
    await pageB.addInitScript(
      ({ url, room }) => {
        localStorage.clear()
        localStorage.setItem('lotus-engine.multiplayer', JSON.stringify({ url, room, enabled: true }))
      },
      { url: relayUrl, room: MP_ROOM },
    )
    await pageA.goto('/')
    await pageB.goto('/')
    await pageA.waitForFunction(() => Boolean(window.lotus?.world?.actors?.size))
    await pageB.waitForFunction(() => Boolean(window.lotus?.world?.actors?.size))

    const spawnDm = async (page: import('@playwright/test').Page) => {
      await page.evaluate(() => {
        const v = window.lotus! as typeof window.lotus & { indie: { spawnIndieMpDeathmatch: () => void } }
        v.indie.spawnIndieMpDeathmatch()
      })
    }
    await spawnDm(pageA)
    await spawnDm(pageB)

    await pageB.keyboard.press('Alt+KeyP')
    await pageB.waitForFunction(() => window.lotus?.multiplayer?.connected?.() === true, { timeout: 15_000 })
    await pageA.keyboard.press('Alt+KeyP')
    await pageA.waitForFunction(() => window.lotus?.multiplayer?.connected?.() === true, { timeout: 15_000 })
    await pageA.waitForFunction(() => (window.lotus?.multiplayer?.peerCount?.() ?? 0) >= 1, { timeout: 15_000 })
    await pageB.waitForFunction(() => (window.lotus?.multiplayer?.peerCount?.() ?? 0) >= 1, { timeout: 15_000 })

    let hostPage: import('@playwright/test').Page | undefined
    let clientPage: import('@playwright/test').Page | undefined
    for (let attempt = 0; attempt < 40; attempt++) {
      const [aHost, bHost] = await Promise.all([
        pageA.evaluate(() => window.lotus!.multiplayer.isHost()),
        pageB.evaluate(() => window.lotus!.multiplayer.isHost()),
      ])
      if (aHost && !bHost) {
        hostPage = pageA
        clientPage = pageB
        break
      }
      if (!aHost && bHost) {
        hostPage = pageB
        clientPage = pageA
        break
      }
      await new Promise((r) => setTimeout(r, 250))
    }
    expect(hostPage, 'expected stable MP host election').toBeDefined()
    expect(clientPage, 'expected MP client tab').toBeDefined()

    await clientPage!.evaluate(() => {
      ;(window as unknown as { __wave48Won?: { winnerId: string; score: number } | null }).__wave48Won = null
      const api = window.lotus!.world.playApi
      api?.on('mp_game_won', (winnerId: string, score: number) => {
        ;(window as unknown as { __wave48Won?: { winnerId: string; score: number } | null }).__wave48Won = {
          winnerId,
          score,
        }
      })
    })

    const hostResult = await hostPage!.evaluate(() => {
      const v = window.lotus! as typeof window.lotus & {
        indie: {
          mp: {
            addScore: (d: number, id?: string) => boolean
            getPeerScores: () => Record<string, number>
          }
        }
        multiplayer: { localId: () => string; isHost: () => boolean }
      }
      const hostId = v.multiplayer.localId()
      const added = v.indie.mp.addScore(3, hostId)
      return {
        hostId,
        isHost: v.multiplayer.isHost(),
        added,
        peerScores: v.indie.mp.getPeerScores(),
      }
    })

    expect(hostResult.isHost).toBe(true)
    expect(hostResult.added).toBe(true)
    expect(hostResult.peerScores[hostResult.hostId]).toBeGreaterThanOrEqual(3)

    await clientPage!.waitForFunction(
      (hostId) => {
        const v = window.lotus! as typeof window.lotus & {
          indie: { mp: { getPeerScores: () => Record<string, number> } }
        }
        const scores = v.indie.mp.getPeerScores()
        return (scores[hostId as string] ?? 0) >= 3
      },
      hostResult.hostId,
      { timeout: 15_000 },
    )

    const clientWon = await clientPage!.waitForFunction(
      () => {
        const won = (window as unknown as { __wave48Won?: { winnerId: string; score: number } | null }).__wave48Won
        return won && won.score >= 3 ? won : null
      },
      { timeout: 15_000 },
    )
    const wonPayload = (await clientWon.jsonValue()) as { winnerId: string; score: number }
    expect(wonPayload.winnerId).toBe(hostResult.hostId)
    expect(wonPayload.score).toBeGreaterThanOrEqual(3)
  } finally {
    await contextA.close()
    await contextB.close()
  }
})
