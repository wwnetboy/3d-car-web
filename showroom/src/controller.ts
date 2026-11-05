import { vehicleById, vehicles, type VehicleId } from './vehicles'
import { clamp, driveSpeedRange, parked, segment, shots } from './story'
import { StudioSound } from './sound'
import type { Showroom } from './scene'
import type { VehiclePhase } from './vehicle'
import { doorsAvailable, paints, studioStore, updateUI, type PaintId, type Sheet } from './ui/state'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const state = studioStore.getSnapshot
const reduced = matchMedia('(prefers-reduced-motion: reduce)')
const sound = new StudioSound()
const photo = $<HTMLImageElement>('still')
const portrait = $<HTMLSourceElement>('portrait-source')
const windSurface = $('wind-interaction')
const stepEls = Array.from($('track').children) as HTMLElement[]
const copy = Array.from(document.querySelectorAll<HTMLElement>('[data-shot]'))
let canvas = $<HTMLCanvasElement>('car')
let stage: Showroom | undefined
let position = 0
let index = -1
let presetIndex = 0
let vehicle = { ...parked }
let phase: VehiclePhase = 'parked'
let failure = ''
let returnFocus: HTMLElement | null = null
let requestId = 0
let scrollFrame = 0
let introTimer = 0
let stallTimer = 0
let posterName = ''
let focusShot = ''
let offsets: number[] = []

function showPhoto(name: string) {
  if (state().vehicleId !== 'vision-gt') {
    const suffix = name === 'aero' || name === 'aero-clear' ? '-' + name : ''
    const file = '/stills/' + state().vehicleId + suffix + '.png'
    portrait.srcset = '/stills/' + state().vehicleId + suffix + '-p.png'
    photo.src = file
    posterName = ''
    $('poster').style.setProperty('--focus-y', '58%')
    $('poster').style.setProperty('--portrait-y', '58%')
    return
  }
  const folder = state().paint === 'original' ? '/stills/' : '/stills/' + state().paint + '/'
  const file = folder + name
  if (posterName === file) return
  posterName = file
  const shot = shots.find(s => s.id === (name === 'aero-clear' ? 'aero' : name))
  const cabin = name.startsWith('view-cockpit')
  $('poster').style.setProperty('--focus-y', (shot?.frame[1] ?? (cabin ? 0.5 : 0.54)) * 100 + '%')
  $('poster').style.setProperty('--portrait-y', (shot?.mobileY ?? (cabin ? 0.5 : 0.53)) * 100 + '%')
  const revision = name === 'aero' ? 24 : name === 'aero-clear' ? 21 : name.endsWith('-drive') ? 17 : name.startsWith('view-') ? 16 : 12
  portrait.srcset = file + '-p.webp?v=' + revision
  photo.src = file + '.webp?v=' + revision
}

function currentPhoto() {
  if (!state().exploring && !vehicle.cockpit && !vehicle.doors && !vehicle.driving) {
    const id = shots[Math.max(0, index)].id
    return id === 'aero' && !state().smokeOn ? 'aero-clear' : id
  }
  const view = vehicle.cockpit ? 'view-cockpit' : 'view-' + presetIndex
  return view + (vehicle.driving ? '-drive' : vehicle.doors ? '-doors' : '')
}

function setPaint(id: PaintId) {
  const paint = paints.find(paint => paint.id === id)
  if (!paint || (state().vehicleId !== 'vision-gt' && state().mode !== 'ready')) return
  updateUI({ paint: id })
  stage?.setPaint(paint.srgb)
  if (state().mode !== 'ready') showPhoto(currentPhoto())
}

function updateWindView() {
  const active = state().mode === 'ready' && !state().exploring && !vehicle.cockpit && shots[index]?.id === 'aero'
  windSurface.hidden = !active
  stage?.setWindView(active)
}

function updateSound() {
  sound.wind(vehicle.driving || (!state().exploring && !vehicle.cockpit && state().smokeOn && shots[index]?.id === 'aero'))
}

function updateSmoke() {
  const { smokeOn, windKmh, exploring, mode } = state()
  stage?.setSmoke(smokeOn, windKmh)
  updateWindView()
  if (mode !== 'ready' && !exploring && shots[index]?.id === 'aero') showPhoto(currentPhoto())
  updateSound()
}

function syncVehicle() {
  document.body.classList.toggle('in-cockpit', vehicle.cockpit)
  canvas.tabIndex = state().mode === 'ready' && (state().exploring || vehicle.cockpit) ? 0 : -1
  updateUI({ vehicle: { ...vehicle }, phase })
  updateWindView()
}

