import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { worldGeometry } from './world-geometry.mjs';

const script = fileURLToPath(new URL('./occlusion.py', import.meta.url));
const bytes = (array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);

export function bakeOcclusion(doc) {
  const draws = worldGeometry(doc.getRoot());
  const vertexCount = draws.reduce((sum, draw) => sum + draw.points.length / 3, 0);
  const indexCount = draws.reduce((sum, draw) => sum + draw.indices.length, 0);
  const indices = new Uint32Array(indexCount);
  let vertexOffset = 0,
    indexOffset = 0;
  for (const draw of draws) {
    for (const i of draw.indices) indices[indexOffset++] = vertexOffset + i;
    vertexOffset += draw.points.length / 3;
  }
  const header = Buffer.alloc(8);
  header.writeUInt32LE(vertexCount);
  header.writeUInt32LE(indexCount, 4);
  const input = Buffer.concat([
    header,
    ...draws.map((draw) => bytes(draw.points)),
    ...draws.map((draw) => bytes(draw.normals)),
    bytes(indices),
  ]);
  const result = spawnSync(process.env.VISION_AO_PYTHON || 'python', [script], {
    input,
    windowsHide: true,
    maxBuffer: vertexCount + 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      result.stderr.toString() +
        '\nInstall the asset preparation dependencies with python -m pip install -r requirements.txt.',
    );
  assert.equal(result.stdout.length, vertexCount, 'Each decoded vertex needs one visibility value.');
  vertexOffset = 0;
  for (const { primitive, points } of draws) {
    const count = points.length / 3;
    const values = Uint8Array.from(result.stdout.subarray(vertexOffset, vertexOffset + count));
    const ao = doc
      .createAccessor('Local ambient visibility')
      .setBuffer(primitive.getAttribute('POSITION').getBuffer())
      .setType('SCALAR')
      .setArray(values)
      .setNormalized(true);
    primitive.setAttribute('_AO', ao);
    vertexOffset += count;
  }
}
