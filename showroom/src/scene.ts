import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { vehicleById, type VehicleId } from './vehicles'
import { Cockpit } from './cockpit'
import { CarLights } from './carLights'
import { reflectDrivingArches, studioEnvironment, studioReflection, studioRoom } from './studio'
import { createWindSmoke } from './windSmoke'
import { flowMax } from './windField'
import { VehicleRig, type VehiclePhase } from './vehicle'
import { clamp, driveSpeedRange, mix, parked, presets, segment, shots, smooth, type VehicleSettings } from './story'

export type Progress = (loaded: number, total: number, decoding: boolean) => void
type Pose = {
  az: number
  el: number
  dist: number
  span: number
  x: number
  y: number
  tx: number
  ty: number
  tz: number
  day: number
  wind: number
}
const deg = THREE.MathUtils.degToRad
const drivingFront = { az: 67, el: 6 }
const studioLens = { distance: 9.7, width: 7.4, portraitWidth: 6.4, x: 0.5 }
const drivingLens = { distance: 7, width: 6.65, portraitWidth: 6.15, x: 0.535 }
// At the viewport edge: orbit in degrees and framing shift as a fraction of the film gate.
const storyHover = { az: 10, el: 3, frameX: 0.018, portraitFrameX: 0.008, frameY: 0.012 }
const windShot = shots.find((shot) => shot.id === 'aero')!
const windViewLimits = { minAz: 0, maxAz: 35, minEl: 3, maxEl: 25, minZoom: 0.55, maxZoom: 1 }
const copyPose = (): Pose => ({
  az: 0,
  el: 0,
  dist: 1,
  span: 1,
  x: 0.5,
  y: 0.5,
  tx: 0,
  ty: 0.5,
  tz: 0,
  day: 0,
  wind: 0,
})

async function loadModel(id: VehicleId, lite: boolean, progress: Progress, signal: AbortSignal) {
  const response = await fetch('/models/' + vehicleById(id).file + (lite ? '-lite' : '') + '.glb?rig=7', {
    signal,
  })
  if (!response.ok) throw new Error('Model HTTP ' + response.status)
  const total = Number(response.headers.get('Content-Length')) || 0
  let buffer: ArrayBuffer
  if (response.body) {
    const reader = response.body.getReader()
    const chunks: Uint8Array<ArrayBuffer>[] = []
    let loaded = 0
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(value as Uint8Array<ArrayBuffer>)
      loaded += value.byteLength
      progress(loaded, total, false)
    }
    buffer = await new Blob(chunks).arrayBuffer()
  } else {
    buffer = await response.arrayBuffer()
  }
  progress(buffer.byteLength, buffer.byteLength, true)
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
  const model = await loader.parseAsync(buffer, '/models/')
  if (!vehicleById(id).articulated) {
    const car = new THREE.Group()
    car.add(model.scene)
    car.rotation.y = Math.PI / 2 // Both source vehicles face +Z; the studio uses +X.
    car.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(car)
    car.scale.setScalar(5.1 / box.getSize(new THREE.Vector3()).x)
    car.updateMatrixWorld(true)
    box.setFromObject(car)
    const center = box.getCenter(new THREE.Vector3())
    car.position.set(-center.x, -box.min.y, -center.z)
    return car
  }
  return model.scene
}