function fallback(reason: string) {
  ++requestId
  clearTimeout(introTimer)
  clearTimeout(stallTimer)
  failure = reason
  canvas.tabIndex = -1
  stage?.dispose()
  stage = undefined
  document.body.classList.remove('live')
  phase = 'parked'
  updateUI({ mode: 'static', loadVisible: true, loadText: reason, loadProgress: null, loadAction: 'retry' })
  showPhoto(currentPhoto())
  updateSmoke()
  syncVehicle()
}

function progress(loaded: number, total: number, decoding: boolean) {
  if (decoding) updateUI({ loadProgress: null, loadText: '正在准备材质与气流' })
  else if (total > 0 && loaded <= total) {
    const percent = Math.floor(loaded / total * 100)
    updateUI({ loadProgress: percent, loadText: '载入模型 ' + percent + '%' })
  } else updateUI({ loadProgress: null, loadText: '已载入 ' + (loaded / 1048576).toFixed(1) + ' MiB' })
}

async function start3D(force = false) {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean; effectiveType?: string } }
  const low = (nav.deviceMemory ?? 8) <= 2 || (nav.hardwareConcurrency || 8) <= 2
  if (!force && (low || nav.connection?.saveData)) return fallback('节能影像模式')
  if (force) {
    ++requestId
    clearTimeout(introTimer)
    clearTimeout(stallTimer)
    stage?.dispose()
    stage = undefined
    document.body.classList.remove('live')
    const fresh = canvas.cloneNode(false) as HTMLCanvasElement
    canvas.replaceWith(fresh)
    canvas = fresh
    watchContext()
  }
  const lite = low || (nav.deviceMemory ?? 8) <= 4 || (nav.hardwareConcurrency || 8) <= 4 || matchMedia('(pointer: coarse)').matches || innerWidth < 850 || (!!failure && force)
  const token = ++requestId
  updateUI({ mode: 'loading', loadVisible: true, loadAction: null, loadProgress: null, loadText: '正在连接摄影棚' })
  const timeout = () => {
    clearTimeout(stallTimer)
    stallTimer = window.setTimeout(() => { if (token === requestId) fallback('加载超时 · 影像模式') }, 45000)
  }
  timeout()
  try {
    const { Showroom: Scene } = await import('./scene')
    if (token !== requestId) return
    stage = new Scene(canvas, windSurface, lite,
      () => fallback('帧率偏低 · 影像模式'),
      () => { if (!vehicle.cockpit) selectPreset(-1) },
      day => { document.body.classList.toggle('light-room', day > 0.5 && !state().exploring && !vehicle.cockpit) },
      value => { phase = value; syncVehicle() },
      toggleDoors, state().vehicleId,
    )
    stage.moveTo(position)
    stage.setPaint(paints.find(paint => paint.id === state().paint)!.srgb)
    if (state().exploring) {
      stage.explore(true)
      stage.preset(presetIndex)
    }
    stage.setVehicle(vehicle)
    stage.setSmoke(state().smokeOn, state().windKmh)
    if (reduced.matches || position > 0.08 || force) stage.skipReveal()
    await stage.load((loaded, total, decoding) => {
      if (token === requestId) { progress(loaded, total, decoding); timeout() }
    })
    if (token !== requestId) return
    clearTimeout(stallTimer)
    failure = ''
    updateUI({ mode: 'ready' })
    if (state().exploring) canvas.tabIndex = 0
    document.body.classList.add('live')
    updateSmoke()
    if (!reduced.matches && position < 0.08 && !state().exploring && !force) {
      updateUI({ loadAction: 'skip', loadText: '', loadProgress: null })
      introTimer = window.setTimeout(endIntro, 1450)
    } else updateUI({ loadVisible: false })
    syncVehicle()
    stage.pause(state().sheet !== null)
  } catch (error) {
    if (token !== requestId) return
    console.warn('Vision GT:', error instanceof Error ? error.message : 'Unable to create the 3D scene')
    fallback(/webgl|context/i.test(String(error)) ? 'WebGL 不可用 · 影像模式' : '资源加载失败 · 影像模式')
  }
}

function endIntro() {
  if (state().loadAction !== 'skip') return
  clearTimeout(introTimer)
  updateUI({ loadAction: null, loadVisible: false })
  stage?.skipReveal()
}

function watchContext() {
  canvas.addEventListener('webglcontextlost', e => {
    e.preventDefault()
    fallback('图形上下文中断 · 影像模式')
  }, { once: true })
}

