import { encodePixels, decodePixels, MAX_SIZE } from './core.js';
import { tileDescriptors } from './tiles.js';
import { validateMapSize } from './tilemap.js';
import { cleanCategory } from './categories.js';
import { savedPalettes } from './palettes.js';

export const MAX_WORKSPACE_PIXELS = 32_000_000;
export function workspacePixelCount(workspace) {
  return workspace.sprites.reduce((n, s) => n + s.width * s.height * s.layers.length, 0)
    + workspace.tilesets.reduce((n, t) => n + t.width * t.height, 0)
    + (workspace.tilemaps||[]).reduce((n,m)=>n+m.width*m.height*m.layers.length+m.layers.reduce((n,l)=>n+(l.terrain?.length||0)+(l.sources?.length||0),0)+(m.textures||[]).reduce((n,t)=>n+t.width*t.height,0)+(m.patterns||[]).reduce((n,p)=>n+p.tiles.length,0),0);
}
export const DEFAULT_SETTINGS = { theme: 'system', color: '#738b51', secondaryColor: '#f3dfb0', brushSize: 1, mirrorX: false, mirrorY: false, dither: false, grid: false, palette: 'woodland', pasteNewLayer: true, tile: { size: 16, columns: 8, mode: 'wang', border: 1, borderType:'dither', borderTexture:'', cutoff:0, slopes1:false, slopes2:false, overrides:{}, isometric: false, gap: false, terrainA: '', terrainB: '' } };
const validColor = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
export function serializeWorkspace(workspace) {
  return {
    format: 'pixfit', version: 2, exportedAt: new Date().toISOString(),
    activeId: workspace.activeId, settings: workspace.settings, palettes: workspace.palettes,
    sprites: workspace.sprites.map(sprite => ({ ...sprite, layers: sprite.layers.map(layer => ({ ...layer, pixels: encodePixels(layer.pixels) })) })),
    tilesets: workspace.tilesets.map(tile => ({ ...tile, pixels: encodePixels(tile.pixels) })),
    collections: structuredClone(workspace.collections||[]),
    tilemaps: (workspace.tilemaps||[]).map(m=>({...m,layers:m.layers.map(l=>({...l,cells:encodePixels(l.cells),...(l.terrain?{terrain:encodePixels(l.terrain)}:{}),...(l.sources?{sources:encodePixels(l.sources)}:{})}))})),
    session: workspace.session || {tabs:[workspace.activeId],activeTab:workspace.activeId,view:'pixel'},
  };
}
export function parseWorkspace(data) {
  if (data?.format !== 'pixfit' || ![1,2].includes(data.version) || !Array.isArray(data.sprites) || !data.sprites.length || data.sprites.length > 100 || !Array.isArray(data.tilesets) || data.tilesets.length > 100 || (data.tilemaps!==undefined&&(!Array.isArray(data.tilemaps)||data.tilemaps.length>100))) throw new Error('This is not a supported Pixfit backup.');
  const ids = new Set(); let pixelBudget = 0;
  const id = value => { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value) || ids.has(value)) throw new Error('Invalid or duplicate asset ID.'); ids.add(value); return value; };
  const name = value => typeof value === 'string' ? value.slice(0, 100) : 'Untitled';
  const size = (value, max) => { if (!Number.isInteger(value) || value < 1 || value > max) throw new Error('Invalid image dimensions.'); return value; };
  const decode = (pixels, length) => { pixelBudget += length; if (pixelBudget > MAX_WORKSPACE_PIXELS) throw new Error('This backup is too large (32 million pixels maximum).'); return decodePixels(pixels, length); };
  const sprites = data.sprites.map(s => {
    const width = size(s.width, MAX_SIZE), height = size(s.height, MAX_SIZE);
    if (!Array.isArray(s.layers) || !s.layers.length || s.layers.length > 32) throw new Error('Invalid layer count.');
    const layers = s.layers.map(l => ({ id: id(l.id), name: name(l.name), visible: l.visible !== false, opacity: Number.isFinite(l.opacity) ? Math.max(0, Math.min(100, l.opacity)) : 100, pixels: decode(l.pixels, width * height) }));
    return { id: id(s.id), kind: 'sprite', name: name(s.name), ...(cleanCategory(s.category)?{category:cleanCategory(s.category)}:{}), width, height, layers, activeLayerId: layers.some(l => l.id === s.activeLayerId) ? s.activeLayerId : layers.at(-1).id, updatedAt: Number(s.updatedAt) || Date.now() };
  });
  const tilesets = data.tilesets.map(t => {
    const width = size(t.width, 4096), height = size(t.height, 4096);
    const tileWidth = size(t.tileWidth, 512), tileHeight = size(t.tileHeight, 512);
    const columns = size(t.columns, 4096), rows = size(t.rows, 4096);
    const gap = Number.isInteger(t.gap) && t.gap >= 0 && t.gap <= 8 ? t.gap : 0;
    if (columns * rows > 4096 || width !== columns * tileWidth + (columns - 1) * gap || height !== rows * tileHeight + (rows - 1) * gap || !Array.isArray(t.masks) || !t.masks.length || t.masks.length > columns * rows || t.masks.some(m => m !== null && (!Number.isInteger(m) || m < 0 || m > 255))) throw new Error('Invalid tileset layout.');
    const atlas={ id: id(t.id), kind: 'tileset', name: name(t.name), width, height, tileWidth, tileHeight, columns, rows, gap, masks: [...t.masks], imported: !!t.imported, pixels: decode(t.pixels, width * height), options: cleanTile(t.options), updatedAt: Number(t.updatedAt) || Date.now() };
    if(t.tiles!==undefined){
      if(!Array.isArray(t.tiles)||t.tiles.length!==t.masks.length)throw new Error('Invalid tile descriptors.');
      const occupied=new Set();
      atlas.tiles=t.tiles.map((tile,index)=>{
        const spanX=size(tile.spanX,64),spanY=size(tile.spanY,64),x=tile.x,y=tile.y;
        const tw=spanX*tileWidth+(spanX-1)*gap,th=spanY*tileHeight+(spanY-1)*gap;
        if(tile.id!==index||!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x%(tileWidth+gap)||y%(tileHeight+gap)||tile.width!==tw||tile.height!==th||x+tw>width||y+th>height)throw new Error('Invalid tile rectangle.');
        for(let py=0;py<spanY;py++)for(let px=0;px<spanX;px++){const key=`${x/(tileWidth+gap)+px},${y/(tileHeight+gap)+py}`;if(occupied.has(key))throw new Error('Overlapping tiles.');occupied.add(key);}
        return {id:index,mask:atlas.masks[index],kind:['terrain','slope-1x1','slope-1x2'].includes(tile.kind)?tile.kind:'terrain',orientation:[0,1,2,3].includes(tile.orientation)?tile.orientation:0,x,y,width:tw,height:th,spanX,spanY};
      });
    }
    atlas.animations={};
    const descriptors=tileDescriptors(atlas);
    if(t.animations&&typeof t.animations==='object')for(const [key,a] of Object.entries(t.animations)){
      if(!/^\d+$/.test(key)||!descriptors[Number(key)]||!a||!Array.isArray(a.frames)||!a.frames.length||a.frames.length>32||!Number.isFinite(a.fps)||a.fps<1||a.fps>60)throw new Error('Invalid tile animation.');
      const base=descriptors[Number(key)];
      if(a.frames.some(f=>!Number.isInteger(f)||!descriptors[f]||descriptors[f].width!==base.width||descriptors[f].height!==base.height))throw new Error('Animation frames must have matching dimensions.');
      atlas.animations[key]={frames:[...a.frames],fps:a.fps};
    }
    return atlas;
  });
  if(data.collections!==undefined&&(!Array.isArray(data.collections)||data.collections.length>100))throw new Error('Invalid tileset collections.');
  const collections=(data.collections||[]).map(c=>{
    if(!Array.isArray(c.terrainIds)||!c.terrainIds.length||c.terrainIds.length>100||new Set(c.terrainIds).size!==c.terrainIds.length||c.terrainIds.some(id=>!tilesets.some(t=>t.id===id)))throw new Error('Invalid tileset terrain references.');
    return {id:id(c.id),name:name(c.name),terrainIds:[...c.terrainIds]};
  });
  const tilemaps=(data.tilemaps||[]).map(m=>{
    const width=size(m.width,256),height=size(m.height,256),cellWidth=size(m.cellWidth,512),cellHeight=size(m.cellHeight,512);
    validateMapSize(width,height,cellWidth,cellHeight);
    const atlas=tilesets.find(t=>t.id===m.tilesetId);if(!atlas&&m.tilesetId!==null)throw new Error('A tilemap references a missing tileset.');
    let sources;
    if(m.sources!==undefined){
      if(!Array.isArray(m.sources)||m.sources.length>200)throw new Error('Invalid map sources.');
      sources=m.sources.map(s=>{
        if(!s||!['texture','tileset'].includes(s.kind)||!(s.kind==='texture'?sprites:tilesets).some(a=>a.id===s.assetId))throw new Error('A map references a missing source.');
        return {kind:s.kind,assetId:s.assetId};
      });
    }
    if(!Array.isArray(m.layers)||!m.layers.length||m.layers.length>16)throw new Error('Invalid map layer count.');
    let textures;
    if(m.textures!==undefined){
      if(!Array.isArray(m.textures)||m.textures.length!==2)throw new Error('Invalid map textures.');
      textures=m.textures.map(t=>{
        const width=size(t.width,512),height=size(t.height,512);
        if(!Array.isArray(t.pixels)||t.pixels.length!==width*height||t.pixels.some(p=>!Number.isInteger(p)||p<0||p>0xffffffff))throw new Error('Invalid map texture pixels.');
        pixelBudget+=width*height;if(pixelBudget>MAX_WORKSPACE_PIXELS)throw new Error('This backup is too large.');
        return {name:name(t.name),width,height,pixels:[...t.pixels]};
      });
    }
    const layers=m.layers.map(l=>{
      const cells=decode(l.cells,width*height),result={id:id(l.id),name:name(l.name),visible:l.visible!==false,opacity:Number.isFinite(l.opacity)?Math.max(0,Math.min(100,l.opacity)):100,cells};
      if(l.decals!==undefined){
        if(!Array.isArray(l.decals)||l.decals.length>4096)throw new Error('Invalid map texture placements.');
        result.decals=l.decals.map(d=>{
          if(!d||!Number.isInteger(d.source)||d.source<1||d.source>(sources?.length||0)||sources[d.source-1]?.kind!=='texture'||!Number.isInteger(d.x)||!Number.isInteger(d.y)||d.x<-512||d.y<-512||d.x>=width*cellWidth||d.y>=height*cellHeight)throw new Error('Invalid map texture placement.');
          return {source:d.source,x:d.x,y:d.y};
        });
      }
      if(l.sources!==undefined){result.sources=decode(l.sources,width*height);if(result.sources.some(v=>v>(sources?.length||0)))throw new Error('Invalid map source index.');}
      if(l.terrain!==undefined)result.terrain=decode(l.terrain,width*height);
      for(let i=0;i<cells.length;i++){
        const index=result.sources?.[i]||0,source=sources?.[index-1],set=index?tilesets.find(t=>source?.kind==='tileset'&&t.id===source.assetId):atlas,type=result.terrain?.[i]||0;
        const texture=source?.kind==='texture'?sprites.find(s=>s.id===source.assetId):null;
        if(cells[i]>(type===7&&texture?Math.ceil(texture.width/cellWidth)*Math.ceil(texture.height/cellHeight):set?.masks.length||0))throw new Error('A map contains an invalid tile.');
        if(type>7||([6,7].includes(type)&&source?.kind!=='texture')||(type===7&&!cells[i])||([1,2,3,5].includes(type)&&(!set||set.imported))||([1,2].includes(type)&&!index&&!textures))throw new Error('Invalid terrain brush data.');
      }
      return result;
    });
    let patterns;
    if(m.patterns!==undefined){
      if(!Array.isArray(m.patterns)||m.patterns.length>100)throw new Error('Invalid map patterns.');
      patterns=m.patterns.map(p=>{
        const pw=size(p.width,64),ph=size(p.height,64);
        if(!Array.isArray(p.tiles)||p.tiles.length!==pw*ph)throw new Error('Invalid pattern dimensions.');
        pixelBudget+=pw*ph;if(pixelBudget>MAX_WORKSPACE_PIXELS)throw new Error('This backup is too large.');
        const tiles=p.tiles.map(t=>{
          const texture=sprites.find(s=>s.id===t.assetId);
          if(t.kind!=='texture-tile'||!texture||!Number.isInteger(t.value)||t.value<0||t.value>=Math.ceil(texture.width/cellWidth)*Math.ceil(texture.height/cellHeight))throw new Error('Invalid pattern tile.');
          return {kind:t.kind,assetId:t.assetId,value:t.value};
        });
        return {id:id(p.id),name:name(p.name),width:pw,height:ph,tiles};
      });
    }
    return {id:id(m.id),kind:'tilemap',name:name(m.name),width,height,cellWidth,cellHeight,tilesetId:atlas?.id||null,layers,...(sources?{sources}:{}),...(textures?{textures}:{}),...(patterns?{patterns}:{}),activeLayerId:layers.some(l=>l.id===m.activeLayerId)?m.activeLayerId:layers[0].id,updatedAt:Number(m.updatedAt)||Date.now()};
  });
  const raw = data.settings || {}, settings = { ...DEFAULT_SETTINGS, tile: cleanTile(raw.tile) };
  for (const key of ['color', 'secondaryColor']) if (raw[key] === 'transparent' || validColor(raw[key])) settings[key] = raw[key];
  for (const key of ['mirrorX', 'mirrorY', 'dither', 'grid']) settings[key] = !!raw[key];
  settings.brushSize = Number.isInteger(raw.brushSize) && raw.brushSize >= 1 && raw.brushSize <= 32 ? raw.brushSize : 1;
  settings.palette = ['woodland', 'pastel', 'classic', 'custom'].includes(raw.palette) ? raw.palette : 'woodland';
  settings.pasteNewLayer=raw.pasteNewLayer!==false;
  settings.mapGrid=raw.mapGrid!==false;
  settings.theme=['system','light','dark'].includes(raw.theme)?raw.theme:'system';
  const palettes = { custom: Array.isArray(data.palettes?.custom) ? data.palettes.custom.filter(validColor).slice(0, 128) : [], saved:savedPalettes(data.palettes?.saved) };
  if(palettes.saved.some(p=>p.id===raw.palette))settings.palette=raw.palette;
  const activeId=sprites.some(s=>s.id===data.activeId)?data.activeId:sprites[0].id;
  const assetIds=new Set([...sprites,...tilesets,...tilemaps].map(a=>a.id)),rawSession=data.session||{};
  const tabs=Array.isArray(rawSession.tabs)?[...new Set(rawSession.tabs.filter(id=>assetIds.has(id)))].slice(0,100):[activeId];
  const activeTab=tabs.includes(rawSession.activeTab)?rawSession.activeTab:tabs[0]||activeId;
  const session={tabs,activeTab,view:['pixel','tiles','map','library'].includes(rawSession.view)?rawSession.view:'pixel'};
  return { sprites, tilesets, collections, tilemaps, session, settings, palettes, activeId };
}
export function cleanTile(raw = {}) {
  const identifier=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value)?value:'';
  const numeric=(value,min,max,fallback)=>Number.isFinite(value)?Math.max(min,Math.min(max,Math.round(value))):fallback;
  const borderFields=value=>({
    borderMapping:value.borderMapping==='native'?'native':'fit',
    borderAlign:['center','inner','outer'].includes(value.borderAlign)?value.borderAlign:'center',
    borderScale:[.5,1,2,4].includes(value.borderScale)?value.borderScale:1,
    borderOffset:numeric(value.borderOffset,-64,64,0),borderRepeat:numeric(value.borderRepeat,0,512,0),borderPhase:numeric(value.borderPhase,-512,512,0),
    borderRotation:[0,90,180,270].includes(value.borderRotation)?value.borderRotation:0,
    borderTrim:!!value.borderTrim,borderReverse:!!value.borderReverse,
  });
  const overrides={};
  if(raw?.overrides&&typeof raw.overrides==='object')for(const [key,value] of Object.entries(raw.overrides).slice(0,4096)){
    if(!/^\d{1,4}$/.test(key)||Number(key)>4095||!value||typeof value!=='object')continue;
    const item={rotation:[0,90,180,270].includes(value.rotation)?value.rotation:0,flipX:!!value.flipX,flipY:!!value.flipY};
    if(['inherit','none','dither','texture'].includes(value.borderType))item.borderType=value.borderType;
    if(value.borderTexture!==undefined)item.borderTexture=identifier(value.borderTexture);
    if(value.border!==undefined)item.border=numeric(value.border,0,64,1);
    if(value.cutoff!==undefined)item.cutoff=numeric(value.cutoff,-64,64,0);
    for(const [key,cleaned] of Object.entries(borderFields(value)))if(value[key]!==undefined)item[key]=cleaned;
    overrides[key]=item;
  }
  return {
    size: [8, 16, 32, 64].includes(raw?.size) ? raw.size : 16,
    columns: [4, 8, 16].includes(raw?.columns) ? raw.columns : 8,
    mode: raw?.mode === 'blob' ? 'blob' : 'wang', border: numeric(raw?.border,0,64,1),
    borderType:['none','dither','texture'].includes(raw?.borderType)?raw.borderType:'dither',borderTexture:identifier(raw?.borderTexture),cutoff:numeric(raw?.cutoff,-64,64,0),
    ...borderFields(raw||{}),
    slopes1:!!raw?.slopes1,slopes2:!!raw?.slopes2,overrides,
    isometric: !!raw?.isometric, gap: !!raw?.gap,
    terrainA: identifier(raw?.terrainA), terrainB: identifier(raw?.terrainB),
  };
}
let database;
async function db() {
  if (!globalThis.indexedDB) throw new Error('IndexedDB is unavailable.');
  if (!database) database = new Promise((resolve, reject) => {
    const request = indexedDB.open('pixfit-studio', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => { database = null; reject(request.error); };
    request.onblocked = () => { database = null; reject(new Error('Browser storage is blocked by another tab.')); };
  });
  return database;
}
export async function loadWorkspace() {
  let value;
  try {
    const database = await db();
    value = await new Promise((resolve, reject) => {
      const request = database.transaction('workspace', 'readonly').objectStore('workspace').get('current');
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
    });
  } catch { /* Local Storage also works when IndexedDB is disabled. */ }
  let fallback;
  try { fallback = JSON.parse(localStorage.getItem('pixfit-workspace') || 'null'); } catch { /* No fallback. */ }
  if (fallback && (!value || fallback.exportedAt > value.exportedAt)) value = fallback;
  return value ? parseWorkspace(value) : null;
}
export async function saveWorkspace(workspace) {
  const value = serializeWorkspace(workspace);
  try {
    const database = await db();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('workspace', 'readwrite');
      transaction.objectStore('workspace').put(value, 'current');
      transaction.oncomplete = resolve; transaction.onerror = () => reject(transaction.error); transaction.onabort = () => reject(transaction.error);
    });
    try { localStorage.removeItem('pixfit-workspace'); } catch { /* IndexedDB succeeded. */ }
    return 'IndexedDB';
  } catch {
    localStorage.setItem('pixfit-workspace', JSON.stringify(value));
    return 'Local Storage';
  }
}
