import { vehicleById, type VehicleId } from './vehicles'
import * as THREE from 'three'
import smokeVertex from './shaders/windSmoke.vert?raw'
import smokeFragment from './shaders/windSmoke.frag?raw'
import { driveSpeedRange } from './story'

import { createWindField, flowDuration, flowMax, flowMin, windCells, windInletX } from './windField'
import { createWakePlayback } from './windWake'

// Trilinear filtering turns this tiny, tileable lattice into a continuous
// 3D density field. The smoke samples it in advected coordinates.
function noiseVolume() {
  const size = 32
  const data = new Uint8Array(size ** 3 * 4)
  let seed = 2917
  for (let i = 0; i < data.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    data[i] = seed >>> 24
  }
  const noise = new THREE.Data3DTexture(data, size, size, size)
  noise.format = THREE.RGBAFormat
  noise.magFilter = noise.minFilter = THREE.LinearFilter
  noise.wrapS = noise.wrapT = noise.wrapR = THREE.RepeatWrapping
  noise.needsUpdate = true
  return noise
}

// The front face of a smoke cell can pass the hardware depth test even when
// the back of that same cell lies inside a panel. Capture the nearest vehicle
// surface, including the wheel covers, from the camera doing the integration.
const vehicleDepthLayer = 2

function vehicleDepth() {
  const depth = new THREE.DepthTexture(1, 1)
  const target = new THREE.WebGLRenderTarget(1, 1, { format: THREE.RedFormat, depthTexture: depth })
  const material = new THREE.MeshDepthMaterial({ side: THREE.DoubleSide, colorWrite: false })
  const viewport = new THREE.Vector4()
  const projection = new THREE.Vector2()
  return {
    depth, viewport, projection,
    capture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
      renderer.getCurrentViewport(viewport)
      target.setSize(viewport.z, viewport.w)
      const matrix = camera.projectionMatrix.elements
      projection.set(matrix[10], matrix[14])
      const previousTarget = renderer.getRenderTarget()
      const face = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel()
      const mask = camera.layers.mask
      const previousMaterial = scene.overrideMaterial
      try {
        camera.layers.set(vehicleDepthLayer)
        scene.overrideMaterial = material
        renderer.setRenderTarget(target)
        renderer.state.buffers.depth.setMask(true)
        if (!renderer.autoClear) renderer.clearDepth()
        renderer.render(scene, camera)
      } finally {
        renderer.setRenderTarget(previousTarget, face, mip)
        scene.overrideMaterial = previousMaterial
        camera.layers.mask = mask
      }
    },
    dispose() {
      target.dispose()
      material.dispose()
    },
  }
}

