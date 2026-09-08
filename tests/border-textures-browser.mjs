import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDemo } from '../src/demo.js';
import { makeSprite, hexToColor } from '../src/core.js';
import { buildTileset } from '../src/tiles.js';
import { cleanTile, serializeWorkspace, parseWorkspace } from '../src/storage.js';
const w=createDemo(),a=makeSprite('Pink terrain',32,32),b=makeSprite('Dark terrain',32,32),strip=makeSprite('32px transparent border',32,32);
a.layers[0].pixels.fill(hexToColor('#ffd1bb'));b.layers[0].pixels.fill(hexToColor('#26494b'));
for(let y=0;y<19;y++)for(let x=0;x<32;x++)if(y<14+(x%8<4?3:0))strip.layers[0].pixels[y*32+x]=hexToColor((x+y)%5?'#719b88':'#b0c9a3');
w.sprites.push(a,b,strip);const options=cleanTile({size:32,columns:8,mode:'blob',border:4,borderType:'texture',borderTexture:strip.id,terrainA:a.id,terrainB:b.id});
w.tilesets=[{...buildTileset(a,b,options,[strip]),id:'border-example',kind:'tileset',name:'Border example'}];
const browser=await chromium.launch({...(process.env.PIXFIT_BROWSER?{executablePath:process.env.PIXFIT_BROWSER}:{channel:'chrome'}),headless:true}),page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const control=(key,selected=false)=>page.locator(`[data-border-option="${key}"][data-border-selected="${selected}"]`);
const action=key=>page.locator(`[data-action="${key}"]`).first().click();
const saved=async()=>{
  await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('All changes saved'));
  return parseWorkspace(await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('pixfit-studio',1);r.onsuccess=()=>{const db=r.result,g=db.transaction('workspace').objectStore('workspace').get('current');g.onsuccess=()=>{resolve(g.result);db.close();};};})));
};
const pixels=()=>page.locator('#art-canvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data));
try{
  await page.addInitScript(data=>{if(!sessionStorage.getItem('border-fixture')){localStorage.setItem('pixfit-workspace',JSON.stringify(data));sessionStorage.setItem('border-fixture','1');}},serializeWorkspace(w));
  await page.goto('http://127.0.0.1:5173');await page.locator('.library-open').filter({hasText:'Border example'}).click();
  const before=await pixels();await page.click('[data-action="border-strip-preset"][data-selected="false"]');
  assert.equal(await control('borderMapping').inputValue(),'native');assert.equal(await page.locator('#tile-border').isDisabled(),true);assert.notDeepEqual(await pixels(),before);
  const native=await saved();assert.equal(native.tilesets[0].options.borderTrim,false);assert.equal(native.tilesets[0].options.borderReverse,false);assert.deepEqual(native.sprites.find(s=>s.id===strip.id).layers,strip.layers);
  await control('borderReverse').check();assert.notDeepEqual(await pixels(),before);await action('undo');assert.equal(await control('borderReverse').isChecked(),false);await action('redo');assert.equal(await control('borderReverse').isChecked(),true);
  await page.click('[data-border-details="global"] summary');await control('borderAlign').selectOption('outer');assert.equal(await page.locator('[data-border-details="global"]').getAttribute('open'),'');
  await control('borderOffset').fill('3');await control('borderOffset').dispatchEvent('change');await control('borderRepeat').fill('24');await control('borderRepeat').dispatchEvent('change');
  await control('borderPhase').fill('-4');await control('borderPhase').dispatchEvent('change');await control('borderScale').selectOption('0.5');await control('borderRotation').selectOption('90');await control('borderTrim').check();
  await action('next-tile');await control('borderMapping',true).selectOption('fit');await page.click('[data-border-details="selected"] summary');await control('borderOffset',true).fill('-2');await control('borderOffset',true).dispatchEvent('change');
  const last=await saved();assert.equal(last.tilesets[0].options.borderRepeat,24);assert.equal(last.tilesets[0].options.borderPhase,-4);assert.equal(last.tilesets[0].options.borderRotation,90);assert.equal(last.tilesets[0].options.overrides[1].borderOffset,-2);
  const result=await pixels();await page.reload();await page.locator('.library-open').filter({hasText:'Border example'}).click();assert.deepEqual(await pixels(),result);assert.equal(await control('borderMapping').inputValue(),'native');
  await action('next-tile');assert.equal(await control('borderMapping',true).inputValue(),'fit');await action('reset-tile');assert.equal(await control('borderMapping',true).inputValue(),'native');
  await action('export');const downloading=page.waitForEvent('download');await page.click('#dialog button[type="submit"]');const png=await readFile(await (await downloading).path());assert.equal(png.readUInt32BE(16),256);assert.equal(png.readUInt32BE(20),192);await page.keyboard.press('Escape');
  await page.click('[data-action="border-strip-preset"][data-selected="false"]');await page.locator('#left-panel').evaluate(e=>e.scrollTop=560);await page.screenshot({path:'.screenshots/border-texture-options.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('Border browser checks passed: 32px preset, transparent padding, live mapping controls, undo/redo, per-tile overrides, reload, source preservation, and PNG export.');
}finally{await browser.close();}
