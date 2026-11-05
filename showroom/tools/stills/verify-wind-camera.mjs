import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const browser = await chromium.launch({ channel: 'chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 960 }, reducedMotion: 'reduce' })
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(() => {
  window.__THREE_DEVTOOLS__ = new EventTarget()
  window.__THREE_DEVTOOLS__.addEventListener('observe', ({ detail: scene }) => {
    if (scene.isScene) scene.onAfterRender = (renderer, _, camera) => {
      if (!renderer.getRenderTarget() && renderer.domElement.id === 'car') window.windCamera = camera
    }
  })
})
const action = (name, ...args) => page.evaluate(async ([name, args]) => {
  const url = performance.getEntriesByType('resource').find(e => e.name.includes('/src/controller.ts')).name
  return (await import(url)).actions[name](...args)
}, [name, args])
const inspect = () => page.evaluate(async () => {
  const THREE = await import('/node_modules/.vite/deps/three.js')
  const camera = window.windCamera
  const direction = camera.getWorldDirection(new THREE.Vector3())
  const az = Math.atan2(-direction.x, direction.z) * 180 / Math.PI
  const el = Math.asin(-direction.y) * 180 / Math.PI
  const inlet = []
  for (const y of [0, 2.55]) for (const z of [-2.14, 2.14]) {
    inlet.push(new THREE.Vector3(4.36, y, z).project(camera).x)
  }
  return { az, el, inlet, position: camera.position.toArray(), fov: camera.fov }
})
const key = async (key, count = 1) => {
  await page.locator('#wind-interaction').focus()
  for (let i = 0; i < count; i++) await page.keyboard.press(key)
  await page.waitForTimeout(80)
}
const safe = async () => {
  const view = await inspect()
  assert(view.az >= -0.01 && view.az <= 35.01, JSON.stringify(view))
  assert(view.el >= 2.99 && view.el <= 25.01, JSON.stringify(view))
  assert(Math.max(...view.inlet) <= -1.039, 'Inlet fade must stay outside viewport: ' + JSON.stringify(view))
  return view
}
const output = new URL('../../.artifacts/wind-camera/', import.meta.url)
await mkdir(output, { recursive: true })
try {
  await page.goto('http://127.0.0.1:5173', { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('body.live', { timeout: 90000 })
  for (const id of ['vision-gt', 'su7-ultra', 'mclaren-vgt']) {
    if (id !== 'vision-gt') {
      await action('selectVehicle', id)
      await page.waitForSelector('body.live', { timeout: 90000 })
    }
    await page.locator('#track > #aero').evaluate(e => window.scrollTo(0, e.offsetTop))
    await page.locator('[data-shot="aero"].is-current').waitFor()
    for (const viewport of [{ width: 1440, height: 960 }, { width: 390, height: 844 }, { width: 2560, height: 1080 }]) {
      await page.setViewportSize(viewport)
      await page.waitForTimeout(150)
      await page.locator('#track > #aero').evaluate(e => window.scrollTo(0, e.offsetTop))
      await page.locator('[data-shot="aero"].is-current').waitFor()
      await page.locator('#wind-interaction').waitFor({ state: 'visible' })
      await key('Home')
      const initial = await safe()
      await key('-', 12)
      assert.deepEqual((await inspect()).position, initial.position, 'Zoom out stops at default')
      await key('+', 12)
      assert.notDeepEqual((await safe()).position, initial.position, 'Detail zoom remains available')
      await key('Home')
      for (const horizontal of ['ArrowLeft', 'ArrowRight']) {
        await key(horizontal, 12)
        for (const vertical of ['ArrowUp', 'ArrowDown']) {
          await key(vertical, 8)
          await safe()
        }
      }
      await page.locator('#wind-interaction').dispatchEvent('wheel', { deltaY: 160, deltaMode: 0 })
      await safe()
      await key('Home')
      await page.screenshot({ path: fileURLToPath(new URL(`${id}-${viewport.width}.png`, output)) })
      console.log('PASS', id, viewport.width, 'zoom, angle limits, inlet coverage and reset')
    }
  }
  assert.deepEqual(errors, [])
} finally {
  await browser.close()
}
