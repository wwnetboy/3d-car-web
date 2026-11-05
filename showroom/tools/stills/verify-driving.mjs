import assert from 'node:assert/strict'
import {chromium} from 'playwright-core'
import {Quaternion,Vector3} from 'three'
import {mkdir} from 'node:fs/promises'
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
const page=await browser.newPage({viewport:{width:1280,height:900},reducedMotion:'no-preference'})
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
await page.addInitScript(()=>{window.__THREE_DEVTOOLS__=new EventTarget();window.__THREE_DEVTOOLS__.addEventListener('observe',({detail:scene})=>{
 if(scene.isScene)scene.onAfterRender=(renderer)=>{if(!renderer.getRenderTarget()&&renderer.domElement.id==='car')window.testScene=scene}
})})
const actions=async (key,...args)=>page.evaluate(async ([key,args])=>(await import(performance.getEntriesByType('resource').find(e=>e.name.includes('/src/controller.ts')).name)).actions[key](...args),[key,args])
const sample=()=>page.evaluate(()=>{
 const scene=window.testScene,room=scene.children.find(n=>n.material?.uniforms?.uRoad)
 return {travel:room.material.uniforms.uTravel.value,road:room.material.uniforms.uRoad.value,wheels:['FL','FR','RL','RR'].map(key=>{
  const n=scene.getObjectByName('Wheel_'+key);return {q:n.quaternion.toArray(),axis:n.userData.motion.axis,radius:n.userData.motion.radius,center:n.getWorldPosition(n.position.clone()).toArray()}
 })}
})
function check(a,b,label){
 const distance=(b.travel-a.travel+960)%960
 assert(distance>.15 && distance<50,label+' ground must travel')
 for(let i=0;i<4;i++){
  const wheel=a.wheels[i],q=new Quaternion().fromArray(wheel.q).invert().multiply(new Quaternion().fromArray(b.wheels[i].q))
  const axis=new Vector3().fromArray(wheel.axis).normalize(),angle=2*Math.atan2(new Vector3(q.x,q.y,q.z).dot(axis),q.w)
  const error=angle-distance/wheel.radius
  assert(Math.abs(Math.atan2(Math.sin(error),Math.cos(error)))<.001,label+' angular travel must equal distance/radius')
  assert(new Vector3().fromArray(wheel.center).distanceTo(new Vector3().fromArray(b.wheels[i].center))<.001,label+' wheel must turn about its hub')
 }
 return distance
}
try {
 await page.goto(process.argv[2]||'http://127.0.0.1:5173',{waitUntil:'domcontentloaded'});await page.waitForSelector('body.live',{timeout:90000})
 await mkdir('../../.artifacts/driving',{recursive:true})
 for(const id of ['vision-gt','su7-ultra','mclaren-vgt']){
  if(id!=='vision-gt'){await actions('selectVehicle',id);await page.waitForSelector('body.live',{timeout:90000})}
  await actions('openViewer');await actions('setDriveSpeed',36);await actions('toggleDrive')
  await page.waitForFunction(()=>document.querySelector('#vehicle-phase')?.textContent==='行驶中')
  for(const [speed,settle] of [[36,0],[120,2200],[300,4600]]){
   await actions('setDriveSpeed',speed);if(settle)await page.waitForTimeout(settle)
   const a=await sample();await page.waitForTimeout(220);const b=await sample();assert(b.road>.99)
   console.log('PASS',id,speed+' km/h',check(a,b,id+' '+speed).toFixed(3)+' m synchronized road/wheels')
  }
  await page.locator('#stage').screenshot({path:'../../.artifacts/driving/'+id+'.png'})
  await actions('toggleDrive');await page.waitForFunction(()=>document.querySelector('#vehicle-phase')?.textContent==='驻车',{timeout:15000})
  const stopped=await sample();await page.waitForTimeout(180);assert.deepEqual((await sample()).wheels,stopped.wheels);assert.equal((await sample()).travel,stopped.travel)
  await actions('closeViewer');await page.locator('#track > #aero').evaluate(e=>window.scrollTo(0,e.offsetTop));await page.locator('[data-shot="aero"].is-current').waitFor();await actions('setWindSpeed',60)
  await page.waitForTimeout(300)
  const a=await sample();await page.waitForTimeout(220);const b=await sample();check(a,b,id+' wind')
  await actions('toggleSmoke');const c=await sample();await page.waitForTimeout(220);check(c,await sample(),id+' inlet off');await actions('toggleSmoke')
  console.log('PASS',id,'parking, wind-driven floor, smoke-off keeps road and wheels moving')
 }
 assert.deepEqual(errors,[])
 console.log('PASS no browser or shader errors')
}finally{await browser.close()}
