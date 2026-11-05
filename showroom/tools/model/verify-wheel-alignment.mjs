import assert from 'node:assert/strict'
import {fileURLToPath} from 'node:url'
import {NodeIO} from '@gltf-transform/core'
import {ALL_EXTENSIONS} from '@gltf-transform/extensions'
import {MeshoptDecoder} from 'meshoptimizer'
import {Quaternion,Vector3} from 'three'
import {worldGeometry,normalizeVehicleGeometry} from './world-geometry.mjs'

await MeshoptDecoder.ready
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({'meshopt.decoder':MeshoptDecoder})
for (const lite of [false,true]) {
  const file = 'mclaren-vgt' + (lite ? '-lite' : '')
  const doc = await io.read(fileURLToPath(new URL('../../public/models/'+file+'.glb',import.meta.url)))
  const draws = worldGeometry(doc.getRoot())
  normalizeVehicleGeometry(draws)
  for (const key of ['FL','FR','RL','RR']) {
    const name = 'Wheel_'+key
    const pivot = doc.getRoot().listNodes().find(n=>n.getName()===name)
    const motion = pivot.getExtras().motion
    const axis = new Vector3(motion.axis[2],motion.axis[1],-motion.axis[0]).normalize()
    const camber = (key[0]==='F' ? 4.5 : 3.5)*Math.PI/180
    const expectedAxis = new Vector3(0,(key[1]==='L'?1:-1)*Math.sin(camber),-Math.cos(camber))
    assert(axis.angleTo(expectedAxis)<.00002,file+' '+key+' must preserve authored camber')
    assert(Math.abs(motion.radius-(key[0]==='F'?.375643:.422829))<.00001,'Use radial tire size, excluding axial width')
    const center = new Vector3(...pivot.getExtras().studioWheel.center)
    const tires = draws.filter(d=>d.node.getName().startsWith(name+'_') && d.primitive.getMaterial().getName()==='EXT_WHEEL')
    assert(tires.length>0)
    let axialDrift=0, minHeight=Infinity, maxHeight=-Infinity
    const q=new Quaternion(),point=new Vector3(),turned=new Vector3()
    for(let step=0;step<16;step++) {
      q.setFromAxisAngle(axis,step*Math.PI/8)
      let bottom=Infinity,top=-Infinity
      for(const draw of tires) for(let i=0;i<draw.points.length;i+=3) {
        point.fromArray(draw.points,i)
        turned.copy(point).sub(center).applyQuaternion(q).add(center)
        axialDrift=Math.max(axialDrift,Math.abs(turned.clone().sub(point).dot(expectedAxis)))
        bottom=Math.min(bottom,turned.y);top=Math.max(top,turned.y)
      }
      minHeight=Math.min(minHeight,top-bottom);maxHeight=Math.max(maxHeight,top-bottom)
    }
    assert(axialDrift<.00002,file+' '+key+' tire must not precess about a horizontal axis')
    assert(maxHeight-minHeight<.0015,file+' '+key+' tire must not wobble over a full turn')
    console.log('PASS',file,key,{camberDegrees:camber*180/Math.PI,axialDrift,heightVariation:maxHeight-minHeight})
  }
}
