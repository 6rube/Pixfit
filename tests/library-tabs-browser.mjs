import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { createDemo } from '../src/demo.js';
import { buildTileset } from '../src/tiles.js';
import { makeTilemap } from '../src/tilemap.js';
import { serializeWorkspace } from '../src/storage.js';

const fixture=createDemo();
fixture.sprites[0].category='Forest';fixture.sprites[1].category='Forest';fixture.sprites[2].category='Water';
const terrain={...buildTileset(fixture.sprites[1],fixture.sprites[2],fixture.settings.tile),id:'test-terrain',kind:'tileset',name:'Forest terrain'};
fixture.tilesets=[terrain];fixture.tilemaps=[makeTilemap('Forest map',8,8,terrain)];
fixture.collections=[{id:'test-collection',name:'Forest collection',terrainIds:[terrain.id]}];
fixture.session={tabs:[fixture.sprites[0].id,terrain.id,fixture.tilemaps[0].id],activeTab:terrain.id,view:'library'};
const browser=await chromium.launch({...(process.env.PIXFIT_BROWSER?{executablePath:process.env.PIXFIT_BROWSER}:{channel:'chrome'}),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const action=name=>page.locator(`[data-action="${name}"]`).first().click();
const tabIds=()=>page.locator('.document-tab').evaluateAll(nodes=>nodes.map(n=>n.dataset.tabId));
const saved=async()=>{
  await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('All changes saved'));
  return page.evaluate(()=>new Promise(resolve=>{const request=indexedDB.open('pixfit-studio',1);request.onsuccess=()=>{const db=request.result,get=db.transaction('workspace').objectStore('workspace').get('current');get.onsuccess=()=>{resolve(get.result);db.close();};};}));
};
try{
  await mkdir('.screenshots',{recursive:true});
  await page.addInitScript(data=>{if(!sessionStorage.getItem('library-fixture')){localStorage.setItem('pixfit-workspace',JSON.stringify(data));sessionStorage.setItem('library-fixture','1');}},serializeWorkspace(fixture));
  await page.goto('http://127.0.0.1:5173');await page.locator('.library-page').waitFor();
  assert.deepEqual(await tabIds(),fixture.session.tabs);
  assert.equal(await page.locator('.document-tabs > :first-child').getAttribute('data-action'),'close-all-tabs');
  assert.equal(await page.locator('.document-tab.active').count(),0);
  assert.equal(await page.locator('.library-open-badge').count(),3);
  const bounds=await page.locator('#library-results, .tileset-collections').evaluateAll(nodes=>nodes.map(n=>({x:n.getBoundingClientRect().x,width:n.getBoundingClientRect().width})));
  assert.deepEqual(bounds[0],bounds[1]);
  await page.selectOption('#library-category','Forest');
  assert.equal(await page.locator('.library-card').count(),4,'category filters textures while other document types remain reachable');
  await page.getByRole('tab',{name:'Forest terrain',exact:true}).click();assert.equal(await page.inputValue('#terrain-category'),'Forest');
  await page.selectOption('#terrain-category','Water');await page.getByRole('tab',{name:'Forest map',exact:true}).click();assert.equal(await page.inputValue('#map-category'),'Water');
  await page.selectOption('#map-category','Water');
  const canvas=await page.locator('#art-canvas').boundingBox(),point={x:canvas.x+canvas.width/16,y:canvas.y+canvas.height/16};
  await page.mouse.click(point.x,point.y);await page.selectOption('#map-category','Forest');
  await page.keyboard.down('Control');await page.mouse.click(point.x,point.y);await page.keyboard.up('Control');
  assert.equal(await page.inputValue('#map-category'),'Forest','picking a painted source must preserve the preferred category');
  assert.equal(await page.inputValue('#map-texture'),fixture.sprites[2].id,'the picked texture remains usable outside the filter');
  assert.equal((await saved()).settings.textureCategory,'Forest');
  await page.getByRole('tab',{name:'A little place',exact:true}).click();assert.equal(await page.inputValue('#sprite-category'),'Forest');
  await page.selectOption('#sprite-category','');await action('library');assert.equal(await page.inputValue('#library-category'),'');
  await saved();await page.reload();assert.equal(await page.inputValue('#library-category'),'');
  await page.selectOption('#library-category','*');

  // Reordering works in the library, preserves the active document, and persists.
  const first=fixture.session.tabs[0],last=fixture.session.tabs[2];
  await page.locator(`[data-tab-id="${last}"]`).dragTo(page.locator(`[data-tab-id="${first}"]`),{targetPosition:{x:3,y:14}});
  assert.deepEqual(await tabIds(),[last,first,terrain.id]);
  await page.getByRole('tab',{name:'Forest map',exact:true}).focus();await page.keyboard.press('Alt+ArrowRight');
  assert.deepEqual(await tabIds(),[first,last,terrain.id]);
  await saved();await page.reload();assert.deepEqual(await tabIds(),[first,last,terrain.id]);
  await page.getByRole('tab',{name:'Forest map',exact:true}).click();await page.getByRole('tab',{name:'Forest map',exact:true}).focus();await page.keyboard.press('Alt+ArrowRight');
  assert.deepEqual(await tabIds(),[first,terrain.id,last]);assert.equal(await page.locator('.document-tab.active').getAttribute('data-tab-id'),last);
  await action('library');

  const rename='A renamed <forest> & image';
  await page.locator(`.library-card:has([data-action="open-tab"][data-id="${first}"]) [data-action="rename-asset"]`).click();
  await page.fill('[name="name"]',rename);await page.click('#dialog button[type="submit"]');
  assert.equal(await page.getByRole('tab',{name:rename,exact:true}).count(),1);
  assert.equal(await page.locator(`.library-open[data-id="${first}"] strong`).innerText(),rename);
  await page.selectOption('#library-sort','name');const names=await page.locator('.library-open strong').allTextContents();assert.deepEqual(names,[...names].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:'base'})));
  await page.selectOption('#library-sort','recent');assert.equal(await page.locator('.library-open strong').first().innerText(),rename);
  await saved();await page.reload();assert.equal(await page.inputValue('#library-sort'),'recent');assert.equal(await page.getByRole('tab',{name:rename,exact:true}).count(),1);
  await page.fill('#library-search','renamed');assert.equal(await page.locator('.library-card').count(),1);await page.fill('#library-search','');
  await page.selectOption('#library-sort','type');
  await page.emulateMedia({colorScheme:'dark'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='dark');await page.screenshot({path:'.screenshots/library-tabs-dark.png',fullPage:true});
  await page.emulateMedia({colorScheme:'light'});await page.waitForFunction(()=>document.documentElement.dataset.theme==='light');await page.screenshot({path:'.screenshots/library-tabs-light.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.screenshot({path:'.screenshots/library-tabs-mobile.png',fullPage:true});
  await page.setViewportSize({width:1440,height:1000});

  // Closing the remembered active tab in the library must keep the library open.
  await page.locator(`[data-action="close-tab"][data-id="${last}"]`).click();assert.equal(await page.locator('.library-page').isVisible(),true);
  await page.getByRole('tab',{name:rename,exact:true}).click();
  const before=await saved();await action('close-all-tabs');
  assert.equal(await page.locator('.library-page').isVisible(),true);assert.equal(await page.locator('.document-tab').count(),0);assert.equal(await page.locator('.library-open-badge').count(),0);
  const after=await saved();assert.deepEqual(after.sprites,before.sprites);assert.deepEqual(after.tilesets,before.tilesets);assert.deepEqual(after.tilemaps,before.tilemaps);assert.deepEqual(after.session,{tabs:[],activeTab:'',view:'library'});
  await page.reload();assert.equal(await page.locator('.document-tab').count(),0);assert.equal(await page.locator('[data-action="close-all-tabs"]').isDisabled(),true);
  await page.locator(`.library-open[data-id="${first}"]`).click();assert.equal(await page.locator('.document-tab').count(),1);
  await page.locator('[data-action="close-tab"]').click();assert.equal(await page.locator('.library-page').isVisible(),true);assert.equal(await page.locator('.document-tab').count(),0);
  assert.deepEqual(errors,[]);console.log('Library and tabs checks passed: shared/persisted category, sorting, rename, drag and keyboard reorder, close all, asset preservation, themes and mobile layout.');
}catch(error){await page.screenshot({path:'.screenshots/library-tabs-failure.png',fullPage:true});console.error(errors);throw error;}
finally{await browser.close();}
