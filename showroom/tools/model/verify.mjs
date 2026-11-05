// Multi-view comparison of decoded geometry, independent of browser/GPU settings.
// Optional argument: a directory to write diagnostic material/normal PPM images.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';
import { worldGeometry } from './world-geometry.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const folder = process.argv[2] && resolve(process.argv[2]);
if (folder) await mkdir(folder, { recursive: true });
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
await MeshoptDecoder.ready;
const width = 720,
  height = 400;
const views = [
  { name: 'reveal', target: [0, 0.56, 0], eye: [0.76, 0.24, -1], span: 5.7 },
  { name: 'side', target: [0, 0.57, 0], eye: [0.08, 0.09, -1], span: 5.75 },
  { name: 'front-duct', target: [1.65, 0.4, -0.7], eye: [1, 0.12, -0.77], span: 2.9 },
  { name: 'front-wheel', target: [1.644, 0.401, -1.15], eye: [0.26, 0.1, -1], span: 1.45 },
  { name: 'headlight', target: [2.38, 0.48, -0.86], eye: [1, 0.1, -0.5], span: 1.3 },
  { name: 'rear', target: [-1.9, 0.5, 0], eye: [-1, 0.17, -0.25], span: 3.0 },
];
const files = {
  original: resolve(here, '../../../models/xiaomi_vision_gt.glb'),
  standard: resolve(here, '../../public/models/vision-gt.glb'),
  lite: resolve(here, '../../public/models/vision-gt-lite.glb'),
};
const unit = (v) => v.map((value) => value / Math.hypot(...v));
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function verifyRig(root) {
  const nodes = root.listNodes();
  const byName = new Map(nodes.map(node => [node.getName(), node]));
  const headlights = nodes.filter(node => node.getExtras().vehicleLamp === 'front');
  assert.deepEqual(headlights.map(node => node.getName()).sort(), [
    'Headlight_L_blac', 'Headlight_L_emit', 'Headlight_R_blac', 'Headlight_R_emit',
  ]);
  for (const node of headlights) {
    const box = getBounds(node);
    assert(box.min[0] > 2.18 && box.max[0] < 2.64, 'Headlights must remain in the front fascia.');
    assert(box.min[1] > 0.26 && box.max[1] < 0.69);
    assert(node.getName().includes('_L_') ? box.max[2] < -0.48 : box.min[2] > 0.48);
  }
  const cabinLights = nodes.filter(node => !node.getExtras().vehicleLamp &&
    node.getMesh()?.listPrimitives().some(prim => prim.getMaterial().getName() === 'emit'));
  assert(cabinLights.length > 0, 'The console lighting must stay separate.');
  for (const node of cabinLights) {
    const box = getBounds(node);
    assert(box.min[0] > 0.35 && box.max[0] < 1.01);
  }
  const glazing = nodes.filter(node => node.getExtras().cabinGlazing);
  assert.deepEqual(glazing.map(node => node.getName()).sort(), ['Door_L_glass', 'Door_R_glass', 'Windscreen']);
  for (const node of glazing) {
    assert.equal(node.getMesh().listPrimitives()[0].getMaterial().getName(), 'glass');
  }
  const stationaryWindows = getBounds(byName.get('Windscreen'));
  const wheels = ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR'];
  const doors = ['Door_L', 'Door_R'];
  for (const name of [...doors, ...wheels]) {
    const node = byName.get(name);
    assert(node, 'Missing articulation: ' + name);
    const { axis, angle, radius } = node.getExtras().motion;
    assert(Math.abs(Math.hypot(...axis) - 1) < 1e-6);
    const materials = node.listChildren().flatMap(child =>
      child.getMesh().listPrimitives().map(prim => prim.getMaterial().getName()));
    const isDoor = doors.includes(name);
    assert.deepEqual(materials.sort(), isDoor
      ? ['accent', 'carbon', 'glass', 'interior_accent', 'metal']
      : ['accent', 'glass', 'shine', 'tire']);
    const rest = [...node.getRotation()];
    const closed = getBounds(node);
    // Frame the hub head-on so even a rotating tread cannot pass for a moving face.
    const target = node.getTranslation();
    const faceView = isDoor ? null : { target, eye: [0, 0, Math.sign(target[2])], span: radius * 1.4 };
    const parkedFace = faceView && render(worldGeometry(root), faceView);
    if (isDoor) {
      // The painted skin ends at x = -0.309; the fixed quarter return reaches -0.694.
      const skin = getBounds(byName.get(name + '_accent'));
      assert(Math.abs(skin.min[0] + 0.309) < 0.004, name + ' must stop at the rear door seam.');
    } else {
      assert(radius > 0.39 && radius < 0.43);
      assert.deepEqual(axis, [0, 0, -1]);
    }
    for (const fraction of [0.25, 0.5, 1]) {
      const theta = (isDoor ? angle : Math.PI / 2) * fraction;
      node.setRotation([...axis.map(x => x * Math.sin(theta / 2)), Math.cos(theta / 2)]);
      const moved = getBounds(node);
      if (isDoor) {
        assert(moved.max[1] > closed.max[1] + 0.8 * fraction, 'Half-canopy must lift.');
        assert(name === 'Door_L' ? moved.max[2] < 0 : moved.min[2] > 0, 'Doors must clear the centerline.');
      } else {
        // A rotating tire may expose a different facet but its circular envelope is stable.
        for (const bound of ['min', 'max']) {
          assert(moved[bound].every((v, i) => Math.abs(v - closed[bound][i]) < 0.004));
        }
        if (fraction === 1) {
          const turnedFace = render(worldGeometry(root), faceView);
          const change = compare(parkedFace, turnedFace);
          assert(change.materialAgreementPercent < 95 || change.normalMedianDeg > 10,
            'Quarter turn must visibly change the wheel face: ' + name);
        }
      }
      assert.deepEqual(getBounds(byName.get('Windscreen')), stationaryWindows);
    }
    node.setRotation(rest);
    assert.deepEqual(getBounds(node), closed);
  }
}

