// Export the display geometry in world metres, retaining fixed wheel covers.
// This is an audit input, not an assertion that a display mesh is engineering CAD.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { Vector3 } from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { worldGeometry } from '../world-geometry.mjs';

const out = resolve(process.argv[2] ?? '.artifacts/cfd/geometry');
await mkdir(out, { recursive: true });
await MeshoptDecoder.ready;
const source = resolve('public/models/vision-gt.glb');
const bytes = await readFile(source);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const doc = await io.readBinary(bytes), root = doc.getRoot();
const primitiveInfo = new Map(), wheels = [], cabin = new Set();
root.getDefaultScene().traverse(node => {
  const name = node.getName();
  if (/^Wheel_[FR][LR]$/.test(name)) {
    const m = node.getWorldMatrix();
    wheels.push({ name, centre: m.slice(12, 15), ...node.getExtras().motion });
  }
  for (const p of node.getMesh()?.listPrimitives() ?? []) {
    primitiveInfo.set(p, { name, material: p.getMaterial()?.getName() });
    if (node.getExtras().cabinGlazing || p.getMaterial()?.getName() === 'interior_accent') cabin.add(p);
  }
});
const parts = new Map(), audit = [], cabinPoints = new Map();
for (const draw of worldGeometry(root)) {
  const info = primitiveInfo.get(draw.primitive);
  const wheel = info.name.match(/^(Wheel_[FR][LR])_(?!glass)/)?.[1];
  const part = wheel ?? 'body';
  if (!parts.has(part)) parts.set(part, []);
  const triangles = parts.get(part);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < draw.points.length; i += 3) {
    const p = Array.from(draw.points.subarray(i, i + 3));
    p.forEach((v, a) => { min[a] = Math.min(v, min[a]); max[a] = Math.max(v, max[a]); });
    if (cabin.has(draw.primitive)) cabinPoints.set(p.map(v => Math.round(v * 250)).join(','), new Vector3(...p));
  }
  for (let j = 0; j < draw.indices.length; j += 3) {
    triangles.push(Array.from(draw.indices.subarray(j, j + 3)).flatMap(i => Array.from(draw.points.subarray(i * 3, i * 3 + 3))));
  }
  audit.push({ ...info, part, triangles: draw.indices.length / 3, min, max });
}
const hull = new ConvexHull().setFromPoints([...cabinPoints.values()]);
for (const face of hull.faces) {
  const triangle = []; let edge = face.edge;
  do { triangle.push(...edge.head().point.toArray()); edge = edge.next; } while (edge !== face.edge);
  parts.get('body').push(triangle);
}
for (const [name, triangles] of parts) {
  const stl = Buffer.alloc(84 + triangles.length * 50);
  stl.write('Vision GT world metres; display geometry plus cabin closure');
  stl.writeUInt32LE(triangles.length, 80);
  triangles.forEach((t, i) => {
    const a = new Vector3(...t.slice(0, 3)), b = new Vector3(...t.slice(3, 6)), c = new Vector3(...t.slice(6, 9));
    const normal = b.sub(a).cross(c.sub(a)).normalize().toArray();
    [...normal, ...t].forEach((v, j) => stl.writeFloatLE(v, 84 + i * 50 + j * 4));
  });
  await writeFile(resolve(out, name + '.stl'), stl);
}
const report = { source, sourceSha256: createHash('sha256').update(bytes).digest('hex'),
  coordinates: '+X nose; +Y up; -Z left', wheels,
  cabinClosure: 'Convex envelope of display glazing and upholstery; an explicit geometry approximation',
  cabinHullFaces: hull.faces.length, parts: audit };
await writeFile(resolve(out, 'geometry.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ out, wheels, parts: [...parts].map(([name, t]) => ({ name, triangles: t.length })) }));
