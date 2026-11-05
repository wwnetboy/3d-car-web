import * as THREE from 'three'

// Metres in the GLB's closed pose. Measured at the visible intersection of
// upholstery and carbon trim, then inset onto the upholstery by about 1 mm.
// The two doors stop at their own panel edges, leaving a 3 mm assembly gap.
const dashHalf = [
  [1.1250, .7382, 0], [1.1243, .7381, .0294], [1.1207, .7377, .0882],
  [1.1179, .7374, .1175], [1.1111, .7365, .1760], [1.1060, .7359, .2050],
  [1.0999, .7351, .2338], [1.0928, .7343, .2624], [1.0849, .7332, .2907],
  [1.0760, .7320, .3187], [1.0660, .7306, .3464], [1.0549, .7291, .3736],
  [1.0428, .7275, .4003], [1.0295, .7257, .4264], [1.0149, .7236, .4519],
  [.9994, .7213, .4767], [.9829, .7186, .5008], [.9638, .7156, .5233],
  [.9431, .7122, .5445], [.9196, .7080, .5635], [.8959, .7036, .5818],
  [.8699, .6986, .5979], [.8438, .6934, .6130], [.7968, .6832, .6360],
]
const door = [
  [-.0788, .5948, .5981], [-.0324, .5982, .6178], [0, .6006, .6293],
  [.0166, .6021, .6343], [.0506, .6051, .6430], [.1034, .6102, .6526],
  [.1584, .6158, .6600], [.1773, .6177, .6617], [.3444, .6350, .6760],
  [.4165, .6426, .6797], [.4680, .6479, .6810], [.5222, .6533, .6805],
  [.5784, .6590, .6772], [.6370, .6648, .6712], [.6972, .6711, .6616],
  [.7277, .6745, .6552], [.7912, .6827, .6407], [.7938, .6829, .6373],
]
const mirrored = (points: number[][]) => points.map(([x, y, z]) => [x, y, -z])
const paths: Record<string, number[][]> = {
  Cube048_interior_accent_0: [...mirrored(dashHalf.slice(1)).reverse(), ...dashHalf],
  Door_L_interior_accent: mirrored(door),
  Door_R_interior_accent: door,
}

function fitPath(mesh: THREE.Mesh, points: number[][]) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)))
  const count = Math.ceil(curve.getLength() / .008)
  const eye = new THREE.Vector3(0, .985, 0)
  const ray = new THREE.Raycaster()
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld)
  const fitted: THREE.Vector3[] = []
  const normals: THREE.Vector3[] = []
  // Reproject onto the actual loaded tier. The lite mesh has slightly different
  // facets; a curve fitted only to the standard mesh could float above them.
  for (let i = 0; i <= count; i++) {
    const sample = curve.getPointAt(i / count)
    ray.set(eye, sample.clone().sub(eye).normalize())
    const hit = ray.intersectObject(mesh, false).find(h => h.point.distanceTo(sample) < .012)
    if (!hit?.normal) return
    const normal = hit.normal.clone().applyNormalMatrix(normalMatrix)
    if (normal.dot(eye.clone().sub(hit.point)) < 0) normal.negate()
    fitted.push(hit.point)
    normals.push(normal)
  }
  return { fitted, normals }
}

export class CabinLights {
  private strips: THREE.Mesh[] = []
  private patches = new Map<THREE.Material, THREE.Material['onBeforeCompile']>()
  private surfaces: THREE.Mesh[] = []
  private material: THREE.ShaderMaterial

