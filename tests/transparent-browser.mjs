// Start npm start, then run node tests/transparent-browser.mjs.
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
const browser=await chromium.launch({...process.env.PIXFIT_BROWSER?{executablePath:process.env.PIXFIT_BROWSER}:{channel:'chrome'},headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const point=async(x,y)=>{const b=await page.locator('#art-canvas').boundingBox();await page.mouse.move(b.x+(x+.5)*b.width/16,b.y+(y+.5)*b.height/16);};
const click=async(x,y,button='left')=>{await point(x,y);await page.mouse.down({button});await page.mouse.up({button});};
const pixels=()=>page.locator('#art-canvas').evaluate(c=>Array.from(c.getContext('2d').getImageData(0,0,16,16).data));
const alpha=(data,x,y)=>data[(y*16+x)*4+3];
const key=async k=>{await page.locator('#stage').focus();await page.keyboard.press(k);};
try{
  await page.goto('http://127.0.0.1:5173');await page.locator('.library-creation [data-action="new"]').click();
  await page.fill('[name="name"]','Transparent regression');await page.fill('[name="width"]','16');await page.fill('[name="height"]','16');await page.click('#dialog button[type="submit"]');
  assert.equal(await page.locator('[data-tool="eraser"]').count(),0);
  await page.click('[data-tool="bucket"]');await click(0,0);const filled=await pixels();
  await page.getByRole('button',{name:'Transparent',exact:true}).click();
  assert.equal(await page.inputValue('#hex-input'),'Transparent');
  await click(0,0);assert.ok((await pixels()).every(v=>v===0));
  await key('Control+z');assert.deepEqual(await pixels(),filled);
  await key('Control+Shift+z');assert.ok((await pixels()).every(v=>v===0));await key('Control+z');
  await key('m');await point(2,2);await page.mouse.down();await point(6,6);await page.mouse.up();
  await key('g');await click(3,3);const selected=await pixels();
  for(let y=0;y<16;y++)for(let x=0;x<16;x++)assert.equal(alpha(selected,x,y),x>=2&&x<6&&y>=2&&y<6?0:255);
  await key('Control+z');await key('Escape');await key('b');await click(8,8);assert.equal(alpha(await pixels(),8,8),0);
  await key('l');await point(0,10);await page.mouse.down();await point(15,10);await page.mouse.up();
  const line=await pixels();for(let x=0;x<16;x++)assert.equal(alpha(line,x,10),0);
  await key('x');await key('b');await click(9,9,'right');assert.equal(alpha(await pixels(),9,9),0);
  await key('x');await page.selectOption('#palette-select','custom');
  assert.equal(await page.getByRole('button',{name:'Transparent',exact:true}).getAttribute('aria-pressed'),'true');
  await page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('All changes saved'));
  await page.reload();await page.locator('.library-open').filter({hasText:'Transparent regression'}).click();
  assert.equal(await page.inputValue('#hex-input'),'Transparent');
  await page.fill('#hex-input','#ff0000');await page.locator('#hex-input').dispatchEvent('change');
  assert.equal(await page.inputValue('#color-input'),'#ff0000');
  await key('i');await click(0,10);assert.equal(await page.inputValue('#hex-input'),'Transparent');
  assert.deepEqual(errors,[]);console.log('Transparent passed: fill, selection, pencil, line, right-click, swap, picker, palettes, undo/redo and persistence.');
}finally{await browser.close();}
