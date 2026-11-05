import assert from 'node:assert/strict'
import {chromium} from 'playwright-core'
import {mkdir} from 'node:fs/promises'
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
const page=await browser.newPage({viewport:{width:390,height:844},reducedMotion:'no-preference',isMobile:true,hasTouch:true})
const failures=[];page.on('pageerror',e=>failures.push(e.message));page.on('console',m=>{if(m.type()==='error')failures.push(m.text())})
const requested=[];page.on('request',r=>{if(r.url().includes('/models/'))requested.push(r.url())})
await page.addInitScript(()=>{window.__THREE_DEVTOOLS__=new EventTarget();window.__THREE_DEVTOOLS__.addEventListener('observe',({detail:s})=>{if(s.isScene)s.onAfterRender=(r)=>{if(!r.getRenderTarget()&&r.domElement.id==='car')window.scene=s}})})
const act=async(key,...args)=>page.evaluate(async([key,args])=>(await import(performance.getEntriesByType('resource').find(e=>e.name.includes('/src/controller.ts')).name)).actions[key](...args),[key,args])
const snapshot=()=>page.evaluate(()=>({q:window.scene.getObjectByName('Wheel_FL').quaternion.toArray(),travel:window.scene.children.find(n=>n.material?.uniforms?.uRoad).material.uniforms.uTravel.value}))
try{
 await page.route('**/models/*.glb*',async route=>{await new Promise(r=>setTimeout(r,1200));await route.continue()})
 await page.goto('http://127.0.0.1:5173',{waitUntil:'domcontentloaded'})
 await page.locator('#load-state[aria-busy="true"]').waitFor()
 assert.equal(await page.locator('.action-dock #load-state').count(),0)
 const load=await page.locator('#load-state').boundingBox();assert(Math.abs(load.x+load.width/2-195)<3 && Math.abs(load.y+load.height/2-422)<3)
 await mkdir('../../.artifacts/wind-floor',{recursive:true})
 await page.screenshot({path:'../../.artifacts/wind-floor/loading-mobile.png'})
 await page.waitForSelector('body.live',{timeout:90000});await page.unroute('**/models/*.glb*')
 for(const id of ['su7-ultra','mclaren-vgt']){
  await act('selectVehicle',id);await page.waitForSelector('body.live',{timeout:90000})
  await act('openViewer');await act('setDriveSpeed',36);await act('toggleDrive')
  await page.waitForFunction(()=>document.querySelector('#vehicle-phase')?.textContent==='行驶中')
  const a=await snapshot();await page.waitForTimeout(150);const b=await snapshot();assert(b.travel>a.travel);assert.notDeepEqual(a.q,b.q)
  await act('toggleDrive');await page.waitForFunction(()=>document.querySelector('#vehicle-phase')?.textContent==='驻车');await act('closeViewer')
  await page.locator('#track > #aero').evaluate(e=>window.scrollTo(0,e.offsetTop));await page.locator('[data-shot="aero"].is-current').waitFor()
  const bounds=await page.locator('.wind-intro, .wind-dashboard').evaluateAll(els=>els.map(e=>e.getBoundingClientRect().toJSON()))
  assert(bounds[0].bottom<=bounds[1].top+1,'Description and metrics must not overlap')
  await page.screenshot({path:'../../.artifacts/wind-floor/'+id+'-lite-mobile.png'})
  assert(requested.some(url=>url.includes(id+'-lite.glb')))
  console.log('PASS',id,'mobile lite model, driving, wind layout')
 }
 assert.deepEqual(failures,[])
 console.log('PASS centered loading and no browser errors')
}finally{await browser.close()}
