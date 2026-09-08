import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createDemo } from '../src/demo.js';
import { buildTileset } from '../src/tiles.js';
import { makeTilemap, paintMapBrush, resolveMapTerrain } from '../src/tilemap.js';
import { serializeWorkspace, parseWorkspace } from '../src/storage.js';
const w=createDemo();w.sprites[0].category='Forest';w.sprites[1].category='Water';w.sprites[3].category='Forest';
const t={...buildTileset(w.sprites[0],w.sprites[1],{size:16,columns:8,mode:'blob',terrainA:w.sprites[0].id,terrainB:w.sprites[1].id}),id:'category-terrain',kind:'tileset',name:'Category terrain',animations:{0:{frames:[0,1],fps:12}}};
w.tilesets=[t];const m=makeTilemap('Performance map',32,32,t);w.tilemaps=[m];paintMapBrush(m,m.layers[0],0,0,{source:0,kind:'tile',value:15},'fill');resolveMapTerrain(m,m.layers[0],w);
const browser=await chromium.launch({...(process.env.PIXFIT_BROWSER?{executablePath:process.env.PIXFIT_BROWSER}:{channel:'chrome'}),headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const action=name=>page.locator(`[data-action="${name}"]`).first().click();
const saved=async()=>{await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('All changes saved'));return parseWorkspace(await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('pixfit-studio',1);r.onsuccess=()=>{const db=r.result,g=db.transaction('workspace').objectStore('workspace').get('current');g.onsuccess=()=>{resolve(g.result);db.close();};};})));};
const pixelCheck=async()=>{
  await saved();assert.equal(await page.evaluate(async()=>{
    const {parseWorkspace}=await import('/src/storage.js'),{renderTilemap}=await import('/src/tilemap.js'),{imageBytes}=await import('/src/core.js');
    const data=await new Promise(resolve=>{const r=indexedDB.open('pixfit-studio',1);r.onsuccess=()=>{const db=r.result,g=db.transaction('workspace').objectStore('workspace').get('current');g.onsuccess=()=>{resolve(g.result);db.close();};};});
    const w=parseWorkspace(data),map=w.tilemaps[0],expected=imageBytes(renderTilemap(map,w,0).pixels),canvas=document.querySelector('#art-canvas'),actual=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    return actual.every((v,i)=>v===expected[i]);
  }),true,'incremental canvas must equal a full render');
};
try{
  await page.addInitScript(data=>{if(!sessionStorage.getItem('category-fixture')){localStorage.setItem('pixfit-workspace',JSON.stringify(data));sessionStorage.setItem('category-fixture','1');}},serializeWorkspace(w));
  await page.goto('http://127.0.0.1:5173');await page.click(`[data-action="texture-category"][data-id="${w.sprites[2].id}"]`);await page.fill('[name="category"]','Forest');await page.click('#dialog button[type="submit"]');assert.equal((await saved()).sprites[2].category,'Forest');
  await page.selectOption('#library-category','Forest');assert.equal(await page.locator('.library-card').count(),3);await page.selectOption('#library-category','*');
  await page.locator('.library-open').filter({hasText:'Category terrain'}).click();await page.selectOption('#terrain-category','Water');assert.equal(await page.locator('#terrainA').inputValue(),w.sprites[0].id);assert.equal(await page.locator('#terrainB').inputValue(),w.sprites[1].id);assert.equal(await page.locator('#terrainA option').count(),2);
  await page.selectOption('#tile-border-type','texture');assert.equal(await page.locator('#tile-border-texture option').count(),2);await saved();
  await action('library');await page.locator('.library-open').filter({hasText:'Performance map'}).click();await action('play-animation');
  await page.selectOption('#map-category','Water');assert.equal(await page.locator('#map-texture option').count(),1);assert.equal(await page.locator('#map-texture').inputValue(),w.sprites[1].id);
  await page.selectOption('#map-category','');assert.equal(await page.locator('[data-texture-tile]').count(),0);const box=await page.locator('#art-canvas').boundingBox();await page.mouse.click(box.x+20,box.y+20);assert.deepEqual((await saved()).tilemaps[0].layers[0].cells,m.layers[0].cells);
  await page.selectOption('#map-category','Forest');assert.equal(await page.locator('#map-texture option').count(),3);await page.selectOption('#map-texture',w.sprites[0].id);await page.click('[data-action="texture-tile"][data-index="3"]');
  await page.evaluate(()=>{window.mapWrites=[];const original=CanvasRenderingContext2D.prototype.putImageData;CanvasRenderingContext2D.prototype.putImageData=function(image,...args){if(this.canvas.id==='art-canvas')window.mapWrites.push({width:image.width,height:image.height});return original.call(this,image,...args);};});
  const x=box.x+box.width*8.2/32,y=box.y+box.height*8.2/32;
  await page.mouse.move(x,y);await page.mouse.down();for(let i=0;i<20;i++)await page.mouse.move(x+box.width/32*(i/40),y);await page.mouse.up();
  const writes=await page.evaluate(()=>window.mapWrites);assert.equal(writes.length,1,'moves within a cell should not repaint');assert.ok(writes[0].width<=48&&writes[0].height<=48);await pixelCheck();
  await page.click('[data-action="map-tool"][data-tool="rect"]');await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x+box.width*5/32,y+box.height*3/32);await page.mouse.move(x+box.width*2/32,y+box.height/32);await page.mouse.up();await pixelCheck();
  await action('undo');await pixelCheck();await action('redo');await pixelCheck();
  await page.selectOption('#map-category','*');await page.selectOption('#map-tileset',t.id);await page.click('[data-action="map-tile"][data-index="100"]');await page.click('[data-action="map-tool"][data-tool="paint"]');await page.mouse.click(x+box.width*8/32,y);await action('play-animation');await page.evaluate(()=>window.mapWrites=[]);await page.waitForTimeout(250);const animatedWrites=await page.evaluate(()=>window.mapWrites);assert.ok(animatedWrites.length>0);assert.ok(animatedWrites.every(r=>r.width===16&&r.height===16),'placed animation should redraw only its tile');await action('play-animation');await pixelCheck();await page.click('[data-action="map-tile"][data-index="3"]');await page.click('[data-action="map-tool"][data-tool="paint"]');await page.mouse.click(x+box.width*8/32,y);await pixelCheck();
  await page.reload();await page.locator('.library-page').waitFor();assert.equal((await saved()).sprites[2].category,'Forest');await page.locator('.library-open').filter({hasText:'Performance map'}).click();await page.selectOption('#map-category','Forest');
  await page.screenshot({path:'.screenshots/texture-categories.png',fullPage:true});assert.deepEqual(errors,[]);console.log('Categories/performance browser checks passed: assignment, filters, empty categories, reload, one-cell update count, partial raster size, rectangles, mixed terrain, and exact pixels after undo/redo.');
}finally{await browser.close();}
