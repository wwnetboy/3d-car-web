// Preserve the geometry-derived duct marks and conservative display-mesh
// boundary. Neither changes the CFD transport or adds a smoke source.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../../', import.meta.url));
const source = process.argv[2] ? resolve(process.argv[2]) : resolve(root, '.artifacts/duct-flow');
const output = resolve(root, 'public/flow');
const [legacy, audit, current, cfdAudit] = await Promise.all([
  readFile(resolve(source, 'vision-gt.bin')), readFile(resolve(source, 'audit.json'), 'utf8').then(JSON.parse),
  readFile(resolve(output, 'vision-gt.bin')), readFile(resolve(output, 'audit.json'), 'utf8').then(JSON.parse),
]);
const hash = b => createHash('sha256').update(b).digest('hex');
assert.equal(hash(legacy), audit.fieldSha256);
assert.equal(hash(current), cfdAudit.fieldSha256);
assert.equal(audit.sourceSha256, cfdAudit.sourceSha256, 'The display mask must match the car model');
assert.equal(legacy.readUInt32LE(4), 2);
assert.equal(current.readUInt32LE(4), 4);
const shape = [8, 12, 16].map(o => legacy.readUInt32LE(o));
assert.deepEqual(shape, [8, 12, 16].map(o => current.readUInt32LE(o)));
const count = shape.reduce((a, b) => a * b, 1);
assert.equal(legacy.length, 64 + count * 6);
assert.equal(current.length, 64 + count * 10);
for (let offset = 20; offset < 44; offset += 4)
  assert.equal(legacy.readFloatLE(offset), current.readFloatLE(offset), 'Grid bounds must match');
const distanceBias = legacy.readFloatLE(48), distanceScale = legacy.readFloatLE(52);
const marks = legacy.subarray(64 + count * 4);
const data = Buffer.alloc(count * 4);
for (let i = 0; i < count; i++) {
  // The CFD sampling grid can miss thin display panels. Keep their directly
  // voxelized boundary too, including the closed cabin, without closing ducts
  // with a screen-space silhouette or a box around the whole car.
  const distanceByte = legacy[64 + i * 4 + 3];
  const solid = (current.readUInt16LE(64 + i * 8 + 6) & 0x8000) ||
    distanceByte / 255 * distanceScale + distanceBias <= 0;
  data[i * 4] = solid ? 0 : marks[i * 2];
  data[i * 4 + 1] = solid ? 0 : marks[i * 2 + 1];
  data[i * 4 + 2] = distanceByte;
  data[i * 4 + 3] = 255;
}
const header = Buffer.alloc(32);
[0x544e4357, 2, ...shape, 4].forEach((n, i) => header.writeUInt32LE(n, i * 4));
header.writeFloatLE(distanceBias, 24);
header.writeFloatLE(distanceScale, 28);
const binary = Buffer.concat([header, data]);
await writeFile(resolve(output, 'contact.bin'), binary);
await writeFile(resolve(output, 'contact.bin.gz'), gzipSync(binary, { level: 9 }));
const report = { formatVersion: 2,
  purpose: 'Bounded optical emphasis and display-mesh exclusion; not a smoke source or physical concentration',
  shape, channels: ['duct and outlet visibility', 'local confinement', 'display-mesh signed distance', 'reserved'],
  distanceEncoding: { bias: distanceBias, scale: distanceScale },
  boundary: 'Conservative triangle voxelization plus closed cabin; intersect its exterior with the CFD fluid region',
  sourceSha256: audit.sourceSha256,
  sourceMaskSha256: audit.fieldSha256, boundaryFieldSha256: cfdAudit.fieldSha256, fieldSha256: hash(binary), bytes: binary.length };
await writeFile(resolve(output, 'contact-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report));
