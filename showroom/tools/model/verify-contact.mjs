// Check the rendering boundary against the display triangles, independently of
// the CFD fluid-cell mask. A valid smoke voxel must not occupy a body surface.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { DataUtils } from 'three';
import { worldGeometry } from './world-geometry.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const load = path => readFile(resolve(root, path));
const hash = b => createHash('sha256').update(b).digest('hex');
const [flow, mask, compressed, audit] = await Promise.all([
  load('public/flow/vision-gt.bin'), load('public/flow/contact.bin'),
  load('public/flow/contact.bin.gz'), load('public/flow/contact-audit.json').then(JSON.parse),
]);
assert.equal(hash(mask), audit.fieldSha256);
assert.equal(hash(flow), audit.boundaryFieldSha256);
assert.deepEqual(gunzipSync(compressed), mask);
assert.equal(mask.readUInt32LE(4), 2);
assert.equal(mask.readUInt32LE(20), 4);
const shape = [8, 12, 16].map(o => mask.readUInt32LE(o));
assert.deepEqual(shape, [8, 12, 16].map(o => flow.readUInt32LE(o)));
const count = shape.reduce((a, b) => a * b, 1);
assert.equal(mask.length, 32 + count * 4);
const low = [20, 24, 28].map(o => flow.readFloatLE(o));
const high = [32, 36, 40].map(o => flow.readFloatLE(o));
const step = shape.map((n, a) => (high[a] - low[a]) / n);
const distances = new Float32Array(count), geometry = new Float32Array(count);
const bias = mask.readFloatLE(24), scale = mask.readFloatLE(28);
let excludedVoxels = 0, markedOpenVoxels = 0;
for (let i = 0; i < count; i++) {
  distances[i] = DataUtils.fromHalfFloat(flow.readUInt16LE(64 + i * 8 + 6));
  geometry[i] = mask[32 + i * 4 + 2] / 255 * scale + bias;
  if (Math.min(distances[i], geometry[i]) <= 0) {
    excludedVoxels++;
    assert.equal(mask[32 + i * 4], 0);
    assert.equal(mask[33 + i * 4], 0);
  } else if (mask[32 + i * 4] > 0) markedOpenVoxels++;
}
assert(markedOpenVoxels > 100000, 'The exclusion must preserve the open duct layer');

function sample(data, point) {
  const cell = point.map((p, a) => (p - low[a]) / step[a] - .5);
  const base = cell.map(Math.floor), f = cell.map((n, a) => n - base[a]);
  let value = 0;
  for (let z = 0; z < 2; z++) for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const c = [x, y, z].map((n, a) => Math.max(0, Math.min(shape[a] - 1, base[a] + n)));
    const weight = (x ? f[0] : 1 - f[0]) * (y ? f[1] : 1 - f[1]) * (z ? f[2] : 1 - f[2]);
    value += data[c[0] + shape[0] * (c[1] + shape[1] * c[2])] * weight;
  }
  return value;
}

await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const models = [];
for (const variant of ['vision-gt', 'vision-gt-lite']) {
  const bytes = await load(`public/models/${variant}.glb`);
  if (variant === 'vision-gt') assert.equal(hash(bytes), audit.sourceSha256);
  const doc = await io.readBinary(bytes);
  const names = new Map();
  doc.getRoot().getDefaultScene().traverse(node => {
    for (const primitive of node.getMesh()?.listPrimitives() ?? []) names.set(primitive, node.getName());
  });
  const parts = [];
  for (const { primitive, points, indices } of worldGeometry(doc.getRoot())) {
    const part = { name: names.get(primitive), probes: 0, before: 0, after: 0, worstBefore: -Infinity, worstAfter: -Infinity };
    // All face centroids, plus three off-centre points, include narrow trim and
    // large glass triangles that a camera screenshot can fail to expose.
    for (let i = 0; i < indices.length; i += 3) for (const weights of [[1/3, 1/3, 1/3], [.8, .1, .1], [.1, .8, .1], [.1, .1, .8]]) {
      const p = [0, 1, 2].map(a => weights.reduce((v, w, j) => v + w * points[indices[i + j] * 3 + a], 0));
      const before = sample(distances, p), after = Math.min(before, sample(geometry, p));
      part.probes++;
      part.before += Number(before >= .003);
      part.after += Number(after >= .003);
      part.worstBefore = Math.max(part.worstBefore, before);
      part.worstAfter = Math.max(part.worstAfter, after);
    }
    parts.push(part);
  }
  models.push({ variant, probes: parts.reduce((n, p) => n + p.probes, 0),
    before: parts.reduce((n, p) => n + p.before, 0), after: parts.reduce((n, p) => n + p.after, 0), parts });
}
const output = resolve(root, '.artifacts/smoke-occlusion');
await mkdir(output, { recursive: true });
const report = { fieldSha256: audit.fieldSha256, excludedVoxels, markedOpenVoxels, models };
await writeFile(resolve(output, 'geometry-verification.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ excludedVoxels, markedOpenVoxels, models: models.map(({ parts, ...summary }) => summary) }));
assert(models.every(m => m.after === 0), 'Smoke exclusion misses display triangles; inspect geometry-verification.json');
