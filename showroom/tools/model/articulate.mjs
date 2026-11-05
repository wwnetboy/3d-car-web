import assert from 'node:assert/strict';
import { compactPrimitive, prune } from '@gltf-transform/functions';
import { worldGeometry } from './world-geometry.mjs';

// World-space envelopes of measured, physically separate islands in the source.
// Fields are X min/max, Y min/max, |Z| near/far. Mirror pairs share a template.
const doorParts = {
  // The separate painted return behind the shut line and the adjoining black
  // duct/sill form the fixed door jamb. Only the outer skin lifts with the card.
  accent: [['outer skin', [-0.309, 1.177, 0.301, 0.892, 0.726, 1.042]]],
  carbon: [['window frame', [-0.423, 0.928, 0.589, 1.166, 0.002, 0.806]]],
  glass: [['side window', [-0.423, 0.926, 0.786, 1.175, 0.001, 0.777]]],
  interior_accent: [['door card', [-0.123, 0.933, 0.354, 0.696, 0.527, 0.803]]],
  metal: [['forward card trim', [0.783, 0.916, 0.564, 0.682, 0.623, 0.714]]],
};
const axles = [
  { end: 'F', x: 1.6440723, y: 0.4007800, z: 1.00756, radius: 0.3968644 },
  { end: 'R', x: -1.3719539, y: 0.4371805, z: 1.050565, radius: 0.4271568 },
];
// Both axles use the same cross-section at different scales. Each entry gives
// the measured outer radius and inboard face offset in units of tire radius.
const wheelLayers = {
  tire: { role: 'tire', radius: 1, inboard: -0.47 },
  shine: { role: 'inner barrel', radius: 0.828, inboard: -0.503 },
  glass: { role: 'outer cover', radius: 0.768, inboard: 0.456 },
};
// The horizontal lens is a separate black island inside its larger black bezel.
// Keep the console's blue emitters separate from the exterior vertical blades.
const headlightParts = {
  blac: [['horizontal lens', [2.186, 2.636, 0.415, 0.528, 0.487, 1.123]]],
  emit: [
    ['upper blade', [2.381, 2.472, 0.529, 0.683, 0.920, 0.940]],
    ['lower blade', [2.466, 2.534, 0.267, 0.424, 0.920, 0.940]],
  ],
};

// Follow triangle connectivity across duplicate hard-normal/UV seam vertices.
// The position stream has already been quantized to the shared 16-bit grid.
function islands(draw) {
  const raw = draw.primitive.getAttribute('POSITION').getArray();
  const parents = Uint32Array.from({ length: raw.length / 3 }, (_, i) => i);
  function root(i) {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  }
  const coincident = new Map();
  for (let i = 0; i < parents.length; i++) {
    const offset = 3 * i;
    const key = raw[offset] + ',' + raw[offset + 1] + ',' + raw[offset + 2];
    const first = coincident.get(key);
    if (first !== undefined) parents[i] = first;
    else coincident.set(key, i);
  }
  for (let i = 0; i < draw.indices.length; i += 3) {
    const a = root(draw.indices[i]);
    parents[root(draw.indices[i + 1])] = a;
    parents[root(draw.indices[i + 2])] = a;
  }

  const boxes = new Map();
  for (let i = 0; i < parents.length; i++) {
    const id = parents[i] = root(i);
    let box = boxes.get(id);
    if (!box) {
      box = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
      boxes.set(id, box);
    }
    for (let k = 0; k < 3; k++) {
      const value = draw.points[i * 3 + k];
      box.min[k] = Math.min(box.min[k], value);
      box.max[k] = Math.max(box.max[k], value);
    }
  }
  return { boxes, ids: parents };
}

function classify(material, { min, max }) {
  const side = min[2] + max[2] < 0 ? 'L' : 'R';
  const z = [Math.abs(min[2]), Math.abs(max[2])];
  const envelope = [min[0], max[0], min[1], max[1], Math.min(...z), Math.max(...z)];
  const matches = (target) => envelope.every((x, i) => Math.abs(x - target[i]) < 0.004);
  for (const [role, target] of doorParts[material] ?? []) {
    if (matches(target)) return ['Door_' + side, role];
  }
  for (const [role, target] of headlightParts[material] ?? []) {
    if (matches(target)) return ['Headlight_' + side, role];
  }
  if (material === 'glass' && min[2] < 0 && max[2] > 0 &&
    matches([0.577, 1.751, 0.686, 1.129, 0.757, 0.757])) {
    return ['Windscreen', 'windscreen'];
  }
  const layer = wheelLayers[material];
  if (layer || material === 'accent') {
    const x = (min[0] + max[0]) / 2;
    const y = (min[1] + max[1]) / 2;
    const radius = (max[1] - min[1]) / 2;
    for (const axle of axles) {
      const fromHub = Math.hypot(x - axle.x, y - axle.y);
      const inboard = envelope[4] - axle.z;
      const owner = 'Wheel_' + axle.end + side;
      if (layer && fromHub < 0.004 && Math.abs(radius - layer.radius * axle.radius) < 0.004 &&
        Math.abs(inboard - layer.inboard * axle.radius) < 0.004) {
        return [owner, layer.role];
      }
      // The 62 individual vanes form an annulus in front of the tire. Checking
      // both face planes keeps painted fenders and body panels on the body.
      if (material === 'accent' && Math.abs(fromHub - 0.71 * axle.radius) < 0.004 &&
        Math.abs(inboard - 0.397 * axle.radius) < 0.004 &&
        Math.abs(envelope[5] - axle.z - 0.525 * axle.radius) < 0.004) {
        return [owner, 'vane'];
      }
    }
  }
  return ['body', 'fixed'];
}

