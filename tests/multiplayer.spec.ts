import { expect } from '@playwright/test'
import WebSocket from 'ws'
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

test('wave 53 multiplayer relay: both tabs ready then host starts deathmatch', async ({
  browser,
  relayAvailable,
  relayUrl,
}) => {
  test.setTimeout(120_000)
  test.skip(!relayAvailable, 'relay unavailable (port bind or WebSocket failed)')

  const MP_ROOM = 'e2e-wave53-lobby'
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

    const spawnLobby = async (page: import('@playwright/test').Page) => {
      await page.evaluate(() => {
        const v = window.lotus! as typeof window.lotus & { indie: { spawnIndieMpLobby: () => void } }
        v.indie.spawnIndieMpLobby()
      })
    }
    await spawnLobby(pageA)
    await spawnLobby(pageB)

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

    await hostPage!.waitForFunction(
      () => {
        const v = window.lotus! as typeof window.lotus & {
          indie: { mp: { lobby: { peers: () => string[] } } }
        }
        return v.indie.mp.lobby.peers().length >= 2
      },
      { timeout: 15_000 },
    )

    await Promise.all([
      hostPage!.evaluate(() => {
        const v = window.lotus! as typeof window.lotus & {
          indie: { mp: { lobby: { setReady: (r: boolean) => void } } }
        }
        v.indie.mp.lobby.setReady(true)
      }),
      clientPage!.evaluate(() => {
        const v = window.lotus! as typeof window.lotus & {
          indie: { mp: { lobby: { setReady: (r: boolean) => void } } }
        }
        v.indie.mp.lobby.setReady(true)
      }),
    ])

    await hostPage!.waitForFunction(
      () => {
        const v = window.lotus! as typeof window.lotus & {
          indie: { mp: { lobby: { allReady: () => boolean; peerReadyCount: () => number } } }
        }
        return v.indie.mp.lobby.allReady() && v.indie.mp.lobby.peerReadyCount() >= 2
      },
      { timeout: 15_000 },
    )

    const started = await hostPage!.evaluate(() => {
      const v = window.lotus! as typeof window.lotus & {
        indie: { mp: { lobby: { tryStart: () => boolean; allReady: () => boolean } } }
        multiplayer: { isHost: () => boolean }
      }
      return {
        isHost: v.multiplayer.isHost(),
        allReady: v.indie.mp.lobby.allReady(),
        started: v.indie.mp.lobby.tryStart(),
      }
    })
    expect(started.isHost).toBe(true)
    expect(started.allReady).toBe(true)
    expect(started.started || started.allReady).toBe(true)

    await hostPage!.waitForFunction(
      () => [...(window.lotus?.world?.actors?.values?.() ?? [])].some((a) => a.name === 'MpScoreboard'),
      { timeout: 15_000 },
    )
    await clientPage!.waitForFunction(
      () => [...(window.lotus?.world?.actors?.values?.() ?? [])].some((a) => a.name === 'MpScoreboard'),
      { timeout: 15_000 },
    )

    const hostDm = await hostPage!.evaluate(() => {
      const lobby = [...window.lotus!.world.actors.values()].find((a) => a.name === 'MpLobbyManager')
      const board = [...window.lotus!.world.actors.values()].find((a) => a.name === 'MpScoreboard')
      const targets = [...window.lotus!.world.actors.values()].filter((a) => a.tags.includes('mp_target'))
      return { lobbyGone: !lobby, board: !!board, targetCount: targets.length }
    })
    const clientDm = await clientPage!.evaluate(() => {
      const lobby = [...window.lotus!.world.actors.values()].find((a) => a.name === 'MpLobbyManager')
      const board = [...window.lotus!.world.actors.values()].find((a) => a.name === 'MpScoreboard')
      return { lobbyGone: !lobby, board: !!board }
    })

    expect(hostDm.lobbyGone).toBe(true)
    expect(hostDm.board).toBe(true)
    expect(hostDm.targetCount).toBe(3)
    expect(clientDm.lobbyGone).toBe(true)
    expect(clientDm.board).toBe(true)
  } finally {
    await contextA.close()
    await contextB.close()
  }
})

