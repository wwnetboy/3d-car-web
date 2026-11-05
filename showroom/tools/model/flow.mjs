// Bake a steady, incompressible potential-flow field around the actual GLB.
// This is a visual transport field, not a drag/pressure prediction or RANS solver.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Triangle, Vector3 } from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { worldGeometry, normalizeVehicleGeometry } from './world-geometry.mjs';
import { projectFlow } from './flow-solver.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const output = process.argv[2] ? resolve(process.argv[2]) : resolve(here, '../../public/flow');
if (!process.argv[2]) {
  const audit = await readFile(resolve(output, 'audit.json'), 'utf8').then(JSON.parse).catch(() => null);
  assert(!audit || audit.formatVersion < 3,
    'The site uses CFD data. Supply an explicit comparison output directory; the legacy potential-flow bake must not overwrite it.');
}
const vehicleId = process.argv[3] ?? 'vision-gt';
assert(['vision-gt', 'su7-ultra', 'mclaren-vgt'].includes(vehicleId), 'Unknown vehicle');
const shape = [256, 96, 128];
const min = [-5.4, -.08, -2.5], max = [4.7, 2.55, 2.5];
const [nx, ny, nz] = shape, plane = nx * ny, count = plane * nz;
const step = shape.map((n, a) => (max[a] - min[a]) / n);
const [dx, dy, dz] = step;
const index = (x, y, z) => x + nx * y + plane * z;
const coord = (a, i) => min[a] + (i + .5) * step[a];
const solid = new Uint8Array(count);
const start = performance.now();
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
await MeshoptDecoder.ready;
const modelBytes = await readFile(resolve(here, `../../public/models/${vehicleId}.glb`));
const doc = await io.readBinary(modelBytes);
const draws = worldGeometry(doc.getRoot());
const normalization = vehicleId === 'vision-gt' ? null : normalizeVehicleGeometry(draws);
const cabinPrimitives = new Set();
doc.getRoot().getDefaultScene().traverse(node => {
  for (const primitive of node.getMesh()?.listPrimitives() ?? []) {
    if (node.getExtras().cabinGlazing || (vehicleId === 'vision-gt'
      ? primitive.getMaterial().getName() === 'interior_accent'
      : ['Windows', 'Roof_Glass', 'glass'].includes(primitive.getMaterial().getName())))
      cabinPrimitives.add(primitive);
  }
});
const triangle = new Triangle(), point = new Vector3(), closest = new Vector3();
const radius = Math.hypot(...step) * .48;
let triangles = 0;
for (const { points, indices } of draws) {
  for (let j = 0; j < indices.length; j += 3) {
    triangle.a.fromArray(points, indices[j] * 3);
    triangle.b.fromArray(points, indices[j + 1] * 3);
    triangle.c.fromArray(points, indices[j + 2] * 3);
    const verts = [triangle.a, triangle.b, triangle.c];
    const lo = ['x', 'y', 'z'].map((axis, a) => Math.max(0,
      Math.floor((Math.min(...verts.map(v => v[axis])) - radius - min[a]) / step[a])));
    const hi = ['x', 'y', 'z'].map((axis, a) => Math.min(shape[a] - 1,
      Math.floor((Math.max(...verts.map(v => v[axis])) + radius - min[a]) / step[a])));
    for (let z = lo[2]; z <= hi[2]; z++) for (let y = lo[1]; y <= hi[1]; y++) {
      for (let x = lo[0]; x <= hi[0]; x++) {
        const i = index(x, y, z);
        if (solid[i]) continue;
        point.set(coord(0, x), coord(1, y), coord(2, z));
        triangle.closestPointToPoint(point, closest);
        if (point.distanceToSquared(closest) <= radius * radius) solid[i] = 1;
      }
    }
    triangles++;
  }
}
// The display model does not contain a watertight footwell/firewall. Seal the
// passenger enclosure from its actual glazing and upholstery envelope, while
// leaving the external hood, wheel, side and underfloor ducts untouched.
const cabinPoints = new Map();
for (const draw of draws) if (cabinPrimitives.has(draw.primitive)) {
  for (let i = 0; i < draw.points.length; i += 3) {
    const p = new Vector3().fromArray(draw.points, i);
    const key = [p.x, p.y, p.z].map(v => Math.round(v * 250)).join(',');
    cabinPoints.set(key, p);
  }
}
const cabinHull = new ConvexHull().setFromPoints([...cabinPoints.values()]);
const cabinMin = [Infinity, Infinity, Infinity], cabinMax = [-Infinity, -Infinity, -Infinity];
for (const p of cabinPoints.values()) for (let a = 0; a < 3; a++) {
  cabinMin[a] = Math.min(cabinMin[a], p.getComponent(a));
  cabinMax[a] = Math.max(cabinMax[a], p.getComponent(a));
}
let cabinCells = 0;
const cabinLow = cabinMin.map((v, a) => Math.max(0, Math.floor((v - min[a]) / step[a])));
const cabinHigh = cabinMax.map((v, a) => Math.min(shape[a] - 1, Math.ceil((v - min[a]) / step[a])));
for (let z = cabinLow[2]; z <= cabinHigh[2]; z++) for (let y = cabinLow[1]; y <= cabinHigh[1]; y++) {
  for (let x = cabinLow[0]; x <= cabinHigh[0]; x++) {
    const i = index(x, y, z);
    if (!solid[i] && cabinHull.containsPoint(point.set(coord(0, x), coord(1, y), coord(2, z)))) {
      solid[i] = 1; cabinCells++;
    }
  }
}
const cabinSeal = { method: 'convex envelope of cabin glazing and upholstery',
  min: cabinMin, max: cabinMax, cells: cabinCells, faces: cabinHull.faces.length };
