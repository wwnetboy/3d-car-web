import * as THREE from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'

const screenVertex = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0., 1.);
  }`

// The mask renders the car's existing depth layer. Body panels occlude the
// light sources before blur, so a hidden lamp cannot glow through the car.
export class CarLights {
  private sources = new Map<THREE.Object3D, THREE.Color>()
  private surfaces: {
    mesh: THREE.Mesh
    original: THREE.Material
    lit: THREE.MeshStandardMaterial
  }[] = []
  private mask = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: true, samples: 4 })
  private horizontal = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false })
  private blurred = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false })
  private size = new THREE.Vector2()
  private clear = new THREE.Color()
  private lowDetail: boolean
  private captureMaterial = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    toneMapped: false,
    uniforms: { uLamp: { value: new THREE.Color(0) } },
    vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }',
    fragmentShader: 'uniform vec3 uLamp; void main() { gl_FragColor = vec4(uLamp, 1.); }',
  })
  private blurMaterial = new THREE.ShaderMaterial({
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
    uniforms: {
      tSource: { value: this.mask.texture },
      uStep: { value: new THREE.Vector2() },
    },
    vertexShader: screenVertex,
    fragmentShader: `
      uniform sampler2D tSource;
      uniform vec2 uStep;
      varying vec2 vUv;
      void main() {
        vec3 light = texture2D(tSource, vUv).rgb * .227027;
        light += texture2D(tSource, vUv + uStep * 1.384615).rgb * .316216;
        light += texture2D(tSource, vUv - uStep * 1.384615).rgb * .316216;
        light += texture2D(tSource, vUv + uStep * 3.230769).rgb * .070270;
        light += texture2D(tSource, vUv - uStep * 3.230769).rgb * .070270;
        gl_FragColor = vec4(light, 1.);
      }`,
  })
  private blurQuad = new FullScreenQuad(this.blurMaterial)
  readonly glow = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      uniforms: { tGlow: { value: this.blurred.texture } },
      vertexShader: screenVertex,
      // This is a restrained lens halo composed after the scene's exposure.
      fragmentShader: `
        uniform sampler2D tGlow;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4(texture2D(tGlow, vUv).rgb * .85, 1.);
        }`,
    }),
  )

  constructor(car: THREE.Object3D, lowDetail: boolean) {
    this.lowDetail = lowDetail
    if (lowDetail) this.mask.samples = 0
    const front = new THREE.Color().setRGB(.72, .88, 1)
    const rear = new THREE.Color().setRGB(1, .018, .006)
    car.traverse((node) => {
      if (!(node instanceof THREE.Mesh) || !(node.material instanceof THREE.MeshStandardMaterial)) return
      const headlight = node.userData.vehicleLamp === 'front'
      const tail = node.material.name === 'material'
      if (!headlight && !tail) return
      const original = node.material
      const lit = original.clone()
      lit.onBeforeCompile = original.onBeforeCompile
      lit.toneMapped = false
      lit.color.setRGB(.025, .025, .025)
      lit.metalness = 0
      lit.roughness = .36
      lit.envMapIntensity = .2
      lit.emissive.copy(headlight ? front : rear)
      lit.emissiveIntensity = headlight ? 1.18 : 1.1
      this.surfaces.push({ mesh: node, original, lit })
      this.sources.set(node, headlight ? front : rear)
      node.material = lit
    })
    this.captureMaterial.onBeforeRender = (_renderer, _scene, _camera, _geometry, object) => {
      const color = this.sources.get(object)
      this.captureMaterial.uniforms.uLamp.value.copy(color ?? this.black)
      this.captureMaterial.uniformsNeedUpdate = true
    }
    this.glow.name = 'Vehicle lamp halo'
    this.glow.frustumCulled = false
    this.glow.layers.set(3)
    this.glow.renderOrder = 100
    this.glow.onBeforeRender = (renderer, scene, camera) => this.capture(renderer, scene, camera)
  }

  private black = new THREE.Color(0)

  private capture(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    renderer.getSize(this.size)
    const scale = Math.min(1, (this.lowDetail ? 640 : 1024) / Math.max(this.size.x, this.size.y))
    const width = Math.max(1, Math.round(this.size.x * scale))
    const height = Math.max(1, Math.round(this.size.y * scale))
    if (this.mask.width !== width || this.mask.height !== height) {
      for (const target of [this.mask, this.horizontal, this.blurred]) target.setSize(width, height)
    }
    const target = renderer.getRenderTarget()
    const face = renderer.getActiveCubeFace()
    const mip = renderer.getActiveMipmapLevel()
    const layers = camera.layers.mask
    const material = scene.overrideMaterial
    const background = scene.background
    const alpha = renderer.getClearAlpha()
    const autoClear = renderer.autoClear
    renderer.getClearColor(this.clear)
    try {
      camera.layers.set(2)
      scene.overrideMaterial = this.captureMaterial
      scene.background = null
      renderer.autoClear = true
      renderer.setClearColor(0, 0)
      renderer.setRenderTarget(this.mask)
      renderer.state.buffers.depth.setMask(true)
      renderer.render(scene, camera)
      const uniforms = this.blurMaterial.uniforms
      uniforms.tSource.value = this.mask.texture
      uniforms.uStep.value.set(1.65 / this.size.x, 0)
      renderer.setRenderTarget(this.horizontal)
      this.blurQuad.render(renderer)
      uniforms.tSource.value = this.horizontal.texture
      uniforms.uStep.value.set(0, 1.65 / this.size.y)
      renderer.setRenderTarget(this.blurred)
      this.blurQuad.render(renderer)
    } finally {
      renderer.setRenderTarget(target, face, mip)
      renderer.setClearColor(this.clear, alpha)
      renderer.autoClear = autoClear
      scene.overrideMaterial = material
      scene.background = background
      camera.layers.mask = layers
    }
  }

  setLowDetail() {
    this.lowDetail = true
    if (this.mask.samples) {
      this.mask.samples = 0
      this.mask.dispose()
    }
  }

  dispose() {
    this.glow.removeFromParent()
    this.glow.geometry.dispose()
    this.glow.material.dispose()
    this.blurQuad.dispose()
    this.blurMaterial.dispose()
    this.captureMaterial.dispose()
    this.mask.dispose()
    this.horizontal.dispose()
    this.blurred.dispose()
    for (const { mesh, original, lit } of this.surfaces) {
      mesh.material = original
      lit.dispose()
    }
  }
}

