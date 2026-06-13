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
        'vektra-engine.multiplayer',
        JSON.stringify({ url, room: mpRoom, enabled: true }),
      )
    },
    { url: relayUrl, room },
  )
  await page.goto('/')
  await page.waitForFunction(() => {
    const v = window.vektra
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
    await pageB.waitForFunction(() => window.vektra?.multiplayer?.connected?.() === true, {
      timeout: 15_000,
    })

    const bBefore = await pageB.evaluate(() => ({
      connected: window.vektra!.multiplayer.connected(),
      peers: window.vektra!.multiplayer.peerCount(),
    }))
    expect(bBefore.connected).toBe(true)
    expect(bBefore.peers).toBe(0)

    // Tab A presses play — relay notifies Tab B of the new peer.
    await pageA.keyboard.press('Alt+KeyP')
    await pageA.waitForFunction(() => window.vektra?.multiplayer?.connected?.() === true, {
      timeout: 15_000,
    })

    await pageB.waitForFunction(() => (window.vektra?.multiplayer?.peerCount?.() ?? 0) >= 1, {
      timeout: 15_000,
    })

    const bAfter = await pageB.evaluate(() => ({
      connected: window.vektra!.multiplayer.connected(),
      peers: window.vektra!.multiplayer.peerCount(),
      status: document.querySelector('.status-message')?.textContent ?? '',
    }))
    expect(bAfter.connected).toBe(true)
    expect(bAfter.peers).toBeGreaterThanOrEqual(1)
    expect(bAfter.status).toMatch(/MP connected/i)

    // Host election: lexicographically smallest id is host — both tabs should converge.
    await pageA.waitForFunction(() => (window.vektra?.multiplayer?.peerCount?.() ?? 0) >= 1, {
      timeout: 15_000,
    })
    const aPeers = await pageA.evaluate(() => window.vektra!.multiplayer.peerCount())
    expect(aPeers).toBeGreaterThanOrEqual(1)
  } finally {
    await contextA.close()
    await contextB.close()
  }
})