function go(i: number) {
  if (state().exploring) closeViewer()
  setSheet(null)
  i = clamp(i, 0, shots.length - 1)
  const key = shots[i].id
  if (location.hash !== '#' + key) history.replaceState(history.state, '', '#' + key)
  window.scrollTo({ top: stepEls[i].offsetTop, behavior: reduced.matches ? 'instant' : 'smooth' })
  endIntro()
}

function focusHeading() {
  if (index < 0 || shots[index].id !== focusShot) return
  const heading = copy[index].querySelector<HTMLElement>('h1,h2')
  if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }) }
  focusShot = ''
}

function setChapter(i: number) {
  index = i
  const shot = shots[i]
  for (const panel of copy) {
    const active = panel.dataset.shot === shot.id
    panel.classList.toggle('is-current', active)
    panel.inert = !active
  }
  document.body.classList.toggle('detail-shot', shot.chapter === 3)
  updateUI({ shotIndex: i })
  updateWindView()
  if (state().mode !== 'ready' && !state().exploring) showPhoto(currentPhoto())
  updateSound()
  focusHeading()
}

function syncScroll() {
  scrollFrame = 0
  if (state().exploring) return
  const y = Math.max(0, window.scrollY)
  let n = offsets.findIndex(o => o > y) - 1
  if (n < 0) n = y >= offsets.at(-1)! ? offsets.length - 1 : 0
  position = n + (n < offsets.length - 1 ? clamp((y - offsets[n]) / (offsets[n + 1] - offsets[n])) : 0)
  const { index: current } = segment(position, reduced.matches)
  if (current !== index) setChapter(current)
  if (state().mode !== 'ready') document.body.classList.toggle('light-room', shots[current].daylight > 0.5)
  stage?.moveTo(position)
  if (position > 0.04) endIntro()
}

function resize() { offsets = stepEls.map(s => s.offsetTop); syncScroll() }

function selectPreset(n: number) {
  if (n >= 0) presetIndex = n
  updateUI({ selectedPreset: n })
}
function usePreset(n: number) {
  selectPreset(n)
  stage?.preset(n)
  if (state().mode !== 'ready') showPhoto(currentPhoto())
}
function applyVehicle() {
  stage?.setVehicle(vehicle)
  syncVehicle()
  if (state().mode !== 'ready') showPhoto(currentPhoto())
  updateSound()
}
function toggleDoors() {
  if (!doorsAvailable(state())) return
  vehicle.doors = !vehicle.doors
  applyVehicle()
}
function openViewer() {
  endIntro()
  returnFocus = document.activeElement as HTMLElement | null
  updateUI({ exploring: true })
  updateWindView()
  document.body.classList.add('in-explorer')
  $('narrative').inert = true
  canvas.tabIndex = state().mode === 'ready' ? 0 : -1
  syncVehicle()
  stage?.explore(true)
  usePreset(0)
  updateSound()
  requestAnimationFrame(() => $('close-explorer')?.focus({ preventScroll: true }))
}
function closeViewer() {
  updateUI({ exploring: false })
  document.body.classList.remove('in-explorer')
  $('narrative').inert = false
  canvas.tabIndex = -1
  stage?.explore(false)
  syncVehicle()
  updateWindView()
  if (state().mode !== 'ready') showPhoto(currentPhoto())
  syncScroll()
  updateSound()
  requestAnimationFrame(() => {
    const target = returnFocus?.isConnected ? returnFocus : $(returnFocus?.id || 'open-explorer')
    target?.focus({ preventScroll: true })
  })
}
function setSheet(sheet: Sheet) {
  updateUI({ sheet })
  stage?.pause(sheet !== null)
}