function render(draws, { eye, target, span }) {
  const front = unit(eye),
    right = unit(cross([0, 1, 0], front)),
    up = cross(front, right);
  const count = width * height;
  const id = new Uint8Array(count),
    normal = new Float32Array(3 * count);
  const visibility = folder ? Buffer.alloc(count, 35) : null;
  const depth = new Float32Array(count).fill(-Infinity);
  for (const { primitive, points, normals, indices, mat } of draws) {
    const ao = primitive.getAttribute('_AO')?.getArray();
    const screen = new Float32Array(points.length);
    const v = [0, 0, 0];
    for (let i = 0; i < points.length; i += 3) {
      for (let k = 0; k < 3; k++) v[k] = points[i + k] - target[k];
      screen[i] = width * (0.5 + dot(v, right) / span);
      screen[i + 1] = height / 2 - (width * dot(v, up)) / span;
      screen[i + 2] = dot(v, front);
    }
    for (let i = 0; i < indices.length; i += 3) {
      const a = indices[i] * 3,
        b = indices[i + 1] * 3,
        c = indices[i + 2] * 3;
      const ax = screen[a],
        ay = screen[a + 1],
        bx = screen[b],
        by = screen[b + 1],
        cx = screen[c],
        cy = screen[c + 1];
      const area = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      if (Math.abs(area) < 1e-8) continue;
      const left = Math.max(0, Math.ceil(Math.min(ax, bx, cx) - 0.5)),
        right = Math.min(width - 1, Math.floor(Math.max(ax, bx, cx) - 0.5));
      const top = Math.max(0, Math.ceil(Math.min(ay, by, cy) - 0.5)),
        bottom = Math.min(height - 1, Math.floor(Math.max(ay, by, cy) - 0.5));
      for (let y = top; y <= bottom; y++) {
        for (let x = left; x <= right; x++) {
          const ex = x + 0.5 - ax,
            ey = y + 0.5 - ay;
          const w1 = (ex * (cy - ay) - ey * (cx - ax)) / area;
          const w2 = ((bx - ax) * ey - (by - ay) * ex) / area,
            w0 = 1 - w1 - w2;
          if (Math.min(w0, w1, w2) < 0) continue;
          const pixel = y * width + x,
            z = w0 * screen[a + 2] + w1 * screen[b + 2] + w2 * screen[c + 2];
          if (z <= depth[pixel]) continue;
          depth[pixel] = z;
          id[pixel] = mat;
          if (visibility && ao) {
            visibility[pixel] = Math.round(w0 * ao[a / 3] + w1 * ao[b / 3] + w2 * ao[c / 3]);
          }
          for (let k = 0; k < 3; k++)
            normal[3 * pixel + k] = w0 * normals[a + k] + w1 * normals[b + k] + w2 * normals[c + k];
        }
      }
    }
  }
  return { id, normal, visibility };
}

