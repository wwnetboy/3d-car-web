import * as THREE from 'three'
import { smooth, type VehicleSettings } from './story'
export type VehiclePhase =
  | 'parked'
  | 'opening'
  | 'open'
  | 'closing'
  | 'starting'
  | 'running'
  | 'braking'

interface Joint {
  node: THREE.Object3D
  rest: THREE.Quaternion
  axis: THREE.Vector3
  angle: number
  radius: number
}
type Surface = THREE.Material | THREE.Material[]
type PaintSurface = { mesh: THREE.Mesh; original: Surface; preview: Surface }

function joint(car: THREE.Object3D, name: string): Joint {
  const node = car.getObjectByName(name)
  const motion = node?.userData.motion
  if (!node || !Array.isArray(motion?.axis)) throw new Error('Missing model joint ' + name)
  return {
    node,
    rest: node.quaternion.clone(),
    axis: new THREE.Vector3().fromArray(motion.axis).normalize(),
    angle: motion.angle ?? 0,
    radius: motion.radius ?? 1,
  }
}

function approach(value: number, target: number, step: number) {
  return value + Math.sign(target - value) * Math.min(step, Math.abs(target - value))
}

export class VehicleRig {
  private hinges: Joint[]
  private axles: Joint[]
  private maxFrameTravel: number
  private turn = new THREE.Quaternion()
  private rotation = [0, 0, 0, 0]
  private windows: { mesh: THREE.Mesh; outside: Surface; inside: Surface }[] = []
  private glassCopies = new Map<THREE.Material, THREE.Material>()
  private paintPanels: PaintSurface[] = []
  private paintCopies = new Map<THREE.MeshStandardMaterial, THREE.MeshStandardMaterial>()
  private inCabin = false
  door = 0
  driveAmount = 0 // start / brake envelope, independent of the cruising speed
  speedKmh = 0
  distanceTravelled = 0
  private windDistance = 0
  phase: VehiclePhase = 'parked'

  get travel() {
    return (this.distanceTravelled + this.windDistance) % 960
  }

  constructor(readonly car: THREE.Object3D, articulated = true, paintMaterials: readonly string[] = ['accent']) {
    this.hinges = articulated ? ['Door_L', 'Door_R'].map((name) => joint(car, name)) : []
    this.axles = ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'].map((name) => joint(car, name))
    // Accretion Rims keep the translucent outer cover stationary. The asset
    // groups it with the wheel for storage; attach preserves its assembled
    // world transform while leaving the tire, barrel and vanes on the axle.
    if (articulated) for (const axle of this.axles) {
      const cover = axle.node.getObjectByName(axle.node.name + '_glass')
      if (!cover || !axle.node.parent) throw new Error('Missing stationary cover ' + axle.node.name)
      axle.node.parent.attach(cover)
    }
    // Reduced-motion wheel playback remains gentle, without limiting road distance.
    this.maxFrameTravel = 0.9 * Math.PI * (this.axles.length ? Math.min(...this.axles.map((axle) => axle.radius)) : 0.4)
    // Body panels, door skins and wheel vanes share the author's accent paint.
    car.traverse((node) => {
      if (!(node instanceof THREE.Mesh)) return
      const surfaces: THREE.Material[] = Array.isArray(node.material)
        ? node.material
        : [node.material]
      const preview = surfaces.map((material) => {
        if (!paintMaterials.includes(material.name) || !(material instanceof THREE.MeshStandardMaterial)) {
          return material
        }
        let copy = this.paintCopies.get(material)
        if (!copy) {
          copy = material.clone()
          copy.onBeforeCompile = material.onBeforeCompile
          this.paintCopies.set(material, copy)
        }
        return copy
      })
      if (preview.some((material, i) => material !== surfaces[i])) {
        this.paintPanels.push({
          mesh: node,
          original: node.material,
          preview: Array.isArray(node.material) ? preview : preview[0],
        })
      }
      const glass = surfaces.some((m) => m.name === 'glass')
      node.castShadow = !glass
      node.receiveShadow = !glass
      if (!glass) return
      let parent: THREE.Object3D | null = node
      while (parent && !parent.userData.cabinGlazing) parent = parent.parent
      if (!parent) return
      const fromSeat = surfaces.map((m) => {
        if (m.name !== 'glass') return m
        if (!this.glassCopies.has(m)) {
          // The author used nearly opaque exterior glazing. This separate,
          // one-sided inside pane gives the driver a view through the windscreen.
          const inside = m.clone()
          inside.onBeforeCompile = m.onBeforeCompile
          inside.side = THREE.FrontSide
          inside.opacity = 0.055
          inside.transparent = true
          inside.depthWrite = false
          this.glassCopies.set(m, inside)
        }
        return this.glassCopies.get(m)!
      })
      this.windows.push({
        mesh: node,
        outside: node.material,
        inside: Array.isArray(node.material) ? fromSeat : fromSeat[0],
      })
    })
  }

