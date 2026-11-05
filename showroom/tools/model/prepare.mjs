// Run npm ci and npm run prepare-models here. Optional first argument: source GLB.
// The two files are independent first-load tiers. A visitor downloads just one.
import assert from 'node:assert/strict';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Logger, NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { compactPrimitive, join, meshopt, prune, weld } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import { bakeOcclusion } from './occlusion.mjs';
import { articulate } from './articulate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const input = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(here, '../../../models/xiaomi_vision_gt.glb');
const outputDirectory = resolve(here, '../../public/models');
await mkdir(outputDirectory, { recursive: true });
await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready, MeshoptSimplifier.ready]);

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    'meshopt.encoder': MeshoptEncoder,
    'meshopt.decoder': MeshoptDecoder,
  })
  .setLogger(new Logger(Logger.Verbosity.WARN));

const original = await readFile(input);
const source = await io.readBinary(original);
const sourceBounds = getBounds(source.getRoot().getDefaultScene());
const sourceExtras = source.getRoot().getAsset().extras;
function materials(root) {
  return Object.fromEntries(
    root.listMaterials().map((material) => {
      const coat = material.getExtension('KHR_materials_clearcoat');
      return [
        material.getName(),
        {
          base: material.getBaseColorFactor(),
          metal: material.getMetallicFactor(),
          rough: material.getRoughnessFactor(),
          alphaMode: material.getAlphaMode(),
          bothFaces: material.getDoubleSided(),
          glow: material.getEmissiveFactor(),
          strength: material.getExtension('KHR_materials_emissive_strength')?.getEmissiveStrength(),
          clearcoat: coat?.getClearcoatFactor(),
          coatRoughness: coat?.getClearcoatRoughnessFactor(),
          normalTexture: Boolean(material.getNormalTexture()),
        },
      ];
    }),
  );
}
const sourceMaterials = materials(source.getRoot());
const sourceTireMap = source.getRoot().listTextures()[0].getImage();

for (const tier of [
  { file: 'vision-gt.glb', ratio: 0.28, error: 0.0005 },
  { file: 'vision-gt-lite.glb', ratio: 0.12, error: 0.0012 },
]) {
  const doc = await io.readBinary(original);
  const root = doc.getRoot();
  // Source chunks share transforms and were split at the 16-bit index ceiling.
  // Reunite each material before edge collapse to avoid seams in the bodywork.
  await doc.transform(prune({ keepSolidTextures: true }), join(), weld());

  for (const mesh of root.listMeshes()) {
    for (const primitive of mesh.listPrimitives()) {
      const material = primitive.getMaterial().getName();
      const indices = primitive.getIndices();
      // Preserve the topology of the small emissive strips and chrome details.
      if (['emit', 'material', 'chrome'].includes(material)) continue;
      const indexCount = indices.getCount();
      const target = Math.floor((tier.ratio * indexCount) / 3) * 3;
      const [simplified] = MeshoptSimplifier.simplifyWithAttributes(
        Uint32Array.from(indices.getArray()),
        primitive.getAttribute('POSITION').getArray(),
        3,
        primitive.getAttribute('NORMAL').getArray(),
        3,
        [0.65, 0.65, 0.65],
        null,
        target,
        tier.error,
        ['LockBorder'],
      );
      indices.setArray(simplified);
      compactPrimitive(primitive);
    }
  }
  await doc.transform(
    meshopt({
      encoder: MeshoptEncoder,
      // Keep smooth reflected gradients with 14-bit normals and a shared 16-bit position grid.
      level: 'medium',
      quantizationVolume: 'scene',
      quantizePosition: 16,
      quantizeNormal: 14,
      quantizeTexcoord: 14,
    }),
  );

  // Bake after simplification and quantization. Geometry and ordering are fixed here.
  bakeOcclusion(doc);
  await articulate(doc);
  const binary = await io.writeBinary(doc);
  const check = await io.readBinary(binary);
  const decoded = check.getRoot();
  assert.deepEqual(
    decoded.getAsset().extras,
    sourceExtras,
    'Creator, source and license must survive the round trip.',
  );
  assert.deepEqual(materials(decoded), sourceMaterials, 'PBR material parameters changed.');
  assert.deepEqual(decoded.listTextures()[0].getImage(), sourceTireMap, 'Tire normal map changed.');
  const bounds = getBounds(decoded.getDefaultScene());
  for (const side of ['min', 'max']) {
    assert(bounds[side].every((dimension, i) => Math.abs(dimension - sourceBounds[side][i]) < 0.003));
  }
  const primitives = decoded.listMeshes().flatMap((mesh) => mesh.listPrimitives());
  for (const prim of primitives) {
    const normals = prim.getAttribute('NORMAL');
    const ao = prim.getAttribute('_AO');
    assert(ao.getNormalized() && ao.getArray() instanceof Uint8Array);
    assert.equal(ao.getCount(), normals.getCount(), 'Missing decoded visibility values.');
    const v = [0, 0, 0];
    for (let i = 0; i < normals.getCount(); i++) {
      normals.getElement(i, v);
      assert(Math.abs(Math.hypot(...v) - 1) < 0.002, 'Invalid decoded normal.');
    }
  }
  const triangleCount = primitives.reduce(
    (sum, primitive) => sum + primitive.getIndices().getCount() / 3,
    0,
  );
  const destination = resolve(outputDirectory, tier.file);
  const temporary = destination + '.' + process.pid + '.tmp';
  try {
    await writeFile(temporary, binary);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
  console.log(tier.file, { triangleCount, bytes: binary.length, drawCalls: primitives.length, bounds });
}