console.log(JSON.stringify({ phase: 'cabin enclosure', ...cabinSeal }));
// Close internal cavities; preserve openings connected to the exterior.
const exterior = new Uint8Array(count), queue = new Int32Array(count);
let read = 0, write = 0;
function visit(i) { if (!solid[i] && !exterior[i]) { exterior[i] = 1; queue[write++] = i; } }
for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
  visit(index(0, y, z)); visit(index(nx - 1, y, z));
}
for (let x = 0; x < nx; x++) for (let z = 0; z < nz; z++) {
  visit(index(x, 0, z)); visit(index(x, ny - 1, z));
}
for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
  visit(index(x, y, 0)); visit(index(x, y, nz - 1));
}
while (read < write) {
  const i = queue[read++], x = i % nx, y = Math.floor(i / nx) % ny, z = Math.floor(i / plane);
  if (x) visit(i - 1); if (x < nx - 1) visit(i + 1);
  if (y) visit(i - nx); if (y < ny - 1) visit(i + nx);
  if (z) visit(i - plane); if (z < nz - 1) visit(i + plane);
}
for (let i = 0; i < count; i++) if (!exterior[i]) solid[i] = 1;
console.log(JSON.stringify({ phase: 'voxelized', triangles, solidVoxels: solid.reduce((a, b) => a + b, 0) }));

// Exact squared Euclidean distance transform of the voxelized vehicle.
// The road is a flow boundary, but must not create a smoke contact band.
const distance2 = Float32Array.from(solid, s => s ? 0 : 1e8);
const f = new Float64Array(Math.max(...shape)), v = new Int32Array(f.length);
const boundaries = new Float64Array(f.length + 1), transformed = new Float64Array(f.length);
function edt(length, spacing) {
  const h2 = spacing * spacing;
  let k = 0; v[0] = 0; boundaries[0] = -Infinity; boundaries[1] = Infinity;
  for (let q = 1; q < length; q++) {
    let s;
    do {
      const p = v[k];
      s = ((f[q] + h2 * q * q) - (f[p] + h2 * p * p)) / (2 * h2 * (q - p));
      if (s <= boundaries[k]) k--; else break;
    } while (k >= 0);
    v[++k] = q; boundaries[k] = s; boundaries[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < length; q++) {
    while (boundaries[k + 1] < q) k++;
    transformed[q] = h2 * (q - v[k]) ** 2 + f[v[k]];
  }
}
for (let axis = 0; axis < 3; axis++) {
  const stride = [1, nx, plane][axis];
  for (let b = 0; b < shape[(axis + 2) % 3]; b++) {
    for (let a = 0; a < shape[(axis + 1) % 3]; a++) {
      const pos = [0, 0, 0]; pos[(axis + 1) % 3] = a; pos[(axis + 2) % 3] = b;
      const base = index(...pos);
      for (let q = 0; q < shape[axis]; q++) f[q] = distance2[base + q * stride];
      edt(shape[axis], step[axis]);
      for (let q = 0; q < shape[axis]; q++) distance2[base + q * stride] = transformed[q];
    }
  }
}
const signedDistance = Float32Array.from(distance2, (d, i) => solid[i]
  ? -Math.min(...step) * .5 : Math.max(.001, Math.sqrt(d) - Math.min(...step) * .5));
for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
  if (coord(1, y) < .015) for (let x = 0; x < nx; x++) solid[index(x, y, z)] = 1;
}

