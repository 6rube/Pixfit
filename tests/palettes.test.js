import test from 'node:test';
import assert from 'node:assert/strict';
import { importPalette, exportPalette } from '../src/palettes.js';
import { serializeWorkspace, parseWorkspace } from '../src/storage.js';
import { createDemo } from '../src/demo.js';

test('palette exchange preserves names and colors with fresh IDs',()=>{
  const data=exportPalette({name:'Sunset',colors:['#FF0000','#ab12ef']});
  const first=importPalette(JSON.parse(JSON.stringify(data))),second=importPalette(data);
  assert.equal(first.name,'Sunset');assert.deepEqual(first.colors,['#ff0000','#ab12ef']);assert.notEqual(first.id,second.id);
  assert.throws(()=>importPalette({...data,colors:['red']}));
  assert.throws(()=>importPalette({...data,version:2}));
  assert.throws(()=>exportPalette({name:'Huge',colors:Array(129).fill('#123456')}));
});
test('named palettes and the selected palette survive backups alongside legacy custom colors',()=>{
  const w=createDemo();w.palettes.custom=['#abcdef'];
  w.palettes.saved=[importPalette({format:'pixfit-palette',version:1,name:'One',colors:['#123456']}),importPalette({format:'pixfit-palette',version:1,name:'Two',colors:[]})];
  w.settings.palette=w.palettes.saved[1].id;
  const restored=parseWorkspace(JSON.parse(JSON.stringify(serializeWorkspace(w))));
  assert.deepEqual(restored.palettes,w.palettes);assert.equal(restored.settings.palette,w.settings.palette);
  const legacy=serializeWorkspace(createDemo());assert.deepEqual(parseWorkspace(legacy).palettes.saved,[]);
  const invalid=serializeWorkspace(w);invalid.palettes={...w.palettes,saved:[w.palettes.saved[0],w.palettes.saved[0]]};assert.throws(()=>parseWorkspace(invalid));
});
