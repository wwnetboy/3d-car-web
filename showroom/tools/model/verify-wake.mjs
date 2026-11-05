import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const folder = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'public/flow');
const [data, compressed, audit, model] = await Promise.all([
  readFile(resolve(folder, 'wake.bin')), readFile(resolve(folder, 'wake.bin.gz')),
  readFile(resolve(folder, 'wake-audit.json'), 'utf8').then(JSON.parse), readFile(resolve(root, 'public/models/vision-gt.glb')),
]);
const hash = b => createHash('sha256').update(b).digest('hex');
assert.equal(hash(data), audit.fieldSha256);
assert.equal(hash(model), audit.sourceModelSha256);
assert.deepEqual(gunzipSync(compressed), data);
assert.equal(data.readUInt32LE(0), 0x4b415757);
assert.equal(data.readUInt32LE(4), 1);
const shape = [8, 12, 16].map(o => data.readUInt32LE(o));
assert.deepEqual(shape, audit.shape);
const length = data.readUInt32LE(20), count = shape.reduce((a, b) => a * b, 1);
assert.equal(length, audit.frames);
assert.equal(data.length, 64 + length * 4 + count * length * 2);
assert.equal(data.readFloatLE(48), 120);
assert.equal(data.readUInt32LE(56), 1);
assert.equal(data.readUInt32LE(60), 2);
let previous = -1;
for (let i = 0; i < length; i++) {
  const time = data.readFloatLE(64 + i * 4);
  assert(Number.isFinite(time) && time > previous);
  if (i === 0) assert.equal(time, 0);
  previous = time;
}
const overlap = data.readFloatLE(52);
assert(overlap > 0 && overlap < previous * .25);
for (let offset = 64 + length * 4; offset < data.length; offset += 2)
  assert(data.readUInt16LE(offset) <= 0x3c00, 'Concentration must be finite and in [0, 1]');
assert(Object.values(audit.numericalChecks).every(Boolean));
assert(Object.values(audit.timeStepCheck.checks).every(Boolean));
assert.equal(audit.engineeringValidated, false);
console.log(JSON.stringify({ shape, frames: length, duration: previous, overlap, bytes: data.length, gzipBytes: compressed.length }));