const { velocity, iterations, correction, residualRatio, maxSpeed } = projectFlow(shape, step, solid);
console.log(JSON.stringify({ phase: 'projected', iterations, correction, residualRatio, maxSpeed }));
assert(residualRatio < .025, 'Pressure projection must remove at least 97.5% of initial divergence');

// Mark resolved, cross-stream-constrained passages. There are no hand-placed
// emitters: opposing solid walls must bound a flowing, exterior-connected cell.
const confined = new Float32Array(count), duct = new Float32Array(count);
const smooth = (a, b, value) => { const t = Math.max(0, Math.min(1, (value - a) / (b - a))); return t * t * (3 - 2 * t); };
let passageCells = 0;
for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
  const i = index(x, y, z), px = coord(0, x), py = coord(1, y);
  if (solid[i] || px < -2.6 || px > 2.68 || py < .055 || py > 1.05 || -velocity[0][i] < .15) continue;
  let strength = 0;
  for (const axis of [1, 2]) {
    const stride = [1, nx, plane][axis], c = [x, y, z][axis];
    let widths = 0, walls = 0;
    for (const sign of [-1, 1]) {
      const reach = Math.min(Math.floor(.35 / step[axis]), sign < 0 ? c : shape[axis] - c - 1);
      for (let d = 1; d <= reach; d++) if (solid[i + sign * d * stride]) {
        widths += d * step[axis]; walls++; break;
      }
    }
    if (walls === 2) strength = Math.max(strength, 1 - smooth(.16, .46, widths));
  }
  confined[i] = strength;
  if (strength > .1) passageCells++;
}
console.log(JSON.stringify({ phase: 'passages', passageCells }));

