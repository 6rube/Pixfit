import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanCategory, textureCategories, texturesInCategory } from '../src/categories.js';
import { createDemo } from '../src/demo.js';
import { parseWorkspace, serializeWorkspace } from '../src/storage.js';
test('texture categories trim names, list existing groups and include uncategorized textures',()=>{
  const textures=[{id:'a',category:'Forest'},{id:'b',category:'Water'},{id:'c',category:'Forest'},{id:'d'}];
  assert.equal(cleanCategory('  Dark   Forest  '),'Dark Forest');assert.equal(cleanCategory(null),'');assert.equal(cleanCategory('x'.repeat(100)).length,48);
  assert.deepEqual(textureCategories(textures),['Forest','Water']);assert.deepEqual(texturesInCategory(textures,'Forest').map(s=>s.id),['a','c']);assert.deepEqual(texturesInCategory(textures,'').map(s=>s.id),['d']);assert.equal(texturesInCategory(textures,'*'),textures);assert.deepEqual(texturesInCategory(textures,'Missing'),[]);
});
test('categories survive backup parsing and older uncategorized sprites stay unchanged',()=>{
  const w=createDemo();w.sprites[0].category='Forest';w.sprites[1].category='Water';const restored=parseWorkspace(JSON.parse(JSON.stringify(serializeWorkspace(w))));
  assert.equal(restored.sprites[0].category,'Forest');assert.equal(restored.sprites[1].category,'Water');assert.equal('category' in restored.sprites[2],false);
  assert.deepEqual(restored.sprites.map(s=>s.layers),w.sprites.map(s=>s.layers));
});
