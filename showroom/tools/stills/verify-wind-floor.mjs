import { chromium } from 'playwright-core'
import { mkdir } from 'node:fs/promises'
import assert from 'node:assert/strict'
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'})
const page=await browser.newPage({viewport:{width:1440,height:960},reducedMotion:'reduce'})
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())})
const output=new URL('../../.artifacts/wind-floor/',import.meta.url)
await mkdir(output,{recursive:true})
const {fileURLToPath}=await import('node:url')
const shot=async name=>page.locator('#stage').screenshot({path:fileURLToPath(new URL(name+'.png',output))})
await page.addInitScript(()=>{
 window.__THREE_DEVTOOLS__=new EventTarget()
 window.__THREE_DEVTOOLS__.addEventListener('observe',({detail:scene})=>{
  if(scene.isScene)scene.onAfterRender=(renderer,_,camera)=>{
   if(!renderer.getRenderTarget() && renderer.domElement.id==='car')window.studioFrame={renderer,scene,camera}
  }
 })
})
const actions=async (method,...args)=>page.evaluate(async ([method,args])=>{const url=performance.getEntriesByType('resource').find(e=>e.name.includes('/src/controller.ts')).name;return (await import(url)).actions[method](...args)},[method,args])
try {
 await page.goto(process.argv[2]||'http://127.0.0.1:5173',{waitUntil:'domcontentloaded'})
 await page.waitForSelector('body.live',{timeout:90000})
 for(const [id,name] of [['vision-gt','小米 Vision GT'],['su7-ultra','小米 SU7 Ultra'],['mclaren-vgt','迈凯伦 Ultimate Vision GT']]){
  if(id!=='vision-gt') {await actions('selectVehicle',id);await page.waitForSelector('body.live',{timeout:90000})}
  await page.locator('#track > #reveal').evaluate(e=>window.scrollTo(0,e.offsetTop));await page.locator('[data-shot="reveal"].is-current').waitFor()
  await page.waitForTimeout(300)
  await shot(id+'-floor')
  const reflection=await page.evaluate(()=>{
   const floor=window.studioFrame.scene.children.find(n=>n.isReflector)
   return {width:floor.getRenderTarget().width,height:floor.getRenderTarget().height,mipmaps:floor.getRenderTarget().texture.generateMipmaps,samples:floor.getRenderTarget().samples}
  })
  assert(reflection.width>=1080 && reflection.height>=720,'Reflection must follow the viewport rather than use 512x320')
  assert.equal(reflection.mipmaps,false)
  assert.equal(reflection.samples,2)
  await page.locator('#track > #aero').evaluate(e=>window.scrollTo(0,e.offsetTop));await page.locator('[data-shot="aero"].is-current').waitFor()
  await page.locator('#wind-settings').click()
  await page.waitForSelector('.studio-popover')
  const slider=page.getByRole('slider',{name:'风洞风速'})
  assert(!(await slider.isDisabled()))
  await slider.focus();await page.keyboard.press('End');assert.equal(await slider.inputValue(),'300')
  await page.keyboard.press('Home');assert.equal(await slider.inputValue(),'1')
  await actions('setWindSpeed',120)
  assert.equal(await page.locator('#drag-coefficient').innerText(),id==='vision-gt'?'0.290':'—')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.screenshot({path:fileURLToPath(new URL(id+'-layout.png',output))})
  const on=await shot(id+'-aero')
  await actions('toggleSmoke');await page.waitForTimeout(200)
  const off=await shot(id+'-aero-clear')
  const changed=await page.evaluate(async ([a,b])=>{
   const read=async s=>{const img=await createImageBitmap(new Blob([Uint8Array.from(atob(s),c=>c.charCodeAt(0))]));const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);return ctx.getImageData(0,0,c.width,c.height).data};
   const x=await read(a),y=await read(b);let n=0;for(let i=0;i<x.length;i+=4) if(Math.abs(x[i]-y[i])+Math.abs(x[i+1]-y[i+1])+Math.abs(x[i+2]-y[i+2])>20)n++;return n
  },[on.toString('base64'),off.toString('base64')])
  assert(changed>15000,'Visible smoke must respond to the switch: '+id+' '+changed)
  await actions('toggleSmoke')
  await page.emulateMedia({reducedMotion:'no-preference'})
  const smokeValue=key=>page.evaluate(key=>window.studioFrame.scene.children.find(n=>n.name==='Wind tunnel smoke').children[0].material.uniforms[key].value,key)
  const before=await smokeValue('uTravel')
  await page.waitForTimeout(180)
  assert(await smokeValue('uTravel')>before,'Smoke must advect over time')
  await actions('toggleSmoke');await page.waitForTimeout(100)
  const tail=await smokeValue('uTail')
  assert(tail>0 && tail<1024,'Closing the inlet must allow smoke to drain downstream')
  await actions('toggleSmoke')
  await page.emulateMedia({reducedMotion:'reduce'})
  await page.locator('#wind-interaction').focus();await page.keyboard.press('ArrowRight');await page.keyboard.press('ArrowUp');await shot(id+'-orbit');await page.keyboard.press('Home')
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(300);await shot(id+'-aero-mobile');await page.screenshot({path:fileURLToPath(new URL(id+'-layout-mobile.png',output))});await page.setViewportSize({width:1440,height:960})
  console.log('PASS',name,'wind on/off pixels',changed,'speed bounds and orbit')
 }
 assert.deepEqual(errors,[])
 console.log('PASS no browser or shader errors')
}finally{await browser.close()}
