import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSprite, hexToColor, uid, shapeSelection } from '../src/core.js';
import { buildTileset, tileDescriptors, extractTile, transformImage, transformMask, selectionClipboard, pastePixels, animatedTileIndex } from '../src/tiles.js';
import { makeTilemap, paintMap, renderTilemap, resizeTilemap, mapLayer } from '../src/tilemap.js';
import { serializeWorkspace, parseWorkspace, cleanTile } from '../src/storage.js';
import { createDemo } from '../src/demo.js';
import { godotPackage, zipFiles } from '../src/godot.js';
const red=hexToColor('#ff0000'),blue=hexToColor('#0000ff'),yellow=hexToColor('#ffff00');
function terrain(color){const s=makeSprite('Terrain',16,16);s.layers[0].pixels.fill(color);return s;}
function atlas(options={}){return {...buildTileset(terrain(red),terrain(blue),{size:16,columns:8,border:0,...options}),id:uid(),kind:'tileset',name:'Test atlas'};}

test('new generation packs 1x1 and 1x2 slopes without overlapping any tile',()=>{
  const t=atlas({slopes1:true,slopes2:true,gap:true});assert.equal(t.tiles.length,24);
  assert.equal(t.tiles.filter(t=>t.kind==='slope-1x1').length,4);assert.equal(t.tiles.filter(t=>t.kind==='slope-1x2').length,4);
  assert.equal(t.tiles[20].spanY,2);assert.equal(t.tiles[20].height,33);
  for(const a of t.tiles)for(const b of t.tiles)if(a.id!==b.id)assert.ok(a.x+a.width<=b.x||b.x+b.width<=a.x||a.y+a.height<=b.y||b.y+b.height<=a.y);
  for(const tile of t.tiles.slice(16)){const pixels=extractTile(t,tile.id).pixels;assert.ok(pixels.includes(red));assert.ok(pixels.includes(blue));}
});
test('pixel cutoff moves the boundary and a third texture occupies the transition band',()=>{
  const a=terrain(red),b=terrain(blue),c=terrain(yellow),options={size:16,columns:8,border:4,borderType:'texture',borderTexture:c.id};
  const t=buildTileset(a,b,options,[a,b,c]);assert.ok(extractTile(t,3).pixels.includes(yellow));assert.equal(extractTile(t,15).pixels.filter(v=>v===yellow).length,0);
  const normal=atlas(),shrunk=atlas({cutoff:3});assert.ok(extractTile(shrunk,3).pixels.filter(v=>v===red).length<extractTile(normal,3).pixels.filter(v=>v===red).length);
});
test('per-tile overrides affect only the chosen tile and transformed masks match rotation/flips',()=>{
  const original=atlas(),modified=atlas({overrides:{3:{cutoff:4,borderType:'none'}}});assert.notDeepEqual(extractTile(original,3).pixels,extractTile(modified,3).pixels);assert.deepEqual(extractTile(original,2).pixels,extractTile(modified,2).pixels);
  assert.equal(transformMask(1,'wang',90),2);assert.equal(transformMask(1,'wang',0,true),2);assert.equal(transformMask(1,'blob',90),2);assert.equal(transformMask(16,'blob',0,true),128);
});
test('rotation exchanges dimensions and four quarter turns recover every pixel',()=>{
  const image={width:2,height:3,pixels:new Uint32Array([1,2,3,4,5,6])};let result=image;
  result=transformImage(result,90);assert.equal(result.width,3);assert.equal(result.height,2);assert.deepEqual(Array.from(result.pixels),[5,3,1,6,4,2]);
  for(let i=0;i<3;i++)result=transformImage(result,90);assert.deepEqual(result,image);
  const t=atlas({slopes2:true,overrides:{16:{rotation:90}}});assert.equal(t.tiles[16].spanX,2);assert.equal(t.tiles[16].spanY,1);
});
test('clipboard preserves ellipse holes and restricts paste to the destination selection',()=>{
  const source=new Uint32Array(64).fill(red),mask=shapeSelection(8,8,1,1,6,6,true),clip=selectionClipboard(source,8,8,mask);
  assert.equal(clip.width,6);assert.equal(clip.mask[0],0);
  const dest=new Uint32Array(64).fill(blue),selection=shapeSelection(8,8,2,2,4,4);pastePixels(dest,8,8,clip,1,1,selection);
  assert.equal(dest[0],blue);assert.equal(dest[3*8+3],red);assert.equal(dest[5*8+5],blue);
});
test('tilemaps paint, erase, fill, composite layers and resize without corrupting cell IDs',()=>{
  const t=atlas(),m=makeTilemap('Map',4,3,t),l=m.layers[0];paintMap(m,l,0,0,15,'fill');assert.ok(l.cells.every(v=>v===16));
  assert.equal(renderTilemap(m,t).pixels[0],red);paintMap(m,l,1,1,0,'erase');assert.equal(l.cells[5],0);
  const top=mapLayer(4,3,'Water');m.layers.push(top);paintMap(m,top,0,0,0);assert.equal(renderTilemap(m,t).pixels[0],blue);top.visible=false;assert.equal(renderTilemap(m,t).pixels[0],red);
  const resized=resizeTilemap(m,2,2);assert.equal(resized.layers[0].cells.length,4);assert.equal(resized.layers[0].cells[3],0);assert.throws(()=>makeTilemap('Too large',257,3,t));
});
test('animated map tiles resolve frame sequence by FPS',()=>{
  const t=atlas();t.animations={0:{frames:[0,15],fps:2}};assert.equal(animatedTileIndex(t,0,.1),0);assert.equal(animatedTileIndex(t,0,.6),15);assert.equal(animatedTileIndex(t,0,1.1),0);
  const m=makeTilemap('Animated',1,1,t);paintMap(m,m.layers[0],0,0,0);assert.equal(renderTilemap(m,t,.1).pixels[0],blue);assert.equal(renderTilemap(m,t,.6).pixels[0],red);
});
test('version 2 backups preserve open tabs, maps, animations, slopes and paste preferences',()=>{
  const w=createDemo(),t=atlas({slopes1:true,slopes2:true,overrides:{2:{rotation:180,cutoff:1,flipY:true}}});t.animations={0:{frames:[0,1],fps:12}};w.tilesets=[t];w.tilemaps=[makeTilemap('World',4,4,t)];paintMap(w.tilemaps[0],w.tilemaps[0].layers[0],2,2,15);
  w.settings.pasteNewLayer=false;w.session={tabs:[w.activeId,t.id,w.tilemaps[0].id],activeTab:w.tilemaps[0].id,view:'map'};
  const restored=parseWorkspace(JSON.parse(JSON.stringify(serializeWorkspace(w))));assert.deepEqual(restored.session,w.session);assert.deepEqual(restored.tilemaps,w.tilemaps);assert.deepEqual(restored.tilesets[0].animations,t.animations);assert.deepEqual(restored.tilesets[0].tiles,t.tiles);assert.equal(restored.settings.pasteNewLayer,false);assert.equal(restored.tilesets[0].options.overrides[2].rotation,180);
});
test('old backups migrate while invalid animations, rectangles and map references are rejected',()=>{
  const legacy=serializeWorkspace(createDemo());legacy.version=1;delete legacy.tilemaps;delete legacy.session;assert.equal(parseWorkspace(legacy).tilemaps.length,0);
  const w=createDemo(),t=atlas({slopes2:true});w.tilesets=[t];w.tilemaps=[makeTilemap('Map',2,2,t)];
  let data=serializeWorkspace(w);data.tilemaps[0].tilesetId='missing';assert.throws(()=>parseWorkspace(data));
  data=serializeWorkspace(w);data.tilesets[0].animations={0:{frames:[16],fps:8}};assert.throws(()=>parseWorkspace(data));
  data=structuredClone(serializeWorkspace(w));data.tilesets[0].tiles[1].x=0;assert.throws(()=>parseWorkspace(data));
  assert.deepEqual(cleanTile({overrides:{'bad':{rotation:90}}}).overrides,{});
});
test('Godot export contains animated texture sources, multi-cell rectangles and terrain masks',async()=>{
  const t=atlas({slopes2:true});t.animations={0:{frames:[0,15],fps:6}};
  const png=async()=>new Uint8Array([137,80,78,71]);const pack=await godotPackage(t,png);
  assert.match(pack.tres,/type="TileSet"/);assert.match(pack.tres,/animation_frames_count = 2/);assert.match(pack.tres,/animation_speed = 6/);assert.match(pack.tres,/size_in_atlas = Vector2i\(1, 2\)/);assert.match(pack.tres,/terrains_peering_bit\/top_left_corner/);assert.equal(pack.mapping[0].source,1);assert.equal(pack.mapping[15].source,0);
  assert.ok(pack.files.some(f=>f.name.endsWith('animation-1.png')));
  const zip=await zipFiles(pack.files).arrayBuffer();assert.equal(new DataView(zip).getUint32(0,true),0x04034b50);assert.equal(new DataView(zip).getUint32(zip.byteLength-22,true),0x06054b50);
});
