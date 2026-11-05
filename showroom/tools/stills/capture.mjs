import { mkdir, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

// Start the showroom in another terminal, then run npm run capture -- <local URL>.
// CHROME_PATH can select a Chromium executable. The default is installed Chrome.
const url = new URL(process.argv[2] || 'http://127.0.0.1:5173')
if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
  throw new Error('Use the local showroom URL')
const output = new URL('../../public/stills/', import.meta.url)
await mkdir(fileURLToPath(output), { recursive: true })
const browser = await chromium.launch(
  process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' },
)
const plates = new Map()
try {
  // Overscan vertically. CSS crops around the same optical center as the
  // perspective camera, keeping the full car in frame on intermediate aspect ratios.
  for (const portrait of [false, true]) {
    const page = await browser.newPage({
      viewport: portrait ? { width: 862, height: 2140 } : { width: 1760, height: 1860 },
      deviceScaleFactor: 1,
      reducedMotion: 'reduce',
    })
    // The local capture tool observes the main camera through Three's inspector
    // hook. All finishes can then be exposed at the exact same simulation time.
    await page.addInitScript(() => {
      window.__THREE_DEVTOOLS__ = new EventTarget()
      window.__THREE_DEVTOOLS__.addEventListener('observe', ({ detail: scene }) => {
        if (!scene.isScene) return
        scene.onAfterRender = (renderer, _, camera) => {
          if (!renderer.getRenderTarget() && renderer.domElement.id === 'car') {
            window.studioFrame = { renderer, scene, camera }
          }
        }
      })
    })
    await page.goto(url.href)
    await page.waitForSelector('body.live', { timeout: 60000 })
    async function openTool(id) {
      const trigger = page.locator('#' + id)
      if (await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click()
    }
    async function press(id) {
      const tool = { 'smoke-toggle': 'wind-settings', 'door-toggle': 'vehicle-settings', 'drive-toggle': 'vehicle-settings' }[id]
      if (tool) await openTool(tool)
      await page.locator('#' + id).evaluate((el) => el.click())
    }
    async function capture(name) {
      await openTool('paint-summary')
      await page.locator('#paint-picker').waitFor()
      const exposures = await page.evaluate(async (portrait) => {
        for (let i = 0; i < 3; i++) await new Promise((resolve) => requestAnimationFrame(resolve))
        const { renderer, scene, camera } = window.studioFrame
        const source = renderer.domElement
        const canvas = document.createElement('canvas')
        canvas.width = portrait ? 760 : source.width
        canvas.height = Math.round((source.height * canvas.width) / source.width)
        const ctx = canvas.getContext('2d')
        ctx.imageSmoothingQuality = 'high'
        const exposures = []
        for (const option of document.querySelectorAll('#paint-picker input')) {
          option.click()
          // The controller updates the material synchronously; keep all paints
          // in this frame so wheel, road and smoke positions remain identical.
          renderer.render(scene, camera)
          ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
          exposures.push([option.value, canvas.toDataURL('image/webp', 0.88).split(',')[1]])
        }
        return exposures
      }, portrait)
      await page.keyboard.press('Escape')
      for (const [finish, data] of exposures) {
        const prefix = finish === 'original' ? '' : finish + '/'
        plates.set(prefix + name + (portrait ? '-p' : '') + '.webp', Buffer.from(data, 'base64'))
      }
    }
    for (const id of await page
      .locator('#track>div')
      .evaluateAll((els) => els.map((el) => el.id))) {
      await page.locator('#' + id).evaluate((el) => window.scrollTo(0, el.offsetTop))
      await page.waitForSelector('[data-shot="' + id + '"].is-current', { state: 'attached' })
      await capture(id)
      if (id === 'aero') {
        await press('smoke-toggle')
        await capture('aero-clear')
        await press('smoke-toggle')
      }
    }
    await press('open-explorer')
    async function photographStates(view) {
      await capture(view)
      await press('door-toggle')
      await page.waitForFunction(
        () => document.querySelector('#vehicle-phase').textContent === '双门已开',
      )
      await capture(view + '-doors')
      await press('drive-toggle')
      await page.waitForFunction(() =>
        document.querySelector('#vehicle-phase').textContent.includes('行驶中'),
      )
      await capture(view + '-drive')
      await press('drive-toggle')
      await page.waitForFunction(
        () => document.querySelector('#vehicle-phase').textContent === '驻车',
      )
    }
    for (let i = 0; i < 3; i++) {
      await openTool('camera-settings')
      await page.locator('[data-preset]').nth(i).evaluate((el) => el.click())
      await photographStates('view-' + i)
    }
    await openTool('camera-settings')
    await page.getByRole('radio', { name: '第一人称 · 驾驶席', exact: true }).click()
    await photographStates('view-cockpit')
    await page.close()
  }
} finally {
  await browser.close()
}
// Write only after both sessions close so Vite cannot reload a camera mid-shot.
for (const [name, bytes] of plates) {
  const file = new URL(name, output)
  await mkdir(new URL('.', file), { recursive: true })
  await writeFile(file, bytes)
}
console.log('Rendered ' + plates.size + ' studio photographs.')
