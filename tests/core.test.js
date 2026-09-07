import test from 'node:test';
import assert from 'node:assert/strict';
import { rgba, hexToColor, colorToHex, makeSprite, makeLayer, composite, imageBytes, pixelsFromBytes, stamp, floodFill, shapeSelection, translatePixels, resizeSprite, encodePixels, decodePixels, BLOB_MASKS, generateTileset, uid } from '../src/core.js';
import { serializeWorkspace, parseWorkspace } from '../src/storage.js';
import { createDemo } from '../src/demo.js';

const red = hexToColor('#ff0000'), blue = hexToColor('#0000ff');
test('pixel colors and PNG bytes round-trip without endian or alpha changes', () => {
  const pixels = new Uint32Array([red, blue, rgba(33,44,55,128), 0]);
  assert.deepEqual(pixelsFromBytes(imageBytes(pixels)), pixels);
  assert.equal(colorToHex(red), '#ff0000');
});
test('layers composite alpha and opacity in the correct order and respect visibility', () => {
  const s=makeSprite('Blend',1,1), top=makeLayer(1,1);s.layers[0].pixels[0]=blue;top.pixels[0]=red;top.opacity=50;s.layers.push(top);
  assert.equal(composite(s)[0],rgba(128,0,128));
  top.visible=false;assert.equal(composite(s)[0],blue);
  s.layers[0].opacity=50;assert.equal(composite(s)[0],rgba(0,0,255,128));
});
test('even sized brushes mirror every pixel exactly across both axes', () => {
  const p=new Uint32Array(12*12);stamp(p,12,12,3,4,red,{size:4,mirrorX:true,mirrorY:true});
  for(let y=0;y<12;y++)for(let x=0;x<12;x++){assert.equal(p[y*12+x],p[y*12+11-x]);assert.equal(p[y*12+x],p[(11-y)*12+x]);}
});
test('brushes and dithering respect selection masks', () => {
  const p=new Uint32Array(64),mask=shapeSelection(8,8,2,2,5,5);stamp(p,8,8,4,4,red,{size:8,dither:true,selection:mask});
  assert.equal(p.filter(v=>v===red).length,8);
  for(let i=0;i<p.length;i++)if(!mask[i])assert.equal(p[i],0);
});
test('bucket fill stays inside connected regions and selected pixels, with dithering', () => {
  const p=new Uint32Array(64);for(let y=0;y<8;y++)p[y*8+4]=blue;
  floodFill(p,8,8,0,0,red);assert.equal(p.filter(v=>v===red).length,32);assert.equal(p[7],0);
  const p2=new Uint32Array(64),selection=shapeSelection(8,8,2,2,5,5);floodFill(p2,8,8,3,3,red,selection,true);
  assert.equal(p2.filter(v=>v===red).length,8);assert.equal(p2[0],0);
});
test('ellipse selections exclude corners and include their center', () => {
  const mask=shapeSelection(8,8,1,1,6,6,true);assert.equal(mask[1*8+1],0);assert.equal(mask[3*8+3],1);assert.equal(mask[1*8+3],1);
  assert.equal(shapeSelection(8,8,3,3,3,3,true).reduce((a,b)=>a+b,0),1);
});
test('moving a selection clears the origin, preserves unselected pixels, and clips at canvas bounds', () => {
  const p=new Uint32Array([red,0,blue,0,0,0,0,0,0]);const mask=new Uint8Array([1,0,0,0,0,0,0,0,0]);
  const moved=translatePixels(p,3,3,1,1,mask);assert.equal(moved.pixels[0],0);assert.equal(moved.pixels[4],red);assert.equal(moved.pixels[2],blue);assert.equal(moved.selection[4],1);
  assert.equal(translatePixels(p,3,3,4,0).pixels.filter(Boolean).length,0);
});
test('canvas resizing crops without scaling and nearest-neighbor preserves hard pixels', () => {
  const s=makeSprite('Resize',2,2);s.layers[0].pixels.set([red,blue,0,red]);
  const bigger=resizeSprite(s,4,4,true);assert.deepEqual(Array.from(bigger.layers[0].pixels.slice(0,4)),[red,red,blue,blue]);
  const crop=resizeSprite(s,1,1);assert.equal(crop.layers[0].pixels[0],red);
  const largest=resizeSprite(s,512,512);assert.equal(largest.layers[0].pixels.length,512*512);
  assert.throws(()=>resizeSprite(s,513,1));assert.throws(()=>resizeSprite(s,1.5,2));
});
test('pixel compression is lossless and rejects corrupt or oversized data', () => {
  const p=new Uint32Array([0,0,red,red,red,blue]);assert.deepEqual(decodePixels(encodePixels(p),p.length),p);
  for(const runs of [[7,red],[-1,red],[1],[1,-1],[1,2**32],[1,red]])assert.throws(()=>decodePixels(runs,6));
});
test('terrain generator creates all 16 corner cases and 47 normalized neighbor cases', () => {
  assert.equal(BLOB_MASKS.length,47);const a=makeSprite('Red',16,16),b=makeSprite('Blue',16,16);a.layers[0].pixels.fill(red);b.layers[0].pixels.fill(blue);
  const t=generateTileset(a,b,{size:16,columns:8,border:0});assert.equal(t.masks.length,16);assert.equal(t.width,128);assert.equal(t.height,32);
  assert.equal(t.pixels[0],blue);assert.equal(t.pixels[16*128+7*16],red);
  const blob=generateTileset(a,b,{size:16,mode:'blob',columns:8,gap:true});assert.equal(blob.masks.length,47);assert.equal(blob.width,135);assert.equal(blob.height,101);assert.equal(blob.pixels[16],0);
});
test('corner terrain tiles join at compatible edges', () => {
  const a=makeSprite('Red',1,1),b=makeSprite('Blue',1,1);a.layers[0].pixels[0]=red;b.layers[0].pixels[0]=blue;
  const t=generateTileset(a,b,{size:16,columns:16,border:0});
  for(let left=0;left<16;left++)for(let right=0;right<16;right++){
    if(!!(left&2)!==!!(right&1)||!!(left&4)!==!!(right&8))continue;
    for(let y=0;y<16;y++)assert.equal(t.pixels[y*t.width+left*16+15],t.pixels[y*t.width+right*16]);
  }
});
test('isometric projection makes a 2:1 tile with transparent outer corners', () => {
  const a=makeSprite('Red',1,1);a.layers[0].pixels[0]=red;
  const t=generateTileset(a,a,{size:16,isometric:true,columns:4});assert.equal(t.tileWidth,32);assert.equal(t.tileHeight,16);
  assert.equal(t.pixels[0],0);assert.equal(t.pixels[8*t.width+16],red);
});
test('workspace JSON preserves layers, settings, palettes and exact saved atlas pixels', () => {
  const w=createDemo();w.settings.brushSize=7;w.palettes.custom=['#123456'];
  const tile=generateTileset(w.sprites[1],w.sprites[2],{size:16,columns:8,mode:'blob',isometric:true,gap:true});
  w.tilesets.push({...tile,id:uid(),name:'Saved atlas',kind:'tileset',updatedAt:123});
  const restored=parseWorkspace(JSON.parse(JSON.stringify(serializeWorkspace(w))));
  assert.equal(restored.settings.brushSize,7);assert.deepEqual(restored.palettes,w.palettes);assert.equal(restored.activeId,w.activeId);
  assert.deepEqual(restored.sprites[0].layers,w.sprites[0].layers);assert.deepEqual(restored.tilesets[0].pixels,tile.pixels);assert.deepEqual(restored.tilesets[0].masks,tile.masks);assert.equal(restored.tilesets[0].tileWidth,32);
});
test('untrusted backups cannot inject invalid dimensions, colors, or duplicate IDs', () => {
  const data=serializeWorkspace(createDemo());data.settings.color='red;url(https://example.com)';assert.equal(parseWorkspace(data).settings.color,'#738b51');
  data.sprites[0].width=513;assert.throws(()=>parseWorkspace(data));data.sprites[0].width=64;
  data.sprites[1].id=data.sprites[0].id;assert.throws(()=>parseWorkspace(data));assert.throws(()=>parseWorkspace({format:'other'}));
  const unsafe=serializeWorkspace(createDemo());unsafe.sprites[0].id='\"><img src=x onerror=alert(1)>';assert.throws(()=>parseWorkspace(unsafe));
});