export class Showroom {
  private renderer: THREE.WebGLRenderer
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(30, 1, 0.07, 120)
  private subject = new THREE.Vector3()
  private room: ReturnType<typeof studioRoom>
  private mirror: ReturnType<typeof studioReflection> | undefined
  private env: THREE.WebGLRenderTarget
  private wind: ReturnType<typeof createWindSmoke>
  private smokeEnabled = true
  private smokeDensity = 0
  private windSpeed = driveSpeedRange.initial
  private vehicle: VehicleSettings = { ...parked }
  private rig?: VehicleRig
  private cockpit?: Cockpit
  private carLights?: CarLights
  private cabinWake = 0
  private paint: string | null = null
  private reportedPhase: VehiclePhase = 'parked'
  private seat = { yaw: 0, pitch: -9.5, zoom: 1 }
  private seatLook = { ...this.seat }
  private cabinFill = new THREE.PointLight(0xc1d9ea, 0.11, 2.8)
  private raycaster = new THREE.Raycaster()
  private tap?: { id: number; x: number; y: number }
  private frame = 0
  private lastTime = 0
  private revealAt = 0
  private revealFinished = false
  private position = 0
  private pose = copyPose()
  private initialized = false
  private ready = false
  private paused = false
  private spent = false
  private abort = new AbortController()
  private observer: ResizeObserver
  private reduced = matchMedia('(prefers-reduced-motion: reduce)')
  private orbit = { az: 35, el: 11, zoom: 1, lens: studioLens }
  private windOrbit = { az: 0, el: 0, zoom: 1 }
  private windInteractive = false
  private pointers = new Map<number, { x: number; y: number }>()
  private hover = new THREE.Vector2()
  private w = 1
  private h = 1
  private dpr = 1
  private slowFrames = 0
  private degraded = false
  exploring = false

  private get freeCamera() { return this.exploring || this.vehicle.cockpit }

