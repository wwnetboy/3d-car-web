import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { resolve } from 'node:path';

const asset = name => new URL('../../public/' + name, import.meta.url);
const fieldAsset = name => process.argv[2] ? resolve(process.argv[2], name) : asset('flow/' + name);
const [binary, compressed, model, reportBytes] = await Promise.all([
  readFile(fieldAsset('vision-gt.bin')), readFile(fieldAsset('vision-gt.bin.gz')),
  readFile(asset('models/vision-gt.glb')), readFile(fieldAsset('audit.json')),
]);
const report = JSON.parse(reportBytes);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(hash(model), report.sourceSha256, 'Rebake flow after changing vehicle geometry');
assert.equal(hash(binary), report.fieldSha256, 'Field checksum');
assert.deepEqual(gunzipSync(compressed), binary, 'Compressed and raw fields must agree');
assert.ok(report.residualRatio < .025, 'Flow projection convergence');
const header = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
assert.equal(header.getUint32(0, true), 0x57464c57);
assert.equal(header.getUint32(4, true), 2);
const shape = [8, 12, 16].map(offset => header.getUint32(offset, true));
const min = [20, 24, 28].map(offset => header.getFloat32(offset, true));
const max = [32, 36, 40].map(offset => header.getFloat32(offset, true));
const count = shape.reduce((a, b) => a * b);
assert.equal(binary.length, 64 + count * 6);
const scale = [header.getFloat32(44, true), max[1] - min[1], max[2] - min[2], header.getFloat32(52, true)];
const bias = [0, min[1], min[2], header.getFloat32(48, true)];
assert.ok(scale.every(n => Number.isFinite(n) && n > 0));
assert.ok(bias.every(Number.isFinite));
assert.equal(header.getUint32(56, true), 2);
function sample(point) {
  const c = point.map((p, a) => Math.max(0, Math.min(shape[a] - 1,
    Math.floor((p - min[a]) / (max[a] - min[a]) * shape[a]))));
  const i = c[0] + shape[0] * (c[1] + shape[1] * c[2]);
  return [...[0, 1, 2, 3].map(a => binary[64 + i * 4 + a] / 255 * scale[a] + bias[a]),
    binary[64 + count * 4 + i * 2] / 255, binary[65 + count * 4 + i * 2] / 255];
}
const inlet = sample([3.8, .64, 0]);
const roof = sample([0, 1.55, 0]);
const flank = sample([0, .64, -1.55]);
const nose = sample([2.5, .7, -.7]);
assert.ok(sample([0, .7, 0])[3] < 0, 'Smoke must be excluded from the vehicle interior');
assert.ok(inlet[3] > .8 && Math.abs(inlet[1] - .64) < .08, 'Undisturbed inlet');
assert.ok(roof[3] > 0 && roof[1] < 1.15, 'The roof flow must rise from lower inlet air');
assert.ok(flank[3] > 0 && flank[2] > -1.3, 'The flank flow must move outboard');
assert.ok(nose[3] > 0 && nose[3] < .15 && nose[1] < .5, 'Close surface flow must turn over the nose');
assert.ok(roof[0] > inlet[0], 'Downstream flight time must increase');
const passages = [-1, 1].map(side => ({
  front: sample([2.45, .28, side * .55]),
  frontExit: sample([2.25, .28, side * .55]),
  wheelSide: sample([1.16, .34, side * 1.15]),
  sideExit: sample([.8, .27, side * 1.26]),
  rearExit: sample([-2.75, .22, side * .55]),
  downstream: sample([-3.3, .22, side * .55]),
}));
console.log(JSON.stringify({ phase: 'passage probes', passages, cabin: sample([0, .7, 0]) }));
for (const p of passages) {
  assert.ok(p.front[3] > .03 && p.front[5] > .5, 'Front intake is a resolved passage');
  assert.ok(p.frontExit[4] > .4 && p.frontExit[5] < .1, 'Tracer leaves the intake enclosure');
  // The two authored wheel-side mouths differ slightly; test transported
  // smoke at the opening rather than requiring both probes to lie mid-duct.
  assert.ok(p.wheelSide[3] > 0 && p.wheelSide[4] > .25, 'Through-flow reaches both wheel-side openings');
  assert.ok(p.sideExit[4] > .02 && p.sideExit[5] === 0, 'Tracer exits the side channel');
  assert.ok(p.rearExit[4] > .3 && p.downstream[4] > .1 && p.downstream[4] < p.rearExit[4],
    'Underfloor smoke exits and dissipates downstream');
}
assert.equal(inlet[4], 0, 'The unobstructed inlet must not contain passage tracer');
for (let i = 0; i < count; i++) if (binary[64 + i * 4 + 3] / 255 * scale[3] + bias[3] < 0) {
  assert.equal(binary[64 + count * 4 + i * 2], 0, 'No passage tracer inside solids');
  assert.equal(binary[65 + count * 4 + i * 2], 0, 'No emitter inside solids');
}
console.log(JSON.stringify({ result: 'passed', sourceGeometry: 'matched', compression: 'matched',
  cells: count, inlet, roof, flank, nose, residualRatio: report.residualRatio }));
