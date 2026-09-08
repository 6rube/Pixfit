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
export function resolveTerrain(map,layer,atlas,sourceIndex=0,bounds=null) {
  if(!layer.terrain||atlas.imported)return;
  const lookup=new Map(tileDescriptors(atlas).filter(t=>t.kind==='terrain').map(t=>[t.mask,t.id+1]));
  const belongs=i=>(layer.sources?.[i]||0)===sourceIndex;
  const inner=(x,y)=>x>=0&&y>=0&&x<map.width&&y<map.height&&belongs(y*map.width+x)&&[1,3].includes(layer.terrain[y*map.width+x]);
  const auto=(x,y)=>x>=0&&y>=0&&x<map.width&&y<map.height&&belongs(y*map.width+x)&&layer.terrain[y*map.width+x]===3;
  const area=bounds||{x0:0,y0:0,x1:map.width-1,y1:map.height-1};
  for(let y=area.y0;y<=area.y1;y++)for(let x=area.x0;x<=area.x1;x++){
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
export function resolveMapTerrain(map,layer,assets,bounds=null) {
  if(!layer.terrain)return;
  const area=bounds||{x0:0,y0:0,x1:map.width-1,y1:map.height-1};
  for(let y=area.y0;y<=area.y1;y++)for(let x=area.x0;x<=area.x1;x++){const i=y*map.width+x;if(layer.terrain[i]===5){layer.terrain[i]=4;layer.cells[i]=0;if(layer.sources)layer.sources[i]=0;}}
  const indices=new Set([0]);
  for(let i=0;i<layer.cells.length;i++)if(layer.terrain[i]!==5)indices.add(layer.sources?.[i]||0);
  // Source priority must not change when a stroke adds an earlier map cell.
  for(const index of [...indices].sort((a,b)=>a-b)){const atlas=mapSource(map,index,assets);if(atlas?.kind==='tileset')resolveTerrain(map,layer,atlas,index,area);}
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
// A region uses pixel coordinates. Draw every overlapping layer and multi-cell
// tile, including anchors outside the region, so partial redraws equal a full render.
export function renderTilemap(map,atlas,time=0,region=null) {
  const assets=atlas?.tilesets?atlas:{tilesets:atlas?[atlas]:[],sprites:[]};
  const fullWidth=map.width*map.cellWidth,fullHeight=map.height*map.cellHeight;
  const left=region?.x||0,top=region?.y||0,width=region?.width??fullWidth,height=region?.height??fullHeight;
  const right=left+width,bottom=top+height,pixels=new Uint32Array(width*height);
  const sprites=new Map(assets.sprites.map(s=>[s.id,s])),atlases=new Map(assets.tilesets.map(t=>[t.id,t]));
  const sources=[atlases.get(map.tilesetId),...(map.sources||[]).map(s=>(s.kind==='texture'?sprites:atlases).get(s.assetId))];
  const cache=new Map(),textureCache=new Map(),descriptorCache=new Map();
  let spanX=1,spanY=1;
  for(const source of sources)if(source&&source.kind!=='sprite'&&!descriptorCache.has(source.id)){
    const tiles=tileDescriptors(source);descriptorCache.set(source.id,tiles);
    for(const tile of tiles){spanX=Math.max(spanX,tile.spanX);spanY=Math.max(spanY,tile.spanY);}
  }
  const texture=s=>{
    if(!textureCache.has(s.id))textureCache.set(s.id,{...s,pixels:composite(s)});
    return textureCache.get(s.id);
  };
  const blit=(image,dx,dy,targetWidth,targetHeight,opacity)=>{
    const x0=Math.max(left,dx),y0=Math.max(top,dy),x1=Math.min(right,dx+targetWidth),y1=Math.min(bottom,dy+targetHeight);
    if(x0>=x1||y0>=y1)return;
    const native=image.width===targetWidth&&image.height===targetHeight;
    image.opaque??=image.pixels.every(p=>(p&255)===255);
    for(let y=y0;y<y1;y++){
      const sy=Math.floor((y-dy)*image.height/targetHeight),dest=(y-top)*width+x0-left;
      if(native&&image.opaque&&opacity===1){pixels.set(image.pixels.subarray(sy*image.width+x0-dx,sy*image.width+x1-dx),dest);continue;}
      for(let x=x0;x<x1;x++){
        const color=image.pixels[sy*image.width+Math.floor((x-dx)*image.width/targetWidth)],i=dest+x-x0;
        pixels[i]=blendPixel(pixels[i],color,opacity);
      }
    }
  };
  const x0=Math.max(0,Math.floor(left/map.cellWidth)-spanX+1),y0=Math.max(0,Math.floor(top/map.cellHeight)-spanY+1);
  const x1=Math.min(map.width,Math.ceil(right/map.cellWidth)),y1=Math.min(map.height,Math.ceil(bottom/map.cellHeight));
  for(const layer of map.layers){
    if(!layer.visible||!layer.opacity)continue;
    const opacity=layer.opacity/100;
    for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++){
      const cell=y*map.width+x,material=layer.terrain?.[cell];
      if(!layer.cells[cell]&&![1,2,6].includes(material))continue;
      const sourceIndex=layer.sources?.[cell]||0,atlas=sources[sourceIndex],dx=x*map.cellWidth,dy=y*map.cellHeight;
      if(material===7&&atlas?.kind==='sprite'){
        const key=`${sourceIndex}:texture:${layer.cells[cell]}`;
        if(!cache.has(key))cache.set(key,textureTile(atlas,map.cellWidth,map.cellHeight,layer.cells[cell]-1,texture(atlas).pixels));
        blit(cache.get(key),dx,dy,map.cellWidth,map.cellHeight,opacity);continue;
      }
      let source=(material===1||material===2)&&!layer.cells[cell]&&!sourceIndex?map.textures?.[material-1]:null;
      const sprite=material===6?atlas:!source&&(material===1||material===2)&&!layer.cells[cell]?sprites.get(atlas?.options?.[material===1?'terrainA':'terrainB']):null;
      if(sprite)source=texture(sprite);
      if(source){
        for(let py=Math.max(top,dy);py<Math.min(bottom,dy+map.cellHeight);py++)for(let px=Math.max(left,dx);px<Math.min(right,dx+map.cellWidth);px++){
          const color=source.pixels[(py%source.height)*source.width+px%source.width],i=(py-top)*width+px-left;
          pixels[i]=blendPixel(pixels[i],color,opacity);
        }
        continue;
      }
      const descriptors=descriptorCache.get(atlas?.id),id=layer.cells[cell]-1;
      if(!descriptors?.[id])continue;
      const frame=animatedTileIndex(atlas,id,time),key=`${sourceIndex}:${frame}`;
      if(!cache.has(key))cache.set(key,extractTile(atlas,frame));
      blit(cache.get(key),dx,dy,descriptors[id].spanX*map.cellWidth,descriptors[id].spanY*map.cellHeight,opacity);
    }
    for(const decal of layer.decals||[]){
      const image=sources[decal.source];if(!image||image.kind!=='sprite')continue;
      if(decal.x>=right||decal.y>=bottom||decal.x+image.width<=left||decal.y+image.height<=top)continue;
      blit(texture(image),decal.x,decal.y,image.width,image.height,opacity);
    }
  }
  return {width,height,pixels};
}
// Only animations actually placed on visible layers can invalidate the map.
export function mapAnimationCells(map,assets){
  const sources=[mapSource(map,0,assets),...(map.sources||[]).map((_,i)=>mapSource(map,i+1,assets))];
  if(!sources.some(s=>s?.kind==='tileset'&&Object.keys(s.animations||{}).length))return [];
  const result=[],descriptors=new Map();
  for(const layer of map.layers)if(layer.visible&&layer.opacity)for(let i=0;i<layer.cells.length;i++){
    const atlas=sources[layer.sources?.[i]||0],id=layer.cells[i]-1;
    if(!atlas?.animations?.[id]||layer.terrain?.[i]===7)continue;
    if(!descriptors.has(atlas))descriptors.set(atlas,tileDescriptors(atlas));
    const tile=descriptors.get(atlas)[id];if(tile)result.push({atlas,id,x0:i%map.width,y0:Math.floor(i/map.width),x1:i%map.width+tile.spanX-1,y1:Math.floor(i/map.width)+tile.spanY-1});
  }
  return result;
}
export function resizeTilemap(map,width,height) {
  validateMapSize(width,height,map.cellWidth,map.cellHeight);
  const result=structuredClone(map);result.width=width;result.height=height;
  for(const layer of result.layers)for(const key of ['cells','terrain','sources']){if(!layer[key])continue;const cells=new Uint32Array(width*height);for(let y=0;y<Math.min(height,map.height);y++)for(let x=0;x<Math.min(width,map.width);x++)cells[y*width+x]=layer[key][y*map.width+x];layer[key]=cells;}
  return result;
}
