import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { parseWorkspace } from '../src/storage.js';

const browser=await chromium.launch({...(process.env.PIXFIT_BROWSER?{executablePath:process.env.PIXFIT_BROWSER}:{channel:'chrome'}),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',error=>errors.push(error.message));
const action=name=>page.locator(`[data-action="${name}"]`).first().click();
const paint=async(x,y)=>{
  const box=await page.locator('#art-canvas').boundingBox();
  await page.mouse.click(box.x+(x+.5)*box.width/4,box.y+(y+.5)*box.height/4);
};
const saved=async()=>{
  await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('All changes saved'));
  return parseWorkspace(await page.evaluate(()=>new Promise((resolve,reject)=>{
    const request=indexedDB.open('pixfit-studio',1);
    request.onsuccess=()=>{const db=request.result,get=db.transaction('workspace').objectStore('workspace').get('current');get.onsuccess=()=>{resolve(get.result);db.close();};get.onerror=()=>reject(get.error);};request.onerror=()=>reject(request.error);
  })));
};
try{
  await page.goto('http://127.0.0.1:5173');await page.locator('#art-canvas').waitFor();
  await page.click('.workspace-nav [data-action="tiles"]');await page.selectOption('#tile-mode','blob');
  await action('tiles-to-map');await page.fill('[name="width"]','4');await page.fill('[name="height"]','4');await page.click('#dialog button[type="submit"]');
  assert.equal(await page.locator('.terrain-brushes button').count(),3);
  await page.click('[data-action="map-tile"][data-index="3"]');await paint(1,1);await paint(2,1);
  let w=await saved(),m=w.tilemaps[0],t=w.tilesets.find(t=>t.id===m.tilesetId);
  assert.equal(t.masks[m.layers[0].cells[5]-1],2);assert.equal(t.masks[m.layers[0].cells[6]-1],8);
  await page.click('[data-action="map-tool"][data-tool="erase"]');await paint(2,1);
  w=await saved();m=w.tilemaps[0];assert.equal(t.masks[m.layers[0].cells[5]-1],0);assert.equal(m.layers[0].cells[6],0);
  await page.click('[data-action="map-tile"][data-index="1"]');await paint(0,0);
  w=await saved();assert.equal(w.tilemaps[0].layers[0].terrain[0],1);assert.ok(w.tilemaps[0].textures[0].pixels.length);
  await page.reload();await page.locator('.terrain-brushes').waitFor();
  const restored=await saved();assert.deepEqual(restored.tilemaps[0].layers,w.tilemaps[0].layers);assert.deepEqual(restored.tilemaps[0].textures,w.tilemaps[0].textures);
  await page.click('[data-action="map-tile"][data-index="3"]');await page.click('[data-action="map-tool"][data-tool="fill"]');await paint(3,3);
  w=await saved();assert.equal(w.tilemaps[0].layers[0].terrain[0],1);assert.equal(w.tilemaps[0].layers[0].terrain[15],3);
  assert.deepEqual(errors,[]);console.log('Terrain browser checks passed: palette, connected painting, erase, texture brush, reload, and fill.');
}finally{await browser.close();}
