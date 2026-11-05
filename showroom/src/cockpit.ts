import * as THREE from 'three'
import { cockpitInstruments } from './instruments'
import { CabinLights } from './cabinLights'
import { driveSpeedRange } from './story'
import type { VehiclePhase, VehicleRig } from './vehicle'

function surface(positions: number[], uv: number[], indices: number[]) {
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2))
  geometry.setIndex(indices)
  return geometry
}

function dashGlass() {
  // Sections measured across the carbon shelf under the GLB windscreen.
  // z, x at the ridge, height at the ridge, height at the near edge.
  const half = [
    [0, 1.298, .7833, .7582], [.15, 1.302, .7843, .76], [.30, 1.278, .7852, .7597],
    [.40, 1.249, .7871, .7603], [.48, 1.223, .7897, .7638], [.54, 1.18, .7924, .7662],
    [.58, 1.131, .795, .7622], [.62, 1.087, .798, .7631],
  ]
  const sections = [...half.slice(1).reverse().map(([z, ...rest]) => [-z, ...rest]), ...half]
  const bottom = new THREE.CatmullRomCurve3(sections.map(([z, x, , y]) => new THREE.Vector3(x - .13, y + .002, z)))
  const top = new THREE.CatmullRomCurve3(sections.map(([z, x, y]) => new THREE.Vector3(x + .006, y + .022, z)))
  const positions: number[] = [], uv: number[] = [], indices: number[] = []
  for (let i = 0; i <= 64; i++) {
    const t = i / 64, lo = bottom.getPoint(t), hi = top.getPoint(t)
    positions.push(lo.x, lo.y, lo.z, hi.x, hi.y, hi.z)
    uv.push(.5 + lo.z / 1.24, 0, .5 + hi.z / 1.24, 1)
    const k = 2 * i
    if (i) indices.push(k - 2, k, k - 1, k - 1, k, k + 1)
  }
  return surface(positions, uv, indices)
}

function wheelGlass() {
  // The central boss is a crowned hexagon. Leave its original lip exposed.
  const rows = [
    [.697, .041, .3818], [.704, .054, .3824], [.751, .078, .3897],
    [.767, .083, .393], [.78, .081, .3956], [.829, .055, .4066], [.839, .042, .4099],
  ]
  const positions: number[] = [], uv: number[] = [], indices: number[] = []
  for (const [j, [y, half, x]] of rows.entries()) {
    for (let i = 0; i <= 8; i++) {
      const dz = half * (i / 4 - 1)
      positions.push(x - .0017 + .30 * dz * dz, y, -.30795 + dz)
      uv.push((.5 + dz / .168) * 256 / 384, (y - .696) / .145)
      const k = j * 9 + i
      if (i && j) indices.push(k - 10, k - 9, k - 1, k - 1, k - 9, k)
    }
  }
  return surface(positions, uv, indices)
}

function rotaryGlass(i: number) {
  const top = i < 2
  const geo = new THREE.CircleGeometry(.0141, 36)
  const uv = geo.getAttribute('uv')
  const col = i % 2, cy = top ? 64 : 176
  for (let k = 0; k < uv.count; k++) {
    uv.setXY(k, (288 + col * 64 + (uv.getX(k) - .5) * 62) / 384,
      1 - cy / 256 + (uv.getY(k) - .5) * 62 / 256)
  }
  geo.rotateY(-Math.PI / 2)
  geo.rotateZ(-.199)
  geo.translate(top ? .3957 : .3838, top ? .803 : .7437, col ? -.19635 : -.41955)
  return geo
}

export class Cockpit {
  private group = new THREE.Group()
  private panels = cockpitInstruments()
  private lamp = { value: new THREE.Vector4() }
  private lights: CabinLights
  private time = 0
  private lastUpdate = 0
  private lastDraw = -Infinity
  private lastPhase?: VehiclePhase
  private displayedKmh = 0
  private reduced = false

  constructor(car: THREE.Object3D) {
    this.lights = new CabinLights(car, this.lamp)
    const dash = new THREE.MeshBasicMaterial({ map: this.panels.dash, toneMapped: false })
    const wheel = new THREE.MeshBasicMaterial({ map: this.panels.wheel, toneMapped: false })
    const mount = (name: string, geometry: THREE.BufferGeometry, material: THREE.Material) => {
      const screen = new THREE.Mesh(geometry, material)
      screen.name = name
      this.group.add(screen)
    }
    mount('Panoramic display', dashGlass(), dash)
    mount('Steering display', wheelGlass(), wheel)
    for (let i = 0; i < 4; i++) mount('Steering dial ' + (i + 1), rotaryGlass(i), wheel)
    this.group.name = 'Cockpit instruments'
    this.group.visible = false
    car.add(this.group)
  }

  update(now: number, rig: VehicleRig, level: number, reduced: boolean, lite: boolean) {
    const active = level > .001
    const entering = active && !this.group.visible
    this.group.visible = active
    this.lights.show(active)
    if (!active) {
      this.lamp.value.x = 0
      return
    }
    if (reduced) this.time = 0
    else if (!entering) this.time += Math.min(.16, (now - this.lastUpdate) / 1000)
    this.lastUpdate = now
    const kmh = rig.speedKmh
    this.lamp.value.set(level, this.time, kmh / driveSpeedRange.max, rig.door)
    const changed = rig.phase !== this.lastPhase || reduced !== this.reduced || (reduced && kmh !== this.displayedKmh)
    if (entering || changed || (!reduced && now - this.lastDraw >= (lite ? 82 : 52))) {
      this.panels.draw(kmh, rig.distanceTravelled, this.time, rig.door)
      this.lastDraw = now
      this.lastPhase = rig.phase
      this.displayedKmh = kmh
      this.reduced = reduced
    }
  }

  dispose() {
    this.lights.dispose()
    this.group.removeFromParent()
    const materials = new Set<THREE.Material>()
    for (const part of this.group.children as THREE.Mesh<THREE.BufferGeometry, THREE.Material>[]) {
      part.geometry.dispose()
      materials.add(part.material)
    }
    for (const material of materials) material.dispose()
    this.panels.dispose()
  }
}
