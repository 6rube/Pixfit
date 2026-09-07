import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const browser=await chromium.launch({...(process.env.PIXFIT_BROWSER?{executablePath:process.env.PIXFIT_BROWSER}:{channel:'chrome'}),headless:true});
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));
const action=name=>page.locator(`[data-action="${name}"]`).first().click();
const submit=()=>page.click('#dialog button[type="submit"]');
const save=()=>page.waitForFunction(()=>document.querySelector('#save-status')?.textContent.includes('All changes saved'));
try{
  await page.goto('http://127.0.0.1:5173');await page.locator('.library-page').waitFor();await page.locator('.library-open').first().click();await page.locator('#art-canvas').waitFor();
  assert.equal(await page.locator('.workspace-nav').count(),0);
  assert.equal(await page.locator('.header-actions [data-action="library"]').count(),1);
  assert.equal(await page.locator('.header-actions [data-action="export"]').count(),1);
  await action('new-palette');await page.fill('#dialog [name="name"]','Sunset');await action('palette-add-color');await page.fill('[name="palette-color"]','#ff8800');await submit();
  const first=await page.inputValue('#palette-select');assert.equal(await page.locator('.palette-grid .swatch').count(),1);
  await action('duplicate-palette');await page.fill('#dialog [name="name"]','Dawn');await action('palette-add-color');await page.locator('[name="palette-color"]').nth(1).fill('#aabbcc');await submit();
  const second=await page.inputValue('#palette-select');assert.notEqual(first,second);
  await action('edit-palette');await page.fill('#dialog [name="name"]','Dawn revised');await page.locator('[data-action="palette-remove-color"]').first().click();await submit();
  assert.equal(await page.locator('.palette-grid [data-color="#aabbcc"]').count(),1);
  const [download]=await Promise.all([page.waitForEvent('download'),action('export-palette')]);
  const stream=await download.createReadStream(),chunks=[];for await(const chunk of stream)chunks.push(chunk);const payload=Buffer.concat(chunks);
  const data=JSON.parse(payload);assert.equal(data.name,'Dawn revised');assert.deepEqual(data.colors,['#aabbcc']);
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),action('import-palette')]);await chooser.setFiles({name:'dawn.palette.json',mimeType:'application/json',buffer:payload});
  await page.waitForFunction(old=>document.querySelector('#palette-select').value!==old,second);const imported=await page.inputValue('#palette-select');
  await save();await page.reload();await page.locator('.library-page').waitFor();await page.locator('.library-open').first().click();await page.locator('#palette-select').waitFor();assert.equal(await page.inputValue('#palette-select'),imported);
  await page.selectOption('#palette-select',first);assert.equal(await page.locator('.palette-grid [data-color="#ff8800"]').count(),1);
  await page.selectOption('#palette-select',imported);await action('delete-palette');await submit();assert.equal(await page.locator(`#palette-select option[value="${imported}"]`).count(),0);
  await page.click('.header-actions [data-action="library"]');await page.locator('.library-page').waitFor();await page.locator('.library-open').first().click();await page.locator('#palette-select').waitFor();
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await action('edit-palette');assert.equal(await page.locator('#dialog').isVisible(),true);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.deepEqual(errors,[]);console.log('Palette browser checks passed: header, create, duplicate, edit, JSON export/import, persistence, delete, library navigation, and mobile layout.');
}finally{await browser.close();}
