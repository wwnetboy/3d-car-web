import assert from 'node:assert/strict';

export function worldGeometry(root) {
  const names = root
    .listMaterials()
    .map((mat) => mat.getName())
    .sort();
  const draws = [];
  root.getDefaultScene().traverse((node) => {
    const m = node.getWorldMatrix();
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
      const pos = primitive.getAttribute('POSITION'),
        norm = primitive.getAttribute('NORMAL');
      const points = new Float32Array(pos.getCount() * 3),
        normals = new Float32Array(points.length);
      // Source and derivatives both use only rotation and uniform positive scale.
      const uniformScale = Math.hypot(m[0], m[1], m[2]);
      assert(Math.abs(uniformScale - Math.hypot(m[4], m[5], m[6])) < 1e-4);
      assert(Math.abs(uniformScale - Math.hypot(m[8], m[9], m[10])) < 1e-4);
      const p = [],
        n = [];
      for (let i = 0; i < pos.getCount(); i++) {
        pos.getElement(i, p);
        norm.getElement(i, n);
        for (let k = 0; k < 3; k++) {
          points[i * 3 + k] = m[k] * p[0] + m[k + 4] * p[1] + m[k + 8] * p[2] + m[k + 12];
          normals[i * 3 + k] = (m[k] * n[0] + m[k + 4] * n[1] + m[k + 8] * n[2]) / uniformScale;
        }
      }
      draws.push({
        node, primitive,
        points,
        normals,
        indices: primitive.getIndices().getArray(),
        mat: names.indexOf(primitive.getMaterial().getName()) + 1,
      });
    }
  });
  return draws;
}

// Match the runtime wrapper: rotate the source +Z nose to +X, fit 5.1 m,
// centre horizontally and place the lowest visible vertex on the floor.
export function normalizeVehicleGeometry(draws) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const { points } of draws) for (let i = 0; i < points.length; i += 3) {
    const rotated = [points[i + 2], points[i + 1], -points[i]];
    for (let a = 0; a < 3; a++) { min[a] = Math.min(min[a], rotated[a]); max[a] = Math.max(max[a], rotated[a]); }
  }
  const scale = 5.1 / (max[0] - min[0]);
  const center = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  for (const { points } of draws) for (let i = 0; i < points.length; i += 3) {
    const rotated = [points[i + 2], points[i + 1], -points[i]];
    for (let a = 0; a < 3; a++) points[i + a] = (rotated[a] - center[a]) * scale;
  }
  return { rotationY: Math.PI / 2, length: 5.1, scale, center };
}
