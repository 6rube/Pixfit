import { uid, floodFill } from './core.js';
import { tileDescriptors, extractTile, animatedTileIndex, blendPixel } from './tiles.js';

export function mapLayer(width,height,name='Ground') {return {id:uid(),name,visible:true,opacity:100,cells:new Uint32Array(width*height)};}
export function makeTilemap(name,width,height,atlas) {
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
// 0 = legacy tile, 1/2 = source texture, 3 = autoterrain, 4 = empty, 5 = corner fringe.
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
export function resolveTerrain(map,layer,atlas) {
  if(!layer.terrain||atlas.imported)return;
  const lookup=new Map(tileDescriptors(atlas).filter(t=>t.kind==='terrain').map(t=>[t.mask,t.id+1]));
  const inner=(x,y)=>x>=0&&y>=0&&x<map.width&&y<map.height&&[1,3].includes(layer.terrain[y*map.width+x]);
  const auto=(x,y)=>x>=0&&y>=0&&x<map.width&&y<map.height&&layer.terrain[y*map.width+x]===3;
  for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++){
    const i=y*map.width+x,type=layer.terrain[i];
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
        if(type===4||type===5){layer.cells[i]=0;layer.terrain[i]=4;}continue;
      }
      const mask=(inner(x,y)?1:0)|(inner(x+1,y)?2:0)|(inner(x+1,y+1)?4:0)|(inner(x,y+1)?8:0);
      layer.cells[i]=lookup.get(mask)||0;if(type!==3&&type!==2)layer.terrain[i]=5;
    }
  }
}
export function renderTilemap(map,atlas,time=0) {
  const width=map.width*map.cellWidth,height=map.height*map.cellHeight,pixels=new Uint32Array(width*height);
  if(!atlas)return {width,height,pixels};
  const descriptors=tileDescriptors(atlas),cache=new Map();
  for(const layer of map.layers) {
    if(!layer.visible||!layer.opacity)continue;
    for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++) {
      const material=layer.terrain?.[y*map.width+x],source=(material===1||material===2)&&!layer.cells[y*map.width+x]?map.textures?.[material-1]:null;
      if(source){
        for(let py=0;py<map.cellHeight;py++)for(let px=0;px<map.cellWidth;px++){
          const color=source.pixels[((y*map.cellHeight+py)%source.height)*source.width+(x*map.cellWidth+px)%source.width];
          const i=(y*map.cellHeight+py)*width+x*map.cellWidth+px;pixels[i]=blendPixel(pixels[i],color,layer.opacity/100);
        }
        continue;
      }
      const id=layer.cells[y*map.width+x]-1;if(id<0||!descriptors[id])continue;
      const frame=animatedTileIndex(atlas,id,time);
      if(!cache.has(frame))cache.set(frame,extractTile(atlas,frame));const tile=cache.get(frame);
      const targetWidth=descriptors[id].spanX*map.cellWidth,targetHeight=descriptors[id].spanY*map.cellHeight;
      for(let py=0;py<targetHeight&&y*map.cellHeight+py<height;py++)for(let px=0;px<targetWidth&&x*map.cellWidth+px<width;px++){
        const src=tile.pixels[Math.floor(py*tile.height/targetHeight)*tile.width+Math.floor(px*tile.width/targetWidth)];
        const i=(y*map.cellHeight+py)*width+x*map.cellWidth+px;pixels[i]=blendPixel(pixels[i],src,layer.opacity/100);
      }
    }
  }
  return {width,height,pixels};
}
export function resizeTilemap(map,width,height) {
  validateMapSize(width,height,map.cellWidth,map.cellHeight);
  const result=structuredClone(map);result.width=width;result.height=height;
  for(const layer of result.layers)for(const key of ['cells','terrain']){if(!layer[key])continue;const cells=new Uint32Array(width*height);for(let y=0;y<Math.min(height,map.height);y++)for(let x=0;x<Math.min(width,map.width);x++)cells[y*width+x]=layer[key][y*map.width+x];layer[key]=cells;}
  return result;
}