  setPaint(srgb: string | null) {
    if (srgb !== null) {
      for (const material of this.paintCopies.values())
        material.color.setStyle(srgb, THREE.SRGBColorSpace)
    }
    for (const panel of this.paintPanels) {
      panel.mesh.material = srgb === null ? panel.original : panel.preview
    }
  }

  setCabin(active: boolean) {
    if (this.inCabin === active) return
    this.inCabin = active
    for (const pane of this.windows) pane.mesh.material = active ? pane.inside : pane.outside
  }

  isDoor(part: THREE.Object3D | undefined) {
    for (let n: THREE.Object3D | null | undefined = part; n; n = n.parent) {
      if (this.hinges.some((hinge) => hinge.node === n)) return true
    }
    return false
  }

  update(dt: number, settings: VehicleSettings, reduced: boolean, tunnelSpeed: number) {
    const previousDoor = this.door
    const canOpen = settings.doors && !settings.driving && this.speedKmh === 0
    this.door = approach(this.door, Number(canOpen), reduced ? 1 : dt / 1.15)
    if (previousDoor !== this.door) {
      for (const hinge of this.hinges) {
        hinge.node.quaternion
          .copy(hinge.rest)
          .multiply(this.turn.setFromAxisAngle(hinge.axis, smooth(this.door) * hinge.angle))
      }
    }
    // Wait for the physical door to close before the road or wheels move.
    const powered = settings.driving && this.door === 0
    const previousKmh = this.speedKmh
    const targetKmh = powered ? settings.targetKmh : 0
    this.speedKmh = reduced ? targetKmh : approach(previousKmh, targetKmh, (powered ? 40 : 72) * dt)
    // Changing the setpoint on the track affects velocity, not the studio transition.
    if (powered) this.driveAmount = reduced ? 1 : Math.min(1, this.driveAmount + dt / 1.65)
    else this.driveAmount = previousKmh > 0 ? this.driveAmount * (this.speedKmh / previousKmh) : 0
    const meanMps = (previousKmh + this.speedKmh) / 7.2
    const roadStep = meanMps * dt
    if (!reduced) this.distanceTravelled += roadStep
    // A manually started run can move the wheels with a stationary backdrop.
    // The scroll-driven wind tunnel only animates when motion is allowed.
    const windStep = reduced ? 0 : (tunnelSpeed / 3.6) * dt
    // Normal motion follows real distance even at 300 km/h. The old frame
    // cap silently slowed the road as well as the wheels on slower displays.
    if (!settings.driving && previousKmh === 0) this.windDistance += windStep
    const wheelStep = reduced ? Math.min(roadStep, this.maxFrameTravel)
      : settings.driving || previousKmh > 0 ? roadStep : windStep
    if (wheelStep > 0) {
      this.axles.forEach((axle, i) => {
        this.rotation[i] = (this.rotation[i] + wheelStep / axle.radius) % (Math.PI * 2)
        axle.node.quaternion
          .copy(axle.rest)
          .multiply(this.turn.setFromAxisAngle(axle.axis, this.rotation[i]))
      })
    }
    if (this.door > 0 && !canOpen) this.phase = 'closing'
    else if (this.door > 0 && this.door < 1) this.phase = 'opening'
    else if (this.door === 1) this.phase = 'open'
    else if (this.speedKmh > 0 && !settings.driving) this.phase = 'braking'
    else if (settings.driving) this.phase = this.driveAmount === 1 ? 'running' : 'starting'
    else this.phase = 'parked'
    return previousDoor !== this.door
  }

  reset() {
    this.setCabin(false)
    for (const part of [...this.hinges, ...this.axles]) part.node.quaternion.copy(part.rest)
    this.door = this.driveAmount = this.speedKmh = this.distanceTravelled = this.windDistance = 0
    this.rotation.fill(0)
    this.phase = 'parked'
  }

  dispose() {
    this.setCabin(false)
    this.setPaint(null)
    for (const copy of this.paintCopies.values()) copy.dispose()
    for (const copy of this.glassCopies.values()) copy.dispose()
  }
}
