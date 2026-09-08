import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSprite, hexToColor } from '../src/core.js';
import { buildTileset } from '../src/tiles.js';
import { textureTiles, textureTile, makeTilemap, paintMapBrush, renderTilemap, resizeTilemap, resolveMapTerrain } from '../src/tilemap.js';
import { createDemo } from '../src/demo.js';
import { serializeWorkspace, parseWorkspace } from '../src/storage.js';
import { godotCollectionPackage } from '../src/godot.js';
const colors=['#ff0000','#00ff00','#0000ff','#ffff00'].map(hexToColor);
function fixture(){
  const w=createDemo(),s=makeSprite('Four tiles',32,32);
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)s.layers[0].pixels[y*32+x]=colors[Math.floor(y/16)*2+Math.floor(x/16)];
  w.sprites.push(s);const m=makeTilemap('Patterns',6,4);w.tilemaps=[m];m.sources=[{kind:'texture',assetId:s.id}];
  const pattern={id:'pattern',name:'Four tiles',width:2,height:2,tiles:[0,1,2,3].map(value=>({kind:'texture-tile',assetId:s.id,value}))};
  m.patterns=[pattern];return {w,s,m,l:m.layers[0],pattern,brush:{...pattern,kind:'pattern',tiles:pattern.tiles.map(t=>({...t,source:1}))}};
}
test('texture grid crops the selected tile independently of destination and pads edge cells',()=>{
  const {w,s,m,l}=fixture();
  assert.equal(textureTiles(s,16,16).length,4);
  paintMapBrush(m,l,0,0,{kind:'texture-tile',source:1,value:3});paintMapBrush(m,l,3,1,{kind:'texture-tile',source:1,value:3});
  const frame=renderTilemap(m,w);assert.equal(frame.pixels[0],colors[3]);assert.equal(frame.pixels[16*frame.width+48],colors[3]);
  const edge=makeSprite('Partial tile',17,18);edge.layers[0].pixels.fill(colors[0]);
  const tile=textureTile(edge,16,16,3);assert.equal(tile.pixels[0],colors[0]);assert.equal(tile.pixels[16],colors[0]);assert.equal(tile.pixels.filter(Boolean).length,2);
});
test('patterns stamp, clip, repeat in fills and rectangles, and survive saves and resize',()=>{
  const {w,m,l,brush}=fixture();paintMapBrush(m,l,1,1,brush);
  assert.deepEqual([7,8,13,14].map(i=>l.cells[i]),[1,2,3,4]);assert.equal(l.cells.filter(Boolean).length,4);
  paintMapBrush(m,l,5,3,brush);assert.equal(l.cells[23],1);
  const restored=parseWorkspace(JSON.parse(JSON.stringify(serializeWorkspace(w))));
  assert.deepEqual(restored.tilemaps[0],m);assert.deepEqual(renderTilemap(m,w),renderTilemap(restored.tilemaps[0],restored));
  assert.equal(resizeTilemap(m,8,5).layers[0].cells[2*8+2],4);
  l.cells.fill(0);l.terrain.fill(0);l.sources.fill(0);paintMapBrush(m,l,1,1,brush,'fill');
  assert.deepEqual(Array.from(l.cells.slice(0,6)),[4,3,4,3,4,3]);
  assert.deepEqual(Array.from(l.cells.slice(6,12)),[2,1,2,1,2,1]);
  const rect={...brush,origin:{x:3,y:2}};
  for(let y=1;y<=2;y++)for(let x=1;x<=3;x++)paintMapBrush(m,l,x,y,rect,'rect');
  assert.deepEqual([7,8,9,13,14,15].map(i=>l.cells[i]),[3,4,3,1,2,1]);
  paintMapBrush(m,l,1,1,brush,'erase');assert.equal(l.cells[7],0);assert.equal(l.cells[8],4);
});
test('texture tiles form distinct fill regions and cannot be overwritten by terrain fringes',()=>{
  const {w,m,l,brush}=fixture();const t={...buildTileset(w.sprites[0],w.sprites[1],{size:16,columns:8}),id:'corners',kind:'tileset'};w.tilesets=[t];m.sources.push({kind:'tileset',assetId:t.id});
  paintMapBrush(m,l,0,0,brush);paintMapBrush(m,l,0,0,{kind:'texture-tile',source:1,value:3},'fill');assert.equal(l.cells[0],4);assert.equal(l.cells[1],2);
  paintMapBrush(m,l,2,2,{kind:'terrain',source:2,value:3});resolveMapTerrain(m,l,w);assert.equal(l.cells[7],4);assert.equal(l.terrain[7],7);
  const invalid=serializeWorkspace(w);invalid.tilemaps[0].patterns[0].tiles[0].value=4;assert.throws(()=>parseWorkspace(invalid),/pattern tile/);
});
test('Godot collections share material identities, separate modes, and remap animation sources',async()=>{
  const w=createDemo(),[a,b,c]=w.sprites;
  const terrain=(id,inner,outer,mode='wang')=>({...buildTileset(inner,outer,{size:16,columns:8,mode,terrainA:inner.id,terrainB:outer?.id||''}),id,kind:'tileset',name:id});
  const one=terrain('one',a,b),two=terrain('two',c,b),three=terrain('three',a,null,'blob');
  two.animations={0:{frames:[0,1],fps:5}};w.tilesets=[one,two,three];w.collections=[{id:'collection',name:'World tileset',terrainIds:['one','two','three']}];
  const pack=await godotCollectionPackage(w.collections[0],w.tilesets,w.sprites,async()=>new Uint8Array([137,80,78,71]));
  assert.equal(pack.mapping.one.terrain.outer,pack.mapping.two.terrain.outer);assert.notEqual(pack.mapping.one.terrain.inner,pack.mapping.two.terrain.inner);
  assert.equal(pack.mapping.three.terrain.set,1);assert.equal(pack.mapping.three.terrain.outer,-1);
  assert.equal(pack.mapping.two.tiles[0].source,2);assert.equal(pack.mapping.three.tiles[0].source,3);
  assert.match(pack.tres,/terrain_set_0\/mode = 1/);assert.match(pack.tres,/terrain_set_1\/mode = 0/);assert.match(pack.tres,/terrains_peering_bit\/top_side = -1/);
  const resources=[...pack.tres.matchAll(/\[(?:ext_resource|sub_resource) [^\n]+id="([^"]+)"/g)].map(m=>m[1]);assert.equal(new Set(resources).size,resources.length);
  for(const match of pack.tres.matchAll(/(?:ExtResource|SubResource)\("([^"]+)"\)/g))assert.ok(resources.includes(match[1]));
  for(const match of pack.tres.matchAll(/path="res:\/\/([^"]+)"/g))assert.ok(pack.files.some(f=>f.name===match[1]));
  assert.deepEqual(parseWorkspace(serializeWorkspace(w)).collections,w.collections);
  two.tileWidth=8;await assert.rejects(()=>godotCollectionPackage(w.collections[0],w.tilesets,w.sprites,async()=>new Uint8Array()),/same tile size/);
});