function createPivots(doc, scene) {
  const pivots = new Map();
  function add(name, center, motion) {
    const node = doc.createNode(name).setTranslation(center).setExtras({ motion });
    scene.addChild(node);
    pivots.set(name, node);
  }
  // The original has no linkage. A presentation hinge is fitted at the forward
  // door seam; its mirrored axes lift the half-canopies up and out together.
  const axis = [0.09805, -0.68386, -0.72299];
  const length = Math.hypot(...axis);
  for (const [side, sign] of [['L', -1], ['R', 1]]) {
    add('Door_' + side, [1.0991, 0.7215, sign * 0.8066], {
      axis: [-sign * axis[0] / length, -sign * axis[1] / length, axis[2] / length],
      angle: Math.PI / 3,
    });
    for (const axle of axles) {
      add('Wheel_' + axle.end + side, [axle.x, axle.y, sign * axle.z], {
        axis: [0, 0, -1], radius: axle.radius,
      });
    }
  }
  return pivots;
}

export async function articulate(doc) {
  const scene = doc.getRoot().getDefaultScene();
  const nodes = new Map();
  scene.traverse(node => {
    for (const prim of node.getMesh()?.listPrimitives() ?? []) nodes.set(prim, node);
  });
  const draws = worldGeometry(doc.getRoot());
  const pivots = createPivots(doc, scene);
  const matched = new Map();
  for (const draw of draws) {
    const source = draw.primitive;
    const material = source.getMaterial().getName();
    const { boxes, ids } = islands(draw);
    const owners = new Map();
    for (const [id, box] of boxes) {
      const [owner, role] = classify(material, box);
      owners.set(id, owner);
      if (owner !== 'body') {
        const key = owner + '/' + role;
        const count = matched.get(key) ?? 0;
        assert(role === 'vane' || count === 0, 'Ambiguous island: ' + key);
        matched.set(key, count + 1);
      }
    }
    if ([...owners.values()].every(owner => owner === 'body')) continue;
    const groups = new Map();
    for (let i = 0; i < draw.indices.length; i += 3) {
      const a = draw.indices[i];
      const owner = owners.get(ids[a]);
      if (!groups.has(owner)) groups.set(owner, []);
      groups.get(owner).push(a, draw.indices[i + 1], draw.indices[i + 2]);
    }
    const sourceNode = nodes.get(source);
    const sourceMesh = sourceNode.getMesh();
    for (const [owner, faces] of groups) {
      const part = source.clone().setIndices(doc.createAccessor().setArray(Uint32Array.from(faces)));
      compactPrimitive(part);
      if (owner === 'body') {
        sourceMesh.addPrimitive(part);
        continue;
      }
      const name = owner === 'Windscreen' ? owner : owner + '_' + material;
      const node = doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(part));
      const pivot = pivots.get(owner);
      // Keep quantized attributes untouched. The child's affine transform undoes
      // only the pivot's translation, preserving the original assembled surface.
      const matrix = [...sourceNode.getWorldMatrix()];
      if (pivot) {
        const center = pivot.getTranslation();
        for (let k = 0; k < 3; k++) matrix[12 + k] -= center[k];
        pivot.addChild(node);
      } else scene.addChild(node);
      node.setMatrix(matrix);
      if (material === 'glass' && (owner === 'Windscreen' || owner.startsWith('Door_'))) {
        node.setExtras({ cabinGlazing: true });
      }
      if (owner.startsWith('Headlight_')) node.setExtras({ vehicleLamp: 'front' });
    }
    sourceMesh.removePrimitive(source);
    source.dispose();
  }
  for (const wheel of ['Wheel_FL','Wheel_FR','Wheel_RL','Wheel_RR']) {
    assert.equal(matched.get(wheel + '/vane'), 62, 'Incomplete vane ring: ' + wheel);
  }
  // Five roles per door, four per wheel, three per headlight, and the windscreen.
  assert.equal(matched.size, 33, 'The source mechanical and lamp islands must be re-inspected.');
  await doc.transform(prune({ keepAttributes: true, keepExtras: true, keepSolidTextures: true }));
}