const originalCopy = copy.map(panel => panel.innerHTML)
function selectVehicle(id: VehicleId) {
  if (!vehicles.some(item => item.id === id) || id === state().vehicleId) return
  vehicle = { ...parked, targetKmh: state().driveKmh }
  phase = 'parked'
  updateUI({ vehicleId: id, paint: 'original', selectedPreset: 0, vehicle: { ...vehicle }, phase })
  presetIndex = 0
  const selected = vehicleById(id)
  document.body.dataset.vehicleId = id
  document.title = selected.name + ' — 3D汽车网站'
  $('stage').setAttribute('aria-label', selected.name + ' 汽车摄影棚')
  copy.forEach((panel, i) => {
    if (id === 'vision-gt') {
      // Keep the React-owned wind hint mount intact.
      if (panel.dataset.shot !== 'aero') panel.innerHTML = originalCopy[i]
    } else if (panel.dataset.shot === 'reveal') {
      panel.querySelector('.make')!.textContent = selected.make
      panel.querySelector('.model-name')!.textContent = selected.model
      panel.querySelector('.lede')!.textContent = '跟随光影与镜头探索车身轮廓，或进入交互展厅自由环绕。'
    } else if (panel.dataset.shot !== 'aero') {
      panel.querySelector('h2')!.textContent = ['','FORM','CANOPY','','WHEELS','LIGHTS','REAR','EXPLORE'][i] || 'DESIGN'
      const heading = panel.querySelector('.chapter-details h3')
      if (heading) heading.textContent = selected.name + ' · ' + shots[i].label
      const description = panel.querySelector('.chapter-details p')
      if (description) description.textContent = '从不同角度观察这款模型的车身曲面与设计细节。进入展厅可拖动环绕、缩放和切换配色。'
    }
  })
  showPhoto(currentPhoto())
  syncVehicle()
  updateSound()
  void start3D(true)
}

export const actions = {
  selectVehicle, go, openViewer, closeViewer, setPaint, setSheet, usePreset, toggleDoors,
  resetWind: () => stage?.resetWindView(),
  toggleSmoke: () => { updateUI({ smokeOn: !state().smokeOn }); updateSmoke() },
  setWindSpeed: (value: number) => { updateUI({ windKmh: clamp(value, driveSpeedRange.min, driveSpeedRange.max) }); updateSmoke() },
  setDriveSpeed: (value: number) => {
    vehicle.targetKmh = clamp(value, driveSpeedRange.min, driveSpeedRange.max)
    updateUI({ driveKmh: vehicle.targetKmh })
    applyVehicle()
  },
  toggleDrive: () => { vehicle.driving = !vehicle.driving; if (vehicle.driving) vehicle.doors = false; applyVehicle() },
  setCockpit: (cockpit: boolean) => { if (!vehicleById(state().vehicleId).articulated) return; vehicle.cockpit = cockpit; applyVehicle() },
  resetView: () => { if (vehicle.cockpit) stage?.preset(0); else usePreset(0) },
  loadAction: () => { if (state().loadAction === 'skip') endIntro(); else if (state().loadAction === 'retry') void start3D(true) },
  toggleSound: async () => {
    const on = await sound.toggle().catch(() => false)
    updateUI({ soundOn: on })
    updateSound()
  },
}

export function initializeStudio() {
  watchContext()
  document.addEventListener('click', e => {
    const a = (e.target as Element).closest<HTMLAnchorElement>('a[href^="#"]')
    if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return
    const i = shots.findIndex(s => '#' + s.id === a.hash)
    if (i < 0) return
    e.preventDefault()
    if (a.classList.contains('skip')) focusShot = shots[i].id
    go(i)
    focusHeading()
  })
  window.addEventListener('scroll', () => { if (!scrollFrame) scrollFrame = requestAnimationFrame(syncScroll) }, { passive: true })
  window.addEventListener('resize', resize)
  window.addEventListener('hashchange', syncScroll)
  reduced.addEventListener('change', () => { updateUI({ reduced: reduced.matches }); syncScroll() })
  document.addEventListener('visibilitychange', () => { void sound.visible(!document.hidden) })
  document.addEventListener('keydown', e => {
    // BoardUI owns keyboard behavior inside its portalled overlays and fields.
    if (e.defaultPrevented || state().sheet || document.querySelector('.studio-popover')) return
    const target = e.target as HTMLElement
    if (target.closest('.react-aria-Popover, [data-studio-popover]')) return
    if (!state().exploring) {
      if (e.key === 'Escape') endIntro()
      if ((target === windSurface || target === canvas) && stage?.orbitKey(e.key)) e.preventDefault()
      return
    }
    if (e.key === 'Escape') { closeViewer(); return }
    if (e.key === 'Tab') {
      const focusables = [...$('explorer').querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]')]
        .filter(el => el.getClientRects().length > 0 && el.tabIndex >= 0)
      if (state().mode === 'ready') focusables.push(canvas)
      const retry = $('load-action')
      if (retry && !focusables.includes(retry)) focusables.push(retry)
      const at = focusables.indexOf(document.activeElement as HTMLElement)
      const next = at === -1 ? (e.shiftKey ? focusables.length - 1 : 0) : (at + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length
      focusables[next]?.focus({ preventScroll: true })
      e.preventDefault()
    } else if (target === canvas && stage?.orbitKey(e.key)) e.preventDefault()
  })
  resize()
  void start3D()
}
