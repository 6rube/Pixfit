// Start npm start, then run node tests/selection-transforms-browser.mjs.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({...process.env.PIXFIT_BROWSER?{executablePath:process.env.PIXFIT_BROWSER}:{channel:'chrome'},headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const action=name=>page.locator(`[data-action="${name}"]`).first().click();
const point=async(x,y)=>{const b=await page.locator('#art-canvas').boundingBox();await page.mouse.move(b.x+(x+.5)*b.width/16,b.y+(y+.5)*b.height/16);};
const pixels=()=>page.locator('#art-canvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,16,16).data));
const color=(data,x,y)=>data.slice((y*16+x)*4,(y*16+x)*4+4);
const select=async()=>{await page.click('[data-tool="rect"]');await point(2,2);await page.mouse.down();await point(4,5);await page.mouse.up();};
const shortcut=async key=>{await page.locator('#stage').focus();await page.keyboard.press(key);};
try{
  await page.goto('http://127.0.0.1:5173');await page.locator('.library-creation [data-action="new"]').click();
  await page.fill('[name="name"]','Transform regression');await page.fill('[name="width"]','16');await page.fill('[name="height"]','16');await page.click('#dialog button[type="submit"]');
  assert.equal(await page.locator('[data-action="rotate-selection-right"]').isDisabled(),true);
  await page.fill('#hex-input','#ff0000');await page.locator('#hex-input').dispatchEvent('change');await point(2,2);await page.mouse.click(...await page.locator('#art-canvas').evaluate(c=>{const b=c.getBoundingClientRect();return [b.x+2.5*b.width/16,b.y+2.5*b.height/16];}));
  await page.fill('#hex-input','#0000ff');await page.locator('#hex-input').dispatchEvent('change');await point(3,4);await page.mouse.down();await page.mouse.up();
  const original=await pixels();await select();
  assert.equal(await page.locator('[data-action="rotate-selection-right"]').isEnabled(),true);
  await action('rotate-selection-right');const rotated=await pixels();
  assert.deepEqual(color(rotated,4,2),[255,0,0,255]);assert.deepEqual(color(rotated,2,3),[0,0,255,255]);
  assert.match(await page.locator('#selection-status').innerText(),/6 px selected/);
  await action('rotate-selection-left');assert.deepEqual(await pixels(),original);
  await action('flip-selection-x');assert.deepEqual(color(await pixels(),3,2),[255,0,0,255]);
  await action('flip-selection-x');assert.deepEqual(await pixels(),original);
  await action('flip-selection-y');assert.deepEqual(color(await pixels(),2,4),[255,0,0,255]);
  await shortcut('Control+z');assert.deepEqual(await pixels(),original);
  await shortcut('Control+Shift+z');assert.deepEqual(color(await pixels(),2,4),[255,0,0,255]);
  await select();await page.locator('.layer-row.active [data-action="toggle-layer"]').click();
  assert.equal(await page.locator('[data-action="flip-selection-x"]').isDisabled(),true);
  await page.locator('.layer-row.active [data-action="toggle-layer"]').click();
  assert.equal(await page.locator('[data-action="flip-selection-x"]').isEnabled(),true);
  await shortcut('Escape');assert.equal(await page.locator('[data-action="flip-selection-x"]').isDisabled(),true);
  assert.deepEqual(errors,[]);console.log('Selection transform browser checks passed: controls, both rotations and flips, mask size, undo/redo, hidden layers and deselection.');
}finally{await browser.close();}
