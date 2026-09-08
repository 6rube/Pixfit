// Start npm start, then run node tests/line-browser.mjs.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({...process.env.PIXFIT_BROWSER?{executablePath:process.env.PIXFIT_BROWSER}:{channel:'chrome'},headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const point=async(x,y)=>{
  const box=await page.locator('#art-canvas').boundingBox();
  await page.mouse.move(box.x+(x+.5)*box.width/32,box.y+(y+.5)*box.height/32);
};
const pixels=()=>page.locator('#art-canvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,32,32).data));
const alpha=(data,x,y)=>data[(y*32+x)*4+3];
const shortcut=async key=>{await page.locator('#stage').focus();await page.keyboard.press(key);};
try{
  await page.goto('http://127.0.0.1:5173');
  await page.locator('.library-creation [data-action="new"]').click();
  await page.fill('[name="name"]','Line regression');
  await page.fill('[name="width"]','32');await page.fill('[name="height"]','32');
  await page.click('#dialog button[type="submit"]');
  await page.fill('#hex-input','#ff0000');await page.locator('#hex-input').dispatchEvent('change');
  await shortcut('l');assert.equal(await page.locator('[data-tool="line"]').getAttribute('aria-pressed'),'true');
  await point(2,2);await page.mouse.down();await point(12,2);
  assert.equal(alpha(await pixels(),12,2),255);
  await point(2,12);assert.equal(alpha(await pixels(),12,2),0);
  await page.mouse.up();const vertical=await pixels();
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)assert.equal(alpha(vertical,x,y),x===2&&y>=2&&y<=12?255:0);
  await shortcut('Control+z');assert.ok((await pixels()).every(v=>v===0));
  await shortcut('Control+Shift+z');assert.deepEqual(await pixels(),vertical);
  await shortcut('Control+z');
  await point(12,12);await page.mouse.down();await point(3,3);await page.mouse.up();
  const diagonal=await pixels();
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)assert.equal(alpha(diagonal,x,y),x===y&&x>=3&&x<=12?255:0);
  await shortcut('Control+z');
  await page.click('[data-tool="rect"]');await point(4,4);await page.mouse.down();await point(8,8);await page.mouse.up();
  await shortcut('l');await point(0,6);await page.mouse.down();await point(20,6);await page.mouse.up();
  const selected=await pixels();
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)assert.equal(alpha(selected,x,y),y===6&&x>=4&&x<8?255:0);
  await shortcut('Control+z');await shortcut('Escape');await shortcut(']');
  await point(10,10);await page.mouse.down();await point(15,10);await page.mouse.up();
  const thick=await pixels();assert.equal(alpha(thick,12,9),255);assert.equal(alpha(thick,12,10),255);assert.equal(alpha(thick,12,11),0);
  await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('All changes saved'));
  await page.reload();await page.locator('.library-open').filter({hasText:'Line regression'}).click();
  assert.deepEqual(await pixels(),thick);
  assert.deepEqual(errors,[]);
  console.log('Line tool passed: shortcut, preview replacement, endpoints, reverse diagonal, selection, thickness, undo/redo and persistence.');
}finally{await browser.close();}
