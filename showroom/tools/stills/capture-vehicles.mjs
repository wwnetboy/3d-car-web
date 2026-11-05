import { chromium } from 'playwright-core'
import { mkdir, writeFile } from 'node:fs/promises'
const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
const page = await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'})
page.on('console',m=>{if(m.type()==='error'||m.type()==='warning') console.log(m.type(),m.text())})
page.on('pageerror',e=>console.log('PAGE ERROR',e.message))
await mkdir('../../.artifacts',{recursive:true})
await page.addInitScript(()=>{
 window.__THREE_DEVTOOLS__=new EventTarget()
 window.__THREE_DEVTOOLS__.addEventListener('observe',({detail:scene})=>{
  if(scene.isScene)scene.onAfterRender=(renderer,_,camera)=>{
   if(!renderer.getRenderTarget()&&renderer.domElement.id==='car')window.studioFrame={renderer,scene,camera}
  }
 })
})
async function capture({path}) {
 const png=await page.evaluate(()=>{
  const {renderer,scene,camera}=window.studioFrame
  renderer.render(scene,camera)
  return renderer.domElement.toDataURL('image/png').split(',')[1]
 })
 await writeFile(path,Buffer.from(png,'base64'))
}
await page.goto(process.argv[2] || 'http://127.0.0.1:5173')
await page.waitForSelector('body.live',{timeout:90000})
for(const id of ['su7-ultra','mclaren-vgt']) {
 await page.evaluate(async id=>(await import(performance.getEntriesByType('resource').find(e=>e.name.includes('/src/controller.ts')).name)).actions.selectVehicle(id),id)
 await page.waitForSelector('body.live',{timeout:90000})
 await page.waitForTimeout(1500)
 console.log('LOADED',id,await page.title())
 await capture({path:'../../public/stills/'+id+'.png'})
 await page.screenshot({path:'../../.artifacts/'+id+'.png'})
 await page.setViewportSize({width:390,height:844})
 await page.waitForTimeout(500)
 await capture({path:'../../public/stills/'+id+'-p.png'})
 await page.screenshot({path:'../../.artifacts/'+id+'-mobile.png'})
 await page.setViewportSize({width:1440,height:960})
 for (const portrait of [false,true]) {
  await page.setViewportSize(portrait ? {width:390,height:844} : {width:1440,height:960})
  await page.locator('#track > #aero').evaluate(e=>window.scrollTo(0,e.offsetTop))
  await page.locator('[data-shot="aero"].is-current').waitFor()
  await page.waitForTimeout(300)
  for(const clear of [false,true]) {
   if(clear) await page.evaluate(async ()=>(await import(performance.getEntriesByType('resource').find(e=>e.name.includes('/src/controller.ts')).name)).actions.toggleSmoke())
   await page.waitForTimeout(200)
   await capture({path:'../../public/stills/'+id+'-aero'+(clear?'-clear':'')+(portrait?'-p':'')+'.png'})
  }
  await page.evaluate(async ()=>(await import(performance.getEntriesByType('resource').find(e=>e.name.includes('/src/controller.ts')).name)).actions.toggleSmoke())
 }
 await page.setViewportSize({width:1440,height:960})
 await page.locator('#track > #reveal').evaluate(e=>window.scrollTo(0,e.offsetTop))
 await page.locator('[data-shot="reveal"].is-current').waitFor()
}
await browser.close()
