#!/usr/bin/env node
/**
 * Wave 22 — headless export perf regression probe for CI.
 * Builds, boots editor via preview, exports playable HTML, probes __LOTUS_EXPORT_PERF__.perfPass.
 */
import { execSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const HOST = '127.0.0.1'
const PORT = 4175
const BASE = `http://${HOST}:${PORT}/`
const GPU_ARGS = ['--enable-gpu', '--use-angle=gl-egl']
const MIN_FPS = Number(process.env.LOTUS_PERF_MIN_FPS ?? 12)
const WAIT_MS = Number(process.env.LOTUS_PERF_WAIT_MS ?? 8000)

function run(cmd, opts = {}) {
  execSync(cmd, { cwd: root, stdio: 'inherit', ...opts })
}

function waitForServer(url, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tick = () => {
      http
        .get(url, (res) => {
          res.resume()
          resolve()
        })
        .on('error', () => {
          if (Date.now() > deadline) reject(new Error(`preview server not ready: ${url}`))
          else setTimeout(tick, 400)
        })
    }
    tick()
  })
}

async function main() {
  console.log('[perf-gate] building…')
  run('npm run build')

  const preview = spawn('npm', ['run', 'preview', '--', '--host', HOST, '--port', String(PORT)], {
    cwd: root,
    stdio: 'ignore',
    detached: true,
  })

  let browser
  try {
    await waitForServer(BASE)
    browser = await chromium.launch({ headless: true, args: GPU_ARGS })
    const page = await browser.newPage()
    await page.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await page.waitForFunction(() => !!window.lotus?.export?.buildPlayableHTML, { timeout: 90_000 })

    const html = await page.evaluate(() => window.lotus.export.buildPlayableHTML())
    const outPath = path.join(root, 'dist', 'perf-gate.play.html')
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, html, 'utf8')

    await page.goto(`${BASE}perf-gate.play.html`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await page.waitForSelector('canvas', { timeout: 90_000 })
    await page.waitForFunction(
      () => document.getElementById('overlay')?.textContent?.includes('Click to play') ?? false,
      { timeout: 90_000 },
    )

    await page.waitForTimeout(WAIT_MS)

    const perf = await page.evaluate(() => window.__LOTUS_EXPORT_PERF__ ?? null)
    const fps = perf?.fps ?? 0
    const pass = perf?.perfPass === true
    const min = perf?.perfMinFps ?? 20

    console.log(`[perf-gate] fps=${fps} min=${min} perfPass=${pass}`)
    if (!pass || fps < MIN_FPS) {
      console.error(`[perf-gate] FAIL — fps ${fps} below gate (min export ${min}, script floor ${MIN_FPS})`)
      process.exit(1)
    }
    console.log('[perf-gate] PASS')
  } finally {
    if (browser) await browser.close()
    try {
      process.kill(-preview.pid)
    } catch {
      preview.kill()
    }
  }
}

main().catch((e) => {
  console.error('[perf-gate] error:', e)
  process.exit(1)
})