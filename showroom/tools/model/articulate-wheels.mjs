import assert from 'node:assert/strict'
import {fitWheelProfile} from './fit-wheel-profile.mjs'
import {compactPrimitive} from '@gltf-transform/functions'
import {worldGeometry,normalizeVehicleGeometry} from './world-geometry.mjs'

// Split only measured wheel-material faces. Calipers, arches and body panels
// stay fixed; shared four-wheel primitives are partitioned without deforming vertices.
export function articulateWheels(doc) {
 const scene=doc.getRoot().getDefaultScene(),meshes=new Map()
 const draws=worldGeometry(doc.getRoot()),normalization=normalizeVehicleGeometry(draws)
 const boxes=new Map()
 for(const draw of draws)if(['tire','EXT_WHEEL'].includes(draw.primitive.getMaterial().getName())) {
  for(let i=0;i<draw.points.length;i+=3){
   const p=Array.from(draw.points.subarray(i,i+3)),key=(p[0]>0?'F':'R')+(p[2]<0?'L':'R')
   if(!boxes.has(key))boxes.set(key,{min:[Infinity,Infinity,Infinity],max:[-Infinity,-Infinity,-Infinity],points:[]})
   const box=boxes.get(key)
   box.points.push(p)
   p.forEach((v,a)=>{box.min[a]=Math.min(v,box.min[a]);box.max[a]=Math.max(v,box.max[a])})
  }
 }
 assert.equal(boxes.size,4,'Four separate tire envelopes are required')
 const wheels=[...boxes].map(([key,box])=>{
  const profile=fitWheelProfile(box.points)
  const {center,axis,radius}=profile
  assert(radius>.25 && radius<.55)
  const {scale,center:origin}=normalization
  const sourceCenter=[-(center[2]/scale+origin[2]),center[1]/scale+origin[1],center[0]/scale+origin[0]]
  const pivot=doc.createNode('Wheel_'+key).setTranslation(sourceCenter).setExtras({motion:{axis:[-axis[2],axis[1],axis[0]],radius},studioWheel:{center,axis,radius}})
  scene.addChild(pivot)
  return {key,center,axis,radius,pivot,sourceCenter,triangles:0}
 })
 const materials=new Set(['tire','Rim_2_CB','Rim_Color_2','Break_Disk','EXT_WHEEL','EXT_BRAKEDISC','color_rims','rim_ao'])
 for(const draw of draws){
  const source=draw.primitive
  if(!materials.has(source.getMaterial().getName()))continue
  const groups=new Map()
  for(let i=0;i<draw.indices.length;i+=3){
   const face=Array.from(draw.indices.subarray(i,i+3))
   const owner=wheels.find(w=>face.every(index=>{
    const x=draw.points[index*3]-w.center[0],y=draw.points[index*3+1]-w.center[1],z=draw.points[index*3+2]-w.center[2]
    return Math.hypot(x,y)<=w.radius*1.08 && Math.abs(z)<.28
   }))
   const key=owner?.key??'body'
   if(!groups.has(key))groups.set(key,[])
   groups.get(key).push(...face)
   if(owner)owner.triangles++
  }
  if(groups.size===1&&groups.has('body'))continue
  const sourceNode=draw.node
  if(!meshes.has(sourceNode)){
   const copy=doc.createMesh(sourceNode.getMesh().getName())
   for(const p of sourceNode.getMesh().listPrimitives())copy.addPrimitive(p)
   sourceNode.setMesh(copy);meshes.set(sourceNode,copy)
  }
  const sourceMesh=meshes.get(sourceNode)
  for(const [key,faces] of groups){
   const part=source.clone().setIndices(doc.createAccessor().setArray(Uint32Array.from(faces)))
   compactPrimitive(part)
   if(key==='body'){sourceMesh.addPrimitive(part);continue}
   const wheel=wheels.find(w=>w.key===key)
   const name='Wheel_'+key+'_'+source.getMaterial().getName()
   const node=doc.createNode(name).setMesh(doc.createMesh(name).addPrimitive(part))
   const matrix=[...sourceNode.getWorldMatrix()]
   wheel.sourceCenter.forEach((v,a)=>matrix[12+a]-=v)
   node.setMatrix(matrix);wheel.pivot.addChild(node)
  }
  sourceMesh.removePrimitive(source)
 }
 for(const wheel of wheels)assert(wheel.triangles>1500,'Incomplete wheel '+wheel.key)
 console.log(JSON.stringify({wheels:wheels.map(({key,center,axis,radius,triangles})=>({key,center,axis,radius,triangles}))}))
}
