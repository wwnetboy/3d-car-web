import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const folder = process.argv[2] ? resolve(process.argv[2]) : resolve(root, 'public/flow');
const [binary, gzip, audit, model] = await Promise.all([
  readFile(resolve(folder, 'vision-gt.bin')), readFile(resolve(folder, 'vision-gt.bin.gz')),
  readFile(resolve(folder, 'audit.json'), 'utf8').then(JSON.parse), readFile(resolve(root, 'public/models/vision-gt.glb')),
]);
const hash = data => createHash('sha256').update(data).digest('hex');
assert.equal(hash(binary), audit.fieldSha256);
assert.equal(hash(model), audit.sourceSha256);
assert(gunzipSync(gzip).equals(binary), 'Compressed and raw fields must match');
assert.equal(binary.readUInt32LE(0), 0x57464c57);
const version = binary.readUInt32LE(4), stride = version === 4 ? 8 : 5;
assert(version === 3 || version === 4);
assert.equal(binary.readUInt32LE(56), 2);
assert.equal(binary.readUInt32LE(60), stride);
const shape = [8, 12, 16].map(o => binary.readUInt32LE(o));
assert.deepEqual(shape, [256, 96, 128]);
const count = shape.reduce((a, b) => a * b, 1), medium = 64 + count * stride;
assert.equal(binary.length, 64 + count * (stride + 2));
const half = h => (h & 0x8000 ? -1 : 1) * ((h & 0x7c00) ? (1 + (h & 1023) / 1024) * 2 ** (((h >> 10) & 31) - 15) : (h & 1023) * 2 ** -24);
let solids = 0, smoke = 0, maxConcentration = 0, longResidence = 0;
for (let i = 0; i < count; i++) {
  const offset = 64 + i * stride;
  const age = binary.readUInt16LE(offset), sdf = version === 4 ? half(binary.readUInt16LE(offset + 6)) : binary[offset + 4] / 255 * 1.28 - .08;
  if (version === 4) for (let c = 1; c < 4; c++) assert((binary.readUInt16LE(offset + c * 2) & 0x7c00) !== 0x7c00);
  assert(age < 0x7c00, 'Residence time must be finite and nonnegative');
  const concentration = binary[medium + i * 2];
  if (sdf < 0) { solids++; assert.equal(concentration, 0, 'No smoke inside solid boundaries'); }
  if (concentration) smoke++;
  if (age > 0x5800) longResidence++;
  maxConcentration = Math.max(maxConcentration, concentration / 255);
}
assert(solids > 10000 && smoke > count / 3);
assert(maxConcentration > .2 && maxConcentration <= 1);
assert(longResidence > 0, 'Slow fluid must not be assigned a forced minimum streamwise velocity');
assert.equal(audit.dragPredictionValidated, false);
if (version === 4) {
  assert.equal(audit.visualCoordinates.concentrationUnchanged, true);
  if (process.argv[3]) {
    const original = await readFile(resolve(process.argv[3], 'vision-gt.bin'));
    assert.equal(hash(original), audit.visualCoordinates.sourceFieldSha256);
    assert(binary.subarray(medium).equals(original.subarray(64 + count * 5)), 'Tracing must preserve all CFD concentration and turbulence samples');
  }
}
console.log(JSON.stringify({ version, shape, solids, smoke, longResidence, maxConcentration, bytes: binary.length, gzipBytes: gzip.length }));
