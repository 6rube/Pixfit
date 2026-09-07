import { BLOB_MASKS, clamp, composite, hexToColor } from './core.js';

export function tileDescriptors(atlas) {
  return atlas.tiles || atlas.masks.map((mask, id) => ({ id, mask, kind: 'terrain', x: id % atlas.columns * (atlas.tileWidth + atlas.gap), y: Math.floor(id / atlas.columns) * (atlas.tileHeight + atlas.gap), width: atlas.tileWidth, height: atlas.tileHeight, spanX: 1, spanY: 1 }));
}
export function extractTile(atlas, index) {
  const tile = tileDescriptors(atlas)[index];
  if (!tile) return { pixels: new Uint32Array(1), width: 1, height: 1 };
  const pixels = new Uint32Array(tile.width * tile.height);
  for (let y = 0; y < tile.height; y++) pixels.set(atlas.pixels.subarray((tile.y + y) * atlas.width + tile.x, (tile.y + y) * atlas.width + tile.x + tile.width), y * tile.width);
  return { ...tile, pixels };
}
export function transformImage(image, rotation = 0, flipX = false, flipY = false) {
  const turns = ((Math.round(rotation / 90) % 4) + 4) % 4;
  const width = turns % 2 ? image.height : image.width, height = turns % 2 ? image.width : image.height;
  const pixels = new Uint32Array(width * height);
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    let nx = x, ny = y;
    if (turns === 1) { nx = image.height - 1 - y; ny = x; }
    if (turns === 2) { nx = image.width - 1 - x; ny = image.height - 1 - y; }
    if (turns === 3) { nx = y; ny = image.width - 1 - x; }
    if (flipX) nx = width - 1 - nx;
    if (flipY) ny = height - 1 - ny;
    pixels[ny * width + nx] = image.pixels[y * image.width + x];
  }
  return { width, height, pixels };
}
export function transformMask(mask, mode, rotation = 0, flipX = false, flipY = false) {
  if (mask === null) return null;
  const positions = mode === 'blob' ? [[0,-1,1],[1,0,2],[0,1,4],[-1,0,8],[1,-1,16],[1,1,32],[-1,1,64],[-1,-1,128]] : [[-1,-1,1],[1,-1,2],[1,1,4],[-1,1,8]];
  let result = 0;
  for (const [x,y,bit] of positions) {
    if (!(mask & bit)) continue;
    let nx=x,ny=y;
    for(let i=0;i<((rotation/90)%4+4)%4;i++)[nx,ny]=[-ny,nx];
    if(flipX)nx=-nx;if(flipY)ny=-ny;
    result |= positions.find(p=>p[0]===nx&&p[1]===ny)[2];
  }
  return result;
}
export function isometricImage(image) {
  const width=image.width+image.height, height=Math.ceil(width/2),pixels=new Uint32Array(width*height);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
    const a=(x+.5-image.height)/2,b=y+.5,sx=Math.floor(b+a),sy=Math.floor(b-a);
    if(sx>=0&&sx<image.width&&sy>=0&&sy<image.height)pixels[y*width+x]=image.pixels[sy*image.width+sx];
  }
  return {width,height,pixels};
}
function fieldAt(mask, mode, u, v) {
  if(mode!=='blob')return ((mask&1?1:0)*(1-u)+(mask&2?1:0)*u)*(1-v)+((mask&8?1:0)*(1-u)+(mask&4?1:0)*u)*v-.5;
  let value=.5;
  if(!(mask&1))value=Math.min(value,v-.25);if(!(mask&2))value=Math.min(value,.75-u);
  if(!(mask&4))value=Math.min(value,.75-v);if(!(mask&8))value=Math.min(value,u-.25);
  if((mask&3)===3&&!(mask&16))value=Math.min(value,Math.hypot(1-u,v)-.25);
  if((mask&6)===6&&!(mask&32))value=Math.min(value,Math.hypot(1-u,1-v)-.25);
  if((mask&12)===12&&!(mask&64))value=Math.min(value,Math.hypot(u,1-v)-.25);
  if((mask&9)===9&&!(mask&128))value=Math.min(value,Math.hypot(u,v)-.25);
  return value;
}
function sourceSampler(sprite, fallback) {
  const pixels=sprite?composite(sprite):null;
  return (x,y)=>pixels?pixels[(y%sprite.height)*sprite.width+x%sprite.width]:fallback;
}
export function buildTileset(terrainA, terrainB, options={}, sprites=[]) {
  const size=clamp(Number(options.size)||16,8,64), columns=clamp(Number(options.columns)||8,4,16),gap=options.gap?1:0;
  const tileWidth=options.isometric?size*2:size,tileHeight=size;
  const masks=options.mode==='blob'?[...BLOB_MASKS]:Array.from({length:16},(_,i)=>i);
  const specs=masks.map(mask=>({mask,kind:'terrain',baseWidth:size,baseHeight:size,orientation:0}));
  for(const [enabled,kind,height] of [[options.slopes1,'slope-1x1',size],[options.slopes2,'slope-1x2',size*2]]) {
    if(enabled)for(let orientation=0;orientation<4;orientation++)specs.push({mask:null,kind,baseWidth:size,baseHeight:height,orientation});
  }
  const sampleA=sourceSampler(terrainA,hexToColor('#91aa66')),sampleB=sourceSampler(terrainB,0);
  const patches=specs.map((spec,id)=>{
    const override=options.overrides?.[id]||{}, opts={...options,...override};
    const borderType=override.borderType&&override.borderType!=='inherit'?override.borderType:(options.borderType||'dither');
    const borderTexture=sprites.find(s=>s.id===(override.borderTexture||options.borderTexture)),sampleBorder=sourceSampler(borderTexture,0);
    const borderWidth=clamp(Number(opts.border)||0,0,size),cutoff=clamp(Number(opts.cutoff)||0,-size,size);
    const width=spec.baseWidth,height=spec.baseHeight,pixels=new Uint32Array(width*height);
    // A signed distance in pixels makes both border width and cutoff independent of tile resolution.
    for(let y=0;y<height;y++)for(let x=0;x<width;x++) {
      const u=(x+.5)/width,v=(y+.5)/height;
      let distance,normalX=0,normalY=1;
      if(spec.kind!=='terrain') {
        const sx=spec.orientation&1?1-u:u,sy=spec.orientation&2?1-v:v;
        distance=(sy-sx)*width/Math.SQRT2;
        normalX=spec.orientation&1?1:-1;normalY=(spec.orientation&2?-1:1)*width/height;
      } else if(spec.mask===0&&options.mode!=='blob')distance=-Infinity;
      else if(spec.mask===(options.mode==='blob'?255:15))distance=Infinity;
      else {
        const f=fieldAt(spec.mask,options.mode,u,v),delta=.001;
        const dx=(fieldAt(spec.mask,options.mode,u+delta,v)-fieldAt(spec.mask,options.mode,u-delta,v))/(2*delta*width);
        const dy=(fieldAt(spec.mask,options.mode,u,v+delta)-fieldAt(spec.mask,options.mode,u,v-delta))/(2*delta*height);
        normalX=dx;normalY=dy;
        distance=f/Math.max(.001,Math.hypot(dx,dy));
      }
      distance-=cutoff;
      const mixed=borderWidth>0&&Math.abs(distance)<borderWidth/2;
      let useA=distance>=0;
      if(mixed&&borderType==='dither')useA=distance/borderWidth+.5>[.125,.625,.875,.375][(y%2)*2+x%2];
      let color=useA?sampleA(x,y):sampleB(x,y);
      if(mixed&&borderType==='texture'&&borderTexture){
        // Repeat the strip along the edge; fit its entire height across the band.
        // Source rows run from outer terrain (top) to inner terrain (bottom).
        const along=Math.abs(normalX)>Math.abs(normalY)?y:x;
        const across=clamp(Math.floor((distance/borderWidth+.5)*borderTexture.height),0,borderTexture.height-1);
        color=blendPixel(color,sampleBorder(along,across));
      }
      pixels[y*width+x]=color;
    }
    let image=transformImage({pixels,width,height},opts.rotation||0,opts.flipX,opts.flipY);
    if(options.isometric)image=isometricImage(image);
    return {id,mask:transformMask(spec.mask,options.mode,opts.rotation||0,opts.flipX,opts.flipY),kind:spec.kind,orientation:spec.orientation,...image};
  });
  return packTiles(patches,{tileWidth,tileHeight,columns,gap,options:structuredClone(options)});
}
export function blendPixel(dst, src, opacity=1) {
  const sa=(src&255)/255*opacity;if(!sa)return dst;if(sa===1)return src;
  const da=(dst&255)/255,a=sa+da*(1-sa);
  const part=shift=>Math.round((((src>>>shift)&255)*sa+((dst>>>shift)&255)*da*(1-sa))/a);
  return (((part(24)<<24)|(part(16)<<16)|(part(8)<<8)|Math.round(a*255))>>>0);
}
export function packTiles(images,{tileWidth,tileHeight,columns,gap=0,options={}}) {
  let col=0,row=0,rowHeight=1;
  const tiles=images.map((image,id)=>{
    const spanX=Math.ceil((image.width+gap)/(tileWidth+gap)),spanY=Math.ceil((image.height+gap)/(tileHeight+gap));
    if(col+spanX>columns){row+=rowHeight;col=0;rowHeight=1;}
    const tile={id,mask:image.mask??null,kind:image.kind||'terrain',orientation:image.orientation||0,x:col*(tileWidth+gap),y:row*(tileHeight+gap),width:spanX*tileWidth+(spanX-1)*gap,height:spanY*tileHeight+(spanY-1)*gap,spanX,spanY};
    col+=spanX;rowHeight=Math.max(rowHeight,spanY);return tile;
  });
  const rows=row+rowHeight,width=columns*tileWidth+(columns-1)*gap,height=rows*tileHeight+(rows-1)*gap;
  if(width>4096||height>4096)throw new Error('This atlas is too large. Use smaller tiles or more columns.');
  const pixels=new Uint32Array(width*height);
  tiles.forEach((tile,i)=>{const image=images[i];for(let y=0;y<image.height;y++)pixels.set(image.pixels.subarray(y*image.width,(y+1)*image.width),(tile.y+y)*width+tile.x);});
  return {pixels,width,height,tileWidth,tileHeight,columns,rows,gap,tiles,masks:tiles.map(t=>t.mask),options};
}
export function animatedTileIndex(atlas,index,timeSeconds=0) {
  const animation=atlas.animations?.[index];
  return animation?.frames?.length?animation.frames[Math.floor(timeSeconds*animation.fps)%animation.frames.length]:index;
}

export function selectionClipboard(pixels,width,height,selection=null) {
  let x0=width,y0=height,x1=-1,y1=-1;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(!selection||selection[y*width+x]){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  if(x1<0)return null;
  const w=x1-x0+1,h=y1-y0+1,result=new Uint32Array(w*h),mask=new Uint8Array(w*h);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const i=(y+y0)*width+x+x0;if(!selection||selection[i]){mask[y*w+x]=1;result[y*w+x]=pixels[i];}}
  return {pixels:result,mask,width:w,height:h,x:x0,y:y0};
}
export function pastePixels(target,width,height,clipboard,x=clipboard.x,y=clipboard.y,selection=null) {
  const mask=new Uint8Array(width*height);
  for(let sy=0;sy<clipboard.height;sy++)for(let sx=0;sx<clipboard.width;sx++) {
    const px=x+sx,py=y+sy,source=sy*clipboard.width+sx,i=py*width+px;
    if(!clipboard.mask[source]||px<0||py<0||px>=width||py>=height||(selection&&!selection[i]))continue;
    target[i]=blendPixel(target[i],clipboard.pixels[source]);mask[i]=1;
  }
  return mask;
}
