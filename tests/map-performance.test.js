import test from 'node:test';
import assert from 'node:assert/strict';
import { makeSprite, hexToColor } from '../src/core.js';
import { buildTileset } from '../src/tiles.js';
import { makeTilemap, mapLayer, paintMapBrush, resolveMapTerrain, renderTilemap, mapAnimationCells } from '../src/tilemap.js';
const sprite=(name,color,w=16,h=16)=>{const s=makeSprite(name,w,h);s.layers[0].pixels.fill(hexToColor(color));return s;};
function fixture(){
  const a=sprite('A','#557755'),b=sprite('B','#556688'),decal=sprite('Decal','#de9988',29,21);decal.layers[0].opacity=42;
  const terrain=(id,mode)=>({...buildTileset(a,b,{size:16,columns:8,mode,slopes2:true}),id,kind:'tileset',name:id});
  const atlases=[terrain('corners','wang'),terrain('blobs','blob')],assets={sprites:[a,b,decal],tilesets:atlases};
  const map=makeTilemap('Mixed',11,9,atlases[0]);map.sources=[{kind:'tileset',assetId:atlases[1].id},{kind:'texture',assetId:decal.id}];
  return {assets,map};
}
const crop=(image,r)=>{const pixels=new Uint32Array(r.width*r.height);for(let y=0;y<r.height;y++)pixels.set(image.pixels.subarray((r.y+y)*image.width+r.x,(r.y+y)*image.width+r.x+r.width),y*r.width);return {width:r.width,height:r.height,pixels};};
test('regional renders match full pixels with slopes, animation, scaling, layers, snapshots and decals',()=>{
  const {assets,map}=fixture(),l=map.layers[0];
  assets.tilesets[0].animations={0:{frames:[0,15],fps:4}};
  for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++)paintMapBrush(map,l,x,y,{kind:'tile',source:x%2,value:(x+y)%16});
  paintMapBrush(map,l,2,2,{kind:'tile',source:0,value:16});
  paintMapBrush(map,l,7,4,{kind:'texture-tile',source:2,value:1});
  const upper=mapLayer(map.width,map.height,'Overlay');upper.opacity=67;map.layers.push(upper);
  map.textures=[{name:'Snapshot',width:3,height:1,pixels:[0xff8844ff,0,0x4466aaaa]},{name:'Outside',width:1,height:1,pixels:[0]}];
  for(let x=0;x<5;x++)paintMapBrush(map,upper,x,0,{kind:'terrain',source:0,value:1});
  upper.decals=[{source:2,x:27,y:39},{source:2,x:-10,y:10}];
  for(const time of [0,.3])for(const r of [{x:0,y:0,width:48,height:48},{x:37,y:43,width:33,height:44},{x:0,y:6,width:13,height:120},{x:100,y:65,width:60,height:49}])assert.deepEqual(renderTilemap(map,assets,time,r),crop(renderTilemap(map,assets,time),r));
  map.cellWidth=8;map.cellHeight=12;const r={x:11,y:5,width:51,height:39};assert.deepEqual(renderTilemap(map,assets,.3,r),crop(renderTilemap(map,assets,.3),r));
});
test('local terrain updates equal full resolution across mixed sources, overwrites, erase and borders',()=>{
  const {assets,map}=fixture();const extra={...buildTileset(assets.sprites[0],assets.sprites[1],{size:16,columns:8,mode:'wang'}),id:'second-corners',kind:'tileset'};assets.tilesets.push(extra);map.sources.push({kind:'tileset',assetId:extra.id});const full=structuredClone(map);let seed=321;
  const random=limit=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%limit;};
  for(let step=0;step<180;step++){
    const x=random(map.width),y=random(map.height),choice=random(6),brush=choice===5?{kind:'terrain',source:3,value:3}:choice<2?{kind:'terrain',source:choice,value:3}:choice===2?{kind:'tile',source:0,value:15}:{kind:'texture-tile',source:2,value:0},tool=choice===4?'erase':'paint';
    paintMapBrush(map,map.layers[0],x,y,brush,tool);paintMapBrush(full,full.layers[0],x,y,brush,tool);
    const bounds={x0:Math.max(0,x-1),y0:Math.max(0,y-1),x1:Math.min(map.width-1,x+1),y1:Math.min(map.height-1,y+1)};
    resolveMapTerrain(map,map.layers[0],assets,bounds);resolveMapTerrain(full,full.layers[0],assets);
    assert.deepEqual(map.layers,full.layers,`paint ${step} at ${x},${y}`);
  }
});
test('only visible, placed animations participate in map redraws',()=>{
  const {map,assets}=fixture();assets.tilesets[0].animations={0:{frames:[0,1],fps:4}};
  assert.deepEqual(mapAnimationCells(map,assets),[]);
  paintMapBrush(map,map.layers[0],2,3,{kind:'tile',source:0,value:0});let cells=mapAnimationCells(map,assets);assert.equal(cells.length,1);assert.equal(cells[0].x0,2);assert.equal(cells[0].y0,3);
  map.layers[0].visible=false;assert.equal(mapAnimationCells(map,assets).length,0);map.layers[0].visible=true;map.layers[0].opacity=0;assert.equal(mapAnimationCells(map,assets).length,0);
});