test('wave 58 multiplayer relay: public room list + ping', async ({
  browser,
  relayAvailable,
  relayUrl,
}) => {
  test.skip(!relayAvailable, 'relay unavailable (port bind or WebSocket failed)')

  const ROOM_A = 'e2e-wave58-room-a'
  const ROOM_B = 'e2e-wave58-room-b'
  const contextA = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const contextB = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const pageA = await contextA.newPage()
  const pageB = await contextB.newPage()

  try {
    await bootEditor(pageA, relayUrl, ROOM_A)
    await bootEditor(pageB, relayUrl, ROOM_B)

    await pageA.keyboard.press('Alt+KeyP')
    await pageA.waitForFunction(() => window.lotus?.multiplayer?.connected?.() === true, { timeout: 15_000 })
    await pageB.keyboard.press('Alt+KeyP')
    await pageB.waitForFunction(() => window.lotus?.multiplayer?.connected?.() === true, { timeout: 15_000 })

    await pageA.waitForFunction(
      ([roomA, roomB]) => {
        const mp = window.lotus?.multiplayer as {
          listRooms?: () => { room: string; peers: number }[]
          refreshRooms?: () => void
        }
        mp?.refreshRooms?.()
        const rooms = mp?.listRooms?.() ?? []
        const names = rooms.map((r) => r.room).sort()
        return names.includes(roomA) && names.includes(roomB)
      },
      [ROOM_A, ROOM_B],
      { timeout: 15_000 },
    )

    const snapshot = await pageA.evaluate(() => {
      const mp = window.lotus!.multiplayer as {
        listRooms: () => { room: string; peers: number }[]
        pingMs: () => number | null
        refreshRooms: () => void
      }
      mp.refreshRooms()
      const rooms = mp.listRooms()
      const status = document.querySelector('.status-message')?.textContent ?? ''
      return {
        rooms: rooms.map((r) => r.room).sort(),
        peerCounts: Object.fromEntries(rooms.map((r) => [r.room, r.peers])),
        ping: mp.pingMs(),
        status,
      }
    })

    expect(snapshot.rooms).toContain(ROOM_A)
    expect(snapshot.rooms).toContain(ROOM_B)
    expect(snapshot.peerCounts[ROOM_A]).toBeGreaterThanOrEqual(1)
    expect(snapshot.peerCounts[ROOM_B]).toBeGreaterThanOrEqual(1)

    await pageA.waitForFunction(
      () => {
        const ping = (
          window.lotus?.multiplayer as { pingMs?: () => number | null; refreshRooms?: () => void }
        )?.pingMs?.()
        if (ping == null) {
          ;(
            window.lotus?.multiplayer as { refreshRooms?: () => void }
          )?.refreshRooms?.()
          return false
        }
        return ping >= 0
      },
      { timeout: 15_000 },
    )

    const withPing = await pageA.evaluate(() => {
      const mp = window.lotus!.multiplayer as { pingMs: () => number | null }
      const status = document.querySelector('.status-message')?.textContent ?? ''
      return { ping: mp.pingMs(), status }
    })
    expect(withPing.ping).not.toBeNull()
    expect(withPing.status).toMatch(/\d+ms/)
  } finally {
    await contextA.close()
    await contextB.close()
  }
})

test('wave 63 multiplayer relay: dedicated host 000000 holds authority over clients', async ({
  browser,
  relayAvailable,
  relayUrl,
}) => {
  test.skip(!relayAvailable, 'relay unavailable (port bind or WebSocket failed)')

  const MP_ROOM = 'e2e-wave63-dedicated'
  const DEDICATED_HOST_ID = '000000'

  const hostWs = new WebSocket(relayUrl)
  await new Promise<void>((resolve, reject) => {
    hostWs.once('open', () => resolve())
    hostWs.once('error', reject)
  })
  hostWs.send(JSON.stringify({ t: 'join', room: MP_ROOM, id: DEDICATED_HOST_ID }))

  const context = await browser.newContext({ baseURL: test.info().project.use.baseURL })
  const page = await context.newPage()

  try {
    await page.addInitScript(
      ({ url, room }) => {
        localStorage.clear()
        localStorage.setItem(
          'lotus-engine.multiplayer',
          JSON.stringify({ url, room, enabled: true, dedicatedServer: false }),
        )
      },
      { url: relayUrl, room: MP_ROOM },
    )
    await page.goto('/')
    await page.waitForFunction(() => Boolean(window.lotus?.world?.actors?.size))

    await page.keyboard.press('Alt+KeyP')
    await page.waitForFunction(() => window.lotus?.multiplayer?.connected?.() === true, {
      timeout: 15_000,
    })

    await page.waitForFunction(
      () => (window.lotus?.multiplayer?.peerCount?.() ?? 0) >= 1,
      { timeout: 15_000 },
    )

    const client = await page.evaluate(() => {
      const mp = window.lotus!.multiplayer as {
        isHost: () => boolean
        localId: () => string
        connected: () => boolean
        peerCount: () => number
      }
      return {
        connected: mp.connected(),
        isHost: mp.isHost(),
        localId: mp.localId(),
        peers: mp.peerCount(),
      }
    })

    expect(client.connected).toBe(true)
    expect(client.isHost).toBe(false)
    expect(client.localId).not.toBe(DEDICATED_HOST_ID)
    expect(client.peers).toBeGreaterThanOrEqual(1)
  } finally {
    hostWs.close()
    await context.close()
  }
})
