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
export function renderTilemap(map,atlas,time=0) {
  const width=map.width*map.cellWidth,height=map.height*map.cellHeight,pixels=new Uint32Array(width*height);
  if(!atlas)return {width,height,pixels};
  const descriptors=tileDescriptors(atlas),cache=new Map();
  for(const layer of map.layers) {
    if(!layer.visible||!layer.opacity)continue;
    for(let y=0;y<map.height;y++)for(let x=0;x<map.width;x++) {
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
  for(const layer of result.layers){const cells=new Uint32Array(width*height);for(let y=0;y<Math.min(height,map.height);y++)for(let x=0;x<Math.min(width,map.width);x++)cells[y*width+x]=layer.cells[y*map.width+x];layer.cells=cells;}
  return result;
}
