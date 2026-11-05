import * as THREE from 'three'
import { fetchField } from './windField'

// Four neighbouring frame values share one RGBA volume. A single GPU lookup
// can interpolate time and join the recording ends without a hard reset.
export function createWakePlayback() {
  const texture = new THREE.Data3DTexture(new Uint16Array(4), 1, 1, 1)
  texture.format = THREE.RGBAFormat
  texture.type = THREE.HalfFloatType
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  const weights = new THREE.Vector4(1, 0, 0, 0)
  const low = new THREE.Vector3(), size = new THREE.Vector3(1, 1, 1)
  const enabled = { value: 0 }
  let frames = new Uint16Array(0), times = new Float32Array(0)
  let packed = new Uint16Array(4), count = 1, period = 1, overlap = 0.1
  const previous = [-1, -1, -1, -1]

  function bracket(time: number) {
    let lo = 0, hi = times.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (times[mid] <= time) lo = mid
      else hi = mid
    }
    return [lo, hi, THREE.MathUtils.clamp((time - times[lo]) / (times[hi] - times[lo]), 0, 1)]
  }

  function update(seconds: number) {
    if (!frames.length) return
    const phase = THREE.MathUtils.euclideanModulo(seconds, period)
    const a = bracket(phase), b = phase < overlap ? bracket(period + phase) : a
    const s = THREE.MathUtils.clamp(phase / overlap, 0, 1)
    const blend = s * s * s * (s * (s * 6 - 15) + 10)
    weights.set(blend * (1 - a[2]), blend * a[2], (1 - blend) * (1 - b[2]), (1 - blend) * b[2])
    const indices = [a[0], a[1], b[0], b[1]]
    if (indices.every((n, i) => n === previous[i])) return
    for (let c = 0; c < 4; c++) {
      const start = indices[c] * count
      for (let i = 0; i < count; i++) packed[i * 4 + c] = frames[start + i]
      previous[c] = indices[c]
    }
    texture.needsUpdate = true
  }

  return {
    texture, weights, low, size, enabled, update,
    async load(signal: AbortSignal) {
      const buffer = await fetchField('/flow/wake.bin', signal, 1)
      if (signal.aborted) return
      const header = new DataView(buffer)
      if (buffer.byteLength < 64 || header.getUint32(0, true) !== 0x4b415757 ||
          header.getUint32(4, true) !== 1 || header.getUint32(56, true) !== 1 || header.getUint32(60, true) !== 2)
        throw new Error('Invalid transient wake header')
      const shape = [8, 12, 16].map(offset => header.getUint32(offset, true))
      const length = header.getUint32(20, true)
      count = shape.reduce((a, b) => a * b, 1)
      if (shape.some(n => n < 2 || n > 128) || count > 250000 || length < 2 || length > 180 ||
          buffer.byteLength !== 64 + length * 4 + length * count * 2 || header.getFloat32(48, true) !== 120)
        throw new Error('Invalid transient wake size')
      low.set(...([24, 28, 32].map(o => header.getFloat32(o, true)) as [number, number, number]))
      size.set(...([36, 40, 44].map(o => header.getFloat32(o, true)) as [number, number, number])).sub(low)
      if (![...low.toArray(), ...size.toArray()].every(Number.isFinite) || size.toArray().some(v => v <= 0))
        throw new Error('Invalid transient wake bounds')
      times = new Float32Array(buffer, 64, length)
      if (times[0] !== 0 || times.some((n, i) => !Number.isFinite(n) || (i > 0 && n <= times[i - 1])))
        throw new Error('Invalid transient wake times')
      overlap = header.getFloat32(52, true)
      period = times[length - 1] - overlap
      if (!Number.isFinite(overlap) || overlap <= 0 || overlap > times[length - 1] * .25 || period <= 0)
        throw new Error('Invalid transient wake loop')
      frames = new Uint16Array(buffer, 64 + length * 4, length * count)
      if (frames.some(v => v > 0x3c00)) throw new Error('Unbounded transient wake concentration')
      packed = new Uint16Array(count * 4)
      texture.image = { data: packed, width: shape[0], height: shape[1], depth: shape[2] }
      previous.fill(-1)
      update(0)
      enabled.value = 1
    },
    dispose() { frames = new Uint16Array(0); times = new Float32Array(0); texture.dispose() },
  }
}
