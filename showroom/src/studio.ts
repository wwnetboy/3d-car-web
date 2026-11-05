import * as THREE from 'three'
import { Reflector } from 'three/addons/objects/Reflector.js'
import roomFragment from './shaders/room.frag?raw'
import softbox from './shaders/softbox.frag?raw'
import lightRings from './shaders/lightRings.glsl?raw'

// The lighting rig is generated locally. The softboxes are only visible in
// reflections, so the photographer can frame the car from any azimuth.
export function studioEnvironment(renderer: THREE.WebGLRenderer) {
  const set = new THREE.Scene()
  set.background = new THREE.Color().setRGB(0.07, 0.077, 0.084)
  const lamps = [
    // position, width, height, linear luminance, roll
    [[-0.7, 5.4, -1.8], 9.5, 2.6, 3.4, 0.16],
    [[-1.0, 3.1, 4.4], 9.0, 1.16, 4.1, -0.14],
    [[1.6, 1.1, -5.2], 8.8, 0.24, 3.3, 0.04],
    [[4.8, 2.3, 1.6], 2.1, 3.9, 2.9, -0.21],
    [[-4.4, 1.8, -2.2], 1.5, 2.9, 2.6, 0.18],
    [[0.5, 4.1, -0.3], 6.5, 0.28, 5.3, -0.18],
  ] as const
  const geometry = new THREE.PlaneGeometry()
  for (const [pos, width, height, radiance, roll] of lamps) {
    const material = new THREE.ShaderMaterial({
      uniforms: { uPower: { value: radiance } },
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      vertexShader:
        'varying vec2 vUv; void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: softbox,
    })
    const panel = new THREE.Mesh(geometry, material)
    panel.position.set(pos[0], pos[1], pos[2])
    panel.scale.set(width, height, 1)
    panel.lookAt(0, 0.35, 0)
    panel.rotateZ(roll)
    set.add(panel)
  }
  const envelope = new THREE.Mesh(
    new THREE.SphereGeometry(14, 48, 32),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader:
        'varying vec3 d; void main(){d=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: [
        'varying vec3 d; void main(){vec3 n=normalize(d);',
        'float ceiling=smoothstep(-.37,.62,n.y);',
        'float scrim=pow(max(0.,dot(n,normalize(vec3(.28,.48,-.83)))),7.);',
        'float bounce=pow(max(0.,dot(n,normalize(vec3(-.57,.25,.81)))),4.);',
        'gl_FragColor=vec4(vec3(.025,.032,.035)+ceiling*vec3(.075,.085,.093)+scrim*vec3(.43,.44,.44)+bounce*.26,1.);}',
      ].join('\n'),
    }),
  )
  set.add(envelope)
  const generator = new THREE.PMREMGenerator(renderer)
  const environment = generator.fromScene(set, 0.025)
  generator.dispose()
  geometry.dispose()
  envelope.geometry.dispose()
  for (const panel of set.children) ((panel as THREE.Mesh).material as THREE.Material).dispose()
  return environment
}

const worldVertex = [
  'varying vec3 vWorld;',
  'void main(){ vec4 pos=modelMatrix*vec4(position,1.); vWorld=pos.xyz; gl_Position=projectionMatrix*viewMatrix*pos; }',
].join('\n')

export function studioRoom(fine: boolean) {
  const uniform = {
    uDay: { value: 0 },
    uWindRoom: { value: 0 },
    uFine: { value: Number(fine) },
    uRoad: { value: 0 },
    uTravel: { value: 0 },
  }
  const room = new THREE.Mesh(
    new THREE.SphereGeometry(54, 40, 22),
    new THREE.ShaderMaterial({
      uniforms: uniform,
      vertexShader: worldVertex,
      fragmentShader: roomFragment.replace('#include <drive_arches>', lightRings),
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
    }),
  )
  room.renderOrder = -100
  room.layers.set(1)
  return room
}

// Add the track luminaires at the IBL stage so the author's metalness,
// roughness and clearcoat still determine how each surface reflects them.
export function reflectDrivingArches(car: THREE.Object3D, room: ReturnType<typeof studioRoom>) {
  const install: THREE.Material['onBeforeCompile'] = (shader) => {
    shader.uniforms.uRoad = room.material.uniforms.uRoad
    shader.uniforms.uTravel = room.material.uniforms.uTravel
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uRoad;
        uniform float uTravel;
        ${lightRings}`)
      .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>
        #if defined(USE_ENVMAP) && defined(RE_IndirectSpecular)
          if (uRoad > .0001) {
            vec3 origin = cameraPosition - (vec4(vViewPosition, 0.) * viewMatrix).xyz;
            vec3 ray = inverseTransformDirection(reflect(-geometryViewDir, geometryNormal), viewMatrix);
            radiance += uRoad * archRadiance(origin, ray, material.roughness, uTravel);
            #ifdef USE_CLEARCOAT
              ray = inverseTransformDirection(reflect(-geometryViewDir, geometryClearcoatNormal), viewMatrix);
              clearcoatRadiance += uRoad * archRadiance(origin, ray, material.clearcoatRoughness, uTravel);
            #endif
          }
        #endif`)
  }
  car.traverse((part) => {
    if (!(part instanceof THREE.Mesh)) return
    for (const m of Array.isArray(part.material) ? part.material : [part.material]) {
      if (m instanceof THREE.MeshStandardMaterial) m.onBeforeCompile = install
    }
  })
}

export function studioReflection() {
  const mirror = new Reflector(new THREE.PlaneGeometry(15, 12), {
    textureWidth: 1024,
    textureHeight: 768,
    clipBias: 0.0006,
    multisample: 2,
    shader: {
      name: 'Sealed charcoal concrete floor',
      uniforms: {
        tDiffuse: { value: null },
        color: { value: null },
        textureMatrix: { value: null },
        uGloss: { value: 1 },
      },
      vertexShader:
        'uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vWorld; void main(){vUv=textureMatrix*vec4(position,1.); vWorld=(modelMatrix*vec4(position,1.)).xyz; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: [
        'uniform sampler2D tDiffuse; uniform float uGloss; varying vec4 vUv; varying vec3 vWorld;',
        'void main(){',
        'vec2 uv=vUv.xy/vUv.w; vec4 sampleColor=texture2D(tDiffuse,uv);',
        'float falloff=exp(-dot(vWorld.xz/vec2(5.5,4.8),vWorld.xz/vec2(5.5,4.8)));',
        'float cosine=clamp(normalize(cameraPosition-vWorld).y,0.,1.);',
        'float reflectance=.14+.32*pow(1.-cosine,5.);',
        'gl_FragColor=vec4(sampleColor.rgb/max(sampleColor.a,0.01),sampleColor.a*falloff*reflectance*uGloss);',
        '#include <tonemapping_fragment>',
        '#include <colorspace_fragment>',
        '}',
      ].join('\n'),
    },
  })
  const texture = mirror.getRenderTarget().texture
  // A viewport-sized target with MSAA preserves the tire/contact silhouette.
  // The old +2.8 mip bias blurred even the part touching the floor.
  texture.generateMipmaps = false
  texture.minFilter = THREE.LinearFilter
  const mat = mirror.material as THREE.ShaderMaterial
  mat.transparent = true
  mat.depthWrite = false
  mirror.rotation.x = -Math.PI / 2
  mirror.renderOrder = -5
  return mirror
}