function compare(original, sample) {
  let union = 0,
    intersection = 0,
    sameMaterial = 0;
  const angles = [];
  for (let i = 0; i < original.id.length; i++) {
    if (original.id[i] || sample.id[i]) union++;
    if (!original.id[i] || !sample.id[i]) continue;
    intersection++;
    if (original.id[i] !== sample.id[i]) continue;
    sameMaterial++;
    const a = original.normal.subarray(3 * i, 3 * i + 3),
      b = sample.normal.subarray(3 * i, 3 * i + 3);
    const cosine = dot(a, b) / (Math.hypot(...a) * Math.hypot(...b));
    angles.push((Math.acos(Math.min(1, Math.max(-1, cosine))) * 180) / Math.PI);
  }
  angles.sort((a, b) => a - b);
  const fixed = (n) => Number(n.toFixed(3));
  return {
    silhouetteIoUPercent: fixed((100 * intersection) / union),
    materialAgreementPercent: fixed((100 * sameMaterial) / intersection),
    normalMedianDeg: fixed(angles[Math.floor(angles.length * 0.5)]),
    normalP95Deg: fixed(angles[Math.floor(angles.length * 0.95)]),
  };
}

async function writeDiagnostic(image, file) {
  const rgb = Buffer.alloc(3 * width * height, 25);
  for (let i = 0; i < image.id.length; i++) {
    if (!image.id[i]) continue;
    const n = image.normal.subarray(3 * i, 3 * i + 3);
    for (let k = 0; k < 3; k++) rgb[3 * i + k] = 127.5 * (n[k] / Math.hypot(...n) + 1);
  }
  await writeFile(file, Buffer.concat([Buffer.from('P6\n' + width + ' ' + height + '\n255\n'), rgb]));
}

const reference = {},
  results = [];
for (const [tier, file] of Object.entries(files)) {
  const root = (await io.read(file)).getRoot();
  if (tier !== 'original') verifyRig(root);
  const draws = worldGeometry(root);
  for (const view of views) {
    const image = render(draws, view);
    if (folder) await writeDiagnostic(image, resolve(folder, tier + '-' + view.name + '.ppm'));
    if (folder && tier !== 'original') {
      const header = Buffer.from('P5\n' + width + ' ' + height + '\n255\n');
      await writeFile(
        resolve(folder, tier + '-' + view.name + '-ao.pgm'),
        Buffer.concat([header, image.visibility]),
      );
    }
    if (tier === 'original') reference[view.name] = image;
    else results.push({ tier, view: view.name, ...compare(reference[view.name], image) });
  }
}
console.table(results);
assert(
  results.every(
    (r) => r.silhouetteIoUPercent > 99 && r.materialAgreementPercent > 97 && r.normalP95Deg < 8,
  ),
  'Visible silhouette, material or normal differences require inspection.',
);
