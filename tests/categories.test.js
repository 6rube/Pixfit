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
test('shared category and library sort survive backups with safe defaults',()=>{
  const w=createDemo();w.sprites[0].category='Forest';
  for(const category of ['Forest','','*']){
    w.settings.textureCategory=category;w.settings.librarySort='recent';
    const restored=parseWorkspace(serializeWorkspace(w));
    assert.equal(restored.settings.textureCategory,category);assert.equal(restored.settings.librarySort,'recent');
  }
  w.settings.textureCategory='Missing';w.settings.librarySort='invalid';
  let restored=parseWorkspace(serializeWorkspace(w));assert.equal(restored.settings.textureCategory,'*');assert.equal(restored.settings.librarySort,'type');
  delete w.settings.textureCategory;delete w.settings.librarySort;
  restored=parseWorkspace(serializeWorkspace(w));assert.equal(restored.settings.textureCategory,'*');assert.equal(restored.settings.librarySort,'type');
});
test('empty tabs stay closed through backup restore without changing assets',()=>{
  const w=createDemo();w.session={tabs:[],activeTab:'',view:'library'};
  const restored=parseWorkspace(serializeWorkspace(w));
  assert.deepEqual(restored.session,w.session);assert.deepEqual(restored.sprites,w.sprites);
  const ids=w.sprites.map(s=>s.id).reverse();w.session={tabs:ids,activeTab:ids[1],view:'pixel'};
  assert.deepEqual(parseWorkspace(serializeWorkspace(w)).session,w.session);
});
