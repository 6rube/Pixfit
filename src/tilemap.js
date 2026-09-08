import { uid, floodFill, composite } from './core.js';
import { tileDescriptors, extractTile, animatedTileIndex, blendPixel } from './tiles.js';

export function mapLayer(width,height,name='Ground') {return {id:uid(),name,visible:true,opacity:100,cells:new Uint32Array(width*height),decals:[]};}
export function makeTilemap(name,width,height,atlas) {
  atlas ||= {id:null,tileWidth:16,tileHeight:16};
  validateMapSize(width,height,atlas.tileWidth,atlas.tileHeight);
  const layer=mapLayer(width,height);
  return {id:uid(),kind:'tilemap',name,width,height,tilesetId:atlas.id,cellWidth:atlas.tileWidth,cellHeight:atlas.tileHeight,layers:[layer],activeLayerId:layer.id,updatedAt:Date.now()};
}
export function validateMapSize(width,height,cellWidth,cellHeight) {
  if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>256||height>256||width*cellWidth>4096||height*cellHeight>4096||width*height*cellWidth*cellHeight>16_000_000)throw new Error('Use 1–256 cells per side, with a rendered map up to 4096 pixels per side and 16 million pixels.');
}
export function paintMap(map,layer,x,y,tile,tool='paint') {
  if(x<0||y<0||x>=map.width||y>=map.height)return;
  const value=tool==='erase'?0:tile+1;
  if(tool==='fill')floodFill(layer.cells,map.width,map.height,x,y,value);
  else layer.cells[y*map.width+x]=value;
}
// Brush intent is separate from resolved atlas IDs so neighboring tiles can change.
// 0 = atlas tile, 1/2 = terrain texture, 3 = auto terrain, 4 = empty,
// 5 = corner fringe, 6 = legacy repeating texture, 7 = selected texture grid tile.
export function paintTerrain(map,layer,atlas,x,y,brush,tool='paint') {
  if(x<0||y<0||x>=map.width||y>=map.height)return;
  layer.terrain ||= new Uint32Array(map.width*map.height);
  const value=tool==='erase'?4:brush;
  if(tool==='fill'){
    const cells=new Uint32Array(layer.terrain);
    // Empty cells and generated corner fringes belong to the same background.
    for(let i=0;i<cells.length;i++){
      if(cells[i]===5||cells[i]===4||(cells[i]===0&&!layer.cells[i]))cells[i]=4;
      else if(cells[i]===0)cells[i]=10+layer.cells[i];
    }
    floodFill(cells,map.width,map.height,x,y,9);
    for(let i=0;i<cells.length;i++)if(cells[i]===9)layer.terrain[i]=value;
  }else layer.terrain[y*map.width+x]=value;
}
export function resolveTerrain(map,layer,atlas,sourceIndex=0) {
  if(!layer.terrain||atlas.imported)return;
  const lookup=new Map(tileDescriptors(atlas).filter(t=>t.kind==='terrain').map(t=>[t.mask,t.id+1]));
  const belongs=i=>(layer.sources?.[i]||0)===sourceIndex;
  const inner=(x,y)=>x>=0&&y>=0&&x<map.width&&y<map.height&&belongs(y*map.width+x)&&[1,3].includes(layer.terrain[y*map.width+x]);
  const auto=(x,y)=>x>=0&&y>=0&&x<map.width&&y<map.height&&belongs(y*map.width+x)&&layer.terrain[y*map.width+x]===3;
  for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++){
    const i=y*map.width+x,type=layer.terrain[i];
    const empty=type===4||(type===0&&!layer.cells[i]);
    if(!belongs(i)&&!empty)continue;
    if(type===1){layer.cells[i]=0;continue;}
    if(atlas.options.mode==='blob'){
      if(type!==3){if(type===2||type===4||type===5)layer.cells[i]=0;continue;}
      const n=inner(x,y-1),e=inner(x+1,y),s=inner(x,y+1),w=inner(x-1,y);
      const mask=(n?1:0)|(e?2:0)|(s?4:0)|(w?8:0)|(n&&e&&inner(x+1,y-1)?16:0)|(e&&s&&inner(x+1,y+1)?32:0)|(s&&w&&inner(x-1,y+1)?64:0)|(w&&n&&inner(x-1,y-1)?128:0);
      layer.cells[i]=lookup.get(mask)||0;
    }else{
      // Corner sets paint terrain junctions; each junction connects four tiles.
      if(type===0&&layer.cells[i])continue;
      if(!auto(x,y)&&!auto(x+1,y)&&!auto(x+1,y+1)&&!auto(x,y+1)){
        if(type===2)layer.cells[i]=0;
        if(belongs(i)&&(type===4||type===5)){layer.cells[i]=0;layer.terrain[i]=4;}continue;
      }
      const mask=(inner(x,y)?1:0)|(inner(x+1,y)?2:0)|(inner(x+1,y+1)?4:0)|(inner(x,y+1)?8:0);
      layer.cells[i]=lookup.get(mask)||0;if(type!==3&&type!==2){layer.terrain[i]=5;if(layer.sources)layer.sources[i]=sourceIndex;}
    }
  }
}
// Source zero preserves existing maps; additional sources reference library assets.
export function mapSource(map,index,assets) {
  const source=map.sources?.[index-1];
  return index?assets[source?.kind==='texture'?'sprites':'tilesets'].find(a=>a.id===source?.assetId):assets.tilesets.find(a=>a.id===map.tilesetId);
}
export function resolveMapTerrain(map,layer,assets) {
  if(!layer.terrain)return;
  for(let i=0;i<layer.cells.length;i++)if(layer.terrain[i]===5){layer.terrain[i]=4;layer.cells[i]=0;if(layer.sources)layer.sources[i]=0;}
  const indices=new Set([0,...(layer.sources||[])]);
  for(const index of indices){const atlas=mapSource(map,index,assets);if(atlas?.kind==='tileset')resolveTerrain(map,layer,atlas,index);}
}
export function paintMapBrush(map,layer,x,y,brush,tool='paint') {
  if(x<0||y<0||x>=map.width||y>=map.height)return;
  layer.terrain ||= new Uint32Array(map.width*map.height);
  layer.sources ||= new Uint32Array(map.width*map.height);
  const write=i=>{
    let part=brush;
    if(brush.kind==='pattern'){
      const dx=i%map.width-(brush.origin?.x??x),dy=Math.floor(i/map.width)-(brush.origin?.y??y);
      const px=(dx%brush.width+brush.width)%brush.width,py=(dy%brush.height+brush.height)%brush.height;
      part=brush.tiles[py*brush.width+px];
    }
    layer.sources[i]=tool==='erase'?0:part.source;
    layer.terrain[i]=tool==='erase'?4:part.kind==='texture-tile'?7:part.kind==='texture'?6:part.kind==='terrain'?part.value:0;
    layer.cells[i]=tool!=='erase'&&['tile','texture-tile'].includes(part.kind)?part.value+1:0;
  };
  if(tool==='fill'){
    const keys=new Map(),regions=new Uint32Array(layer.cells.length);
    for(let i=0;i<regions.length;i++){
      const type=layer.terrain[i],empty=type===4||type===5||(!type&&!layer.cells[i]);
      const key=empty?'empty':`${layer.sources[i]}:${type}:${!type||type===7?layer.cells[i]:0}`;
      if(!keys.has(key))keys.set(key,keys.size+1);regions[i]=keys.get(key);
    }
    floodFill(regions,map.width,map.height,x,y,0);
    for(let i=0;i<regions.length;i++)if(!regions[i])write(i);
  }else if(brush.kind==='pattern'&&tool==='paint'){
    for(let py=0;py<brush.height&&y+py<map.height;py++)for(let px=0;px<brush.width&&x+px<map.width;px++)write((y+py)*map.width+x+px);
  }else write(y*map.width+x);
}
// Texture sheets use the map grid. Partial edge cells are padded with transparency.
export function textureTiles(sprite,cellWidth,cellHeight) {
  const columns=Math.ceil(sprite.width/cellWidth),rows=Math.ceil(sprite.height/cellHeight);
  return Array.from({length:columns*rows},(_,id)=>({id,x:id%columns*cellWidth,y:Math.floor(id/columns)*cellHeight,width:cellWidth,height:cellHeight}));
}
export function textureTile(sprite,cellWidth,cellHeight,id,pixels=composite(sprite)) {
  const columns=Math.ceil(sprite.width/cellWidth),tile=Number.isInteger(id)&&id>=0&&id<columns*Math.ceil(sprite.height/cellHeight)?{x:id%columns*cellWidth,y:Math.floor(id/columns)*cellHeight}:null,result=new Uint32Array(cellWidth*cellHeight);
  if(tile)for(let y=0;y<cellHeight&&tile.y+y<sprite.height;y++)for(let x=0;x<cellWidth&&tile.x+x<sprite.width;x++)result[y*cellWidth+x]=pixels[(tile.y+y)*sprite.width+tile.x+x];
  return {width:cellWidth,height:cellHeight,pixels:result};
}
// Retained for maps saved with the earlier free texture stamp workflow.
export function placeMapDecal(map,layer,x,y,source) {
  layer.decals ||= [];
  const decal={source,x,y};
  layer.decals.push(decal);return decal;
}
export function eraseMapDecal(layer,x,y,assets,map) {
  const decals=layer.decals||[];
  for(let i=decals.length-1;i>=0;i--){
    const decal=decals[i],image=mapSource(map,decal.source,assets);
    if(image&&x>=decal.x&&y>=decal.y&&x<decal.x+image.width&&y<decal.y+image.height){decals.splice(i,1);return true;}
  }
  return false;
}
export function renderTilemap(map,atlas,time=0) {
  const assets=atlas?.tilesets?atlas:{tilesets:atlas?[atlas]:[],sprites:[]};
  const width=map.width*map.cellWidth,height=map.height*map.cellHeight,pixels=new Uint32Array(width*height);
  const cache=new Map(),textureCache=new Map(),descriptorCache=new Map();
  for(const layer of map.layers) {
    if(!layer.visible||!layer.opacity)continue;
    for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++) {
      const cell=y*map.width+x,sourceIndex=layer.sources?.[cell]||0;
      const atlas=mapSource(map,sourceIndex,assets),material=layer.terrain?.[cell];
      if(material===7&&atlas?.kind==='sprite'){
        const key=`${atlas.id}:texture:${layer.cells[cell]}`;
        if(!textureCache.has(atlas.id))textureCache.set(atlas.id,{...atlas,pixels:composite(atlas)});
        if(!cache.has(key))cache.set(key,textureTile(atlas,map.cellWidth,map.cellHeight,layer.cells[cell]-1,textureCache.get(atlas.id).pixels));
        const tile=cache.get(key);
        for(let py=0;py<map.cellHeight;py++)for(let px=0;px<map.cellWidth;px++){
          const i=(y*map.cellHeight+py)*width+x*map.cellWidth+px;pixels[i]=blendPixel(pixels[i],tile.pixels[py*map.cellWidth+px],layer.opacity/100);
        }
        continue;
      }
      let source=(material===1||material===2)&&!layer.cells[cell]&&!sourceIndex?map.textures?.[material-1]:null;
      const sprite=material===6?atlas:!source&&(material===1||material===2)&&!layer.cells[cell]?assets.sprites.find(s=>s.id===atlas?.options?.[material===1?'terrainA':'terrainB']):null;
      if(sprite){if(!textureCache.has(sprite.id))textureCache.set(sprite.id,{...sprite,pixels:composite(sprite)});source=textureCache.get(sprite.id);}
      if(source){
        for(let py=0;py<map.cellHeight;py++)for(let px=0;px<map.cellWidth;px++){
          const color=source.pixels[((y*map.cellHeight+py)%source.height)*source.width+(x*map.cellWidth+px)%source.width];
          const i=(y*map.cellHeight+py)*width+x*map.cellWidth+px;pixels[i]=blendPixel(pixels[i],color,layer.opacity/100);
        }
        continue;
      }
      if(!atlas||atlas.kind==='sprite')continue;
      if(!descriptorCache.has(atlas.id))descriptorCache.set(atlas.id,tileDescriptors(atlas));
      const descriptors=descriptorCache.get(atlas.id),id=layer.cells[cell]-1;if(id<0||!descriptors[id])continue;
      const frame=animatedTileIndex(atlas,id,time);
      const key=`${atlas.id}:${frame}`;if(!cache.has(key))cache.set(key,extractTile(atlas,frame));const tile=cache.get(key);
      const targetWidth=descriptors[id].spanX*map.cellWidth,targetHeight=descriptors[id].spanY*map.cellHeight;
      for(let py=0;py<targetHeight&&y*map.cellHeight+py<height;py++)for(let px=0;px<targetWidth&&x*map.cellWidth+px<width;px++){
        const src=tile.pixels[Math.floor(py*tile.height/targetHeight)*tile.width+Math.floor(px*tile.width/targetWidth)];
        const i=(y*map.cellHeight+py)*width+x*map.cellWidth+px;pixels[i]=blendPixel(pixels[i],src,layer.opacity/100);
      }
    }
    for(const decal of layer.decals||[]) {
      const image=mapSource(map,decal.source,assets);if(!image||image.kind!=='sprite')continue;
      if(!textureCache.has(image.id))textureCache.set(image.id,{...image,pixels:composite(image)});const source=textureCache.get(image.id);
      for(let py=0;py<source.height;py++)for(let px=0;px<source.width;px++){
        const dx=decal.x+px,dy=decal.y+py;if(dx<0||dy<0||dx>=width||dy>=height)continue;
        const i=dy*width+dx;pixels[i]=blendPixel(pixels[i],source.pixels[py*source.width+px],layer.opacity/100);
      }
    }
  }
  return {width,height,pixels};
}
export function resizeTilemap(map,width,height) {
  validateMapSize(width,height,map.cellWidth,map.cellHeight);
  const result=structuredClone(map);result.width=width;result.height=height;
  for(const layer of result.layers)for(const key of ['cells','terrain','sources']){if(!layer[key])continue;const cells=new Uint32Array(width*height);for(let y=0;y<Math.min(height,map.height);y++)for(let x=0;x<Math.min(width,map.width);x++)cells[y*width+x]=layer[key][y*map.width+x];layer[key]=cells;}
  return result;
}
