import * as THREE from 'three'

// V3/V4 contain CFD residence/material coordinates, inlet Y/Z, body distance,
// conservative smoke concentration and relative turbulence intensity.
export const flowMin = new THREE.Vector3(-5.4, -.08, -2.5)
export const flowMax = new THREE.Vector3(4.7, 2.55, 2.5)
export const flowDuration = 1024

export async function fetchField(path: string, signal: AbortSignal, revision = 6) {
  const compressed = typeof DecompressionStream !== 'undefined'
  const response = await fetch(path + (compressed ? '.gz' : '') + '?v=' + revision, { signal })
  if (!response.ok) throw new Error('Wind field HTTP ' + response.status)
  let buffer = await response.arrayBuffer()
  const magic = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength))
  // Hosts may already decode Content-Encoding; inspect before inflating.
  if (magic[0] === 0x1f && magic[1] === 0x8b) {
    const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'))
    buffer = await new Response(stream).arrayBuffer()
  }
  return buffer
}

export function createWindField() {
  const texture = new THREE.Data3DTexture(new Uint8Array(4), 1, 1, 1)
  texture.format = THREE.RGBAFormat
  texture.type = THREE.UnsignedByteType
  texture.minFilter = texture.magFilter = THREE.LinearFilter
  texture.unpackAlignment = 1
  texture.needsUpdate = true
  const passages = new THREE.Data3DTexture(new Uint8Array(2), 1, 1, 1)
  passages.format = THREE.RGFormat
  passages.type = THREE.UnsignedByteType
  passages.minFilter = passages.magFilter = THREE.LinearFilter
  passages.unpackAlignment = 1
  passages.needsUpdate = true
  const contact = new THREE.Data3DTexture(new Uint8Array([0, 0, 255, 255]), 1, 1, 1)
  contact.format = THREE.RGBAFormat
  contact.type = THREE.UnsignedByteType
  contact.minFilter = contact.magFilter = THREE.LinearFilter
  contact.unpackAlignment = 1
  contact.needsUpdate = true
  const scale = new THREE.Vector4(30, flowMax.y - flowMin.y, flowMax.z - flowMin.z, 1.28)
  const bias = new THREE.Vector4(0, flowMin.y, flowMin.z, -.08)
  const surfaceDecode = new THREE.Vector2(1.28, -.08)
  const physical = { value: 0 }
  return {
    texture, passages, contact, scale, bias, surfaceDecode, physical,
    async load(signal: AbortSignal, folder = '/flow', file = 'vision-gt') {
      const [buffer, contactBuffer] = await Promise.all([
        fetchField(folder + '/' + file + '.bin', signal), fetchField(folder + '/contact.bin', signal, 7),
      ])
      if (signal.aborted) return
      const header = new DataView(buffer)
      if (buffer.byteLength < 64 || header.getUint32(0, true) !== 0x57464c57)
        throw new Error('Invalid wind field header')
      const version = header.getUint32(4, true)
      if (version !== 2 && version !== 3 && version !== 4) throw new Error('Unsupported wind field version')
      const shape = [8, 12, 16].map(offset => header.getUint32(offset, true))
      const count = shape[0] * shape[1] * shape[2]
      const stride = version === 4 ? 8 : version === 3 ? 5 : 4
      if (shape.some(n => n < 2 || n > 256) || buffer.byteLength !== 64 + count * (stride + 2) ||
          header.getUint32(56, true) !== 2 || (version >= 3 && header.getUint32(60, true) !== stride))
        throw new Error('Invalid wind field size')
      for (let axis = 0; axis < 3; axis++) {
        const low = header.getFloat32(20 + axis * 4, true), high = header.getFloat32(32 + axis * 4, true)
        if (!Number.isFinite(low) || !Number.isFinite(high) ||
            Math.abs(low - flowMin.getComponent(axis)) > 1e-5 || Math.abs(high - flowMax.getComponent(axis)) > 1e-5)
          throw new Error('Wind field bounds do not match the renderer')
      }
      scale.x = header.getFloat32(44, true)
      bias.w = header.getFloat32(48, true)
      scale.w = header.getFloat32(52, true)
      if (!scale.toArray().every(n => Number.isFinite(n) && n > 0) || !Number.isFinite(bias.w))
        throw new Error('Invalid wind field encoding')
      const size = { width: shape[0], height: shape[1], depth: shape[2] }
      const contactHeader = new DataView(contactBuffer)
      if (contactBuffer.byteLength !== 32 + count * 4 || contactHeader.getUint32(0, true) !== 0x544e4357 ||
          contactHeader.getUint32(4, true) !== 2 || contactHeader.getUint32(20, true) !== 4 ||
          shape.some((n, i) => contactHeader.getUint32(8 + i * 4, true) !== n))
        throw new Error('Invalid wind contact mask')
      surfaceDecode.set(contactHeader.getFloat32(28, true), contactHeader.getFloat32(24, true))
      if (!surfaceDecode.toArray().every(Number.isFinite) || surfaceDecode.x <= 0 || surfaceDecode.y >= 0)
        throw new Error('Invalid wind surface encoding')
      contact.image = { data: new Uint8Array(contactBuffer, 32), ...size }
      if (version === 4) {
        const data = new Uint16Array(buffer, 64, count * 4)
        for (let i = 0; i < data.length; i++) {
          if ((data[i] & 0x7c00) === 0x7c00 || (i % 4 === 0 && data[i] >= 0x8000))
            throw new Error('Invalid wind material coordinates')
        }
        texture.type = THREE.HalfFloatType
        texture.image = { data, ...size }
        scale.set(1, 1, 1, 1); bias.set(0, 0, 0, 0)
        physical.value = 1
      } else if (version === 3) {
        const packed = new Uint8Array(buffer, 64, count * 5)
        const data = new Uint16Array(count * 4)
        const lookup = [
          Uint16Array.from({ length: 256 }, (_, i) => THREE.DataUtils.toHalfFloat(flowMin.y + i / 255 * (flowMax.y - flowMin.y))),
          Uint16Array.from({ length: 256 }, (_, i) => THREE.DataUtils.toHalfFloat(flowMin.z + i / 255 * (flowMax.z - flowMin.z))),
          Uint16Array.from({ length: 256 }, (_, i) => THREE.DataUtils.toHalfFloat(bias.w + i / 255 * scale.w)),
        ]
        for (let i = 0; i < count; i++) {
          const age = packed[i * 5] | packed[i * 5 + 1] << 8
          if (age >= 0x7c00) throw new Error('Invalid wind residence time')
          data[i * 4] = age
          for (let a = 1; a < 4; a++) data[i * 4 + a] = lookup[a - 1][packed[i * 5 + a + 1]]
        }
        texture.type = THREE.HalfFloatType
        texture.image = { data, ...size }
        scale.set(1, 1, 1, 1); bias.set(0, 0, 0, 0)
        physical.value = 1
      } else {
        texture.image = { data: new Uint8Array(buffer, 64, count * 4), ...size }
      }
      passages.image = { data: new Uint8Array(buffer, 64 + count * stride, count * 2), ...size }
      texture.needsUpdate = passages.needsUpdate = contact.needsUpdate = true
    },
    dispose() { texture.dispose(); passages.dispose(); contact.dispose() },
  }
}

export function windCells(lite: boolean) {
  const count = lite ? 20 : 28
  return Array.from({ length: count }, (_, i) => {
    const low = new THREE.Vector3(THREE.MathUtils.lerp(flowMin.x, flowMax.x, i / count), .025, -2.15)
    const high = new THREE.Vector3(THREE.MathUtils.lerp(flowMin.x, flowMax.x, (i + 1) / count), 2.2, 2.15)
    return { low, high, center: low.clone().lerp(high, .5) }
  })
}
