// Preserve source materials and attribution while compressing the added vehicles.
import { articulateWheels } from './articulate-wheels.mjs'
import { NodeIO } from '@gltf-transform/core'
import { ALL_EXTENSIONS } from '@gltf-transform/extensions'
import { dedup, meshopt, prune, simplify, weld } from '@gltf-transform/functions'
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer'
import { fileURLToPath } from 'node:url'

await Promise.all([MeshoptDecoder.ready, MeshoptEncoder.ready, MeshoptSimplifier.ready])
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder,
})
for (const [source, target] of [
  ['2025_xiaomi_su7_ultra_production_version', 'su7-ultra'],
  ['mclaren_ultimate_vision_gt', 'mclaren-vgt'],
]) {
  for (const lite of [false, true]) {
    const doc = await io.read(fileURLToPath(new URL(`../../../models/${source}.glb`, import.meta.url)))
    await doc.transform(dedup(), weld())
    articulateWheels(doc)
    if (lite) await doc.transform(simplify({ simplifier: MeshoptSimplifier, ratio: 0.5, error: 0.0005, lockBorder: true }))
    await doc.transform(prune(), meshopt({ encoder: MeshoptEncoder, level: 'medium' }))
    await io.write(fileURLToPath(new URL(`../../public/models/${target}${lite ? '-lite' : ''}.glb`, import.meta.url)), doc)
    console.log(`Prepared ${target}${lite ? '-lite' : ''}`)
  }
}