  constructor(
    private canvas: HTMLCanvasElement,
    private windSurface: HTMLElement,
    private lite: boolean,
    private onSlow: () => void,
    private onOrbit: () => void,
    private onLight: (day: number) => void,
    private onPhase: (phase: VehiclePhase) => void,
    private onDoorTap: () => void,
    private vehicleId: VehicleId = 'vision-gt',
  ) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: lite ? 'default' : 'high-performance',
    })
    this.renderer.setClearColor(0x000000, 0)
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    this.renderer.toneMapping = THREE.NeutralToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.shadowMap.enabled = !lite
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.shadowMap.autoUpdate = false
    this.camera.layers.enable(1)
    this.camera.layers.enable(3)
    this.room = studioRoom(!lite)
    this.wind = createWindSmoke(lite)
    this.scene.add(this.room, this.wind.group)
    if (!lite && this.renderer.extensions.has('EXT_color_buffer_float')) {
      this.mirror = studioReflection()
      this.scene.add(this.mirror)
    }
    this.env = studioEnvironment(this.renderer)
    this.scene.environment = this.env.texture
    this.scene.add(new THREE.HemisphereLight(0xe6f2f7, 0x4c5556, 0.56))
    const key = new THREE.DirectionalLight(0xf3f7ff, 1.12)
    key.position.set(3, 6, -4)
    key.castShadow = !lite
    key.shadow.mapSize.set(1024, 1024)
    Object.assign(key.shadow.camera, {
      left: -3.6,
      right: 3.6,
      top: 3,
      bottom: -3,
      near: 0.7,
      far: 16,
    })
    key.shadow.camera.updateProjectionMatrix()
    key.shadow.normalBias = 0.009
    key.shadow.bias = -0.0002
    const rim = new THREE.DirectionalLight(0xdaeeed, 0.68)
    rim.position.set(-3, 3.8, 3)
    this.cabinFill.position.set(-0.08, 1.04, -0.1)
    this.cabinFill.visible = false
    this.scene.add(key, rim, this.cabinFill)
    this.observer = new ResizeObserver(() => this.resize())
    this.observer.observe(canvas)
    this.listen()
    this.resize()
  }

  async load(progress: Progress) {
    const [car] = await Promise.all([
      loadModel(this.vehicleId, this.lite, progress, this.abort.signal),
      this.wind.loadField(this.abort.signal, this.vehicleId),
    ])
    if (this.spent) { disposeModel(car); return }
    const definition = vehicleById(this.vehicleId)
    reflectDrivingArches(car, this.room)
    this.rig = new VehicleRig(car, definition.articulated, definition.paintMaterials)
    this.wind.setVehicle(car)
    if (definition.articulated) {
      this.cockpit = new Cockpit(car)
      this.carLights = new CarLights(car, this.lite)
      this.scene.add(this.carLights.glow)
    }
    this.rig.setPaint(this.paint)
    this.rig.setCabin(this.vehicle.cockpit)
    this.scene.add(car)
    this.renderer.shadowMap.needsUpdate = true
    this.resize()
    this.pose = this.destination()
    this.applyCamera()
    await this.renderer.compileAsync(this.scene, this.camera)
    if (this.spent) return
    this.ready = true
    this.revealAt = performance.now()
    this.tick(this.revealAt)
  }

  moveTo(position: number) {
    this.position = position
    this.wake()
  }

  skipReveal() {
    this.revealFinished = true
    this.wake()
  }

  explore(active: boolean) {
    this.exploring = active
    this.clearPointers()
    this.hover.set(0, 0)
    if (active) this.preset(0)
    this.wake()
  }

  setVehicle(next: VehicleSettings) {
    if (next.driving !== this.vehicle.driving) {
      const front = this.vehicle.driving ? drivingFront : presets[0]
      // Reframe the untouched front preset along the arches. Keep an angle
      // or zoom the visitor has chosen for themselves.
      if (this.orbit.az === front.az && this.orbit.el === front.el && this.orbit.zoom === 1)
        this.frameExterior(0, next.driving)
    }
    if (next.cockpit !== this.vehicle.cockpit) {
      this.pointers.clear()
      this.tap = undefined
      this.seat = { yaw: 0, pitch: -9.5, zoom: 1 }
      this.seatLook = { ...this.seat }
      // A cut between two real cameras avoids travelling through the bodywork.
      this.initialized = false
      this.rig?.setCabin(next.cockpit)
    }
    const requested = Number.isFinite(next.targetKmh) ? next.targetKmh : parked.targetKmh
    this.vehicle = {
      ...next,
      doors: next.doors && !next.driving,
      targetKmh: clamp(requested, driveSpeedRange.min, driveSpeedRange.max),
    }
    this.wake()
  }

  setSmoke(active: boolean, speed: number) {
    if (active && !this.smokeEnabled) this.wind.restart()
    this.smokeEnabled = active
    this.windSpeed = clamp(Number.isFinite(speed) ? speed : driveSpeedRange.initial,
      driveSpeedRange.min, driveSpeedRange.max)
    this.wake()
  }

  setWindView(active: boolean) {
    if (active === this.windInteractive) return
    this.windInteractive = active
    this.clearPointers()
    this.hover.set(0, 0)
    this.wake()
  }

  resetWindView() {
    this.clearPointers()
    this.windOrbit = { az: 0, el: 0, zoom: 1 }
    this.wake()
  }

  private turnWind(az: number, el: number) {
    const mobile = this.w / this.h < 0.94
    const baseAz = mobile ? windShot.mobile[0] : windShot.az
    const baseEl = mobile ? windShot.mobile[1] : windShot.el
    this.windOrbit.az = clamp(baseAz + this.windOrbit.az + az, windViewLimits.minAz, windViewLimits.maxAz) - baseAz
    this.windOrbit.el = clamp(baseEl + this.windOrbit.el + el, windViewLimits.minEl, windViewLimits.maxEl) - baseEl
  }

  private clearPointers() {
    const ids = [...this.pointers.keys()]
    this.pointers.clear()
    this.tap = undefined
    for (const surface of [this.canvas, this.windSurface]) {
      surface.classList.remove('is-dragging', 'is-pointer-focused')
      for (const id of ids) if (surface.hasPointerCapture(id)) surface.releasePointerCapture(id)
    }
  }

  setPaint(srgb: string | null) {
    this.paint = srgb
    this.rig?.setPaint(srgb)
    this.wake()
  }

  private frameExterior(index: number, driving: boolean) {
    const tracking = driving && index === 0
    const p = tracking ? drivingFront : presets[index] ?? presets[0]
    this.orbit = { az: p.az, el: p.el, zoom: 1, lens: tracking ? drivingLens : studioLens }
  }

  preset(index: number) {
    if (this.vehicle.cockpit) this.seat = { yaw: 0, pitch: -9.5, zoom: 1 }
    else this.frameExterior(index, this.vehicle.driving)
    this.wake()
  }

  orbitKey(key: string) {
    if (this.paused || (!this.freeCamera && !this.windInteractive)) return false
    if (!this.freeCamera) {
      if (key === 'ArrowLeft') this.turnWind(-12, 0)
      else if (key === 'ArrowRight') this.turnWind(12, 0)
      else if (key === 'ArrowUp') this.turnWind(0, 5)
      else if (key === 'ArrowDown') this.turnWind(0, -5)
      else if (['+', '=', '-'].includes(key)) this.zoom(key === '-' ? 1.12 : 1 / 1.12)
      else if (key === 'Home') this.resetWindView()
      else return false
    } else if (this.vehicle.cockpit) {
      if (key === 'ArrowLeft') this.seat.yaw = clamp(this.seat.yaw - 8, -80, 90)
      else if (key === 'ArrowRight') this.seat.yaw = clamp(this.seat.yaw + 8, -80, 90)
      else if (key === 'ArrowUp') this.seat.pitch = clamp(this.seat.pitch + 5, -38, 22)
      else if (key === 'ArrowDown') this.seat.pitch = clamp(this.seat.pitch - 5, -38, 22)
      else if (['+', '=', '-'].includes(key)) this.zoom(key === '-' ? 1.08 : 1 / 1.08)
      else return false
    } else if (key === 'ArrowLeft') this.orbit.az -= 12
    else if (key === 'ArrowRight') this.orbit.az += 12
    else if (key === 'ArrowUp') this.orbit.el = clamp(this.orbit.el + 5, 2.5, 61)
    else if (key === 'ArrowDown') this.orbit.el = clamp(this.orbit.el - 5, 2.5, 61)
    else if (key === '+' || key === '=') this.orbit.zoom = clamp(this.orbit.zoom / 1.12, 0.64, 1.65)
    else if (key === '-') this.orbit.zoom = clamp(this.orbit.zoom * 1.12, 0.64, 1.65)
    else return false
    if (this.exploring) this.onOrbit()
    this.wake()
    return true
  }

  pause(value: boolean) {
    this.paused = value
    if (value) {
      this.clearPointers()
      clearTimeout(this.cabinWake)
      cancelAnimationFrame(this.frame)
      this.frame = 0
    } else this.wake()
  }

  private resize() {
    this.w = Math.max(1, this.canvas.clientWidth)
    this.h = Math.max(1, this.canvas.clientHeight)
    this.dpr = Math.min(
      window.devicePixelRatio || 1,
      this.degraded ? 0.85 : this.lite ? 1.35 : 1.75,
      2500 / Math.max(this.w, this.h),
    )
    this.renderer.setPixelRatio(this.dpr)
    this.renderer.setSize(this.w, this.h, false)
    if (this.mirror) {
      const ratio = Math.min(this.dpr, 1.5, 1536 / Math.max(this.w, this.h))
      this.mirror.getRenderTarget().setSize(Math.max(1, Math.round(this.w * ratio)), Math.max(1, Math.round(this.h * ratio)))
    }
    this.initialized = false
    this.wake()
  }

  private listen() {
    const opts = { signal: this.abort.signal }
    for (const surface of [this.canvas, this.windSurface]) surface.addEventListener(
      'pointerdown',
      (e) => {
        if (!this.ready || this.paused ||
            (surface === this.canvas ? !this.freeCamera : !this.windInteractive || this.freeCamera) ||
            (e.pointerType === 'mouse' && e.button !== 0)) return
        this.tap =
          this.exploring && !this.vehicle.cockpit && !this.pointers.size
            ? { id: e.pointerId, x: e.clientX, y: e.clientY }
            : undefined
        surface.setPointerCapture(e.pointerId)
        surface.classList.add('is-pointer-focused')
        surface.focus({ preventScroll: true })
        surface.classList.add('is-dragging')
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
      },
      opts,
    )
    const spacing = () => {
      const [a, b] = [...this.pointers.values()]
      return b ? Math.max(2, Math.hypot(a.x - b.x, a.y - b.y)) : 0
    }
    window.addEventListener(
      'pointermove',
      (e) => {
        if (this.paused) return
        if (!this.freeCamera && !this.windInteractive) {
          if (this.reduced.matches || this.paused || e.pointerType !== 'mouse') return
          this.hover.set(
            clamp((2 * e.clientX) / this.w - 1, -1, 1),
            clamp((2 * e.clientY) / this.h - 1, -1, 1),
          )
        } else {
          const prev = this.pointers.get(e.pointerId)
          if (!prev) return
          if (this.tap && Math.hypot(e.clientX - this.tap.x, e.clientY - this.tap.y) > 5)
            this.tap = undefined
          const before = spacing()
          this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })
          const dx = e.clientX - prev.x,
            dy = e.clientY - prev.y
          if (before) this.zoom(before / spacing())
          else if (!this.freeCamera) {
            this.turnWind((dx * 190) / Math.min(900, this.w), dy * 0.18)
          } else if (this.vehicle.cockpit) {
            this.seat.yaw = clamp(this.seat.yaw + (dx * 125) / Math.min(850, this.w), -80, 90)
            this.seat.pitch = clamp(this.seat.pitch - dy * 0.15, -38, 22)
          } else {
            // With this model's -Z left flank, increasing azimuth carries
            // the nearest point on the body to the right under a rightward drag.
            this.orbit.az += (dx * 190) / Math.min(900, this.w)
            this.orbit.el = clamp(this.orbit.el + dy * 0.18, 2.5, 61)
          }
          if (this.exploring) this.onOrbit()
        }
        this.wake()
      },
      opts,
    )
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      for (const surface of [this.canvas, this.windSurface]) surface.addEventListener(
        type,
        (e) => {
          if (
            type === 'pointerup' &&
            this.exploring &&
            this.tap?.id === e.pointerId &&
            this.rig &&
            !this.vehicle.driving &&
            this.rig.speedKmh === 0
          ) {
            const rect = this.canvas.getBoundingClientRect()
            const at = new THREE.Vector2(
              (2 * (e.clientX - rect.left)) / rect.width - 1,
              1 - (2 * (e.clientY - rect.top)) / rect.height,
            )
            this.raycaster.setFromCamera(at, this.camera)
            const hit = this.raycaster.intersectObject(this.rig.car, true)[0]
            if (this.rig.isDoor(hit?.object)) this.onDoorTap()
          }
          this.tap = undefined
          this.pointers.delete(e.pointerId)
          if (!this.pointers.size) surface.classList.remove('is-dragging')
        },
        opts,
      )
    }
    for (const type of ['blur', 'keydown'] as const) {
      this.windSurface.addEventListener(type, () => this.windSurface.classList.remove('is-pointer-focused'), opts)
    }
    for (const surface of [this.canvas, this.windSurface]) surface.addEventListener(
      'wheel',
      (e) => {
        if (this.paused || (surface === this.canvas ? !this.freeCamera : !this.windInteractive || this.freeCamera)) return
        e.preventDefault()
        this.zoom(Math.exp(clamp(e.deltaY * (e.deltaMode === 1 ? 16 : 1), -160, 160) * 0.0015))
        if (this.exploring) this.onOrbit()
        this.wake()
      },
      { ...opts, passive: false },
    )
    const centerHover = () => {
      this.hover.set(0, 0)
      this.wake()
    }
    document.documentElement.addEventListener('pointerleave', centerHover, opts)
    window.addEventListener('blur', () => { this.clearPointers(); centerHover() }, opts)
    this.reduced.addEventListener('change', centerHover, opts)
    document.addEventListener('visibilitychange', () => this.wake(), opts)
  }

  private zoom(factor: number) {
    if (!this.freeCamera) this.windOrbit.zoom = clamp(this.windOrbit.zoom * factor, windViewLimits.minZoom, windViewLimits.maxZoom)
    else if (this.vehicle.cockpit) this.seat.zoom = clamp(this.seat.zoom * factor, 0.76, 1.15)
    else this.orbit.zoom = clamp(this.orbit.zoom * factor, 0.64, 1.65)
  }

  private destination(): Pose {
    const reduced = this.reduced.matches
    const { a, b, t } = segment(this.position, reduced)
    const mobile = this.w / this.h < 0.94
    const sample = (s: typeof a) => ({
      az: mobile ? s.mobile[0] : s.az,
      el: mobile ? s.mobile[1] : s.el,
      dist: s.distance,
      span: mobile ? s.mobile[2] : s.span,
      x: mobile ? (s.id === 'reveal' ? 0.535 : 0.505) : s.frame[0],
      y: mobile ? s.mobileY : s.frame[1],
      tx: s.target[0],
      ty: s.target[1],
      tz: s.target[2],
      day: s.daylight,
      wind: s.id === 'aero' ? 1 : 0,
    })
    const p = sample(a),
      q = sample(b)
    for (const k of Object.keys(p) as (keyof Pose)[]) p[k] = mix(p[k], q[k], t)
    if (this.freeCamera) {
      const lens = this.orbit.lens
      p.az = this.orbit.az
      p.el = this.orbit.el
      p.dist = lens.distance * this.orbit.zoom
      p.span = (mobile ? lens.portraitWidth : lens.width) * this.orbit.zoom
      p.x = lens.x
      p.y = mobile ? 0.53 : 0.54
      p.tx = 0.04
      p.ty = 0.52
      p.tz = 0
      p.day = this.vehicle.cockpit ? 0.16 : 0.055
    } else {
      const windAz = mobile ? windShot.mobile[0] : windShot.az
      const windEl = mobile ? windShot.mobile[1] : windShot.el
      p.az += (clamp(windAz + this.windOrbit.az, windViewLimits.minAz, windViewLimits.maxAz) - windAz) * p.wind
      p.el += (clamp(windEl + this.windOrbit.el, windViewLimits.minEl, windViewLimits.maxEl) - windEl) * p.wind
      if (!reduced) {
        const follow = 1 - p.wind
        p.az += this.hover.x * storyHover.az * follow
        p.el += this.hover.y * storyHover.el * follow
        p.x += this.hover.x * (mobile ? storyHover.portraitFrameX : storyHover.frameX) * follow
        p.y += this.hover.y * storyHover.frameY * follow
      }
    }
    if (!vehicleById(this.vehicleId).articulated) {
      p.span = Math.max(p.span, mobile ? 6.4 : 6.7)
      p.dist = Math.max(p.dist, 9)
      p.tx = 0
      p.ty = 0.65
      p.tz = 0
    }
    if (mobile && this.h < 650) p.y += (650 - this.h) / 1200 * p.wind
    // Extra-wide film gates need more width so the car stays inside the vertical safe area.
    p.span *= Math.max(1, this.w / this.h / 1.95)
    if (!this.freeCamera) {
      const zoom = mix(1, this.windOrbit.zoom, p.wind)
      p.span *= zoom
      p.dist *= zoom
    }
    return p
  }

  private applyCamera() {
    const p = this.pose,
      aspect = this.w / this.h
    if (this.vehicle.cockpit) {
      const yaw = deg(this.seatLook.yaw),
        pitch = deg(this.seatLook.pitch)
      this.camera.position.set(-0.105, 0.985, -0.308)
      this.subject
        .set(Math.cos(yaw) * Math.cos(pitch), Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch))
        .add(this.camera.position)
      this.camera.lookAt(this.subject)
      this.camera.clearViewOffset()
      this.camera.near = 0.022
      this.camera.aspect = aspect
      const gate = aspect < 0.94 ? Math.tan(deg(27)) : (Math.tan(deg(31)) * 16) / 9
      const fov = THREE.MathUtils.radToDeg(2 * Math.atan(gate / aspect))
      this.camera.fov = clamp(fov * this.seatLook.zoom, 38, 108)
      this.camera.updateProjectionMatrix()
      return
    }
    this.camera.near = 0.07
    const az = deg(p.az),
      el = deg(p.el)
    this.subject.set(p.tx, p.ty, p.tz)
    this.camera.position
      .set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el))
      .multiplyScalar(p.dist)
      .add(this.subject)
    this.camera.lookAt(this.subject)
    let span = p.span
    if (!this.freeCamera && p.wind > 0.999) {
      // Keep even the start of the inlet fade beyond the left edge. Use the
      // rendered pose so easing, portrait layouts and wide screens stay safe.
      this.camera.updateMatrixWorld()
      const corner = new THREE.Vector3()
      for (const y of [0, flowMax.y]) for (const z of [-2.14, 2.14]) {
        corner.set(flowMax.x - 0.34, y, z).applyMatrix4(this.camera.matrixWorldInverse)
        if (corner.z < 0) span = Math.min(span, -corner.x * p.dist / (-corner.z * (p.x + 0.02)))
      }
    }
    this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(span / (2 * p.dist * aspect)))
    this.camera.aspect = aspect
    this.camera.setViewOffset(
      this.w,
      this.h,
      (0.5 - p.x) * this.w,
      (0.5 - p.y) * this.h,
      this.w,
      this.h,
    )
  }

  private wake() {
    clearTimeout(this.cabinWake)
    if (this.ready && !this.spent && !this.frame && !this.paused && !document.hidden) {
      this.lastTime = performance.now()
      this.frame = requestAnimationFrame(this.tick)
    }
  }

  private tick = (now: number) => {
    this.frame = 0
    const rig = this.rig
    if (!this.ready || !rig || this.spent || this.paused || document.hidden) return
    const elapsed = now - this.lastTime
    const dt = clamp(elapsed / 1000, 0.001, 0.09)
    this.lastTime = now
    const destination = this.destination()
    const ease = !this.initialized || this.reduced.matches ? 1 : 1 - Math.exp(-dt * 12.5)
    let moving = false
    for (const k of Object.keys(destination) as (keyof Pose)[]) {
      let delta = destination[k] - this.pose[k]
      if (k === 'az') delta = (((delta % 360) + 540) % 360) - 180
      const epsilon = k === 'az' || k === 'el' ? 0.003 : 0.00012
      this.pose[k] += Math.abs(delta) < epsilon ? delta : delta * ease
      moving ||= Math.abs(delta) >= epsilon
    }
    if (this.vehicle.cockpit) {
      for (const k of ['yaw', 'pitch', 'zoom'] as const) {
        const delta = this.seat[k] - this.seatLook[k]
        this.seatLook[k] += Math.abs(delta) < 0.0003 ? delta : delta * ease
        moving ||= Math.abs(delta) >= 0.0003
      }
    }
    const tunnel = !this.exploring ? this.pose.wind : 0
    const doorMoved = rig.update(dt, this.vehicle, this.reduced.matches, tunnel * this.windSpeed)
    if (doorMoved) this.renderer.shadowMap.needsUpdate = true
    if (this.reportedPhase !== rig.phase) {
      this.reportedPhase = rig.phase
      this.onPhase(this.reportedPhase)
    }
    const road = smooth(clamp(rig.driveAmount * 1.48))
    this.room.material.uniforms.uRoad.value = road
    this.room.material.uniforms.uTravel.value = rig.travel
    this.cabinFill.visible = this.vehicle.cockpit
    if (this.carLights) this.carLights.glow.visible = !this.vehicle.cockpit
    const cabinLevel = this.vehicle.cockpit ? 1 : rig.door
    this.cockpit?.update(now, rig, cabinLevel, this.reduced.matches, this.lite || this.degraded)
    if (this.mirror) {
      this.mirror.visible = !this.degraded && !this.vehicle.cockpit
      ;(this.mirror.material as THREE.ShaderMaterial).uniforms.uGloss.value =
        (1 - road * 0.85) * (1 - this.pose.wind * 0.35)
    }
    this.initialized = true
    this.applyCamera()
    const reveal =
      this.revealFinished || this.reduced.matches || this.position > 0.08
        ? 1
        : smooth(clamp((now - this.revealAt) / 1450))
    if (reveal >= 1) this.revealFinished = true
    this.scene.environmentRotation.y = -0.115 * (1 - reveal) + this.pose.day * 0.22
    this.scene.environmentIntensity =
      (0.87 + 0.13 * reveal) * (1 + 0.15 * this.pose.day + 0.12 * this.pose.wind) *
      (1 - 0.22 * road) * (this.vehicle.cockpit ? 0.54 : 1)
    this.room.material.uniforms.uDay.value = this.pose.day
    this.room.material.uniforms.uWindRoom.value = this.pose.wind
    this.onLight(this.pose.day)
    const requestedDensity = tunnel * 0.9
    const densityDelta = requestedDensity - this.smokeDensity
    this.smokeDensity += Math.abs(densityDelta) < 0.002 ? densityDelta : densityDelta * ease
    this.wind.update(dt, this.smokeDensity, this.windSpeed, this.reduced.matches, this.smokeEnabled)
    const animating = moving || doorMoved || rig.driveAmount > 0 || (!this.reduced.matches && this.smokeDensity > 0.001)
    this.renderer.render(this.scene, this.camera)
    if (animating && this.revealFinished && elapsed > 55 && elapsed < 2000) this.slowFrames++
    else this.slowFrames = Math.max(0, this.slowFrames - 2)
    if (this.slowFrames >= 22 && !this.degraded) {
      this.degraded = true
      this.slowFrames = 0
      if (this.mirror) this.mirror.visible = false
      this.renderer.shadowMap.enabled = false
      this.wind.setLowDetail()
      this.carLights?.setLowDetail()
      this.room.material.uniforms.uFine.value = 0
      this.resize()
    } else if (this.slowFrames >= 40 && elapsed > 95) {
      this.onSlow()
      return
    }
    if (!this.frame && (animating || reveal < 1)) this.frame = requestAnimationFrame(this.tick)
    else if (!this.frame && cabinLevel > .001 && !this.reduced.matches)
      this.cabinWake = window.setTimeout(() => this.wake(), this.lite || this.degraded ? 82 : 52)
  }

  dispose() {
    this.spent = true
    this.clearPointers()
    this.abort.abort()
    this.observer.disconnect()
    clearTimeout(this.cabinWake)
    cancelAnimationFrame(this.frame)
    this.mirror?.dispose()
    this.cockpit?.dispose()
    this.carLights?.dispose()
    this.rig?.dispose()
    this.wind.group.removeFromParent()
    this.wind.dispose()
    this.env.dispose()
    disposeModel(this.scene)
    this.renderer.dispose()
  }
}

function disposeModel(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  const textures = new Set<THREE.Texture>()
  root.traverse(node => {
    if (!(node instanceof THREE.Mesh) && !(node instanceof THREE.Line)) return
    geometries.add(node.geometry)
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
      materials.add(material)
      for (const value of Object.values(material)) if (value instanceof THREE.Texture) textures.add(value)
    }
  })
  textures.forEach(texture => { texture.dispose(); if (texture.image instanceof ImageBitmap) texture.image.close() })
  materials.forEach(material => material.dispose())
  geometries.forEach(geometry => geometry.dispose())
}
