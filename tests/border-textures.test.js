import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSprite, hexToColor, uid } from '../src/core.js';
import { buildTileset, borderTextureImage, extractTile, blendPixel } from '../src/tiles.js';
import { cleanTile, parseWorkspace, serializeWorkspace } from '../src/storage.js';
import { createDemo } from '../src/demo.js';
const inner=hexToColor('#ff8899'),outer=hexToColor('#334455'),border=hexToColor('#77aa88');
const solid=(name,color,w=32,h=32)=>{const s=makeSprite(name,w,h);s.layers[0].pixels.fill(color);return s;};
const a=solid('Inside',inner),b=solid('Outside',outer);
const strip=solid('Half transparent',0);
for(let y=0;y<16;y++)for(let x=0;x<32;x++)strip.layers[0].pixels[y*32+x]=border;
const opts={size:32,columns:8,border:4,borderType:'texture',borderTexture:strip.id,borderMapping:'native',borderReverse:true};
const build=(options={},texture=strip)=>buildTileset(a,b,{...opts,borderTexture:texture.id,...options},[texture]);
test('native 32px strip preserves its half-transparent padding, direction and exact pixels',()=>{
  const pixels=extractTile(build(),3).pixels;
  for(let y=0;y<32;y++)for(let x=0;x<32;x++)assert.equal(pixels[y*32+x],y<16?border:outer);
  const reversed=extractTile(build({borderReverse:false}),3).pixels;
  for(let y=0;y<32;y++)assert.equal(reversed[y*32],y<16?inner:border);
  const fitted=extractTile(build({borderMapping:'fit'}),3).pixels;
  assert.equal(fitted.filter(c=>c===border).length,64,'fitting the original 32 rows into 4 px reduces the visible half to 2 px');
  assert.ok(extractTile(build(),15).pixels.every(c=>c===inner),'no border on fully inner tiles');
  assert.ok(extractTile(build(),0).pixels.every(c=>c===outer),'no border on fully outer tiles');
});
test('trimming removes only empty source rows and keeps holes and horizontal repeat spacing',()=>{
  const image=solid('Padded',0,6,6);image.layers[0].pixels[2*6+2]=border;image.layers[0].pixels[3*6+3]=border;
  const trimmed=borderTextureImage(image,{borderTrim:true});assert.equal(trimmed.width,6);assert.equal(trimmed.height,2);assert.equal(trimmed.pixels[0],0);assert.equal(trimmed.pixels[2],border);
  const empty=borderTextureImage(solid('Empty',0),{borderTrim:true});assert.equal(empty.height,1);assert.ok(empty.pixels.every(v=>v===0));
  const rotated=borderTextureImage(image,{borderRotation:90,borderTrim:true});assert.equal(rotated.width,6);assert.equal(rotated.height,2);
  const cropped=extractTile(build({borderTrim:true,borderMapping:'fit'}),3).pixels;
  assert.equal(cropped.filter(c=>c===border).length,128,'visible 16 rows fit across the complete 4px band');
});
test('alignment and offset move only the overlay and transparent pixels retain underlying colors',()=>{
  const opaque=solid('Opaque',border,32,4);
  for(const [borderAlign,start] of [['center',14],['inner',12],['outer',16]]){
    const pixels=extractTile(build({borderAlign,borderReverse:false},opaque),3).pixels;
    for(let y=0;y<32;y++)assert.equal(pixels[y*32],y>=start&&y<start+4?border:y<16?inner:outer);
  }
  const shifted=extractTile(build({borderAlign:'inner',borderOffset:2},opaque),3).pixels;
  assert.equal(shifted[10*32],border);assert.equal(shifted[14*32],inner);assert.equal(shifted[16*32],outer);
  const translucent=solid('Translucent',(border&0xffffff00|128)>>>0,32,4);
  const pixels=extractTile(build({},translucent),3).pixels;
  assert.equal(pixels[15*32],blendPixel(inner,translucent.layers[0].pixels[0]));assert.equal(pixels[16*32],blendPixel(outer,translucent.layers[0].pixels[0]));
});
test('repeat length, negative phase and scale use nearest-neighbor sampling on both axes',()=>{
  const motif=solid('Motif',0,4,2),colors=[inner,outer,border,hexToColor('#ffffff')];motif.layers[0].pixels.set([...colors,...colors]);
  const atlas=build({borderRepeat:8,borderPhase:-2,borderReverse:false},motif),top=extractTile(atlas,3).pixels,right=extractTile(atlas,6).pixels;
  const expected=[colors[3],colors[3],colors[0],colors[0],colors[1],colors[1],colors[2],colors[2]];
  assert.deepEqual(Array.from(top.slice(15*32,15*32+8)),expected);
  assert.deepEqual(Array.from({length:8},(_,i)=>right[i*32+15]),expected);
  const scaled=extractTile(build({borderScale:2,borderReverse:false},motif),3).pixels;
  assert.deepEqual(Array.from(scaled.slice(14*32,14*32+8)),colors.flatMap(c=>[c,c]));
  assert.deepEqual(borderTextureImage(motif,{borderRotation:90}).pixels,new Uint32Array([inner,inner,outer,outer,border,border,colors[3],colors[3]]));
});
test('tile overrides, backup restore and old defaults retain border settings',()=>{
  const options={...opts,terrainA:a.id,terrainB:b.id,borderScale:2,borderOffset:-3,borderRepeat:28,borderPhase:-8,borderRotation:180,borderTrim:true,borderAlign:'outer',overrides:{3:{borderReverse:false,borderMapping:'fit',borderAlign:'inner',borderOffset:2,borderRepeat:12,borderPhase:4,borderRotation:90,borderScale:.5,borderTrim:false}}};
  const w=createDemo();w.sprites.push(a,b,strip);w.settings.tile=cleanTile(options);w.tilesets=[{...buildTileset(a,b,w.settings.tile,[strip]),id:uid(),kind:'tileset',name:'Border terrain'}];
  const restored=parseWorkspace(JSON.parse(JSON.stringify(serializeWorkspace(w))));assert.deepEqual(restored.settings.tile,w.settings.tile);assert.deepEqual(restored.tilesets[0].options,w.settings.tile);
  assert.deepEqual(buildTileset(a,b,restored.tilesets[0].options,[strip]).pixels,w.tilesets[0].pixels);
  const base=build(),changed=build({overrides:{3:{borderReverse:false}}});assert.notDeepEqual(extractTile(base,3).pixels,extractTile(changed,3).pixels);assert.deepEqual(extractTile(base,6).pixels,extractTile(changed,6).pixels);
  const old=cleanTile({});assert.equal(old.borderMapping,'fit');assert.equal(old.borderReverse,false);assert.equal(old.borderTrim,false);assert.equal(old.borderOffset,0);
  assert.equal(cleanTile({borderOffset:1000,borderScale:3,borderRotation:45}).borderOffset,64);
});
