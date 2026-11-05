import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {gunzipSync} from 'node:zlib'
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {MeshoptDecoder} from 'meshoptimizer'
import {worldGeometry,normalizeVehicleGeometry} from './world-geometry.mjs'
await MeshoptDecoder.ready
const io=new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder})
const hash=b=>createHash('sha256').update(b).digest('hex')
const fingerprints=[]
for(const id of ['su7-ultra','mclaren-vgt']){
 const folder=new URL('../../public/flow/'+id+'/',import.meta.url)
 const asset=new URL('../../public/models/'+id+'.glb',import.meta.url)
 const [bytes,zipped,contact,contactZip,reportText,model]=await Promise.all([readFile(new URL(id+'.bin',folder)),readFile(new URL(id+'.bin.gz',folder)),readFile(new URL('contact.bin',folder)),readFile(new URL('contact.bin.gz',folder)),readFile(new URL('audit.json',folder),'utf8'),readFile(asset)])
 const report=JSON.parse(reportText)
 assert.equal(hash(bytes),report.fieldSha256);assert.equal(hash(model),report.sourceSha256)
 assert.deepEqual(gunzipSync(zipped),bytes);assert.deepEqual(gunzipSync(contactZip),contact)
 assert(report.residualRatio<.025)
 const shape=[8,12,16].map(o=>bytes.readUInt32LE(o));const count=shape.reduce((a,b)=>a*b)
 assert.equal(bytes.readUInt32LE(4),2);assert.deepEqual(shape,[256,96,128]);assert.equal(bytes.length,64+count*6)
 assert.equal(contact.readUInt32LE(0),0x544e4357);assert.equal(contact.length,32+count*4)
 assert.deepEqual([8,12,16].map(o=>contact.readUInt32LE(o)),shape)
 const low=[20,24,28].map(o=>bytes.readFloatLE(o)),high=[32,36,40].map(o=>bytes.readFloatLE(o))
 const bias=bytes.readFloatLE(48),scale=bytes.readFloatLE(52)
 const sample=p=>{const c=p.map((v,a)=>Math.max(0,Math.min(shape[a]-1,Math.floor((v-low[a])/(high[a]-low[a])*shape[a]))));return c[0]+shape[0]*(c[1]+shape[1]*c[2])}
 const distance=p=>bytes[64+sample(p)*4+3]/255*scale+bias
 let solids=0
 for(let i=0;i<count;i++){
  assert.equal(contact[32+i*4+2],bytes[64+i*4+3])
  if(bytes[64+i*4+3]/255*scale+bias<=0){solids++;assert.equal(bytes[64+count*4+i*2],0);assert.equal(bytes[65+count*4+i*2],0)}
 }
 assert(solids>50000)
 assert(distance([4,.6,0])>.8,'Clear inlet')
 const cabin=report.cabinSeal.min.map((v,a)=>(v+report.cabinSeal.max[a])/2)
 assert(distance(cabin)<0,'Cabin must exclude smoke')
 const draws=worldGeometry((await io.readBinary(model)).getRoot());const normalization=normalizeVehicleGeometry(draws)
 assert(Math.abs(normalization.scale-report.normalization.scale)<1e-6)
 let probes=0,maxDistance=-Infinity
 for(const {points,indices} of draws)for(let i=0;i<indices.length;i+=3){
  const center=[0,1,2].map(a=>(points[indices[i]*3+a]+points[indices[i+1]*3+a]+points[indices[i+2]*3+a])/3)
  maxDistance=Math.max(maxDistance,distance(center));probes++
 }
 assert(maxDistance<.04,'Conservative mask must cover the model surface')
 fingerprints.push(report.fieldSha256)
 console.log('PASS',id,{probes,solids,maxSurfaceDistance:maxDistance,residualRatio:report.residualRatio,gzipBytes:zipped.length})
}
assert.equal(new Set(fingerprints).size,2,'Each car needs its own field')
