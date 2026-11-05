import assert from 'node:assert/strict'
import {Vector3} from 'three'

// The tire's narrow principal dimension identifies its axle, including authored
// camber. Projected radial bounds locate the hub without mixing tread width
// into the radius, as an axis-aligned bounding box would do.
export function fitWheelProfile(points) {
  assert(points.length > 100)
  const mean = new Vector3()
  for (const p of points) mean.add(new Vector3(...p))
  mean.divideScalar(points.length)
  const covariance = Array.from({length: 3}, () => [0, 0, 0])
  for (const p of points) for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++)
    covariance[a][b] += (p[a] - mean.getComponent(a)) * (p[b] - mean.getComponent(b)) / points.length
  const vectors = [[1,0,0], [0,1,0], [0,0,1]]
  for (let sweep = 0; sweep < 24; sweep++) {
    let p = 0, q = 1
    for (const [a,b] of [[0,2], [1,2]])
      if (Math.abs(covariance[a][b]) > Math.abs(covariance[p][q])) { p = a; q = b }
    if (Math.abs(covariance[p][q]) < 1e-12) break
    const angle = .5 * Math.atan2(2 * covariance[p][q], covariance[q][q] - covariance[p][p])
    const c = Math.cos(angle), s = Math.sin(angle)
    const pp = covariance[p][p], qq = covariance[q][q], pq = covariance[p][q]
    covariance[p][p] = c*c*pp - 2*s*c*pq + s*s*qq
    covariance[q][q] = s*s*pp + 2*s*c*pq + c*c*qq
    covariance[p][q] = covariance[q][p] = 0
    for (let k = 0; k < 3; k++) {
      if (k !== p && k !== q) {
        const kp = covariance[k][p], kq = covariance[k][q]
        covariance[k][p] = covariance[p][k] = c*kp - s*kq
        covariance[k][q] = covariance[q][k] = s*kp + c*kq
      }
      const vp = vectors[k][p], vq = vectors[k][q]
      vectors[k][p] = c*vp - s*vq
      vectors[k][q] = s*vp + c*vq
    }
  }
  const narrow = [0,1,2].reduce((a,b) => covariance[a][a] < covariance[b][b] ? a : b)
  const axis = new Vector3(...vectors.map(row => row[narrow])).normalize()
  if (axis.z > 0) axis.negate()
  // Nearly parallel road-car tires contain asymmetric tread and seam sampling.
  // Keep their existing straight axle rather than amplifying that tiny bias.
  if (Math.acos(Math.min(1, -axis.z)) < Math.PI / 720) axis.set(0, 0, -1)
  const forward = new Vector3(1,0,0).addScaledVector(axis, -axis.x).normalize()
  const up = forward.clone().cross(axis).normalize()
  const bounds = [forward, up].map(direction => {
    let min = Infinity, max = -Infinity
    for (const p of points) { const d = direction.dot(new Vector3(...p)); min = Math.min(min,d); max = Math.max(max,d) }
    return {mid: (min + max) / 2, radius: (max - min) / 2}
  })
  const center = forward.multiplyScalar(bounds[0].mid)
    .addScaledVector(up, bounds[1].mid).addScaledVector(axis, mean.dot(axis))
  return {center: center.toArray(), axis: axis.toArray(), radius: Math.max(...bounds.map(b => b.radius))}
}