// Transport inlet Y/Z and time-of-flight through successive X planes. These
// coordinates deform the animated continuous density texture with the flow.
const time = new Float32Array(count), originY = new Float32Array(count), originZ = new Float32Array(count);
let recoveredSamples = 0;
for (let x = nx - 1; x >= 0; x--) for (let z = 0; z < nz; z++) for (let y = 0; y < ny; y++) {
  const i = index(x, y, z);
  originY[i] = coord(1, y); originZ[i] = coord(2, z);
  if (x === nx - 1 || solid[i]) continue;
  const speedX = Math.max(.18, -velocity[0][i] || 1);
  const dt = dx / speedX;
  const py = Math.max(0, Math.min(ny - 1.001, y - velocity[1][i] * dt / dy));
  const pz = Math.max(0, Math.min(nz - 1.001, z - velocity[2][i] * dt / dz));
  const y0 = Math.floor(py), z0 = Math.floor(pz);
  let total = 0, sy = 0, sz = 0, st = 0, sd = 0;
  for (let oz = 0; oz < 2; oz++) for (let oy = 0; oy < 2; oy++) {
    const j = index(x + 1, y0 + oy, z0 + oz);
    if (solid[j]) continue;
    const w = (oy ? py - y0 : 1 - py + y0) * (oz ? pz - z0 : 1 - pz + z0);
    total += w; sy += originY[j] * w; sz += originZ[j] * w; st += time[j] * w; sd += duct[j] * w;
  }
  if (total < 1e-6) {
    // The receding tail exposes cells whose previous plane was solid. Take
    // their tracer from the closest open part of the shear layer.
    let best = Infinity, found = -1;
    for (let oz = -14; oz <= 14; oz++) for (let oy = -14; oy <= 14; oy++) {
      const yy = y0 + oy, zz = z0 + oz;
      if (yy < 0 || yy >= ny || zz < 0 || zz >= nz) continue;
      const j = index(x + 1, yy, zz);
      const d = ((yy - py) * dy) ** 2 + ((zz - pz) * dz) ** 2;
      if (!solid[j] && d < best) { found = j; best = d; }
    }
    // Never copy the passage tracer across a blocked upstream face.
    if (found >= 0) { total = 1; sy = originY[found]; sz = originZ[found]; st = time[found]; }
    recoveredSamples++;
  }
  if (total > 0) { originY[i] = sy / total; originZ[i] = sz / total; time[i] = Math.min(30, st / total + dt); }
  else time[i] = (nx - 1 - x) * dx;
  duct[i] = Math.max(confined[i], total > 0 ? sd / total * Math.exp(-dx / 1.25) : 0);
}
// Extrapolate transport coordinates just inside solids. Trilinear sampling
// across the boundary must not blend a valid streamline with placeholder
// coordinates; signed distance still excludes all interior smoke.
let valid = Uint8Array.from(solid, s => Number(!s));
for (let pass = 0; pass < 3; pass++) {
  const next = valid.slice();
  for (let z = 1; z < nz - 1; z++) for (let y = 1; y < ny - 1; y++) for (let x = 1; x < nx - 1; x++) {
    const i = index(x, y, z);
    if (valid[i]) continue;
    let n = 0, st = 0, sy = 0, sz = 0;
    for (const delta of [-1, 1, -nx, nx, -plane, plane]) if (valid[i + delta]) {
      n++; st += time[i + delta]; sy += originY[i + delta]; sz += originZ[i + delta];
    }
    if (n) { time[i] = st / n; originY[i] = sy / n; originZ[i] = sz / n; next[i] = 1; }
  }
  valid = next;
}
// Normalized bytes retain sub-cell tracer coordinates and millimetre-scale
// distance precision while keeping the refined field compact for mobile GPUs.
const data = new Uint8Array(count * 4), passages = new Uint8Array(count * 2);
const scale = [30, max[1] - min[1], max[2] - min[2], 1.28];
const bias = [0, min[1], min[2], -.08];
const byte = value => Math.round(255 * Math.max(0, Math.min(1, value)));
for (let i = 0; i < count; i++) {
  const values = [time[i], originY[i], originZ[i], signedDistance[i]];
  assert(values.every(Number.isFinite));
  for (let a = 0; a < 4; a++) data[i * 4 + a] = byte((values[a] - bias[a]) / scale[a]);
  passages[i * 2] = solid[i] ? 0 : byte(duct[i]);
  passages[i * 2 + 1] = solid[i] ? 0 : byte(confined[i]);
}
const header = new ArrayBuffer(64), view = new DataView(header);
view.setUint32(0, 0x57464c57, true); // WFLW
view.setUint32(4, 2, true);
shape.forEach((n, a) => view.setUint32(8 + a * 4, n, true));
min.forEach((n, a) => view.setFloat32(20 + a * 4, n, true));
max.forEach((n, a) => view.setFloat32(32 + a * 4, n, true));
view.setFloat32(44, scale[0], true);
view.setFloat32(48, bias[3], true);
view.setFloat32(52, scale[3], true);
view.setUint32(56, 2, true);
await mkdir(output, { recursive: true });
const binary = Buffer.concat([Buffer.from(header), Buffer.from(data.buffer), Buffer.from(passages.buffer)]);
const compressed = gzipSync(binary, { level: 9 });
await writeFile(resolve(output, vehicleId + '.bin'), binary);
await writeFile(resolve(output, vehicleId + '.bin.gz'), compressed);
const report = { method: 'refined GLB voxelization, coarse-initialized MAC projection, inlet and confined-passage transport',
  source: `public/models/${vehicleId}.glb`, vehicleId, normalization, shape, min, max, step, triangles,
  sourceSha256: createHash('sha256').update(modelBytes).digest('hex'),
  fieldSha256: createHash('sha256').update(binary).digest('hex'),
  formatVersion: 2, iterations, residualRatio, maxSpeed, recoveredSamples, passageCells, cabinSeal,
  bytes: binary.byteLength, gzipBytes: compressed.byteLength,
  seconds: (performance.now() - start) / 1000 };
await writeFile(resolve(output, 'audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));

if (vehicleId !== 'vision-gt') {
  const contact = Buffer.alloc(count * 4);
  for (let i = 0; i < count; i++) {
    contact[i * 4] = passages[i * 2];
    contact[i * 4 + 1] = passages[i * 2 + 1];
    contact[i * 4 + 2] = data[i * 4 + 3];
    contact[i * 4 + 3] = 255;
  }
  const header = Buffer.alloc(32);
  [0x544e4357, 2, ...shape, 4].forEach((n, i) => header.writeUInt32LE(n, i * 4));
  header.writeFloatLE(bias[3], 24); header.writeFloatLE(scale[3], 28);
  const contactBytes = Buffer.concat([header, contact]);
  await writeFile(resolve(output, 'contact.bin'), contactBytes);
  await writeFile(resolve(output, 'contact.bin.gz'), gzipSync(contactBytes, { level: 9 }));
}