  constructor(car: THREE.Object3D, power: THREE.IUniform<THREE.Vector4>) {
    this.material = new THREE.ShaderMaterial({
      name: 'Cabin seam diffuser',
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      uniforms: { uCabinLamp: power },
      vertexShader: `
        attribute vec2 lampGuide;
        varying vec2 vLampGuide;
        void main() {
          vLampGuide = lampGuide;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
        }`,
      fragmentShader: `
        uniform vec4 uCabinLamp;
        varying vec2 vLampGuide;
        void main() {
          float sweep = pow(.5 + .5*cos(abs(vLampGuide.x)*6.8 - uCabinLamp.y*1.45), 5.);
          float level = .66 + .30*sweep + .10*uCabinLamp.z;
          float end = smoothstep(0., .003, vLampGuide.y);
          gl_FragColor = vec4(vec3(.28, .78, 1.3)*level, uCabinLamp.x*end);
          #include <colorspace_fragment>
        }`,
    })
    car.updateWorldMatrix(true, true)
    const parts: THREE.Mesh[] = []
    car.traverse(node => {
      if (node instanceof THREE.Mesh && paths[node.name]) parts.push(node)
    })
    for (const mesh of parts) {
      const fit = fitPath(mesh, paths[mesh.name])
      if (!fit) continue
      const { fitted, normals } = fit
      const centers = fitted.map((p, i) => p.clone().addScaledVector(normals[i], .00095))
      const curve = new THREE.CatmullRomCurve3(centers)
      const length = curve.getLength()
      const geometry = new THREE.TubeGeometry(curve, fitted.length - 1, .00175, 6, false)
      const uv = geometry.getAttribute('uv')
      const guide = new Float32Array(uv.count * 2)
      for (let i = 0; i < uv.count; i++) {
        const t = uv.getX(i), p = curve.getPointAt(t)
        guide[2 * i] = p.z + Math.sign(p.z) * Math.max(0, 1.07 - p.x)
        guide[2 * i + 1] = Math.min(t, 1 - t) * length
      }
      geometry.setAttribute('lampGuide', new THREE.BufferAttribute(guide, 2))
      geometry.applyMatrix4(mesh.matrixWorld.clone().invert())
      const strip = new THREE.Mesh(geometry, this.material)
      strip.name = mesh.name + ' seam light'
      strip.visible = false
      // Parent to the actual panel, not the car root: the local attachment is
      // preserved through the hinge transform when either door opens.
      mesh.add(strip)
      this.strips.push(strip)
      this.fitSpill(mesh, fitted, power)
    }
  }

  private fitSpill(mesh: THREE.Mesh, path: THREE.Vector3[], power: THREE.IUniform<THREE.Vector4>) {
    const pos = mesh.geometry.getAttribute('position')
    const coords = new Float32Array(pos.count * 3)
    const spill = new Float32Array(pos.count * 3)
    const point = new THREE.Vector3(), nearest = new THREE.Vector3()
    const segments = path.slice(1).map((end, i) => new THREE.Line3(path[i], end))
    const door = mesh.name.startsWith('Door_')
    for (let i = 0; i < pos.count; i++) {
      point.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld)
      const { x, y, z } = point
      if (!door && (x < .755 || x > 1.20 || y < .53 || Math.abs(z) > .73)) continue
      let distance = Infinity
      for (const line of segments) {
        line.closestPointToPoint(point, true, nearest)
        const d = point.distanceToSquared(nearest)
        if (d < distance) {
          distance = d
          spill[3 * i] = point.x - nearest.x
          spill[3 * i + 1] = point.y - nearest.y
          spill[3 * i + 2] = point.z - nearest.z
        }
      }
      coords[3 * i] = z + Math.sign(z) * Math.max(0, 1.07 - x)
      coords[3 * i + 1] = Math.sqrt(distance)
      coords[3 * i + 2] = 1
    }
    mesh.geometry.setAttribute('cabinGuide', new THREE.BufferAttribute(coords, 3))
    mesh.geometry.setAttribute('cabinSpill', new THREE.BufferAttribute(spill, 3))
    this.surfaces.push(mesh)
    const mat = mesh.material as THREE.Material
    if (this.patches.has(mat)) return
    const previous = mat.onBeforeCompile
    this.patches.set(mat, previous)
    mat.onBeforeCompile = function (shader, renderer) {
      previous.call(this, shader, renderer)
      shader.uniforms.uCabinLamp = power
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec3 cabinGuide; attribute vec3 cabinSpill; varying vec3 vGuide; varying vec3 vSpill;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGuide = cabinGuide; vSpill = cabinSpill;')
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec4 uCabinLamp; varying vec3 vGuide; varying vec3 vSpill;')
        .replace('#include <opaque_fragment>', `
          if (uCabinLamp.x > .001 && vGuide.z > .99) {
            float glow = exp(-length(vSpill)*125.);
            float sweep = pow(.5 + .5*cos(abs(vGuide.x)*6.8 - uCabinLamp.y*1.45), 5.);
            float light = .66 + .30*sweep + .10*uCabinLamp.z;
            float weave = 1. - .09*cos(vGuide.x*1340.) * (1.-smoothstep(.001,.004,fwidth(vGuide.x)));
            vec3 sheltered = outgoingLight*.070*weave;
            vec3 spill = light*vec3(.055,.22,.44)*glow;
            outgoingLight = mix(outgoingLight, sheltered + spill, uCabinLamp.x);
          }
          #include <opaque_fragment>`)
    }
  }

  show(active: boolean) {
    for (const strip of this.strips) strip.visible = active
  }

  dispose() {
    for (const strip of this.strips) {
      strip.removeFromParent()
      strip.geometry.dispose()
    }
    for (const mesh of this.surfaces) {
      mesh.geometry.deleteAttribute('cabinGuide')
      mesh.geometry.deleteAttribute('cabinSpill')
    }
    for (const [material, previous] of this.patches) material.onBeforeCompile = previous
    this.material.dispose()
  }
}
