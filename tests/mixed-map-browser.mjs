import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createDemo } from '../src/demo.js';
import { buildTileset } from '../src/tiles.js';
import { makeTilemap } from '../src/tilemap.js';
import { serializeWorkspace, parseWorkspace } from '../src/storage.js';

const w=createDemo();
const a={...buildTileset(w.sprites[0],w.sprites[1],{size:16,columns:8,mode:'blob',terrainA:w.sprites[0].id,terrainB:w.sprites[1].id}),id:'first-atlas',kind:'tileset',name:'First set'};
const b={...buildTileset(w.sprites[1],w.sprites[0],{size:8,columns:8}),id:'imported-atlas',kind:'tileset',name:'Imported set',imported:true};
w.tilesets=[a,b];w.tilemaps=[makeTilemap('Mixed world',4,4,a)];
const browser=await chromium.launch({...(process.env.PIXFIT_BROWSER?{executablePath:process.env.PIXFIT_BROWSER}:{channel:'chrome'}),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const click=action=>page.locator(`[data-action="${action}"]`).first().click();
const paint=async(x,y,button='left')=>{const box=await page.locator('#art-canvas').boundingBox();await page.mouse.click(box.x+(x+.5)*box.width/4,box.y+(y+.5)*box.height/4,{button});};
const saved=async()=>{
  await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('All changes saved'));
  return parseWorkspace(await page.evaluate(()=>new Promise(resolve=>{const r=indexedDB.open('pixfit-studio',1);r.onsuccess=()=>{const db=r.result,g=db.transaction('workspace').objectStore('workspace').get('current');g.onsuccess=()=>{resolve(g.result);db.close();};};})));
};
try{
  await page.addInitScript(data=>{if(!sessionStorage.getItem('fixture')){localStorage.setItem('pixfit-workspace',JSON.stringify(data));sessionStorage.setItem('fixture','1');}},serializeWorkspace(w));
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.library-open').filter({hasText:'Mixed world'}).click();
  await page.click('[data-action="map-tile"][data-index="115"]');await paint(0,0);
  await page.selectOption('#map-tileset',b.id);assert.equal(await page.locator('[data-map-brush]').count(),16);
  await page.click('[data-action="map-tile"][data-index="100"]');await paint(1,0);
  await page.selectOption('#map-tileset','textures');assert.equal(await page.locator('[data-map-brush]').count(),w.sprites.length);
  await page.click(`[data-action="map-tile"][data-index="${w.sprites[0].id}"]`);await paint(2,0);
  let m=(await saved()).tilemaps[0];assert.equal(m.cellWidth,16);assert.deepEqual(Array.from(m.layers[0].cells.slice(0,3)),[16,1,0]);assert.deepEqual(Array.from(m.layers[0].sources.slice(0,3)),[0,1,2]);
  await click('undo');m=(await saved()).tilemaps[0];assert.equal(m.layers[0].terrain[2],0);
  await click('redo');m=(await saved()).tilemaps[0];assert.equal(m.layers[0].terrain[2],6);
  await page.click('[data-action="map-tool"][data-tool="picker"]');await paint(1,0);assert.equal(await page.locator('#map-tileset').inputValue(),b.id);
  assert.equal(await page.locator('[data-action="map-tile"][aria-pressed="true"]').getAttribute('data-index'),'100');
  await paint(1,0,'right');m=(await saved()).tilemaps[0];assert.equal(m.layers[0].cells[1],0);await click('undo');
  await page.selectOption('#map-tileset','textures');await page.click(`[data-action="map-tile"][data-index="${w.sprites[0].id}"]`);
  await page.click('[data-action="map-tool"][data-tool="rect"]');
  const box=await page.locator('#art-canvas').boundingBox();await page.mouse.move(box.x+box.width/8,box.y+box.height*5/8);await page.mouse.down();await page.mouse.move(box.x+box.width*3/8,box.y+box.height*7/8,{steps:4});await page.mouse.up();
  m=(await saved()).tilemaps[0];for(const i of [8,9,12,13])assert.equal(m.layers[0].terrain[i],6);
  await page.reload();await page.locator('.library-open').filter({hasText:'Mixed world'}).click();assert.deepEqual((await saved()).tilemaps[0].layers,m.layers);
  await click('export');await page.selectOption('[name="format"]','map');
  const downloadPromise=page.waitForEvent('download');await page.click('#dialog button[type="submit"]');const download=await downloadPromise;
  const zip=await readFile(await download.path());const files=new Map();
  for(let offset=0;zip.readUInt32LE(offset)===0x04034b50;){const size=zip.readUInt32LE(offset+18),length=zip.readUInt16LE(offset+26),extra=zip.readUInt16LE(offset+28),start=offset+30+length+extra;files.set(zip.subarray(offset+30,offset+30+length).toString(),zip.subarray(start,start+size));offset=start+size;}
  const json=JSON.parse(files.get('map.json'));assert.equal(json.version,3);assert.equal(json.assets.length,3);assert.equal(json.layers[0].sources[2],2);for(const asset of json.assets)assert.ok(files.has(asset.image));
  await page.keyboard.press('Escape');await page.selectOption('#map-tileset',b.id);await page.screenshot({path:'.screenshots/mixed-map.png',fullPage:true});
  assert.deepEqual(errors,[]);console.log('Mixed map browser checks passed: imported tiles, textures, fixed grid, undo/redo, picker, erase, rectangle, reload, and complete source export.');
}finally{await browser.close();}