export function createWindSmoke(lite: boolean) {
  const cells = windCells(lite)
  const field = createWindField()
  const wake = createWakePlayback()
  const noise = noiseVolume()
  const body = vehicleDepth()
  const group = new THREE.Group()
  group.name = 'Wind tunnel smoke'
  group.visible = false
  const cube = new THREE.BoxGeometry(1, 1, 1)
  const geometry = new THREE.InstancedBufferGeometry()
  geometry.setAttribute('position', cube.getAttribute('position'))
  geometry.setIndex(cube.index)
  const lows = new THREE.InstancedBufferAttribute(new Float32Array(cells.length * 4), 4).setUsage(
    THREE.DynamicDrawUsage,
  )
  const highs = new THREE.InstancedBufferAttribute(new Float32Array(cells.length * 3), 3).setUsage(
    THREE.DynamicDrawUsage,
  )
  geometry.setAttribute('aLow', lows)
  geometry.setAttribute('aHigh', highs)
  geometry.instanceCount = cells.length
  const uniforms = {
    uFlow: { value: field.texture },
    uPassages: { value: field.passages },
    uContactMask: { value: field.contact },
    uSurfaceDecode: { value: field.surfaceDecode },
    uPhysical: field.physical,
    uWake: { value: wake.texture },
    uWakeWeights: { value: wake.weights },
    uWakeMin: { value: wake.low },
    uWakeSize: { value: wake.size },
    uWakeActive: wake.enabled,
    uFlowScale: { value: field.scale },
    uFlowBias: { value: field.bias },
    uFlowMin: { value: flowMin },
    uInletX: { value: windInletX },
    uFlowSize: { value: flowMax.clone().sub(flowMin) },
    uNoise: { value: noise },
    uBodyDepth: { value: body.depth },
    uDepthViewport: { value: body.viewport },
    uDepthProjection: { value: body.projection },
    uTravel: { value: 2.41 },
    uSpeed: { value: driveSpeedRange.initial / driveSpeedRange.max },
    uExposure: { value: 0 },
    uHead: { value: 0 },
    uTail: { value: -1 },
    uStrength: { value: 0 },
    uStepSize: { value: lite ? 0.045 : 0.030 },
  }
  const material = new THREE.ShaderMaterial({
    name: 'Advected wind tunnel smoke',
    uniforms,
    glslVersion: THREE.GLSL3,
    vertexShader: smokeVertex,
    fragmentShader: smokeFragment,
    depthTest: true,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  })
  const volume = new THREE.Mesh(geometry, material)
  volume.layers.set(1)
  volume.renderOrder = 3
  volume.frustumCulled = false
  const lastDirection = new THREE.Vector3()
  const direction = new THREE.Vector3()
  function writeCells() {
    cells.forEach(({ low, high }, i) => {
      lows.setXYZW(i, low.x, low.y, low.z, 0)
      highs.setXYZ(i, high.x, high.y, high.z)
    })
    lows.needsUpdate = highs.needsUpdate = true
  }
  writeCells()
  volume.onBeforeRender = (renderer, scene, camera) => {
    body.capture(renderer, scene, camera)
    camera.getWorldDirection(direction)
    if (direction.dot(lastDirection) > 0.99998) return
    lastDirection.copy(direction)
    cells.sort((a, b) => b.center.dot(direction) - a.center.dot(direction))
    writeCells()
  }
  group.add(volume)
  let travel = uniforms.uTravel.value
  let wasEmitting = false
  return {
    group,
    async loadField(signal: AbortSignal, vehicleId: VehicleId = 'vision-gt') {
      const definition = vehicleById(vehicleId)
      await Promise.all([field.load(signal, definition.flowFolder, definition.file),
        definition.flowKind === 'cfd' ? wake.load(signal) : Promise.resolve()])
      if (!signal.aborted) wake.update(uniforms.uTravel.value / (120 / 3.6))
    },
    setVehicle(car: THREE.Object3D) {
      car.traverse((part) => {
        if (part instanceof THREE.Mesh) part.layers.enable(vehicleDepthLayer)
      })
    },
    update(dt: number, intensity: number, speed: number, reduced: boolean, emitting = true) {
      const elapsed = THREE.MathUtils.clamp(dt, 0, 0.1)
      const kmh = THREE.MathUtils.clamp(speed, driveSpeedRange.min, driveSpeedRange.max)
      uniforms.uSpeed.value = kmh / driveSpeedRange.max
      uniforms.uStrength.value = THREE.MathUtils.clamp(intensity, 0, 1)
      if (uniforms.uStrength.value <= 0.008) {
        group.visible = false
        uniforms.uHead.value = 0
        uniforms.uTail.value = -1
        wasEmitting = false
        return
      }
      if (emitting && !wasEmitting) { uniforms.uHead.value = 0; uniforms.uTail.value = -1 }
      if (!emitting && wasEmitting) uniforms.uTail.value = 0
      if (!emitting && !wasEmitting && uniforms.uTail.value < 0) uniforms.uTail.value = flowDuration
      wasEmitting = emitting
      // The baked field's flight coordinate is based on a 1 m/s inlet.
      // Convert km/h directly, matching tire travel without an artistic cap.
      const velocity = kmh / 3.6
      uniforms.uExposure.value = reduced ? 0 : velocity * elapsed * 0.8
      const advance = elapsed * velocity
      uniforms.uHead.value = reduced
        ? flowDuration
        : Math.min(flowDuration, uniforms.uHead.value + advance)
      if (!emitting && !reduced) uniforms.uTail.value = Math.min(flowDuration, uniforms.uTail.value + advance)
      group.visible = reduced ? emitting : emitting || uniforms.uTail.value < flowDuration
      if (reduced) uniforms.uTail.value = emitting ? -1 : flowDuration
      if (!reduced) travel += advance
      uniforms.uTravel.value = reduced ? 2.41 : travel
      // The local transient recording was solved at 120 km/h. Other wind
      // settings change its time scale, not its aerodynamic boundary solution.
      wake.update(uniforms.uTravel.value / (120 / 3.6))
    },
    restart() {
      uniforms.uHead.value = 0
      uniforms.uTail.value = -1
      wasEmitting = false
    },
    setLowDetail() {
      uniforms.uStepSize.value = 0.045
    },
    dispose() {
      group.clear()
      geometry.dispose()
      cube.dispose()
      material.dispose()
      noise.dispose()
      field.dispose()
      wake.dispose()
      body.dispose()
    },
  }
}
