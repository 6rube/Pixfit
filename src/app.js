import { uid, clamp, rgba, colorToHex, hexToColor, makeSprite, makeLayer, cloneSprite, composite, imageBytes, pixelsFromBytes, linePoints, stamp, floodFill, shapeSelection, translatePixels, resizeSprite, generateTileset } from './core.js';
import { loadWorkspace, saveWorkspace, serializeWorkspace, parseWorkspace, workspacePixelCount, MAX_WORKSPACE_PIXELS } from './storage.js';
import { createDemo, PALETTES } from './demo.js';
import { MAX_PALETTES, validatePalette, importPalette, exportPalette } from './palettes.js';
import { cleanCategory, textureCategories, texturesInCategory } from './categories.js';
import { icon } from './icons.js';
import { buildTileset, borderTextureImage, tileDescriptors, extractTile, transformImage, packTiles, animatedTileIndex, selectionClipboard, pastePixels, transformSelection, blendPixel } from './tiles.js';
import { makeTilemap, mapLayer, paintMapBrush, textureTiles, textureTile, eraseMapDecal, resolveMapTerrain, renderTilemap, mapAnimationCells, resizeTilemap } from './tilemap.js';
import { godotCollectionPackage, zipFiles } from './godot.js';

const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const button = (action, glyph, label, cls = '', extra = '') => `<button type="button" class="${cls}" data-action="${action}" title="${escape(label)}" aria-label="${escape(label)}" ${extra}>${icon(glyph)}<span>${escape(label)}</span></button>`;
const iconButton = (action, glyph, label, extra = '') => button(action, glyph, label, 'icon-button', extra);
const toolList = [ ['pencil','pencil','Pencil','B'], ['line','line','Line','L'], ['bucket','bucket','Fill','G'], ['picker','picker','Eyedropper','I'], ['rect','select','Rectangle select','M'], ['ellipse','circle','Ellipse select','O'], ['color-select','wand','Select by color','W'], ['move','move','Move pixels','V'], ['pan','hand','Pan canvas','H'] ];
const systemTheme=window.matchMedia('(prefers-color-scheme: dark)');
let workspace;
function applyTheme(){
  const preference=workspace?.settings.theme||'system',dark=preference==='dark'||(preference==='system'&&systemTheme.matches);
  document.documentElement.dataset.theme=dark?'dark':'light';
  document.querySelector('meta[name="theme-color"]').content=dark?'#20251f':'#f6f5f1';
}
systemTheme.addEventListener('change',applyTheme);
applyTheme();
try { workspace = await loadWorkspace() || createDemo(); } catch (error) { workspace = createDemo(); setTimeout(() => toast(`Could not restore saved data: ${error.message}`, true), 300); }
workspace.tilemaps ||= [];
workspace.collections ||= [];
workspace.palettes.saved ||= [];
workspace.session ||= {tabs:[workspace.activeId],activeTab:workspace.activeId,view:'pixel'};
workspace.settings.pasteNewLayer ??= true;
workspace.settings.mapGrid ??= true;
const state = { view: 'pixel', tool: 'pencil', zoom: 6, pan: { x: 0, y: 0 }, selection: null, cursor: null, drag: null, space: false, inspector: false, history: new Map(), tile: null, mapId:null,mapTool:'paint',mapTile:3,mapFrame:null, clipboard:null,tabViews:new Map(), libraryFilter:'all',librarySearch:'',animationPlaying:true,spriteRepeatPreview:false,selectedTile: 0, saved: true, storage: 'IndexedDB', saveTimer: null, saveQueue: Promise.resolve(), revision: 0 };
const sprite = () => workspace.sprites.find(s => s.id === workspace.activeId) || workspace.sprites[0];
const layer = () => sprite().layers.find(l => l.id === sprite().activeLayerId) || sprite().layers.at(-1);
const settings = () => workspace.settings;
const currentMap=()=>workspace.tilemaps.find(m=>m.id===state.mapId)||workspace.tilemaps[0];
const currentMapLayer=()=>currentMap()?.layers.find(l=>l.id===currentMap().activeLayerId)||currentMap()?.layers[0];
const allAssets=()=>[...workspace.sprites,...workspace.tilesets,...workspace.tilemaps];
const activeDocument=()=>state.view==='map'?currentMap():state.view==='tiles'?state.tile:sprite();
const assetView=asset=>({sprite:'pixel',tileset:'tiles',tilemap:'map'})[asset.kind];
function rememberTab(doc) {if(!doc?.id)return;if(!workspace.session.tabs.includes(doc.id))workspace.session.tabs.push(doc.id);workspace.session.activeTab=doc.id;workspace.session.view=state.view;}
function saveTabView(){const doc=activeDocument();if(state.view!=='library'&&doc)state.tabViews.set(doc.id,{zoom:state.zoom,pan:{...state.pan},selection:state.selection});}
function openDocument(id) {
  const doc=allAssets().find(a=>a.id===id);if(!doc)return;
  saveTabView();state.view=assetView(doc);state.selection=null;state.cursor=null;
  if(doc.kind==='sprite')workspace.activeId=id;
  if(doc.kind==='tileset'){state.tile=doc;settings().tile=structuredClone(doc.options);state.selectedTile=0;}
  if(doc.kind==='tilemap'){state.mapPickedSourceId=null;state.mapId=id;state.mapSourceId=doc.tilesetId||'textures';state.mapTile=3;state.textureSelection=null;state.mapCollectionId='';}
  rememberTab(doc);closeDialog();changed(false);render();
  const view=state.tabViews.get(id);if(view){state.zoom=view.zoom;state.pan=view.pan;state.selection=view.selection;positionCanvas();}else fitCanvas();
}
function checkCapacity(additionalPixels) { if (workspacePixelCount(workspace) + additionalPixels > MAX_WORKSPACE_PIXELS) throw new Error('This workspace can hold 32 million pixels across all layers and atlases. Export a backup and remove an unused asset to make room.'); }
const history = () => { const id=activeDocument()?.id||sprite().id;if (!state.history.has(id)) state.history.set(id, { undo: [], redo: [] }); return state.history.get(id); };
const texture = document.createElement('canvas'), repeatTexture = document.createElement('canvas'), mapPreviewTexture=document.createElement('canvas'),mapGridTexture=document.createElement('canvas');
let toastTimer;
function toast(message, error = false) {
  const el = $('#toast'); el.textContent = message; el.className = `show${error ? ' error' : ''}`;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.className = '', error ? 6500 : 3400);
}
function checkpoint() {
  const doc=activeDocument(),h = history(); h.undo.push(structuredClone(doc)); h.redo = [];
  const budget = Math.max(3, Math.min(40, Math.floor(24_000_000 / (doc.width * doc.height * (doc.layers?.length||1)))));
  if (h.undo.length > budget) h.undo.shift();
  updateHistory();
}
function replaceSprite(next) { workspace.sprites[workspace.sprites.findIndex(s => s.id === next.id)] = next; }
function undo(redo = false) {
  const h = history(), from = redo ? h.redo : h.undo, to = redo ? h.undo : h.redo;
  if (!from.length) return;
  to.push(structuredClone(activeDocument()));const next=from.pop();
  if(state.view==='pixel')replaceSprite(next);
  if(state.view==='tiles'){state.tile=next;settings().tile=structuredClone(next.options);workspace.tilesets[workspace.tilesets.findIndex(t=>t.id===next.id)]=next;for(const m of workspace.tilemaps)for(const l of m.layers)resolveMapTerrain(m,l,workspace);}
  if(state.view==='map')workspace.tilemaps[workspace.tilemaps.findIndex(m=>m.id===next.id)]=next;
  state.selection = null; changed(); render();
}
function updateHistory() {
  const h = history();
  for (const [action, disabled] of [['undo', !h.undo.length], ['redo', !h.redo.length]]) {
    const el = $(`[data-action="${action}"]`); if (el) el.disabled = disabled;
  }
}
function changed(touchDocument=true) {
  if(state.view!=='library'){
    const doc=activeDocument();if(doc){if(touchDocument)doc.updatedAt=Date.now();rememberTab(doc);}
    if(state.view==='tiles'&&state.tile?.id){const i=workspace.tilesets.findIndex(t=>t.id===state.tile.id);if(i>=0)workspace.tilesets[i]=state.tile;}
  }
  workspace.session.view=state.view;
  state.saved = false; state.revision++; updateSaveStatus();
  clearTimeout(state.saveTimer); state.saveTimer = setTimeout(persist, 450);
}
function persist() {
  clearTimeout(state.saveTimer);
  const revision = state.revision;
  // Snapshot synchronously so queued writes always preserve their order.
  const snapshot = { ...workspace, session:structuredClone(workspace.session), settings: structuredClone(workspace.settings), palettes: structuredClone(workspace.palettes), sprites: workspace.sprites.map(cloneSprite), tilesets: workspace.tilesets.map(t => structuredClone(t)),collections:structuredClone(workspace.collections),tilemaps:workspace.tilemaps.map(m=>structuredClone(m)) };
  state.saveQueue = state.saveQueue.catch(() => {}).then(async () => {
    try { state.storage = await saveWorkspace(snapshot); if (revision === state.revision) state.saved = true; updateSaveStatus(); }
    catch { state.saved = false; updateSaveStatus(true); toast('Browser storage is full or unavailable. Export a JSON backup to keep your work.', true); }
  });
  return state.saveQueue;
}
function updateSaveStatus(error = false) {
  const el = $('#save-status'); if (el) { el.innerHTML = `<span class="status-dot ${error ? 'failed' : ''}"></span>${error ? 'Save failed' : state.saved ? 'All changes saved' : 'Saving changes…'}`; el.title = `Saved in this browser with ${state.storage}`; }
}
function setView(view) {
  if (view === state.view) return;
  saveTabView();
  if(view==='library'){state.view=view;changed();closeDialog();render();return;}
  if(view==='pixel'){openDocument(sprite().id);return;}
  if(view==='tiles'){if(state.tile?.id){openDocument(state.tile.id);return;}if(workspace.tilesets.length){openDocument(workspace.tilesets[0].id);return;}newTileset();return;}
  if(view==='map'){if(currentMap()){openDocument(currentMap().id);return;}newMapDialog();}
}
function headerMarkup(){return `<header class="app-header"><a class="brand" href="./" aria-label="Pixfit home"><img src="./favicon.svg" alt="" width="34" height="34"/><span>pixfit<span class="brand-dot">.</span></span><span class="version">STUDIO</span></a><div class="header-actions">${button('library','folder','Library',`button quiet ${state.view==='library'?'active':''}`,`aria-current="${state.view==='library'?'page':'false'}"`)}${state.view==='library'?button('new','plus','New sprite','button dark'):button('export','download','Export','button dark')}${iconButton('settings','settings','Workspace settings')}</div></header>`;}
function footerMarkup(){return `<footer class="app-footer"><span><span class="status-dot"></span>Local-first. Yours forever.</span><span>Everything stays in your browser</span><button data-action="help" class="footer-link">${icon('help')}Shortcuts & help</button></footer>`;}
function tabsMarkup(){
  const active=id=>state.view!=='library'&&workspace.session.activeTab===id;
  return `<div class="document-tabs" role="tablist" aria-label="Open documents">${button('close-all-tabs','close','Close all','close-all-tabs',workspace.session.tabs.length?'':'disabled')}${workspace.session.tabs.map(id=>allAssets().find(a=>a.id===id)).filter(Boolean).map(a=>`<div class="document-tab ${active(a.id)?'active':''}" draggable="true" data-tab-id="${a.id}"><button role="tab" aria-selected="${active(a.id)}" data-action="open-tab" data-id="${a.id}" title="${escape(a.name)} · Drag to reorder, or press Alt + Arrow Left / Right" aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight">${icon(a.kind==='sprite'?'image':a.kind==='tileset'?'tiles':'grid')}<span>${escape(a.name)}</span></button>${iconButton('close-tab','close',`Close ${a.name}`,`data-id="${a.id}"`)}</div>`).join('')}<button class="new-tab" data-action="new-document" title="New document" aria-label="New document">${icon('plus')}</button></div>`;
}
function render() {
  applyTheme();
  if(state.view==='library'){renderLibraryPage();return;}
  const s = activeDocument(), tiles = state.view === 'tiles',maps=state.view==='map';
  $('#app').innerHTML = `
    ${headerMarkup()}
    <div class="workspace-bar"><div class="breadcrumbs"><span>Workspace</span>${icon('chevron')}<button data-action="rename">${escape(s.name)}${icon('pencil')}</button><span class="file-badge">${tiles ? 'AUTO TERRAIN' :maps?'TILEMAP': 'SPRITE'}</span></div><div class="workspace-bar-actions"><span id="save-status"></span><span class="divider"></span>${button('new-document','plus','New document','text-button')}</div></div>
    ${tabsMarkup()}
    <div class="editor-layout">
      <aside class="left-panel" id="left-panel" aria-label="Editing tools"></aside>
      <main class="editor-main">
        <div class="canvas-toolbar"><div class="document-title">${icon(tiles ? 'tiles' :maps?'grid': 'image')}<span>${escape(s.name)}</span><span class="dimensions" id="canvas-dimensions"></span></div><div class="canvas-actions">${iconButton('undo','undo','Undo (Ctrl+Z)')}${iconButton('redo','redo','Redo (Ctrl+Shift+Z)')}<span class="divider"></span>${tiles?button('tiles-to-map','grid','Use in map','text-button'):iconButton(maps?'resize-map':'resize','resize','Resize canvas')}${iconButton('grid','grid','Toggle grid (Ctrl+\')', `aria-pressed="${maps?settings().mapGrid:settings().grid}"`)}<button class="icon-button mobile-inspector" data-action="inspector" title="Layers and preview" aria-label="Layers and preview" aria-expanded="${state.inspector}">${icon('layers')}</button></div></div>
        <div class="stage" id="stage" tabindex="0" aria-label="${tiles ? 'Generated auto terrain preview' : 'Pixel editing canvas. Use the tools or keyboard shortcuts to edit.'}">
          <div class="stage-caption"><span class="tiny-dot"></span>${tiles ? 'A whole world, one tile at a time.' : 'A little space for pixel-perfect worlds.'}</div>
          <div id="canvas-position"><canvas id="art-canvas"></canvas><canvas id="selection-canvas"></canvas></div><canvas id="repeat-preview" aria-label="Repeating pattern preview"></canvas>
          <div id="brush-cursor"></div>
          <div class="stage-bottom"><span>${tiles ? 'AUTOMATIC COMPOSITING' : 'MADE OF LITTLE THINGS'}</span><span>${icon('sun')}Make something you love.</span></div>
          <div class="zoom-controls">${iconButton('zoom-out','minus','Zoom out')}<button id="zoom-label" data-action="zoom-reset" title="Reset zoom to 100%">600%</button>${iconButton('zoom-in','plus','Zoom in')}<span class="divider"></span>${iconButton('fit','fit','Fit canvas (F)')}</div>
        </div>
        <div class="canvas-footer"><span id="pointer-status">${icon(tiles ? 'tiles' : 'pencil')}<span>${tiles ? 'Generated auto terrain' : 'Pencil tool'}</span></span><span id="selection-status"></span><span class="canvas-tip">${tiles ? 'Click a tile to inspect · Scroll to zoom' : 'Space + drag to pan · Scroll to zoom'}</span></div>
      </main>
      <aside class="right-panel ${state.inspector ? 'inspector-open' : ''}" id="right-panel" aria-label="Preview and layers"></aside>
    </div>
    ${footerMarkup()}`;
  renderLeft(); renderRight(); updateHistory(); updateSaveStatus(); updateCanvas(); bindStage();
}
function sectionTitle(title, right = '') { return `<div class="section-title"><h2>${title}</h2>${right}</div>`; }

function paletteChoices(){
  return [...Object.entries(PALETTES).map(([id,p])=>({id,name:p.name.replace(/ · .*$/,''),colors:p.colors,builtin:true})),{id:'custom',name:'My palette',colors:workspace.palettes.custom},...workspace.palettes.saved];
}
function currentPalette(){return paletteChoices().find(p=>p.id===settings().palette)||paletteChoices()[0];}
function paletteColorRow(color){
  return `<div class="palette-color-row"><input class="palette-color-picker" type="color" value="${color}" aria-label="Choose palette color"/><input name="palette-color" value="${color}" aria-label="Palette hex color" pattern="#[0-9a-fA-F]{6}" maxlength="7" required spellcheck="false"/>${iconButton('palette-remove-color','trash','Remove color')}</div>`;
}
function paletteEditor(create=false,source=null){
  const selected=currentPalette(),copy=create||selected.builtin;
  if(copy&&workspace.palettes.saved.length>=MAX_PALETTES)throw new Error('Your workspace holds up to 32 named palettes.');
  const initial=source||(!create?selected:{name:'Untitled palette',colors:[]});
  const name=initial.name+(selected.builtin&&!create?' copy':'');
  showDialog(copy?'Create a palette':'Edit palette','Name your palette and edit its colors. Changes apply when you save.',
    `${selected.id==='custom'&&!copy?'<p class="field-note">My palette is your original custom collection. Duplicate it to give it a new name.</p>':nameField(name)}<div id="palette-colors">${initial.colors.map(paletteColorRow).join('')}</div>${button('palette-add-color','plus','Add foreground color','button outlined')}<p class="field-note">Up to 128 colors · Hex values use #RRGGBB. Built-in palettes are copied before editing.</p>`,
    'Save palette',data=>{
      const value=validatePalette({name:selected.id==='custom'&&!copy?'My palette':data.get('name'),colors:data.getAll('palette-color')});
      if(copy){const p={id:uid(),...value};workspace.palettes.saved.push(p);settings().palette=p.id;}
      else if(selected.id==='custom')workspace.palettes.custom=value.colors;
      else Object.assign(workspace.palettes.saved.find(p=>p.id===selected.id),value);
      changed();closeDialog();renderLeft();
    });
}
function deletePalette(){
  const p=currentPalette();if(!workspace.palettes.saved.some(item=>item.id===p.id))return;
  showDialog('Delete palette?',p.name,'<p class="field-note">This removes the palette from your workspace. Artwork already painted with these colors is preserved.</p>','Delete palette',()=>{
    workspace.palettes.saved=workspace.palettes.saved.filter(item=>item.id!==p.id);settings().palette='woodland';changed();closeDialog();renderLeft();
  });
}
function pickPalette(){
  const input=document.createElement('input');input.type='file';input.accept='.json,application/json';
  input.addEventListener('change',async()=>{
    try{
      const file=input.files[0];if(!file)return;
      if(file.size>100000)throw new Error('Choose a palette JSON file smaller than 100 KB.');
      if(workspace.palettes.saved.length>=MAX_PALETTES)throw new Error('Your workspace holds up to 32 named palettes.');
      const palette=importPalette(JSON.parse(await file.text()));workspace.palettes.saved.push(palette);settings().palette=palette.id;changed();renderLeft();toast('Palette imported.');
    }catch(error){toast(error.message,true);}
  });input.click();
}

function renderLeft() {
  if (state.view === 'tiles') { renderTilesLeft(); return; }
  if (state.view === 'map') { renderMapLeft(); return; }
  const opts = settings(), colors = currentPalette().colors, transparent=opts.color==='transparent';
  $('#left-panel').innerHTML = `
    <section class="panel-section tools-section">${sectionTitle('YOUR TOOLBOX', '<span class="key-hint">B</span>')}
      <div class="tool-grid">${toolList.map(([id,glyph,name,key]) => `<button class="tool-button ${state.tool === id ? 'active' : ''}" data-action="tool" data-tool="${id}" title="${name} (${key})" aria-label="${name} (${key})" aria-pressed="${state.tool === id}">${icon(glyph)}<span>${name}</span><kbd>${key}</kbd></button>`).join('')}</div>
      <div class="tool-description">${escape(({pencil:'Every great world starts with a pixel.',line:'Drag to draw a straight line. Brush size sets its thickness.',bucket:'Fill a connected area with your color.',picker:'Find your next color on the canvas.',rect:'Draw a rectangle to limit your edits.',ellipse:'Draw an ellipse to limit your edits.','color-select':'Select every visible pixel of one color.',move:'Drag a layer or selected pixels.',pan:'Drag to explore the infinite workspace.'})[state.tool])}</div>
    </section>
    <section class="panel-section">${sectionTitle('BRUSH', `<span class="subtle">${opts.brushSize} px</span>`)}
      <div class="brush-sizes">${[1,2,4,8,16].map(size => `<button data-action="brush" data-size="${size}" class="${opts.brushSize === size ? 'active' : ''}" title="${size} pixel brush" aria-label="${size} pixel brush" aria-pressed="${opts.brushSize === size}"><span style="width:${Math.min(18,size+3)}px;height:${Math.min(18,size+3)}px"></span></button>`).join('')}</div>
      <label class="range-row"><span>Size</span><input type="range" min="1" max="32" value="${opts.brushSize}" id="brush-range" aria-label="Brush size"/><output id="brush-output">${opts.brushSize}</output></label>
      <button data-action="dither" class="toggle-row" aria-pressed="${opts.dither}"><span>${icon('dither')}Dithering</span><span class="switch ${opts.dither ? 'on' : ''}"></span></button>
    </section>
    <section class="panel-section symmetry-section">${sectionTitle('SYMMETRY')}<div class="segmented">${button('mirror-x','mirrorX','Horizontal',opts.mirrorX ? 'active' : '', `aria-pressed="${opts.mirrorX}"`)}${button('mirror-y','mirrorY','Vertical',opts.mirrorY ? 'active' : '', `aria-pressed="${opts.mirrorY}"`)}</div></section>
    <section class="panel-section palette-section">${sectionTitle('COLOR PALETTE',iconButton('add-color','plus','Add foreground color to palette'))}
      <div class="palette-select-wrap"><select id="palette-select" aria-label="Color palette">${paletteChoices().map(p=>`<option value="${p.id}" ${opts.palette===p.id?'selected':''}>${escape(p.name)} · ${p.colors.length} colors</option>`).join('')}</select></div>
      <div class="palette-actions">${iconButton('new-palette','plus','New palette')}${iconButton('edit-palette','pencil','Edit palette')}${iconButton('duplicate-palette','copy','Duplicate palette')}${iconButton('import-palette','upload','Import palette')}${iconButton('export-palette','download','Export palette')}${iconButton('delete-palette','trash','Delete palette',workspace.palettes.saved.some(p=>p.id===opts.palette)?'':'disabled')}</div>
      <div class="palette-grid"><button class="swatch transparent-color ${transparent?'active':''}" data-action="color" data-color="transparent" title="Transparent · erase with any drawing tool" aria-label="Transparent" aria-pressed="${transparent}"></button>${colors.length ? colors.map(c => `<button class="swatch ${c.toLowerCase() === opts.color.toLowerCase() ? 'active' : ''}" data-action="color" data-color="${c}" style="--swatch:${c}" title="${c}" aria-label="Color ${c}" aria-pressed="${c.toLowerCase() === opts.color.toLowerCase()}"></button>`).join('') : '<p class="empty-palette">Add your foreground color with +, or open Edit palette.</p>'}</div>
      <div class="current-color"><label class="color-well ${transparent?'transparent-color':''}" title="Choose a color"><input id="color-input" type="color" value="${transparent?'#000000':opts.color}" aria-label="Choose foreground color"/></label><div><span>Foreground</span><input id="hex-input" aria-label="Hex color" value="${transparent?'Transparent':opts.color.toUpperCase()}" maxlength="11" spellcheck="false" pattern="#[0-9a-fA-F]{6}|[Tt]ransparent"/></div>${iconButton('swap-colors','swap','Swap foreground and background (X)')}<span class="background-color ${opts.secondaryColor==='transparent'?'transparent-color':''}" style="${opts.secondaryColor==='transparent'?'':`background:${opts.secondaryColor}`}" title="Background color ${opts.secondaryColor}"></span></div>
    </section>
    <section class="panel-section clipboard-section">${sectionTitle('SELECTION & CLIPBOARD')}<div class="clipboard-actions">${button('copy-selection','copy','Copy','button outlined')}${button('paste-selection','layers','Paste','button outlined',state.clipboard?'':'disabled')}</div><div class="clipboard-actions selection-transforms">${button('rotate-selection-left','undo','Rotate left','button outlined','disabled')}${button('rotate-selection-right','redo','Rotate right','button outlined','disabled')}${button('flip-selection-x','mirrorX','Flip horizontal','button outlined','disabled')}${button('flip-selection-y','mirrorY','Flip vertical','button outlined','disabled')}</div><p class="field-note">Rotate 90° from the selection's top left. Pixels beyond the canvas are cropped.</p><label class="checkbox-row"><input id="paste-new-layer" type="checkbox" ${opts.pasteNewLayer?'checked':''}/>Paste into a new layer</label><p class="field-note">Ctrl+C / Ctrl+V · Hold Ctrl to pick a color.</p></section>
    <div class="left-bottom">${button('import-image','upload','Import an image','button outlined full-width')}<p>A tiny canvas. Endless possibilities.</p></div>`;
  updateSelectionTransforms();
}
function renderRight() {
  if (state.view === 'tiles') { renderTilesRight(); return; }
  if (state.view === 'map') { renderMapRight(); return; }
  const s = sprite(), active = layer();
  $('#right-panel').innerHTML = `
    <section class="panel-section preview-section">${sectionTitle('NAVIGATOR','<span class="live-badge">LIVE</span>')}<div class="navigator checker"><canvas id="navigator" aria-label="Artwork preview"></canvas></div><label class="checkbox-row repeat-preview-toggle"><input id="sprite-repeat-preview" type="checkbox" ${state.spriteRepeatPreview?'checked':''}/>Preview as repeating pattern</label><div class="preview-meta"><span>${s.width} × ${s.height} px</span><span>RGBA</span></div></section>
    <section class="panel-section">${sectionTitle('TEXTURE CATEGORY')}${button('texture-category','folder',s.category||'Uncategorized','button outlined full-width',`data-id="${s.id}"`)}</section>
    <section class="panel-section layers-section">${sectionTitle('LAYERS',`<span class="subtle">${s.layers.length} layers</span>`)}

      <label class="range-row opacity-row"><span>Opacity</span><input id="opacity" type="range" min="0" max="100" value="${active.opacity}" aria-label="Layer opacity"/><output id="opacity-output">${active.opacity}%</output></label>
      <div class="layer-list">${[...s.layers].reverse().map(l => `<div class="layer-row ${l.id === active.id ? 'active' : ''}" data-layer="${l.id}"><button class="layer-pick" data-action="select-layer" data-id="${l.id}" aria-label="Select ${escape(l.name)}" aria-pressed="${l.id === active.id}"><span class="layer-thumb checker"><canvas data-layer-preview="${l.id}"></canvas></span><span class="layer-name">${escape(l.name)}<small>${l.id === active.id ? 'Active layer' : `${l.opacity}% opacity`}</small></span></button>${layerRowActions(s,l)}</div>`).join('')}</div>
      <div class="add-layer-bar">${button('add-layer','plus','Add layer','button outlined full-width')}</div>
    </section>
    <section class="panel-section assets-section">${sectionTitle('IN YOUR LIBRARY', '<button class="text-link" data-action="library">View all</button>')}${categoryFilter('sprite-category')}<div class="asset-strip">${texturesInCategory(workspace.sprites,currentCategory()).filter(a => a.id !== s.id).slice(0,3).map(a => `<button class="mini-asset" data-action="open-sprite" data-id="${a.id}" title="Open ${escape(a.name)}"><span class="checker"><canvas data-asset-preview="${a.id}"></canvas></span><span>${escape(a.name)}</span></button>`).join('')}</div></section>`;
  drawThumbnails();
}
function rememberBorderDetails(){
  state.borderDetailsOpen||={};
  document.querySelectorAll('[data-border-details]').forEach(el=>state.borderDetailsOpen[el.dataset.borderDetails]=el.open);
}
function borderTextureControls(opts,selected=false){
  const source=workspace.sprites.find(s=>s.id===opts.borderTexture),image=borderTextureImage(source,opts),native=opts.borderMapping==='native';
  const attr=key=>`data-border-option="${key}" data-border-selected="${selected}"`;
  const select=(key,label,items,value)=>`<label class="field-label">${label}<select ${attr(key)}>${items.map(([id,name])=>`<option value="${id}" ${String(value)===String(id)?'selected':''}>${name}</option>`).join('')}</select></label>`;
  const number=(key,label,value,min,max)=>`<label class="field-label">${label}<input type="number" ${attr(key)} min="${min}" max="${max}" value="${value||0}"/></label>`;
  return `<div class="border-texture-controls">${button('border-strip-preset','sparkles','Transparent strip · original pixels','button outlined full-width',`data-selected="${selected}" ${source?'':'disabled'}`)}
  ${image?`<div class="border-strip-preview checker"><canvas data-border-preview="${selected?'selected':'global'}" aria-label="Border strip from outer side to inner side"></canvas></div><p class="field-note">${image.width} × ${image.height} px strip · ${native?image.height*(opts.borderScale||1):opts.border} px across the edge. Preview rows run from outer side (top) to inner side (bottom).</p>`:'<p class="field-note">Choose your border sprite first.</p>'}
  ${select('borderMapping','Texture sizing',[['fit','Fit image to border width'],['native','Original pixels · keep padding']],opts.borderMapping||'fit')}
  <label class="checkbox-row"><input type="checkbox" ${attr('borderReverse')} ${opts.borderReverse?'checked':''}/>Reverse inner / outer side</label>
  <details class="border-texture-details" data-border-details="${selected?'selected':'global'}" ${state.borderDetailsOpen?.[selected?'selected':'global']?'open':''}><summary>Placement, repeat & padding</summary>
  ${select('borderAlign','Place strip',[['center','Centered on terrain edge'],['inner','Inside the inner terrain'],['outer','Outside the inner terrain']],opts.borderAlign||'center')}
  ${number('borderOffset','Offset across edge (px)',opts.borderOffset,-64,64)}<p class="field-note">Positive offset moves the strip inward without moving the terrain edge.</p>
  ${select('borderScale','Pixel scale',[['0.5','½×'],['1','1×'],['2','2×'],['4','4×']],opts.borderScale||1)}
  <p class="field-note">Scales the repeat length and, in Original pixels mode, the strip thickness.</p>
  ${number('borderRepeat','Repeat length (px · 0 = automatic)',opts.borderRepeat,0,512)}
  ${number('borderPhase','Slide along edge (px)',opts.borderPhase,-512,512)}
  ${select('borderRotation','Rotate source strip',[[0,'0° · horizontal strip'],[90,'90°'],[180,'180°'],[270,'270°']],opts.borderRotation||0)}
  <label class="checkbox-row"><input type="checkbox" ${attr('borderTrim')} ${opts.borderTrim?'checked':''}/>Trim fully transparent rows</label>
  <p class="field-note">Keep padding for a half-transparent strip. Trim it when you want only the visible artwork fitted to the border. Transparent pixels reveal the terrain underneath.</p></details></div>`;
}
function drawBorderTexturePreviews(){
  document.querySelectorAll('[data-border-preview]').forEach(canvas=>{
    const override=canvas.dataset.borderPreview==='selected'?settings().tile.overrides?.[state.selectedTile]||{}:{};
    const opts={...settings().tile,...override,borderTexture:override.borderTexture||settings().tile.borderTexture};
    let image=borderTextureImage(workspace.sprites.find(s=>s.id===opts.borderTexture),opts);if(!image)return;
    if(opts.borderReverse)image=transformImage(image,0,false,true);
    paintCanvas(canvas,image.pixels,image.width,image.height);
  });
}
function renderTilesLeft() {
  rememberBorderDetails();
  const opts = settings().tile;
  const source = (key, title, letter) => `<label class="source-label"><span><i>${letter}</i>${title}</span><select id="${key}" aria-label="${title}">${key === 'terrainB' ? '<option value="">Transparent</option>' : ''}${spriteOptions(opts[key])}</select></label>`;
  $('#left-panel').innerHTML = `
    <section class="panel-section">${sectionTitle('TERRAIN SOURCES','<span class="key-hint">01</span>')}<p class="section-copy">Mix two textures. We’ll take care of the connections.</p>${categoryFilter('terrain-category')}${source('terrainA','Inner terrain','A')}${source('terrainB','Outer terrain','B')}<div class="terrain-samples"><div class="checker"><canvas id="terrain-a-preview"></canvas><span>Inside</span></div>${icon('swap')}<div class="checker"><canvas id="terrain-b-preview"></canvas><span>${opts.terrainB ? 'Outside' : 'Transparent'}</span></div></div>${button('import-terrain','upload','Import texture','text-button')}</section>
    <section class="panel-section">${sectionTitle('TILE CONFIGURATION','<span class="key-hint">02</span>')}<label class="field-label">Tile size<select id="tile-size">${[8,16,32,64].map(n=>`<option value="${n}" ${opts.size===n?'selected':''}>${n} × ${n} pixels</option>`).join('')}</select></label><label class="field-label">Compositing mode<select id="tile-mode"><option value="wang" ${opts.mode==='wang'?'selected':''}>16 tiles · Corner terrain</option><option value="blob" ${opts.mode==='blob'?'selected':''}>47 tiles · Blob autotile</option></select></label><label class="field-label">Atlas columns<select id="tile-columns">${[4,8,16].map(n=>`<option value="${n}" ${opts.columns===n?'selected':''}>${n} columns</option>`).join('')}</select></label></section>
    <section class="panel-section">${sectionTitle('TRANSITION BORDER','<span class="key-hint">03</span>')}<label class="field-label">Border type<select id="tile-border-type">${['none','dither','texture'].map(type=>`<option value="${type}" ${(opts.borderType||'dither')===type?'selected':''}>${{none:'Hard edge',dither:'Dithered blend',texture:'Transition texture'}[type]}</option>`).join('')}</select></label>${(opts.borderType==='texture')?`<label class="field-label">Transition texture<select id="tile-border-texture"><option value="">Choose a sprite…</option>${spriteOptions(opts.borderTexture)}</select></label>${borderTextureControls(opts)}`:''}<label class="range-row"><span>Border width</span><input id="tile-border" ${opts.borderType==='texture'&&opts.borderMapping==='native'?'disabled':''} type="range" min="0" max="${opts.size}" value="${opts.border}"/><output>${opts.borderType==='texture'&&opts.borderMapping==='native'?'native':opts.border+' px'}</output></label><label class="field-label">Cutoff / inset (pixels)<input id="tile-cutoff" type="number" min="-${opts.size}" max="${opts.size}" value="${opts.cutoff||0}"/></label><p class="field-note">Positive cutoff shrinks the inner terrain. Negative values expand it.</p></section>
    <section class="panel-section">${sectionTitle('SHAPES & PROJECTION')}<label class="checkbox-row"><input id="tile-slopes1" type="checkbox" ${opts.slopes1?'checked':''}/>Generate 1 × 1 slopes</label><label class="checkbox-row"><input id="tile-slopes2" type="checkbox" ${opts.slopes2?'checked':''}/>Generate 1 × 2 slopes</label><p class="field-note">Four directions per slope size. Rotate a tall slope to make it wide.</p><button data-action="tile-iso" class="toggle-row" aria-pressed="${opts.isometric}"><span>${icon('iso')}Isometric projection</span><span class="switch ${opts.isometric?'on':''}"></span></button><button data-action="tile-gap" class="toggle-row" aria-pressed="${opts.gap}"><span>${icon('grid')}1 px tile spacing</span><span class="switch ${opts.gap?'on':''}"></span></button></section>
    <div class="left-bottom">${button('generate','sparkles','Generate auto terrain','button accent full-width')}${button('import-atlas','upload','Import tile atlas','text-button atlas-import')}<p>Made from your pixels. Connected for you.</p></div>`;
  drawTerrainPreviews();drawBorderTexturePreviews();
}
function renderTilesRight() {
  rememberBorderDetails();
  const t = state.tile,tile=tileDescriptors(t)[state.selectedTile],override=settings().tile.overrides?.[state.selectedTile]||{},animation=t.animations?.[state.selectedTile];
  $('#right-panel').innerHTML = `<section class="panel-section preview-section">${sectionTitle('TILE INSPECTOR','<span class="live-badge">LIVE</span>')}<div class="navigator checker tile-inspector"><canvas id="tile-preview"></canvas></div><div class="preview-meta"><span id="tile-name">Tile ${state.selectedTile+1}</span><span>${tile.width} × ${tile.height} px</span></div><div class="tile-stepper">${iconButton('previous-tile','chevron','Previous tile') }<span>${tile.kind==='terrain'?'Terrain tile':tile.kind.replace('slope-','')+' slope'}</span>${iconButton('next-tile','chevron','Next tile')}</div></section>
    <section class="panel-section">${sectionTitle('THIS TILE',button('reset-tile','undo','Reset','text-button',t.imported?'disabled':''))}<div class="tile-transforms">${button('rotate-tile','redo',`${override.rotation||0}°`,'button outlined')}${button('flip-tile-x','mirrorX','Flip X',`button outlined ${override.flipX?'active':''}`)}${button('flip-tile-y','mirrorY','Flip Y',`button outlined ${override.flipY?'active':''}`)}</div>${t.imported?'<p class="field-note">Transforms edit the imported pixels. To generate texture borders, choose terrain sources and press Generate.</p>':`<label class="field-label">Border override<select id="selected-border-type">${[['inherit','Use terrain border'],['none','Hard edge'],['dither','Dithered blend'],['texture','Transition texture']].map(([value,name])=>`<option value="${value}" ${(override.borderType||'inherit')===value?'selected':''}>${name}</option>`).join('')}</select></label>${(override.borderType==='texture'||((!override.borderType||override.borderType==='inherit')&&settings().tile.borderType==='texture'))?`<label class="field-label">Texture<select id="selected-border-texture"><option value="">Use terrain texture</option>${spriteOptions(override.borderTexture)}</select></label>${borderTextureControls({...settings().tile,...override,borderTexture:override.borderTexture||settings().tile.borderTexture},true)}`:''}<div class="compact-fields"><label class="field-label">Width (px)<input id="selected-border" ${(override.borderMapping||settings().tile.borderMapping)==='native'&&(override.borderType==='texture'||((!override.borderType||override.borderType==='inherit')&&settings().tile.borderType==='texture'))?'disabled':''} type="number" min="0" max="${settings().tile.size}" value="${override.border??settings().tile.border}"/></label><label class="field-label">Cutoff (px)<input id="selected-cutoff" type="number" min="-${settings().tile.size}" max="${settings().tile.size}" value="${override.cutoff??settings().tile.cutoff??0}"/></label></div>`}</section>
    <section class="panel-section">${sectionTitle('ANIMATED TILE',button('play-animation',state.animationPlaying?'minus':'arrow',state.animationPlaying?'Pause':'Play','text-button'))}<label class="field-label">Frame tiles (in order)<input id="animation-frames" type="text" value="${animation?animation.frames.map(n=>n+1).join(', '):''}" placeholder="e.g. 1, 2, 3, 2"/></label><label class="field-label">Frames per second<input id="animation-fps" type="number" min="1" max="60" value="${animation?.fps||8}"/></label><div class="clipboard-actions">${button('save-animation','check','Apply','button outlined')}${button('clear-animation','trash','Clear','button outlined',animation?'':'disabled')}</div><p class="field-note">Use up to 32 frames with matching dimensions. Previewed here and in tilemaps; exported to Godot.</p></section>
    <section class="panel-section">${sectionTitle('YOUR AUTO TERRAIN')}<dl class="spec-list"><div><dt>${t.imported?'Tiles imported':'Tiles generated'}</dt><dd>${t.masks.length}</dd></div><div><dt>Atlas size</dt><dd>${t.width} × ${t.height}</dd></div><div><dt>Projection</dt><dd>${t.imported?'Original image':settings().tile.isometric?'Isometric':'Orthogonal'}</dd></div><div><dt>Animations</dt><dd>${Object.keys(t.animations||{}).length}</dd></div></dl>${button('godot-export','download','Export to Godot 4','button accent full-width')}</section>`;
  drawTilePreview();drawBorderTexturePreviews();
}
function currentCategory(){
  const category=settings().textureCategory??'*';
  return category==='*'||category===''||textureCategories(workspace.sprites).includes(category)?category:'*';
}
function categoryFilter(id){
  const value=currentCategory();
  return `<label class="field-label texture-category-filter">Texture category<select id="${id}"><option value="*" ${value==='*'?'selected':''}>All categories</option><option value="" ${value===''?'selected':''}>Uncategorized</option>${textureCategories(workspace.sprites).map(c=>`<option value="${escape(c)}" ${value===c?'selected':''}>${escape(c)}</option>`).join('')}</select></label>`;
}
function spriteOptions(selected,category=state.view==='tiles'?currentCategory():'*',pin=true){
  const visible=texturesInCategory(workspace.sprites,category),current=workspace.sprites.find(s=>s.id===selected),outside=current&&!visible.includes(current);
  return [...(pin&&outside?[current]:[]),...visible].map(s=>`<option value="${s.id}" ${s.id===selected?'selected':''}>${escape(s.name)}${pin&&outside&&s===current?' · current selection':''}</option>`).join('');
}
function textureCategoryDialog(id){
  const texture=workspace.sprites.find(s=>s.id===id);if(!texture)return;
  showDialog('Texture category',texture.name,`<label class="field-label">Category<input name="category" type="text" list="texture-categories" maxlength="48" value="${escape(texture.category||'')}" placeholder="e.g. Forest, Water, Buildings"/></label><datalist id="texture-categories">${textureCategories(workspace.sprites).map(c=>`<option value="${escape(c)}"></option>`).join('')}</datalist><p class="field-note">Choose an existing category or type a new one. Leave blank for Uncategorized.</p>`,'Save category',data=>{
    if(state.view==='pixel'&&sprite().id===id)checkpoint();
    const category=cleanCategory(data.get('category'));if(category)texture.category=category;else delete texture.category;
    texture.updatedAt=Date.now();changed();closeDialog();if(state.view==='library')renderLibraryPage();else renderRight();
  });
}
function mapTextureChoices(){
  const visible=texturesInCategory(workspace.sprites,currentCategory()),picked=workspace.sprites.find(s=>s.id===state.mapPickedSourceId);
  return picked&&!visible.includes(picked)?[picked,...visible]:visible;
}
function mapAtlasChoices(){
  const category=currentCategory(),textureIds=new Set(mapTextureChoices().map(s=>s.id)),collection=workspace.collections.find(c=>c.id===state.mapCollectionId);
  return workspace.tilesets.filter(t=>(!collection||collection.terrainIds.includes(t.id))&&(category==='*'||t.id===state.mapPickedSourceId||textureIds.has(t.options.terrainA)||textureIds.has(t.options.terrainB)));
}

function paintCanvas(canvas, pixels, width, height) {
  if (!canvas) return;
  canvas.width = width; canvas.height = height;
  canvas.getContext('2d').putImageData(new ImageData(imageBytes(pixels), width, height), 0, 0);
}
function drawThumbnails() {
  const s = sprite(); paintCanvas($('#navigator'), composite(s), s.width, s.height);
  document.querySelectorAll('[data-layer-preview]').forEach(el => { const l=s.layers.find(l=>l.id===el.dataset.layerPreview); if(l) paintCanvas(el,l.pixels,s.width,s.height); });
  document.querySelectorAll('[data-asset-preview]').forEach(el => { const a=allAssets().find(a=>a.id===el.dataset.assetPreview);if(!a)return;const image=a.kind==='tilemap'?renderTilemap(a,workspace):a.kind==='sprite'?{...a,pixels:composite(a)}:a;paintCanvas(el,image.pixels,image.width,image.height); });
}
function drawTerrainPreviews() {
  ['A','B'].forEach(letter=>{const s=workspace.sprites.find(s=>s.id===settings().tile[`terrain${letter}`]);if(s)paintCanvas($(`#terrain-${letter.toLowerCase()}-preview`),composite(s),s.width,s.height);});
}
function drawTilePreview() {
  if(!state.tile)return;const t=state.tile,index=state.selectedTile,tile=extractTile(t,animatedTileIndex(t,index,state.animationPlaying?performance.now()/1000:0));
  paintCanvas($('#tile-preview'),tile.pixels,tile.width,tile.height);
  if($('#tile-name'))$('#tile-name').textContent=`Tile ${index+1}${t.masks[index]===null?'':` · Mask ${t.masks[index]}`}`;
}
function regenerate() {
  const opts = settings().tile, a=workspace.sprites.find(s=>s.id===opts.terrainA)||sprite(), b=workspace.sprites.find(s=>s.id===opts.terrainB);
  opts.terrainA=a.id;
  // A transparent layer is an explicit outer terrain, while core also supports default colors.
  const empty= b || makeSprite('Transparent',1,1);
  const previous=state.tile;
  const next=buildTileset(a,empty,opts,workspace.sprites);
  for(const map of workspace.tilemaps)if(map.layers.some(l=>l.cells.some((id,i)=>id>next.masks.length&&((l.sources?.[i]||0)?map.sources[l.sources[i]-1]?.assetId===previous?.id:map.tilesetId===previous?.id))))throw new Error('This configuration removes tiles used in a map. Duplicate the tileset first, or erase those tiles in the map.');
  checkCapacity(next.width*next.height-(previous?.id?previous.width*previous.height:0));
  state.tile={...next,id:previous?.id||uid(),kind:'tileset',name:previous?.name||'Terrain transitions',animations:structuredClone(previous?.animations||{}),updatedAt:Date.now()};
  if(!previous?.id)workspace.tilesets.push(state.tile);
  for(const m of workspace.tilemaps.filter(m=>m.tilesetId===state.tile.id||m.sources?.some(s=>s.assetId===state.tile.id)))for(const l of m.layers)resolveMapTerrain(m,l,{...workspace,tilesets:workspace.tilesets.map(t=>t.id===state.tile.id?state.tile:t)});
  const descriptors=tileDescriptors(state.tile);
  for(const [key,anim] of Object.entries(state.tile.animations)){const base=descriptors[Number(key)];if(!base||anim.frames.some(i=>!descriptors[i]||descriptors[i].width!==base.width||descriptors[i].height!==base.height))delete state.tile.animations[key];}
  state.selectedTile=Math.min(state.selectedTile,state.tile.masks.length-1);
}
function dimensions() { return state.view==='pixel'?sprite():state.view==='map'?{width:currentMap().width*currentMap().cellWidth,height:currentMap().height*currentMap().cellHeight}:state.tile; }
let pendingMapPaint=null,mapPaintFrame=0;
const unionBounds=(a,b)=>a?{x0:Math.min(a.x0,b.x0),y0:Math.min(a.y0,b.y0),x1:Math.max(a.x1,b.x1),y1:Math.max(a.y1,b.y1)}:{...b};
function mapSpans(){
  const m=currentMap(),ids=new Set([m.tilesetId,...(m.sources||[]).map(s=>s.assetId)]);let x=1,y=1;
  for(const atlas of workspace.tilesets)if(ids.has(atlas.id))for(const tile of tileDescriptors(atlas)){x=Math.max(x,tile.spanX);y=Math.max(y,tile.spanY);}
  return {x,y};
}
function drawMapNavigator(){
  const canvas=$('#map-navigator'),art=$('#art-canvas');if(!canvas||!art)return;
  const scale=Math.min(1,220/art.width,170/art.height),width=Math.max(1,Math.round(art.width*scale)),height=Math.max(1,Math.round(art.height*scale));
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  const ctx=canvas.getContext('2d');ctx.clearRect(0,0,width,height);ctx.imageSmoothingEnabled=false;ctx.drawImage(art,0,0,width,height);
}
function drawMapRegion(bounds){
  const m=currentMap(),art=$('#art-canvas');if(!art||!state.mapFrame)return;
  const x=Math.max(0,bounds.x0)*m.cellWidth,y=Math.max(0,bounds.y0)*m.cellHeight;
  const width=(Math.min(m.width-1,bounds.x1)+1)*m.cellWidth-x,height=(Math.min(m.height-1,bounds.y1)+1)*m.cellHeight-y;if(width<=0||height<=0)return;
  const patch=renderTilemap(m,workspace,state.animationPlaying?performance.now()/1000:0,{x,y,width,height});
  for(let row=0;row<height;row++)state.mapFrame.pixels.set(patch.pixels.subarray(row*width,(row+1)*width),(y+row)*state.mapFrame.width+x);
  art.getContext('2d').putImageData(new ImageData(imageBytes(patch.pixels),width,height),x,y);
  drawMapNavigator();drawOverlay();
}
function queueMapPaint(map,layer,bounds){
  if(pendingMapPaint&&(pendingMapPaint.map!==map||pendingMapPaint.layer!==layer))flushMapPaint();
  pendingMapPaint={map,layer,bounds:unionBounds(pendingMapPaint?.bounds,bounds)};
  if(!mapPaintFrame)mapPaintFrame=requestAnimationFrame(()=>flushMapPaint());
}
function flushMapPaint(draw=true){
  if(mapPaintFrame){cancelAnimationFrame(mapPaintFrame);mapPaintFrame=0;}
  const pending=pendingMapPaint;pendingMapPaint=null;if(!pending)return;
  const {map,layer,bounds}=pending,area={x0:Math.max(0,bounds.x0-1),y0:Math.max(0,bounds.y0-1),x1:Math.min(map.width-1,bounds.x1+1),y1:Math.min(map.height-1,bounds.y1+1)};
  resolveMapTerrain(map,layer,workspace,area);
  if(draw&&state.view==='map'&&currentMap()===map){const span=state.mapSpans||{x:1,y:1};drawMapRegion({...area,x1:area.x1+span.x-1,y1:area.y1+span.y-1});}
}
function updateCanvas() {
  if(!$('#art-canvas'))return;
  flushMapPaint(false);
  const s=dimensions();if(state.view==='map'){state.mapSpans=mapSpans();state.mapAnimations=mapAnimationCells(currentMap(),workspace);state.mapFrame=renderTilemap(currentMap(),workspace,state.animationPlaying?performance.now()/1000:0);}paintCanvas($('#art-canvas'),state.view==='pixel'?composite(s):state.view==='map'?state.mapFrame.pixels:s.pixels,s.width,s.height);
  $('#canvas-dimensions').textContent=`${s.width} × ${s.height}`;
  positionCanvas(); if(state.view==='pixel')drawThumbnails(); else if(state.view==='tiles')drawTilePreview();else drawMapNavigator();
}
function drawRepeatPreview() {
  const preview=$('#repeat-preview'),stage=$('#stage');if(!preview||!stage)return;
  const active=state.view==='pixel'&&state.spriteRepeatPreview;
  stage.classList.toggle('repeat-preview-active',active);if(!active)return;
  const s=sprite(),pixels=composite(s),width=stage.clientWidth,height=stage.clientHeight;
  paintCanvas(repeatTexture,pixels,s.width,s.height);preview.width=width;preview.height=height;
  const ctx=preview.getContext('2d');ctx.imageSmoothingEnabled=false;
  const tileWidth=s.width*state.zoom,tileHeight=s.height*state.zoom,originX=width/2+state.pan.x-tileWidth/2,originY=height/2+state.pan.y-tileHeight/2;
  for(let y=-1;y<=1;y++)for(let x=-1;x<=1;x++)if(x||y)ctx.drawImage(repeatTexture,originX+x*tileWidth,originY+y*tileHeight,tileWidth,tileHeight);
}
function positionCanvas() {
  const stage=$('#stage'), position=$('#canvas-position');if(!stage||!position)return;
  const d=dimensions(),width=d.width*state.zoom,height=d.height*state.zoom;
  position.style.width=`${width}px`;position.style.height=`${height}px`;
  position.style.left=`${stage.clientWidth/2+state.pan.x-width/2}px`;position.style.top=`${stage.clientHeight/2+state.pan.y-height/2}px`;
  $('#zoom-label').textContent=`${Math.round(state.zoom*100)}%`;
  stage.classList.toggle('panning',state.space||(state.view==='pixel'&&state.tool==='pan')||(state.view==='map'&&state.mapTool==='pan'));
  drawRepeatPreview();drawOverlay();updateCursor();
}
function drawOverlay() {
  const canvas=$('#selection-canvas');if(!canvas)return;
  const d=dimensions(),scale=Math.max(.25,Math.min(state.zoom,12,2048/Math.max(d.width,d.height)));
  const width=Math.ceil(d.width*scale),height=Math.ceil(d.height*scale);
  if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
  const ctx=canvas.getContext('2d');ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,width,height);ctx.setLineDash([]);ctx.globalAlpha=1;ctx.imageSmoothingEnabled=false;ctx.scale(scale,scale);
  if(state.view==='map'&&settings().mapGrid){
    const m=currentMap(),key=`${width}:${height}:${scale}:${m.cellWidth}:${m.cellHeight}`;
    if(state.mapGridKey!==key){
      state.mapGridKey=key;mapGridTexture.width=width;mapGridTexture.height=height;const grid=mapGridTexture.getContext('2d');grid.scale(scale,scale);
      grid.beginPath();grid.strokeStyle='rgba(41,47,50,.15)';grid.lineWidth=1/scale;
      for(let x=0;x<=d.width;x+=m.cellWidth){grid.moveTo(x,0);grid.lineTo(x,d.height);}for(let y=0;y<=d.height;y+=m.cellHeight){grid.moveTo(0,y);grid.lineTo(d.width,y);}grid.stroke();
    }
    ctx.drawImage(mapGridTexture,0,0,width/scale,height/scale);
  }else if(state.view!=='map'&&settings().grid&&state.zoom>=4){
    ctx.beginPath();ctx.strokeStyle='rgba(41,47,50,.15)';ctx.lineWidth=1/scale;
    for(let x=0;x<=d.width;x++){ctx.moveTo(x,0);ctx.lineTo(x,d.height);}for(let y=0;y<=d.height;y++){ctx.moveTo(0,y);ctx.lineTo(d.width,y);}ctx.stroke();
  }
  if(state.view==='pixel'&&state.selection) {
    const mask=state.selection,w=d.width,h=d.height;ctx.fillStyle='rgba(159,190,221,.23)';ctx.beginPath();
    for(let y=0;y<h;y++)for(let x=0;x<w;x++) {const i=y*w+x;if(!mask[i])continue;ctx.fillRect(x,y,1,1);if(!y||!mask[i-w]){ctx.moveTo(x,y);ctx.lineTo(x+1,y);}if(y===h-1||!mask[i+w]){ctx.moveTo(x,y+1);ctx.lineTo(x+1,y+1);}if(!x||!mask[i-1]){ctx.moveTo(x,y);ctx.lineTo(x,y+1);}if(x===w-1||!mask[i+1]){ctx.moveTo(x+1,y);ctx.lineTo(x+1,y+1);}}
    ctx.strokeStyle='#fff';ctx.lineWidth=2/scale;ctx.stroke();ctx.strokeStyle='#425b68';ctx.lineWidth=1/scale;ctx.setLineDash([4/scale,4/scale]);ctx.stroke();
  }
  if(state.view==='tiles') {
    const tile=tileDescriptors(state.tile)[state.selectedTile];ctx.strokeStyle='#effacb';ctx.lineWidth=2/scale;ctx.strokeRect(tile.x+1/scale,tile.y+1/scale,tile.width-2/scale,tile.height-2/scale);
  }
  const preview=mapDecalPreview();
  if(preview){
    if(state.mapPreviewImage!==preview.image){paintCanvas(mapPreviewTexture,preview.image.pixels,preview.image.width,preview.image.height);state.mapPreviewImage=preview.image;}
    ctx.globalAlpha=.58;ctx.drawImage(mapPreviewTexture,preview.x,preview.y);ctx.globalAlpha=1;
    ctx.strokeStyle='#d7efae';ctx.lineWidth=1/scale;ctx.setLineDash([4/scale,3/scale]);ctx.strokeRect(preview.x,preview.y,preview.image.width,preview.image.height);ctx.setLineDash([]);
  }
  const count=state.selection?.reduce((n,v)=>n+v,0)||0;
  const status=$('#selection-status');if(status)status.innerHTML=state.selection?`<button class="text-link" data-action="deselect">${count.toLocaleString()} px selected ×</button>`:'';
  updateSelectionTransforms(count);
}
function updateSelectionTransforms(count=state.selection?.reduce((n,v)=>n+v,0)||0){
  document.querySelectorAll('.selection-transforms button').forEach(button=>button.disabled=state.view!=='pixel'||!count||!layer().visible);
}
function mapDecalPreview(point=state.cursor){
  if(state.view!=='map'||state.mapTool!=='paint'||state.drag||!point)return null;
  const p=point,m=currentMap();if(p.x<0||p.y<0||p.x>=m.width*m.cellWidth||p.y>=m.height*m.cellHeight)return null;
  const brush=state.mapBrushes?.find(b=>b.id===state.mapTile);if(brush?.kind!=='pattern')return null;
  return {image:state.mapBrushImages.get(brush.id),x:Math.floor(p.x/m.cellWidth)*m.cellWidth,y:Math.floor(p.y/m.cellHeight)*m.cellHeight};
}
function fitCanvas() {
  const stage=$('#stage'), d=dimensions();if(!stage)return;
  const available=Math.min((stage.clientWidth-100)/d.width,(stage.clientHeight-130)/d.height);
  state.zoom=clamp(available>=1?Math.floor(available):available,.25,24);state.pan={x:0,y:0};positionCanvas();
}
function zoomBy(factor, clientX, clientY) {
  const stage=$('#stage'),rect=stage.getBoundingClientRect(),old=state.zoom,next=clamp(old*factor,.25,40);
  const x=clientX==null?0:clientX-rect.left-rect.width/2,y=clientY==null?0:clientY-rect.top-rect.height/2;
  state.pan.x=x-(x-state.pan.x)*next/old;state.pan.y=y-(y-state.pan.y)*next/old;state.zoom=next;positionCanvas();
}
function canvasPoint(e) {const rect=$('#canvas-position').getBoundingClientRect();return{x:Math.floor((e.clientX-rect.left)/state.zoom),y:Math.floor((e.clientY-rect.top)/state.zoom)};}
function updateCursor() {
  const cursor=$('#brush-cursor');if(!cursor)return;const p=state.cursor,d=dimensions();
  if(state.view!=='pixel'||!p||p.x<0||p.y<0||p.x>=d.width||p.y>=d.height||!['pencil','line'].includes(state.tool)||state.space){cursor.style.display='none';return;}
  const stage=$('#stage'),size=settings().brushSize,offset=Math.floor(size/2);
  cursor.style.cssText=`display:block;left:${stage.clientWidth/2+state.pan.x+(p.x-offset-d.width/2)*state.zoom}px;top:${stage.clientHeight/2+state.pan.y+(p.y-offset-d.height/2)*state.zoom}px;width:${size*state.zoom}px;height:${size*state.zoom}px`;
}
function brushAt(x,y,event) {
  stamp(layer().pixels,sprite().width,sprite().height,x,y,hexToColor(event?.button===2||state.drag?.button===2?settings().secondaryColor:settings().color),{size:settings().brushSize,mirrorX:settings().mirrorX,mirrorY:settings().mirrorY,dither:settings().dither,selection:state.selection});
}
function previewLine(p) {
  const drag=state.drag,d=dimensions();
  layer().pixels.set(drag.pixels);
  const x=clamp(p.x,-32,d.width+32),y=clamp(p.y,-32,d.height+32);
  linePoints(drag.start.x,drag.start.y,x,y,(px,py)=>brushAt(px,py));
  updateCanvas();
}
function bindStage() {
  const stage=$('#stage');
  stage.addEventListener('contextmenu',e=>e.preventDefault());
  stage.addEventListener('wheel',e=>{e.preventDefault();zoomBy(e.deltaY<0?1.12:1/1.12,e.clientX,e.clientY);},{passive:false});
  stage.addEventListener('pointerdown',e=>{
    if(e.target.closest('button'))return;e.preventDefault();stage.focus();stage.setPointerCapture(e.pointerId);
    const p=canvasPoint(e),d=dimensions();
    if(state.space||(state.view==='pixel'&&state.tool==='pan')||(state.view==='map'&&state.mapTool==='pan')||e.button===1){state.drag={type:'pan',clientX:e.clientX,clientY:e.clientY,pan:{...state.pan}};stage.classList.add('dragging');return;}
    if(p.x<0||p.y<0||p.x>=d.width||p.y>=d.height)return;
    if(state.view==='tiles'){const tile=tileDescriptors(state.tile).find(t=>p.x>=t.x&&p.x<t.x+t.width&&p.y>=t.y&&p.y<t.y+t.height);if(tile){state.selectedTile=tile.id;drawOverlay();renderTilesRight();}return;}
    if(state.view==='map'){mapPointerDown(p,e);return;}
    const tool=e.ctrlKey||e.altKey?'picker':state.tool;
    if(tool==='picker'){const c=composite(sprite())[p.y*d.width+p.x];settings().color=c&255?colorToHex(c):'transparent';changed();renderLeft();return;}
    if(tool==='color-select'){const pixels=composite(sprite()),target=pixels[p.y*d.width+p.x];state.selection=Uint8Array.from(pixels,v=>v===target?1:0);drawOverlay();return;}
    if(tool==='rect'||tool==='ellipse'){state.drag={type:tool,start:p};state.selection=shapeSelection(d.width,d.height,p.x,p.y,p.x,p.y,tool==='ellipse');drawOverlay();return;}
    if(!layer().visible){toast('Show the active layer before editing it.');return;}
    checkpoint();
    if(tool==='bucket'){
      const points=[[p.x,p.y]],opts=settings();if(opts.mirrorX)points.push([d.width-1-p.x,p.y]);if(opts.mirrorY)points.push([p.x,d.height-1-p.y]);if(opts.mirrorX&&opts.mirrorY)points.push([d.width-1-p.x,d.height-1-p.y]);
      for(const [x,y] of points)floodFill(layer().pixels,d.width,d.height,x,y,hexToColor(e.button===2?opts.secondaryColor:opts.color),state.selection,opts.dither);changed();updateCanvas();return;
    }
    if(tool==='move'){state.drag={type:'move',start:p,pixels:new Uint32Array(layer().pixels),selection:state.selection?new Uint8Array(state.selection):null};return;}
    if(tool==='line'){state.drag={type:'line',start:p,pixels:new Uint32Array(layer().pixels),button:e.button};previewLine(p);return;}
    state.drag={type:'draw',last:p,button:e.button};brushAt(p.x,p.y,e);updateCanvas();
  });
  stage.addEventListener('pointermove',e=>{
    const p=canvasPoint(e);state.cursor=p;updateCursor();
    if(state.view==='map'&&!state.drag){const m=currentMap(),key=`${Math.floor(p.x/m.cellWidth)}:${Math.floor(p.y/m.cellHeight)}:${state.mapTool}:${state.mapTile}`;if(state.mapHoverKey!==key){state.mapHoverKey=key;drawOverlay();}}
    const d=dimensions();const label=$('#pointer-status');if(label)label.innerHTML=`${icon(state.view==='tiles'?'tiles':toolList.find(t=>t[0]===state.tool)?.[1]||'pencil')}<span>${p.x>=0&&p.y>=0&&p.x<d.width&&p.y<d.height?`X: ${p.x} <span class="coordinate-y">Y: ${p.y}</span>`:state.view==='tiles'?'Auto terrain preview':toolList.find(t=>t[0]===state.tool)?.[2]}</span>`;
    const drag=state.drag;if(!drag)return;
    if(drag.type==='pan'){state.pan.x=drag.pan.x+e.clientX-drag.clientX;state.pan.y=drag.pan.y+e.clientY-drag.clientY;positionCanvas();return;}
    if(drag.type==='map-draw'||drag.type==='map-rect'){mapPointerMove(p);return;}
    if(drag.type==='line'){previewLine(p);return;}
    if(drag.type==='draw'){
      const next={x:clamp(p.x,-32,d.width+32),y:clamp(p.y,-32,d.height+32)};
      linePoints(drag.last.x,drag.last.y,next.x,next.y,(x,y)=>brushAt(x,y));drag.last=next;updateCanvas();
    } else if(drag.type==='rect'||drag.type==='ellipse'){state.selection=shapeSelection(d.width,d.height,drag.start.x,drag.start.y,p.x,p.y,drag.type==='ellipse');drawOverlay();}
    else if(drag.type==='move'){const moved=translatePixels(drag.pixels,d.width,d.height,p.x-drag.start.x,p.y-drag.start.y,drag.selection);layer().pixels=moved.pixels;state.selection=moved.selection;updateCanvas();}
  });
  const end=e=>{if(state.view==='map')flushMapPaint();if(state.drag?.type==='line'&&e.type==='pointerup')previewLine(canvasPoint(e));if(state.drag&&['draw','line','move','map-draw','map-rect'].includes(state.drag.type)){changed();if(state.view==='map'){state.mapAnimations=mapAnimationCells(currentMap(),workspace);renderRight();drawMapNavigator();}}state.drag=null;if(state.view==='map')drawOverlay();stage.classList.remove('dragging');};
  stage.addEventListener('pointerup',end);stage.addEventListener('pointercancel',end);stage.addEventListener('lostpointercapture',end);
  stage.addEventListener('pointerleave',()=>{state.cursor=null;state.mapHoverKey=null;updateCursor();if(state.view==='map')drawOverlay();});
}

function showDialog(title, subtitle, content, submitLabel, onSubmit, wide = false) {
  const dialog=$('#dialog');if(dialog.open)dialog.close();dialog.className=wide?'wide-dialog':'';
  dialog.innerHTML=`<form id="dialog-form"><div class="dialog-heading"><div><span class="eyebrow">PIXFIT STUDIO</span><h2>${escape(title)}</h2><p>${escape(subtitle)}</p></div>${iconButton('close-dialog','close','Close dialog')}</div><div class="dialog-content">${content}</div><div class="dialog-error" id="dialog-error" role="alert"></div>${submitLabel?`<div class="dialog-actions"><button type="button" data-action="close-dialog" class="button outlined">Cancel</button><button type="submit" class="button dark">${escape(submitLabel)}${icon('arrow')}</button></div>`:''}</form>`;
  $('#dialog-form').addEventListener('submit',async e=>{e.preventDefault();try{await onSubmit?.(new FormData(e.target));}catch(error){$('#dialog-error').textContent=error.message;}});
  dialog.showModal();
}
function closeDialog() {$('#dialog').close();}
function nameField(value='Untitled sprite') {return `<label class="field-label">Name<input name="name" required maxlength="100" value="${escape(value)}" autocomplete="off"/></label>`;}
function sizeFields(width=32,height=32,max=512) {return `<div class="form-columns"><label class="field-label">Width <span>pixels</span><input type="number" name="width" min="1" max="${max}" value="${width}" required/></label><span class="size-cross">×</span><label class="field-label">Height <span>pixels</span><input type="number" name="height" min="1" max="${max}" value="${height}" required/></label></div>`;}
function newSpriteDialog() {
  saveTabView();
  showDialog('A fresh little canvas','Every pixel is a possibility.',`${nameField()}${sizeFields()}<div class="size-presets">${[16,32,64,128,256,512].map(n=>`<button type="button" data-action="size-preset" data-size="${n}">${n} × ${n}</button>`).join('')}</div><p class="field-note">Transparent background · Up to 512 × 512 pixels</p>`,'Create sprite',data=>{
    if(workspace.sprites.length>=100)throw new Error('Your workspace holds up to 100 sprites.');
    const w=Number(data.get('width')),h=Number(data.get('height'));if(!Number.isInteger(w)||!Number.isInteger(h)||w<1||h<1||w>512||h>512)throw new Error('Enter dimensions from 1 to 512.');
    checkCapacity(w*h);const s=makeSprite(data.get('name').trim()||'Untitled sprite',w,h);workspace.sprites.push(s);workspace.activeId=s.id;state.view='pixel';state.selection=null;state.pan={x:0,y:0};changed();closeDialog();render();fitCanvas();toast('Your canvas is ready. Make it yours.');
  });
}
function renameDialog(isLayer=false,layerId=null) {
  const target=isLayer?(activeDocument().layers.find(l=>l.id===layerId)||(state.view==='map'?currentMapLayer():layer())):activeDocument();showDialog(isLayer?'Name this layer':'Name your document','Give this little piece of your world a name.',nameField(target.name),'Save name',data=>{checkpoint();target.name=data.get('name').trim()||'Untitled';changed();closeDialog();render();});
}
function resizeDialog() {
  showDialog('Room to grow','Resize your canvas or scale every pixel.',`${sizeFields(sprite().width,sprite().height)}<label class="field-label">Resize method<select name="method"><option value="canvas">Canvas size · anchor at top left</option><option value="scale">Scale artwork · nearest neighbor</option></select></label><p class="field-note">Reducing canvas size crops pixels from the right and bottom. You can undo this change.</p>`,'Resize canvas',data=>{const width=Number(data.get('width')),height=Number(data.get('height'));checkCapacity((width*height-sprite().width*sprite().height)*sprite().layers.length);if((width!==sprite().width||height!==sprite().height)&&workspace.tilemaps.some(m=>(m.patterns||[]).some(p=>p.tiles.some(t=>t.assetId===sprite().id))||m.layers.some(l=>l.terrain?.some((type,i)=>type===7&&m.sources?.[(l.sources?.[i]||0)-1]?.assetId===sprite().id))))throw new Error('This texture sheet is used by map tiles or patterns. Duplicate the sprite before changing its grid dimensions.');const resized=resizeSprite(sprite(),width,height,data.get('method')==='scale');checkpoint();replaceSprite(resized);state.selection=null;changed();closeDialog();render();fitCanvas();});
}
function libraryDialog() {
  closeDialog();if(state.view!=='library')setView('library');else renderLibraryPage();
}
function renderLibraryPage() {
  $('#app').innerHTML=`${headerMarkup()}${tabsMarkup()}<div class="workspace-bar"><div class="breadcrumbs"><span>Workspace</span>${icon('chevron')}<span>Library</span></div><div id="save-status"></div></div><main class="library-page"><div class="library-page-heading"><div><span class="eyebrow">YOUR PIXEL UNIVERSE</span><h1>Your little collection<span>.</span></h1><p>Every sprite, every tile, every world. All in one place.</p></div><span class="library-total">${allAssets().length}<small>saved assets</small></span></div><div class="library-creation"><button data-action="new">${icon('pencil')}<span><strong>New sprite</strong><small>Start with a single pixel</small></span>${icon('plus')}</button><button data-action="new-tileset">${icon('tiles')}<span><strong>New auto terrain</strong><small>Generate terrain transitions</small></span>${icon('plus')}</button><button data-action="new-collection">${icon('folder')}<span><strong>New tileset</strong><small>Collect auto terrains for Godot 4</small></span>${icon('plus')}</button><button data-action="new-map">${icon('grid')}<span><strong>New tilemap</strong><small>Build somewhere new</small></span>${icon('plus')}</button></div><div class="library-browse-bar"><div class="library-filters">${[['all','All assets'],['sprite','Sprites'],['tileset','Auto terrains'],['tilemap','Tilemaps']].map(([kind,name])=>`<button class="${state.libraryFilter===kind?'active':''}" data-action="library-filter" data-kind="${kind}">${name}<span>${kind==='all'?allAssets().length:allAssets().filter(a=>a.kind===kind).length}</span></button>`).join('')}</div>${categoryFilter('library-category')}<label class="field-label library-sort">Sort by<select id="library-sort">${[['type','Asset type'],['name','Name A–Z'],['recent','Recently edited']].map(([value,label])=>`<option value="${value}" ${(settings().librarySort||'type')===value?'selected':''}>${label}</option>`).join('')}</select></label><input id="library-search" type="search" placeholder="Find something you made…" aria-label="Search library" value="${escape(state.librarySearch)}"/><div class="library-imports">${button('import-image','upload','Image','button outlined')}${button('import-atlas','tiles','Tileset','button outlined')}</div></div><div id="library-results"></div>${workspace.collections.length?`<section class="tileset-collections">${sectionTitle('TILESET COLLECTIONS')}<p class="field-note">Combine auto terrains into one Godot 4 TileSet. Each terrain supplies its generated transitions.</p><div class="collection-list">${workspace.collections.map(c=>`<article><strong>${escape(c.name)}</strong><span>${c.terrainIds.length} terrains</span>${button('edit-collection','pencil','Edit','button outlined',`data-id="${c.id}"`)}${button('export-collection','download','Godot 4','button accent',`data-id="${c.id}"`)}${iconButton('delete-collection','trash','Delete collection',`data-id="${c.id}"`)}</article>`).join('')||'<p class="field-note">Create a tileset to choose which terrains belong together.</p>'}</div></section>`: ''}</main>${footerMarkup()}`;
  renderLibraryResults();updateSaveStatus();
}
function renderLibraryResults(){
  const category=currentCategory(),sort=settings().librarySort||'type',kinds=['sprite','tileset','tilemap'],labels={sprite:'Sprites',tileset:'Auto terrains & tile atlases',tilemap:'Tilemaps'};
  const byName=(a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true,sensitivity:'base'})||a.id.localeCompare(b.id);
  const assets=allAssets().filter(a=>(state.libraryFilter==='all'||a.kind===state.libraryFilter)&&(category==='*'||a.kind!=='sprite'||cleanCategory(a.category)===category)&&a.name.toLowerCase().includes(state.librarySearch.trim().toLowerCase()));
  assets.sort((a,b)=>sort==='recent'?(b.updatedAt||0)-(a.updatedAt||0)||byName(a,b):sort==='type'?kinds.indexOf(a.kind)-kinds.indexOf(b.kind)||byName(a,b):byName(a,b));
  const card=a=>`<article class="library-card ${workspace.session.tabs.includes(a.id)?'is-open':''}"><button class="library-open" data-action="open-tab" data-id="${a.id}"><span class="library-preview checker"><canvas data-asset-preview="${a.id}"></canvas><span class="file-badge">${a.kind==='tileset'?(a.imported?'TILE ATLAS':'AUTO TERRAIN'):a.kind.toUpperCase()}</span>${workspace.session.tabs.includes(a.id)?'<span class="library-open-badge">Open</span>':''}</span><strong title="${escape(a.name)}">${escape(a.name)}</strong><span>${a.width} × ${a.height} ${a.kind==='tilemap'?'cells':'px'}${a.layers?` · ${a.layers.length} ${a.layers.length===1?'layer':'layers'}`:` · ${a.masks.length} tiles`}</span></button><div class="library-card-actions">${a.kind==='sprite'?button('texture-category','folder',a.category||'Uncategorized','text-button category-assignment',`data-id="${a.id}"`):''}${button('rename-asset','pencil','Rename','text-button',`data-id="${a.id}"`)}${button('duplicate-asset','copy','Duplicate','text-button',`data-id="${a.id}"`)}${iconButton('delete-asset','trash',`Delete ${a.name}`,`data-id="${a.id}" ${workspace.sprites.length===1&&a.kind==='sprite'?'disabled':''}`)}</div></article>`;
  const groups=sort==='type'?kinds.map(kind=>[labels[kind],assets.filter(a=>a.kind===kind)]):[['Assets',assets]];
  $('#library-results').innerHTML=assets.length?groups.filter(([,items])=>items.length).map(([label,items])=>`<section class="library-group"><div class="library-group-heading"><h2>${label}</h2><span>${items.length}</span></div><div class="library-grid">${items.map(card).join('')}</div></section>`).join(''):'<div class="library-empty"><h2>Room for something new.</h2><p>No assets match this view. Create a document or try another search.</p></div>';
  drawThumbnails();
}
function newDocumentDialog(){showDialog('What will you make?','Open a fresh document alongside your current work.',`<div class="new-document-options">${button('new','pencil','Pixel sprite','button outlined full-width')}${button('new-tileset','tiles','Auto terrain','button outlined full-width')}${button('new-collection','folder','Tileset collection','button outlined full-width')}${button('new-map','grid','Tilemap','button outlined full-width')}</div>`,null);}
function collectionDialog(id=null,exportOnly=false){
  const current=workspace.collections.find(c=>c.id===id),selected=current?.terrainIds||[state.tile?.id].filter(Boolean);
  if(!workspace.tilesets.length){toast('Generate an auto terrain first.');return;}
  showDialog(exportOnly?'Export a Godot 4 tileset':current?'Edit tileset collection':'New tileset collection','Choose the auto terrains to combine in one TileSet resource.',`${nameField(current?.name||'World tileset')}<div class="collection-choices">${workspace.tilesets.map(t=>`<label><input type="checkbox" name="terrain" value="${t.id}" ${selected.includes(t.id)?'checked':''}/><span>${escape(t.name)}<small>${t.tileWidth} × ${t.tileHeight} px · ${t.imported?'Tile atlas':t.options.mode==='blob'?'Blob terrain':'Corner terrain'}</small></span></label>`).join('')}</div><p class="field-note">Terrains must use the same tile size and projection. Shared texture materials connect within each matching mode. Add generated transitions for every material pair you need.</p>`,exportOnly?'Download tileset':'Save tileset',async data=>{
    const terrainIds=data.getAll('terrain');if(!terrainIds.length)throw new Error('Select at least one auto terrain.');
    const terrains=terrainIds.map(id=>workspace.tilesets.find(t=>t.id===id)),base=terrains[0];
    if(terrains.some(t=>t.tileWidth!==base.tileWidth||t.tileHeight!==base.tileHeight||(!t.imported&&!!t.options.isometric)!==(!base.imported&&!!base.options.isometric)))throw new Error('Choose terrains with the same tile size and projection.');
    const collection={id:current?.id||uid(),name:data.get('name').trim()||'World tileset',terrainIds};
    if(exportOnly){await exportCollection(collection);return;}
    if(current)Object.assign(current,collection);else{if(workspace.collections.length>=100)throw new Error('Your workspace holds up to 100 tileset collections.');workspace.collections.push(collection);}
    changed();closeDialog();if(state.view==='library')renderLibraryPage();
  });
}
async function exportCollection(collection){
  const pack=await godotCollectionPackage(collection,workspace.tilesets,workspace.sprites,encodePNG);
  pack.files.push({name:`${pack.folder}/collection.json`,data:JSON.stringify({...collection,terrains:collection.terrainIds.map((id,i)=>({...atlasJSON(workspace.tilesets.find(t=>t.id===id)),id,image:`terrain-${i+1}/atlas.png`}))},null,2)});
  download(zipFiles(pack.files),`${safeName(collection.name)}-godot4.zip`);toast('Tileset exported with all selected terrains and animations.');
}
function deleteCollection(id){
  const c=workspace.collections.find(c=>c.id===id);if(!c)return;
  showDialog('Delete tileset collection?',c.name,'<p class="field-note">Your auto terrains and maps stay in the library.</p>','Delete collection',()=>{workspace.collections=workspace.collections.filter(c=>c.id!==id);changed();closeDialog();renderLibraryPage();});
}
function newTileset(sourceId=null){
  if(workspace.tilesets.length>=100)throw new Error('Your workspace holds up to 100 auto terrains and tile atlases.');saveTabView();state.tile=null;state.view='tiles';state.selectedTile=0;
  settings().tile={...settings().tile,overrides:{},terrainA:sourceId||settings().tile.terrainA};regenerate();rememberTab(state.tile);changed();closeDialog();render();fitCanvas();
}
function closeTab(id){
  const index=workspace.session.tabs.indexOf(id);
  if(index<0)return;
  saveTabView();
  workspace.session.tabs=workspace.session.tabs.filter(tab=>tab!==id);state.tabViews.delete(id);
  if(workspace.session.activeTab===id){const next=workspace.session.tabs[Math.min(index,workspace.session.tabs.length-1)];if(next&&state.view!=='library')openDocument(next);else{state.view='library';workspace.session.activeTab=next||'';changed();render();}}
  else {changed(false);render();}
}
function closeAllTabs(){
  saveTabView();workspace.session.tabs=[];workspace.session.activeTab='';state.view='library';state.selection=null;state.cursor=null;state.tabViews.clear();
  changed();render();toast('All tabs closed. Your assets are saved in the library.');
}
function moveTab(id,index){
  const tabs=workspace.session.tabs,from=tabs.indexOf(id);if(from<0)return;
  index=clamp(index,0,tabs.length-1);if(from===index)return;
  tabs.splice(from,1);tabs.splice(index,0,id);changed(false);
  $('.document-tabs').outerHTML=tabsMarkup();
  $(`.document-tab [role="tab"][data-id="${id}"]`)?.focus();
}
function renameAssetDialog(id){
  const asset=allAssets().find(a=>a.id===id);if(!asset)return;
  showDialog('Name your document','Update its name in the library and open tabs.',nameField(asset.name),'Save name',data=>{
    asset.name=data.get('name').trim()||'Untitled';asset.updatedAt=Date.now();
    // Preserve this rename when an open document's pixel history is restored.
    const h=state.history.get(id);if(h)for(const snapshot of [...h.undo,...h.redo])snapshot.name=asset.name;
    changed();closeDialog();renderLibraryPage();
  });
}
function copySelection(cut=false){
  const s=sprite();state.clipboard=selectionClipboard(layer().pixels,s.width,s.height,state.selection);
  if(!state.clipboard){toast('Select some pixels to copy.');return;}
  if(cut){checkpoint();for(let i=0;i<layer().pixels.length;i++)if(!state.selection||state.selection[i])layer().pixels[i]=0;changed();updateCanvas();}
  renderLeft();toast(`${state.clipboard.width} × ${state.clipboard.height} pixels ${cut?'cut':'copied'}. Paste in any sprite tab.`);
}
function pasteSelection(){
  if(!state.clipboard){toast('Copy pixels from a sprite first.');return;}
  const s=sprite();if(settings().pasteNewLayer){if(s.layers.length>=32)throw new Error('A sprite can have up to 32 layers.');checkCapacity(s.width*s.height);}else if(!layer().visible)throw new Error('Show the active layer before pasting.');
  checkpoint();const targetSelection=state.selection;let x=state.clipboard.x,y=state.clipboard.y;
  if(targetSelection){const bounds=selectionClipboard(layer().pixels,s.width,s.height,targetSelection);if(bounds){x=bounds.x;y=bounds.y;}}
  else{x=clamp(x,0,Math.max(0,s.width-state.clipboard.width));y=clamp(y,0,Math.max(0,s.height-state.clipboard.height));}
  if(settings().pasteNewLayer){const pasted=makeLayer(s.width,s.height,'Pasted pixels');s.layers.splice(s.layers.findIndex(l=>l.id===s.activeLayerId)+1,0,pasted);s.activeLayerId=pasted.id;}
  state.selection=pastePixels(layer().pixels,s.width,s.height,state.clipboard,x,y,targetSelection);state.tool='move';changed();renderLeft();renderRight();updateCanvas();toast('Pasted. Drag the selection to move it.');
}
function transformSelectedRegion(rotation=0,flipX=false,flipY=false){
  if(state.view!=='pixel'||!state.selection)return;
  if(!layer().visible)throw new Error('Show the active layer before transforming it.');
  const s=sprite(),result=transformSelection(layer().pixels,s.width,s.height,state.selection,rotation,flipX,flipY);
  if(!result)return;
  checkpoint();layer().pixels=result.pixels;state.selection=result.selection;
  changed();updateCanvas();
}
function newMapDialog(atlasId=null){
  const selected=atlasId||state.tile?.id||workspace.tilesets[0]?.id;
  showDialog('A world of your own','Mix terrains, texture tiles, and saved patterns. Maps autosave as you build.',`${nameField('Untitled world')}${sizeFields(32,24,256)}<label class="field-label">Initial cell size<select name="tileset" id="new-map-terrain"><option value="">Custom texture grid</option>${workspace.tilesets.map(t=>`<option value="${t.id}" ${t.id===selected?'selected':''}>${escape(t.name)} · ${t.tileWidth} × ${t.tileHeight} px</option>`).join('')}</select></label><div class="compact-fields"><label class="field-label">Cell width (px)<input name="cell-width" type="number" min="8" max="512" value="${workspace.tilesets.find(t=>t.id===selected)?.tileWidth||16}" required/></label><label class="field-label">Cell height (px)<input name="cell-height" type="number" min="8" max="512" value="${workspace.tilesets.find(t=>t.id===selected)?.tileHeight||16}" required/></label></div><p class="field-note">Choose the grid used to slice texture sheets. The initial terrain suggests a cell size. You can paint from every terrain and texture sheet. Width and height are in cells. Start with up to 256 × 256 cells, within a 4096 × 4096 pixel render.</p>`,'Create tilemap',data=>{if(workspace.tilemaps.length>=100)throw new Error('Your workspace holds up to 100 tilemaps.');const atlas=workspace.tilesets.find(t=>t.id===data.get('tileset')),m=makeTilemap(data.get('name').trim()||'Untitled world',Number(data.get('width')),Number(data.get('height')),{id:atlas?.id||null,tileWidth:Number(data.get('cell-width')),tileHeight:Number(data.get('cell-height'))});checkCapacity(m.width*m.height);workspace.tilemaps.push(m);openDocument(m.id);});
}
function mapTextures(atlas){
  return ['terrainA','terrainB'].map(key=>{
    const s=workspace.sprites.find(s=>s.id===atlas.options[key]);
    return s?{name:s.name,width:s.width,height:s.height,pixels:Array.from(composite(s))}:{name:'Transparent',width:1,height:1,pixels:[0]};
  });
}
function mapPaletteAtlas(){return workspace.tilesets.find(t=>t.id===(state.mapSourceId||currentMap().tilesetId));}
function textureSelectionBrush(){
  const m=currentMap(),choices=mapTextureChoices(),s=choices.find(s=>s.id===state.mapTextureId)||choices[0];
  if(!s)return null;
  state.mapTextureId=s.id;
  const cols=Math.ceil(s.width/m.cellWidth),rows=Math.ceil(s.height/m.cellHeight),selection=state.textureSelection;
  const a=selection?.assetId===s.id?Math.min(selection.start,cols*rows-1):0,b=selection?.assetId===s.id?Math.min(selection.end,cols*rows-1):a;
  const x=Math.min(a%cols,b%cols),y=Math.min(Math.floor(a/cols),Math.floor(b/cols)),width=Math.abs(a%cols-b%cols)+1,height=Math.abs(Math.floor(a/cols)-Math.floor(b/cols))+1;
  const tiles=Array.from({length:width*height},(_,i)=>({kind:'texture-tile',assetId:s.id,value:(y+Math.floor(i/width))*cols+x+i%width}));
  return {id:'selection',kind:'pattern',name:`${s.name} · ${width} × ${height}`,width,height,tiles};
}
function mapBrushOptions(){
  const atlas=mapPaletteAtlas();
  if(!atlas){const category=currentCategory(),ids=new Set(mapTextureChoices().map(s=>s.id));return [textureSelectionBrush(),...(currentMap().patterns||[]).filter(p=>category==='*'||p.tiles.some(t=>ids.has(t.assetId))).map(p=>({...p,kind:'pattern'}))].filter(Boolean);}
  const textures=atlas.id===currentMap().tilesetId&&currentMap().textures?currentMap().textures:mapTextures(atlas);
  return [...(atlas.imported?[]:textures.map((t,i)=>({id:i+1,name:t.name,image:t,kind:'terrain',value:i+1,assetId:atlas.id})).concat([{id:3,name:'Auto terrain · '+atlas.name,image:extractTile(atlas,tileDescriptors(atlas).find(t=>t.mask===(atlas.options.mode==='blob'?255:15))?.id??0),kind:'terrain',value:3,assetId:atlas.id}])),...tileDescriptors(atlas).map(t=>({id:100+t.id,name:`Tile ${t.id+1} · ${t.kind}`,image:null,tile:t.id,kind:'tile',value:t.id,assetId:atlas.id}))];
}
function patternImage(pattern){
  const m=currentMap(),width=pattern.width*m.cellWidth,height=pattern.height*m.cellHeight,pixels=new Uint32Array(width*height),cache=new Map();
  pattern.tiles.forEach((tile,i)=>{
    const s=workspace.sprites.find(s=>s.id===tile.assetId);if(!s)return;
    if(!cache.has(s.id))cache.set(s.id,composite(s));
    const image=textureTile(s,m.cellWidth,m.cellHeight,tile.value,cache.get(s.id));
    for(let y=0;y<m.cellHeight;y++)pixels.set(image.pixels.subarray(y*m.cellWidth,(y+1)*m.cellWidth),(Math.floor(i/pattern.width)*m.cellHeight+y)*width+i%pattern.width*m.cellWidth);
  });return {width,height,pixels};
}
function renderMapLeft(){
  if(state.mapSourceId!=='textures'&&!mapAtlasChoices().some(t=>t.id===(state.mapSourceId||currentMap().tilesetId)))state.mapSourceId='textures';
  const atlas=mapPaletteAtlas(),brushes=mapBrushOptions(),m=currentMap(),collection=workspace.collections.find(c=>c.id===state.mapCollectionId);
  state.mapBrushes=brushes;state.mapBrushImages=new Map();state.mapHoverKey=null;
  if(!brushes.some(b=>b.id===state.mapTile))state.mapTile=brushes[0]?.id;
  const palette=items=>items.map(t=>`<button data-action="map-tile" data-index="${t.id}" class="checker ${state.mapTile===t.id?'active':''}" title="${escape(t.name)}" aria-label="Paint ${escape(t.name)}" aria-pressed="${state.mapTile===t.id}"><canvas data-map-brush="${t.id}"></canvas><span>${t.kind==='tile'?t.value+1:escape(t.name)}</span></button>`).join('');
  const selection=textureSelectionBrush(),texture=mapTextureChoices().find(s=>s.id===state.mapTextureId),selected=new Set(selection?.tiles.map(t=>t.value));
  $('#left-panel').innerHTML=`<section class="panel-section">${sectionTitle('MAP TOOLS')}<div class="map-tools">${[['paint','pencil','Paint'],['erase','eraser','Erase'],['fill','bucket','Fill'],['rect','select','Rectangle'],['picker','picker','Pick brush'],['pan','hand','Pan']].map(([id,glyph,name])=>`<button data-action="map-tool" data-tool="${id}" class="${state.mapTool===id?'active':''}" aria-pressed="${state.mapTool===id}">${icon(glyph)}<span>${name}</span></button>`).join('')}</div><p class="field-note">Mix terrains and texture patterns on any layer. Export the complete map as one PNG. Right-click erases.</p></section><section class="panel-section map-palette-section">${sectionTitle('TERRAINS & PATTERNS')}
  ${categoryFilter('map-category')}<label class="field-label">Tileset collection<select id="map-collection"><option value="">All library terrains</option>${workspace.collections.map(c=>`<option value="${c.id}" ${collection?.id===c.id?'selected':''}>${escape(c.name)}</option>`).join('')}</select></label>
  <label class="field-label">Brush source<select id="map-tileset"><option value="textures" ${!atlas?'selected':''}>Texture tiles & patterns</option>${mapAtlasChoices().map(t=>`<option value="${t.id}" ${atlas?.id===t.id?'selected':''}>${escape(t.name)}${t.imported?' · tile atlas':' · auto terrain'}</option>`).join('')}</select></label>
  ${!atlas&&texture?`<label class="field-label">Texture sheet<select id="map-texture">${spriteOptions(texture?.id,currentCategory(),!!state.mapPickedSourceId)}</select></label><p class="field-note">${m.cellWidth} × ${m.cellHeight} px grid. Click a tile; Shift-click another to select a rectangular pattern. Paint stamps it; Fill and Rectangle repeat it. Partial edge tiles are transparent outside the image.</p><div class="texture-grid-scroll"><div class="texture-tile-grid" style="grid-template-columns:repeat(${Math.ceil(texture.width/m.cellWidth)},40px)">${textureTiles(texture,m.cellWidth,m.cellHeight).map(t=>`<button class="checker ${selected.has(t.id)?'active':''}" data-action="texture-tile" data-index="${t.id}" title="Tile ${t.id+1}" aria-label="Texture tile ${t.id+1}" aria-pressed="${selected.has(t.id)}"><canvas data-texture-tile="${t.id}"></canvas></button>`).join('')}</div></div>${button('save-map-pattern','plus','Save selected pattern','button outlined full-width')}<p class="field-label">SELECTED & SAVED PATTERNS</p>`:!atlas?'<p class="field-note">No textures in this category. Assign textures in the Library or choose another category.</p>':'<p class="field-note">Choose connected auto terrain or an individual tile.</p>'}
  <div class="map-tile-palette terrain-brushes">${palette(brushes.filter(b=>b.kind!=='tile'))}</div>${!atlas&&m.patterns?.some(p=>p.id===state.mapTile)?button('delete-map-pattern','trash','Delete selected pattern','text-button'):''}${atlas?`<p class="field-label">ALL TILES · ${atlas.masks.length}</p><div class="map-tile-palette">${palette(brushes.filter(b=>b.kind==='tile'))}</div>`:''}</section>${atlas?`<div class="left-bottom">${button('edit-map-tileset','tiles','Edit auto terrain','button outlined full-width')}</div>`:''}`;
  document.querySelectorAll('[data-map-brush]').forEach(c=>{const b=brushes.find(b=>String(b.id)===c.dataset.mapBrush),t=b.kind==='pattern'?patternImage(b):b.image||extractTile(atlas,b.tile);state.mapBrushImages.set(b.id,t);paintCanvas(c,t.pixels,t.width,t.height);});
  if(!atlas&&texture){const pixels=composite(texture);document.querySelectorAll('[data-texture-tile]').forEach(c=>{const t=textureTile(texture,m.cellWidth,m.cellHeight,Number(c.dataset.textureTile),pixels);paintCanvas(c,t.pixels,t.width,t.height);});}
}
function selectedMapBrush(){
  const m=currentMap(),b=state.mapBrushes?.find(b=>b.id===state.mapTile);
  if(!b)return null;
  const resolve=b=>{
    if(b.kind!=='texture-tile'&&b.assetId===m.tilesetId)return {...b,source:0};
    m.sources ||= [];
    const kind=b.kind==='texture-tile'?'texture':'tileset';
    let index=m.sources.findIndex(s=>s.kind===kind&&s.assetId===b.assetId);
    if(index<0){index=m.sources.length;m.sources.push({kind,assetId:b.assetId});}
    return {...b,source:index+1};
  };
  return b.kind==='pattern'?{...b,tiles:b.tiles.map(resolve)}:resolve(b);
}
function saveMapPattern(){
  const m=currentMap(),pattern=textureSelectionBrush();if(!pattern)return;
  if(pattern.width>64||pattern.height>64)throw new Error('Select a pattern up to 64 × 64 tiles.');
  if((m.patterns?.length||0)>=100)throw new Error('A map holds up to 100 saved patterns.');
  showDialog('Save texture pattern','Reuse this selection anywhere in this map.',nameField(pattern.name),'Save pattern',data=>{
    checkCapacity(pattern.tiles.length);checkpoint();const {kind,...saved}=pattern;saved.id=uid();saved.name=data.get('name').trim()||pattern.name;
    (m.patterns||=[]).push(saved);state.mapTile=saved.id;changed();closeDialog();renderLeft();
  });
}
function layerRowActions(doc,l,map=false){
  const prefix=map?'map-':'',index=doc.layers.indexOf(l),id=`data-id="${l.id}"`;
  return `<div class="layer-row-actions" role="group" aria-label="Actions for ${escape(l.name)}">${iconButton(prefix+'toggle-layer',l.visible?'eye':'hidden',l.visible?`Hide ${l.name}`:`Show ${l.name}`,id)}${iconButton(prefix+'layer-up','up','Move layer up',`${id} ${index===doc.layers.length-1?'disabled':''}`)}${iconButton(prefix+'layer-down','down','Move layer down',`${id} ${index===0?'disabled':''}`)}${iconButton(prefix+'merge-down','layers','Merge with layer below',`${id} ${index===0?'disabled':''}`)}${!map?iconButton('duplicate-layer','copy','Duplicate layer',id):''}${iconButton('rename-layer','pencil','Rename layer',id)}${iconButton(prefix+'delete-layer','trash','Delete layer',`${id} ${doc.layers.length===1?'disabled':''}`)}</div>`;
}
function mergePixelLayerDown(id){
  const s=sprite(),index=s.layers.findIndex(l=>l.id===id),top=s.layers[index],bottom=s.layers[index-1];if(!top||!bottom)return;
  checkpoint();
  for(let i=0;i<bottom.pixels.length;i++)bottom.pixels[i]=blendPixel(blendPixel(0,bottom.pixels[i],bottom.visible?bottom.opacity/100:0),top.pixels[i],top.visible?top.opacity/100:0);
  bottom.visible=bottom.visible||top.visible;bottom.opacity=100;s.layers.splice(index,1);s.activeLayerId=bottom.id;changed();renderRight();updateCanvas();
}
function mergeMapLayerDown(id){
  const m=currentMap(),index=m.layers.findIndex(l=>l.id===id),top=m.layers[index],bottom=m.layers[index-1];if(!top||!bottom)return;
  checkpoint();bottom.terrain ||= new Uint32Array(m.width*m.height);bottom.sources ||= new Uint32Array(m.width*m.height);
  for(let i=0;i<top.cells.length;i++)if(top.cells[i]||top.terrain?.[i]){bottom.cells[i]=top.cells[i];bottom.terrain[i]=top.terrain?.[i]||0;bottom.sources[i]=top.sources?.[i]||0;}
  bottom.decals=[...(bottom.decals||[]),...(top.decals||[])];bottom.visible=bottom.visible||top.visible;m.layers.splice(index,1);m.activeLayerId=bottom.id;resolveMapTerrain(m,bottom,workspace);changed();renderRight();updateCanvas();
}
function renderMapRight(){
  const m=currentMap(),active=currentMapLayer();
  $('#right-panel').innerHTML=`<section class="panel-section preview-section">${sectionTitle('WORLD PREVIEW','<span class="live-badge">LIVE</span>')}<div class="navigator checker"><canvas id="map-navigator"></canvas></div><div class="preview-meta"><span>${m.width} × ${m.height} cells</span><span>${m.cellWidth} × ${m.cellHeight} px</span></div></section><section class="panel-section layers-section">${sectionTitle('MAP LAYERS')}<label class="range-row opacity-row"><span>Opacity</span><input id="map-opacity" type="range" min="0" max="100" value="${active.opacity}"/><output>${active.opacity}%</output></label><div class="layer-list">${[...m.layers].reverse().map(l=>`<div class="layer-row ${l.id===active.id?'active':''}"><button class="layer-pick" data-action="map-select-layer" data-id="${l.id}">${icon('layers')}<span class="layer-name">${escape(l.name)}<small>${l.cells.filter((v,i)=>v||l.terrain?.[i]===1||l.terrain?.[i]===2||l.terrain?.[i]===6).length+(l.decals?.length||0)} placed items</small></span></button>${layerRowActions(m,l,true)}</div>`).join('')}</div><div class="add-layer-bar">${button('map-add-layer','plus','Add layer','button outlined full-width')}</div></section><section class="panel-section">${sectionTitle('BUILD YOUR WORLD')}<p class="section-copy">Each tile is a building block. Layer paths, water, and details to make a place of your own.</p>${button('play-animation',state.animationPlaying?'minus':'arrow',state.animationPlaying?'Pause animations':'Play animations','button outlined full-width')}${button('export','download','Export tilemap','button accent full-width')}</section>`;
}
function mapPointerDown(p,e){
  const m=currentMap(),x=Math.floor(p.x/m.cellWidth),y=Math.floor(p.y/m.cellHeight),l=currentMapLayer();
  if(x<0||y<0||x>=m.width||y>=m.height)return;
  const tool=e.button===2?'erase':state.mapTool;
  if(tool==='picker'||(e.ctrlKey&&e.button!==2)){
    const i=y*m.width+x,type=l.terrain?.[i]||0,source=m.sources?.[(l.sources?.[i]||0)-1];
    if(type===4||(!type&&!l.cells[i]))return;
    state.mapPickedSourceId=source?.assetId||m.tilesetId;state.mapCollectionId='';state.mapSourceId=source?.kind==='texture'?'textures':source?.assetId||m.tilesetId;
    if(type===7||type===6){state.mapTextureId=source.assetId;state.textureSelection={assetId:source.assetId,start:Math.max(0,l.cells[i]-1),end:Math.max(0,l.cells[i]-1)};state.mapTile='selection';renderMapLeft();return;}
    state.mapTile=type===6?source.assetId:type===5?3:type||100+l.cells[i]-1;renderMapLeft();return;
  }
  if(!l.visible){toast('Show the active map layer before painting.');return;}
  if(tool!=='erase'&&!state.mapBrushes?.some(b=>b.id===state.mapTile))return;
  const atlas=mapPaletteAtlas(),textures=m.textures||(atlas?.id===m.tilesetId&&!atlas.imported?mapTextures(atlas):null);
  checkCapacity((l.terrain?0:m.width*m.height)+(l.sources?0:m.width*m.height)+(m.textures||!textures?0:textures.reduce((n,t)=>n+t.width*t.height,0)));
  checkpoint();if(textures)m.textures=textures;
  const brush=tool==='erase'?{}:selectedMapBrush();state.mapSpans=mapSpans();if(brush.kind==='pattern'&&['fill','rect'].includes(tool))brush.origin={x,y};
  if(tool==='erase'&&eraseMapDecal(l,p.x,p.y,workspace,m)){changed();updateCanvas();return;}
  if(tool==='rect'){state.drag={type:'map-rect',last:{x,y},start:{x,y},cells:new Uint32Array(l.cells),terrain:new Uint32Array(l.terrain||m.width*m.height),sources:new Uint32Array(l.sources||m.width*m.height),brush};paintMapBrush(m,l,x,y,brush,'rect');}
  else {paintMapBrush(m,l,x,y,brush,tool);state.drag=tool==='fill'?null:{type:'map-draw',last:{x,y},tool,brush};}
  const bounds=tool==='fill'?{x0:0,y0:0,x1:m.width-1,y1:m.height-1}:{x0:x,y0:y,x1:x+(tool==='paint'&&brush.kind==='pattern'?brush.width-1:0),y1:y+(tool==='paint'&&brush.kind==='pattern'?brush.height-1:0)};
  queueMapPaint(m,l,bounds);if(!state.drag){flushMapPaint();state.mapAnimations=mapAnimationCells(m,workspace);changed();}
}
function mapPointerMove(p){
  const m=currentMap(),l=currentMapLayer(),x=clamp(Math.floor(p.x/m.cellWidth),0,m.width-1),y=clamp(Math.floor(p.y/m.cellHeight),0,m.height-1),drag=state.drag;
  if(x===drag.last.x&&y===drag.last.y)return;
  let bounds=unionBounds({x0:x,y0:y,x1:x,y1:y},{x0:drag.last.x,y0:drag.last.y,x1:drag.last.x,y1:drag.last.y});
  if(drag.type==='map-rect'){bounds=unionBounds(bounds,{x0:drag.start.x,y0:drag.start.y,x1:drag.start.x,y1:drag.start.y});l.cells=new Uint32Array(drag.cells);l.terrain=new Uint32Array(drag.terrain);l.sources=new Uint32Array(drag.sources);for(let py=Math.min(y,drag.start.y);py<=Math.max(y,drag.start.y);py++)for(let px=Math.min(x,drag.start.x);px<=Math.max(x,drag.start.x);px++)paintMapBrush(m,l,px,py,drag.brush,'rect');}
  else {linePoints(drag.last.x,drag.last.y,x,y,(px,py)=>paintMapBrush(m,l,px,py,drag.brush,drag.tool));if(drag.tool!=='erase'&&drag.brush.kind==='pattern'){bounds.x1+=drag.brush.width-1;bounds.y1+=drag.brush.height-1;}}
  drag.last={x,y};queueMapPaint(m,l,bounds);
}
function resizeMapDialog(){const m=currentMap();showDialog('Resize this world','Dimensions are in cells; content stays anchored at the top left.',sizeFields(m.width,m.height,256),'Resize tilemap',data=>{const w=Number(data.get('width')),h=Number(data.get('height'));checkCapacity((w*h-m.width*m.height)*m.layers.reduce((n,l)=>n+1+(l.terrain?1:0)+(l.sources?1:0),0));const next=resizeTilemap(m,w,h);for(const l of next.layers)resolveMapTerrain(next,l,workspace);checkpoint();workspace.tilemaps[workspace.tilemaps.findIndex(a=>a.id===m.id)]=next;changed();closeDialog();render();fitCanvas();});}
function settingsDialog() {
  showDialog('A home for your pixels','Your work lives on this device, inside this browser.',`<label class="field-label">Appearance<select id="theme-setting">${[['system','System default'],['light','Light'],['dark','Dark']].map(([value,label])=>`<option value="${value}" ${(settings().theme||'system')===value?'selected':''}>${label}</option>`).join('')}</select></label><p class="field-note">System default follows your device’s light or dark appearance.</p><div class="storage-card"><span class="storage-icon">${icon('folder')}</span><div><strong>${allAssets().length} saved assets</strong><p>${(new Blob([JSON.stringify(serializeWorkspace(workspace))]).size/1024).toFixed(0)} KB · ${state.storage}</p></div><span class="live-badge">LOCAL</span></div><div class="settings-action"><div><h3>Take your workspace with you</h3><p>Export sprites, layers, tilesets, tilemaps, animations, open tabs, palettes, and settings in one JSON file.</p></div>${button('backup','download','Export workspace','button outlined')}</div><div class="settings-action"><div><h3>Restore a workspace</h3><p>Load a Pixfit JSON backup. You can merge it with your current collection.</p></div>${button('restore','upload','Import workspace','button outlined')}</div><div class="note-card">Browser data belongs to this browser and website address. Keep a backup before clearing site data or switching devices.</div>`,null);
}
function helpDialog() {
  showDialog('Small tools. Big possibilities.','A few handy shortcuts to keep you in your flow.',`<div class="shortcut-grid">${[...toolList.map(t=>[t[2],t[3]]),['Undo','Ctrl / ⌘ Z'],['Redo','Ctrl / ⌘ Shift Z'],['Select all','Ctrl / ⌘ A'],['Deselect','Esc'],['Delete selection','Delete'],['Pan anywhere','Space + drag'],['Copy selection','Ctrl / ⌘ C'],['Cut selection','Ctrl / ⌘ X'],['Paste selection','Ctrl / ⌘ V'],['Pick a color','Ctrl + click'],['Zoom','Mouse wheel'],['Fit artwork','F'],['Swap colors','X'],['Brush size','[ and ]'],['Save workspace','Ctrl / ⌘ S']].map(([name,key])=>`<div><span>${name}</span><kbd>${key}</kbd></div>`).join('')}</div><div class="note-card">Selections restrict painting, erasing, filling, and dithering. The move tool moves the active layer or selection; Space + drag pans the workspace without bounds. Pixels moved outside the image are cropped and can be undone.</div><p class="field-note">Auto terrain builder: select two saved sprites as terrain textures, choose 16 corner masks or 47 blob masks, then generate. Export the PNG and its atlas JSON for game engines. GIF import uses the first frame.</p>`,null,null,true);
}
function download(blob,name) {
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
const safeName = name => name.toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-|-$/g,'')||'pixfit';
async function downloadPNG(pixels,width,height,name,scale=1) {
  paintCanvas(texture,pixels,width,height);const output=document.createElement('canvas');output.width=width*scale;output.height=height*scale;const ctx=output.getContext('2d');ctx.imageSmoothingEnabled=false;ctx.drawImage(texture,0,0,output.width,output.height);
  const blob=await new Promise(resolve=>output.toBlob(resolve,'image/png'));if(!blob)throw new Error('This image is too large to export. Try a smaller scale.');download(blob,`${safeName(name)}.png`);
}
function atlasJSON(t) {
  return {format:'pixfit-atlas',version:2,image:`${safeName(t.name)}.png`,width:t.width,height:t.height,tileWidth:t.tileWidth,tileHeight:t.tileHeight,columns:t.columns,spacing:t.gap,projection:t.imported?'unspecified':t.options.isometric?'isometric':'orthogonal',mode:t.imported?'imported':t.options.mode,maskBits:t.options.mode==='blob'?{N:1,E:2,S:4,W:8,NE:16,SE:32,SW:64,NW:128}:{topLeft:1,topRight:2,bottomRight:4,bottomLeft:8},tiles:tileDescriptors(t),animations:t.animations||{},settings:t.options};
}
function mapAssetIds(m){
  const ids=new Set([m.tilesetId,...(m.sources||[]).map(s=>s.assetId),...(m.patterns||[]).flatMap(p=>p.tiles.map(t=>t.assetId))]);
  for(const l of m.layers)for(let i=0;i<l.cells.length;i++)if([1,2].includes(l.terrain?.[i])&&l.sources?.[i]){
    const source=m.sources[l.sources[i]-1],atlas=workspace.tilesets.find(t=>t.id===source.assetId);
    ids.add(atlas?.options[l.terrain[i]===1?'terrainA':'terrainB']);
  }
  return ids;
}
function exportDialog() {
  const tiles=state.view==='tiles',maps=state.view==='map',doc=activeDocument(),d=maps?renderTilemap(currentMap(),workspace,0):tiles?state.tile:{...sprite(),pixels:composite(sprite())};
  showDialog(tiles||maps?'Ready for your next world?':'Let your pixels out.',tiles?'Export textures, animation, and tile metadata.':maps?'Export a map image or a package with every source tileset and texture.':'Save a crisp PNG with a transparent background.',`<div class="export-preview checker"><canvas id="export-preview"></canvas></div><label class="field-label">File format<select name="format"><option value="png">PNG image · transparent</option>${tiles?'<option value="atlas">Atlas JSON · tiles & animations</option><option value="godot">Godot 4 · Tileset collection (.zip)</option>':''}${maps?'<option value="map">Tilemap package · map JSON + all sources (.zip)</option>':''}</select></label>${!tiles&&!maps?'<label class="field-label" id="export-scale-field">Export scale<select name="scale"><option value="1">1× · original pixels</option><option value="2">2× · double size</option><option value="4">4× · four times bigger</option><option value="8">8× · extra crisp</option></select></label>':'<p class="field-note">PNG exports a still frame. Godot packages include animated tiles and their textures. Full workspace backups are in Settings.</p>'}`,'Download',async data=>{
    const format=data.get('format');if(format==='godot'){collectionDialog(null,true);return;}
    if(format==='atlas')download(new Blob([JSON.stringify(atlasJSON(state.tile),null,2)],{type:'application/json'}),`${safeName(doc.name)}.atlas.json`);
    else if(format==='map'){
      const m=currentMap(),sourceIds=mapAssetIds(m),files=[],assets=[];
      for(const asset of [...workspace.tilesets,...workspace.sprites].filter(a=>sourceIds.has(a.id))){
        const image=`sources/${asset.id}.png`,pixels=asset.kind==='sprite'?{...asset,pixels:composite(asset)}:asset;
        files.push({name:image,data:await encodePNG(pixels)});
        assets.push(asset.kind==='tileset'?{...atlasJSON(asset),id:asset.id,kind:asset.kind,name:asset.name,image}:{id:asset.id,kind:'texture',name:asset.name,...(asset.category?{category:asset.category}:{}),width:asset.width,height:asset.height,image});
      }
      const json={format:'pixfit-tilemap',version:4,...m,layers:m.layers.map(l=>({...l,cells:Array.from(l.cells),...(l.terrain?{terrain:Array.from(l.terrain)}:{}),...(l.sources?{sources:Array.from(l.sources)}:{})})),assets};
      files.push({name:'map.json',data:JSON.stringify(json,null,2)},{name:'map.png',data:await encodePNG(d)});
      download(zipFiles(files),`${safeName(m.name)}.zip`);
    } else await downloadPNG(d.pixels,d.width,d.height,doc.name,Number(data.get('scale')||1));
    toast('Your export is ready.');
  });paintCanvas($('#export-preview'),d.pixels,d.width,d.height);
}
async function encodePNG(image){const canvas=document.createElement('canvas');paintCanvas(canvas,image.pixels,image.width,image.height);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw new Error('Could not encode this image.');return new Uint8Array(await blob.arrayBuffer());}

function changeTile(patch,selected=false){
  checkpoint();const old=structuredClone(settings().tile);
  try{if(selected){settings().tile.overrides||={};settings().tile.overrides[state.selectedTile]={...(settings().tile.overrides[state.selectedTile]||{}),...patch};}else Object.assign(settings().tile,patch);regenerate();changed();renderLeft();renderRight();updateCanvas();}
  catch(error){settings().tile=old;throw error;}
}
function transformSelectedTile(rotation=0,flipX=false,flipY=false){
  if(!state.tile.imported){const o=settings().tile.overrides?.[state.selectedTile]||{};changeTile({rotation:((o.rotation||0)+rotation)%360,flipX:flipX?!o.flipX:!!o.flipX,flipY:flipY?!o.flipY:!!o.flipY},true);return;}
  checkpoint();const previous=state.tile,images=tileDescriptors(previous).map(t=>extractTile(previous,t.id)),selected=images[state.selectedTile],old=previous.options.overrides?.[state.selectedTile]||{};
  const original=transformImage(transformImage(selected,0,old.flipX,old.flipY),(360-(old.rotation||0))%360);
  const next={...old,rotation:((old.rotation||0)+rotation)%360,flipX:flipX?!old.flipX:!!old.flipX,flipY:flipY?!old.flipY:!!old.flipY};
  images[state.selectedTile]={...selected,...transformImage(original,next.rotation,next.flipX,next.flipY)};
  const options=structuredClone(previous.options);options.overrides||={};options.overrides[state.selectedTile]=next;
  const packed=packTiles(images,{...previous,options});checkCapacity(packed.width*packed.height-previous.width*previous.height);
  const animations=structuredClone(previous.animations||{});for(const [id,a] of Object.entries(animations)){const t=packed.tiles[id];if(a.frames.some(f=>packed.tiles[f].width!==t.width||packed.tiles[f].height!==t.height))delete animations[id];}
  state.tile={...previous,...packed,animations};settings().tile=structuredClone(options);changed();renderRight();updateCanvas();fitCanvas();
}
function saveTileAnimation(){
  const value=$('#animation-frames').value.trim(),fps=Number($('#animation-fps').value),frames=value.split(',').map(n=>Number(n.trim())-1),tiles=tileDescriptors(state.tile),base=tiles[state.selectedTile];
  if(!value||frames.length>32||!Number.isFinite(fps)||fps<1||fps>60||frames.some(f=>!Number.isInteger(f)||!tiles[f]))throw new Error('Enter 1–32 valid tile numbers separated by commas and a speed from 1 to 60 FPS.');
  if(frames.some(f=>tiles[f].width!==base.width||tiles[f].height!==base.height))throw new Error('All animation frames must match the selected tile’s dimensions.');
  checkpoint();state.tile.animations||={};state.tile.animations[state.selectedTile]={frames,fps};changed();renderRight();toast('Animation saved. Its tile will animate in maps and Godot.');
}
function duplicateAsset(id){
  const original=allAssets().find(a=>a.id===id),collection=original.kind==='sprite'?workspace.sprites:original.kind==='tileset'?workspace.tilesets:workspace.tilemaps;
  if(collection.length>=100)throw new Error('You can keep up to 100 assets of each type.');checkCapacity(original.kind==='tilemap'?workspacePixelCount({sprites:[],tilesets:[],tilemaps:[original]}):original.width*original.height*(original.layers?.length||1));
  const copy=structuredClone(original);copy.id=uid();copy.name=`${copy.name} copy`.slice(0,100);copy.updatedAt=Date.now();
  if(copy.layers){const active=copy.activeLayerId;for(const l of copy.layers){const previous=l.id;l.id=uid();if(previous===active)copy.activeLayerId=l.id;}}
  for(const p of copy.patterns||[])p.id=uid();
  collection.push(copy);changed();renderLibraryPage();
}
function deleteAssetDialog(id){
  const asset=allAssets().find(a=>a.id===id);if(!asset)return;
  if(workspace.collections.some(c=>c.terrainIds.includes(id)))throw new Error('Remove this terrain from its tileset collections before deleting it.');
  const dependents=workspace.tilemaps.filter(m=>mapAssetIds(m).has(id));
  if(dependents.length)throw new Error(`This asset is used by ${dependents.length} tilemap(s). Remove those maps before deleting the asset.`);
  showDialog('Remove from your collection?',`“${asset.name}” will be deleted from this browser.`,`<p class="section-copy">This removes the saved asset and cannot be undone. You can export your workspace in Settings first.</p>`,'Delete asset',()=>{
    if(asset.kind==='sprite'){if(workspace.sprites.length===1)throw new Error('Keep at least one sprite.');workspace.sprites=workspace.sprites.filter(a=>a.id!==id);if(workspace.activeId===id)workspace.activeId=workspace.sprites[0].id;}
    if(asset.kind==='tileset'){workspace.tilesets=workspace.tilesets.filter(a=>a.id!==id);if(state.tile?.id===id)state.tile=null;}
    if(asset.kind==='tilemap'){workspace.tilemaps=workspace.tilemaps.filter(a=>a.id!==id);if(state.mapId===id)state.mapId=null;}
    workspace.session.tabs=workspace.session.tabs.filter(tab=>tab!==id);if(workspace.session.activeTab===id)workspace.session.activeTab=workspace.session.tabs[0]||'';
    state.history.delete(id);state.selection=null;state.view='library';changed();closeDialog();render();
  });
}
async function backup() {await persist();download(new Blob([JSON.stringify(serializeWorkspace(workspace))],{type:'application/json'}),`pixfit-workspace-${new Date().toISOString().slice(0,10)}.json`);toast('Your complete workspace has been exported.');}
function saveTilesetDialog() {
  renameDialog();
}
let importMode='sprite';
function pickImage(mode='sprite') {importMode=mode;$('#image-file').value='';$('#image-file').click();}
async function readImage(file) {
  if(file.size>40*1024*1024)throw new Error('Please choose an image under 40 MB.');
  const image=await createImageBitmap(file);
  if(image.width>4096||image.height>4096||image.width*image.height>16_000_000){image.close();throw new Error('Images can be up to 4096 × 4096 (16 million pixels).');}
  const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);image.close();return {width:canvas.width,height:canvas.height,pixels:pixelsFromBytes(ctx.getImageData(0,0,canvas.width,canvas.height).data)};
}
$('#image-file').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try {
    const image=await readImage(file),name=file.name.replace(/\.[^.]+$/,'');
    if(importMode==='atlas'){
      showDialog('Bring in your tile atlas',`${image.width} × ${image.height} pixels · Set the size of each tile.`,`${nameField(name)}${sizeFields(settings().tile.isometric?settings().tile.size*2:settings().tile.size,settings().tile.size)}<label class="field-label">Spacing between tiles<input name="gap" type="number" min="0" max="8" value="0" required/></label><p class="field-note">Use the tile width and height above. Atlas dimensions must fit whole tiles, with spacing between them and no outer padding. Imported masks are unknown; the atlas JSON exports their positions.</p>`,'Import tile atlas',data=>{
        if(workspace.tilesets.length>=100)throw new Error('Your workspace holds up to 100 auto terrains and tile atlases.');
        checkCapacity(image.width*image.height);
        const tw=Number(data.get('width')),th=Number(data.get('height')),gap=Number(data.get('gap'));
        const columns=(image.width+gap)/(tw+gap),rows=(image.height+gap)/(th+gap);
        if(!Number.isInteger(columns)||!Number.isInteger(rows)||columns<1||rows<1||columns*rows>4096)throw new Error('The image must contain whole tiles (up to 4096 tiles). Check tile dimensions and spacing.');
        const t={...image,tileWidth:tw,tileHeight:th,columns,rows,gap,masks:Array(columns*rows).fill(null),imported:true,options:{...settings().tile},id:uid(),kind:'tileset',name:data.get('name').trim()||name,updatedAt:Date.now()};
        workspace.tilesets.push(t);state.view='tiles';state.tile=t;state.selectedTile=0;changed();closeDialog();render();fitCanvas();toast('Tile atlas imported and saved to your library.');
      });return;
    }
    const add=(width,height,asLayer)=>{
      if(!asLayer&&workspace.sprites.length>=100)throw new Error('Your workspace holds up to 100 sprites.');
      checkCapacity(asLayer?sprite().width*sprite().height:width*height);
      let pixels=image.pixels;
      if(width!==image.width||height!==image.height){const temp=makeSprite(name,image.width,image.height);temp.layers[0].pixels=image.pixels;pixels=resizeSprite(temp,width,height,true).layers[0].pixels;}
      if(asLayer){if(sprite().layers.length>=32)throw new Error('A sprite can have up to 32 layers.');checkpoint();const l=makeLayer(sprite().width,sprite().height,name);for(let y=0;y<Math.min(height,sprite().height);y++)for(let x=0;x<Math.min(width,sprite().width);x++)l.pixels[y*sprite().width+x]=pixels[y*width+x];sprite().layers.push(l);sprite().activeLayerId=l.id;state.view='pixel';}
      else{const s=makeSprite(name,width,height);s.layers[0].pixels=pixels;workspace.sprites.push(s);workspace.activeId=s.id;if(importMode==='terrain'){settings().tile.terrainA=s.id;regenerate();}else state.view='pixel';}
      state.selection=null;changed();closeDialog();render();fitCanvas();toast(asLayer?'Image added as a new layer.':'Image imported to your library.');
    };
    const ratio=Math.min(1,512/image.width,512/image.height),w=Math.max(1,Math.floor(image.width*ratio)),h=Math.max(1,Math.floor(image.height*ratio));
    showDialog('A new piece of your world',`${file.name} · ${image.width} × ${image.height} pixels`,`<div class="export-preview checker"><canvas id="import-preview"></canvas></div>${sizeFields(w,h)}<label class="field-label">Import as<select name="destination"><option value="sprite">New sprite${importMode==='terrain'?' and inner terrain':''}</option><option value="layer">Layer in ${escape(sprite().name)} · top left</option></select></label><p class="field-note">${ratio<1?'This image is larger than 512 pixels and will be scaled down. ':''}Resizing uses nearest neighbor. Images added as layers are clipped to the active canvas.</p>`,'Import image',data=>add(Number(data.get('width')),Number(data.get('height')),data.get('destination')==='layer'));
    paintCanvas($('#import-preview'),image.pixels,image.width,image.height);
  } catch(error){toast(`Could not import image. ${error.message}`,true);}
});
$('#json-file').addEventListener('change',async e=>{
  const file=e.target.files[0];if(!file)return;
  try {
    if(file.size>512*1024*1024)throw new Error('Please choose a backup under 512 MB.');
    const imported=parseWorkspace(JSON.parse(await file.text()));
    showDialog('Welcome back, pixels.',`This backup contains ${imported.sprites.length} sprites, ${imported.tilesets.length} auto terrains, ${imported.collections.length} tileset collections, and ${imported.tilemaps.length} tilemaps.`,`<label class="field-label">How would you like to restore?<select name="mode"><option value="merge">Merge into this workspace</option><option value="replace">Replace this workspace</option></select></label><div class="note-card">Merge adds a copy of every asset and combines custom colors, keeping your current settings. Replace loads the backup’s assets and settings and removes the current collection. Export a backup first if you want to keep it.</div>`,'Restore backup',async data=>{
      if(data.get('mode')==='replace')workspace=imported;
      else{
        if(workspace.sprites.length+imported.sprites.length>100||workspace.tilesets.length+imported.tilesets.length>100||workspace.tilemaps.length+imported.tilemaps.length>100||workspace.collections.length+imported.collections.length>100)throw new Error('Merged workspaces can have up to 100 assets of each type.');
        checkCapacity(workspacePixelCount(imported));
        if(workspace.palettes.saved.length+imported.palettes.saved.length>MAX_PALETTES)throw new Error('Merging would exceed 32 named palettes.');
        const map=new Map();for(const s of imported.sprites){map.set(s.id,uid());s.id=map.get(s.id);const old=s.activeLayerId;for(const l of s.layers){const prev=l.id;l.id=uid();if(prev===old)s.activeLayerId=l.id;}}
        for(const t of imported.tilesets){const old=t.id;t.id=uid();map.set(old,t.id);for(const key of ['terrainA','terrainB','borderTexture'])t.options[key]=map.get(t.options[key])||'';for(const o of Object.values(t.options.overrides||{}))if(o.borderTexture)o.borderTexture=map.get(o.borderTexture)||'';}
        for(const c of imported.collections){c.id=uid();c.terrainIds=c.terrainIds.map(id=>map.get(id));}
        for(const m of imported.tilemaps){for(const p of m.patterns||[]){p.id=uid();for(const tile of p.tiles)tile.assetId=map.get(tile.assetId);}m.id=uid();m.tilesetId=map.get(m.tilesetId)||null;for(const source of m.sources||[])source.assetId=map.get(source.assetId);const active=m.activeLayerId;for(const l of m.layers){const old=l.id;l.id=uid();if(old===active)m.activeLayerId=l.id;}}
        workspace.palettes.saved.push(...imported.palettes.saved.map(p=>({...p,id:uid()})));
        workspace.collections.push(...imported.collections);workspace.sprites.push(...imported.sprites);workspace.tilesets.push(...imported.tilesets);workspace.tilemaps.push(...imported.tilemaps);workspace.palettes.custom=[...new Set([...workspace.palettes.custom,...imported.palettes.custom])].slice(0,128);
      }
      state.history.clear();state.tabViews.clear();state.tile=null;state.mapId=null;state.selection=null;hydrateSession();changed();await persist();closeDialog();render();if(state.view!=='library')fitCanvas();toast('Your workspace is restored.');
    });
  }catch(error){toast(`Could not import backup. ${error.message}`,true);}
});

document.addEventListener('click',async e=>{
  const el=e.target.closest('[data-action]');if(!el||el.disabled)return;
  const action=el.dataset.action;
  try {
    switch(action) {
      case 'pixel':setView('pixel');break;
      case 'tiles':setView('tiles');break;
      case 'map':setView('map');break;
      case 'open-tab':openDocument(el.dataset.id);break;
      case 'close-tab':closeTab(el.dataset.id);break;
      case 'close-all-tabs':closeAllTabs();break;
      case 'rename-asset':renameAssetDialog(el.dataset.id);break;
      case 'new-document':newDocumentDialog();break;
      case 'texture-category':textureCategoryDialog(el.dataset.id);break;
      case 'new-tileset':newTileset();break;
      case 'new-collection':collectionDialog();break;
      case 'edit-collection':collectionDialog(el.dataset.id);break;
      case 'export-collection':await exportCollection(workspace.collections.find(c=>c.id===el.dataset.id));break;
      case 'delete-collection':deleteCollection(el.dataset.id);break;
      case 'new-map':newMapDialog();break;
      case 'tiles-to-map':newMapDialog(state.tile.id);break;
      case 'library-filter':state.libraryFilter=el.dataset.kind;renderLibraryPage();break;
      case 'duplicate-asset':duplicateAsset(el.dataset.id);break;
      case 'copy-selection':copySelection();break;
      case 'paste-selection':pasteSelection();break;
      case 'rotate-selection-left':transformSelectedRegion(-90);break;
      case 'rotate-selection-right':transformSelectedRegion(90);break;
      case 'flip-selection-x':transformSelectedRegion(0,true);break;
      case 'flip-selection-y':transformSelectedRegion(0,false,true);break;
      case 'border-strip-preset':changeTile({borderMapping:'native',borderAlign:'center',borderScale:1,borderReverse:false,borderTrim:false,borderOffset:0,borderRepeat:0,borderPhase:0,borderRotation:0,border:settings().tile.size},el.dataset.selected==='true');break;
      case 'godot-export':collectionDialog(null,true);break;
      case 'rotate-tile':transformSelectedTile(90);break;
      case 'flip-tile-x':transformSelectedTile(0,true);break;
      case 'flip-tile-y':transformSelectedTile(0,false,true);break;
      case 'previous-tile':case 'next-tile':state.selectedTile=(state.selectedTile+(action==='next-tile'?1:-1)+state.tile.masks.length)%state.tile.masks.length;renderRight();drawOverlay();break;
      case 'reset-tile':checkpoint();delete settings().tile.overrides[state.selectedTile];regenerate();changed();renderRight();updateCanvas();break;
      case 'save-animation':saveTileAnimation();break;
      case 'clear-animation':checkpoint();delete state.tile.animations[state.selectedTile];changed();renderRight();break;
      case 'play-animation':state.animationPlaying=!state.animationPlaying;renderRight();updateCanvas();break;
      case 'map-tool':state.mapTool=el.dataset.tool;renderLeft();positionCanvas();break;
      case 'map-tile':state.mapTile=!mapPaletteAtlas()?el.dataset.index:Number(el.dataset.index);if(state.mapTool==='picker'||state.mapTool==='erase'||state.mapTool==='pan')state.mapTool='paint';renderLeft();break;
      case 'texture-tile':{const index=Number(el.dataset.index),old=state.textureSelection;state.textureSelection={assetId:state.mapTextureId,start:e.shiftKey&&old?.assetId===state.mapTextureId?old.start:index,end:index};state.mapTile='selection';if(['picker','erase','pan'].includes(state.mapTool))state.mapTool='paint';renderLeft();drawOverlay();break;}
      case 'save-map-pattern':saveMapPattern();break;
      case 'delete-map-pattern':checkpoint();currentMap().patterns=currentMap().patterns.filter(p=>p.id!==state.mapTile);state.mapTile='selection';changed();renderLeft();break;
      case 'edit-map-tileset':openDocument(mapPaletteAtlas()?.id);break;
      case 'resize-map':resizeMapDialog();break;
      case 'map-select-layer':currentMap().activeLayerId=el.dataset.id;changed();renderRight();break;
      case 'map-toggle-layer':checkpoint();{const l=currentMap().layers.find(l=>l.id===el.dataset.id);l.visible=!l.visible;}changed();renderRight();updateCanvas();break;
      case 'map-add-layer':{const m=currentMap();if(m.layers.length>=16)throw new Error('A map can have up to 16 layers.');checkCapacity(m.width*m.height);checkpoint();const l=mapLayer(m.width,m.height,`Layer ${m.layers.length+1}`);m.layers.push(l);m.activeLayerId=l.id;changed();renderRight();break;}
      case 'map-delete-layer':{const m=currentMap();if(m.layers.length>1){checkpoint();const target=el.dataset.id||m.activeLayerId;m.layers=m.layers.filter(l=>l.id!==target);if(m.activeLayerId===target)m.activeLayerId=m.layers.at(-1).id;changed();renderRight();updateCanvas();}break;}
      case 'map-layer-up':case 'map-layer-down':{const m=currentMap(),i=m.layers.findIndex(l=>l.id===(el.dataset.id||m.activeLayerId)),next=i+(action==='map-layer-up'?1:-1);if(next>=0&&next<m.layers.length){checkpoint();[m.layers[i],m.layers[next]]=[m.layers[next],m.layers[i]];changed();renderRight();updateCanvas();}break;}
      case 'map-merge-down':mergeMapLayerDown(el.dataset.id);break;
      case 'tool':state.tool=el.dataset.tool;renderLeft();positionCanvas();break;
      case 'brush':settings().brushSize=Number(el.dataset.size);changed();renderLeft();break;
      case 'dither':settings().dither=!settings().dither;changed();renderLeft();break;
      case 'mirror-x':settings().mirrorX=!settings().mirrorX;changed();renderLeft();break;
      case 'mirror-y':settings().mirrorY=!settings().mirrorY;changed();renderLeft();break;
      case 'color':settings().color=el.dataset.color;changed();renderLeft();break;
      case 'swap-colors':[settings().color,settings().secondaryColor]=[settings().secondaryColor,settings().color];changed();renderLeft();break;
      case 'new-palette':paletteEditor(true);break;
      case 'edit-palette':paletteEditor();break;
      case 'duplicate-palette':paletteEditor(true,currentPalette());break;
      case 'delete-palette':deletePalette();break;
      case 'import-palette':pickPalette();break;
      case 'export-palette':download(new Blob([JSON.stringify(exportPalette(currentPalette()),null,2)],{type:'application/json'}),`${safeName(currentPalette().name)}.palette.json`);break;
      case 'palette-remove-color':el.closest('.palette-color-row').remove();break;
      case 'palette-add-color':if(settings().color==='transparent'){toast('Transparent is always available in every palette.');break;}if(document.querySelectorAll('.palette-color-row').length>=128)throw new Error('A palette can hold 128 colors.');$('#palette-colors').insertAdjacentHTML('beforeend',paletteColorRow(settings().color));break;
      case 'add-color':{
        if(settings().color==='transparent'){toast('Transparent is always available in every palette.');break;}
        const palette=currentPalette();
        if(palette.builtin){paletteEditor(true,{name:palette.name+' copy',colors:[...palette.colors,...(palette.colors.includes(settings().color)?[]:[settings().color])]});break;}
        if(palette.colors.length>=128)throw new Error('A palette can hold 128 colors.');
        if(!palette.colors.includes(settings().color))palette.colors.push(settings().color);changed();renderLeft();toast('Color added to your palette.');break;
      }
      case 'grid':{const key=state.view==='map'?'mapGrid':'grid';settings()[key]=!settings()[key];el.setAttribute('aria-pressed',settings()[key]);changed();drawOverlay();break;}
      case 'undo':undo();break;
      case 'redo':undo(true);break;
      case 'zoom-in':zoomBy(1.25);break;
      case 'zoom-out':zoomBy(.8);break;
      case 'zoom-reset':state.zoom=1;state.pan={x:0,y:0};positionCanvas();break;
      case 'fit':fitCanvas();break;
      case 'deselect':state.selection=null;drawOverlay();break;
      case 'new':newSpriteDialog();break;
      case 'rename':renameDialog();break;
      case 'resize':resizeDialog();break;
      case 'library':libraryDialog();break;
      case 'settings':settingsDialog();break;
      case 'inspector':state.inspector=!state.inspector;$('#right-panel').classList.toggle('inspector-open',state.inspector);el.setAttribute('aria-expanded',state.inspector);break;
      case 'help':helpDialog();break;
      case 'export':exportDialog();break;
      case 'backup':await backup();break;
      case 'restore':$('#json-file').value='';$('#json-file').click();break;
      case 'close-dialog':closeDialog();break;
      case 'size-preset':$('#dialog [name="width"]').value=el.dataset.size;$('#dialog [name="height"]').value=el.dataset.size;break;
      case 'select-layer':sprite().activeLayerId=el.dataset.id;changed();renderRight();break;
      case 'toggle-layer':checkpoint();{const l=sprite().layers.find(l=>l.id===el.dataset.id);l.visible=!l.visible;}changed();renderRight();updateCanvas();break;
      case 'add-layer':case 'duplicate-layer':{
        if(sprite().layers.length>=32)throw new Error('A sprite can have up to 32 layers.');
        checkCapacity(sprite().width*sprite().height);
        checkpoint();const source=sprite().layers.find(l=>l.id===el.dataset.id)||layer(),l=action==='add-layer'?makeLayer(sprite().width,sprite().height,`Layer ${sprite().layers.length+1}`):{...source,id:uid(),name:`${source.name} copy`,pixels:new Uint32Array(source.pixels)};
        sprite().layers.splice(sprite().layers.findIndex(l=>l.id===source.id)+1,0,l);sprite().activeLayerId=l.id;changed();renderRight();updateCanvas();break;
      }
      case 'delete-layer':if(sprite().layers.length>1){checkpoint();const target=el.dataset.id||sprite().activeLayerId;sprite().layers=sprite().layers.filter(l=>l.id!==target);if(sprite().activeLayerId===target)sprite().activeLayerId=sprite().layers.at(-1).id;changed();renderRight();updateCanvas();}break;
      case 'rename-layer':renameDialog(true,el.dataset.id);break;
      case 'layer-up':case 'layer-down':{const index=sprite().layers.findIndex(l=>l.id===(el.dataset.id||sprite().activeLayerId)),next=index+(action==='layer-up'?1:-1);if(next>=0&&next<sprite().layers.length){checkpoint();[sprite().layers[index],sprite().layers[next]]=[sprite().layers[next],sprite().layers[index]];changed();renderRight();updateCanvas();}break;}
      case 'merge-down':mergePixelLayerDown(el.dataset.id);break;
      case 'open-sprite':case 'open-tileset':openDocument(el.dataset.id);break;
      case 'duplicate-sprite':{if(workspace.sprites.length>=100)throw new Error('Your workspace holds up to 100 sprites.');const original=workspace.sprites.find(s=>s.id===el.dataset.id);checkCapacity(original.width*original.height*original.layers.length);const s=cloneSprite(original),active=s.activeLayerId;s.id=uid();s.name=`${s.name} copy`;for(const l of s.layers){const old=l.id;l.id=uid();if(old===active)s.activeLayerId=l.id;}workspace.sprites.push(s);changed();libraryDialog();break;}
      case 'delete-asset':deleteAssetDialog(el.dataset.id);break;
      case 'download-asset':{const t=workspace.tilesets.find(t=>t.id===el.dataset.id);await downloadPNG(t.pixels,t.width,t.height,t.name);break;}
      case 'use-in-tiles':newTileset(sprite().id);break;
      case 'import-image':pickImage();break;
      case 'import-terrain':pickImage('terrain');break;
      case 'import-atlas':pickImage('atlas');break;
      case 'tile-iso':changeTile({isometric:!settings().tile.isometric});fitCanvas();break;
      case 'tile-gap':changeTile({gap:!settings().tile.gap});break;
      case 'generate':checkpoint();regenerate();changed();renderRight();updateCanvas();fitCanvas();toast(`${state.tile.masks.length} connected tiles, ready for your world.`);break;
      case 'save-tileset':saveTilesetDialog();break;
    }
  }catch(error){toast(error.message,true);}
});
let opacityEditing=false;
let draggedTab=null;
function clearTabDrop(){document.querySelectorAll('.document-tab.drop-before,.document-tab.drop-after').forEach(el=>el.classList.remove('drop-before','drop-after'));}
document.addEventListener('dragstart',e=>{
  const tab=e.target.closest('.document-tab');if(!tab)return;
  draggedTab=tab.dataset.tabId;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',draggedTab);tab.classList.add('dragging');
});
document.addEventListener('dragover',e=>{
  if(!draggedTab||!e.target.closest('.document-tabs'))return;
  e.preventDefault();e.dataTransfer.dropEffect='move';clearTabDrop();
  const tab=e.target.closest('.document-tab');if(tab&&tab.dataset.tabId!==draggedTab){const box=tab.getBoundingClientRect();tab.classList.add(e.clientX<box.x+box.width/2?'drop-before':'drop-after');}
  const strip=e.target.closest('.document-tabs'),box=strip.getBoundingClientRect();
  if(e.clientX>box.right-45)strip.scrollLeft+=20;else if(e.clientX<box.left+90)strip.scrollLeft-=20;
});
document.addEventListener('drop',e=>{
  if(!draggedTab||!e.target.closest('.document-tabs'))return;
  e.preventDefault();const id=draggedTab,tab=e.target.closest('.document-tab'),tabs=workspace.session.tabs;
  let index=tabs.length-1;
  if(tab){const box=tab.getBoundingClientRect();index=tabs.indexOf(tab.dataset.tabId)+(e.clientX>=box.x+box.width/2?1:0);if(tabs.indexOf(id)<index)index--;}
  else if(e.target.closest('.close-all-tabs'))index=0;
  draggedTab=null;clearTabDrop();document.querySelector('.document-tab.dragging')?.classList.remove('dragging');moveTab(id,index);
});
document.addEventListener('dragend',()=>{draggedTab=null;clearTabDrop();document.querySelector('.document-tab.dragging')?.classList.remove('dragging');});
document.addEventListener('pointerdown',e=>{if(e.target.id==='opacity'){checkpoint();opacityEditing=true;}});
document.addEventListener('change',e=>{try{
  const el=e.target,id=el.id;
  if(el.dataset.borderOption){if(!el.checkValidity())throw new Error('Enter a value within the displayed range.');const key=el.dataset.borderOption;changeTile({[key]:el.type==='checkbox'?el.checked:el.type==='number'||['borderScale','borderRotation'].includes(key)?Number(el.value):el.value},el.dataset.borderSelected==='true');return;}
  if(['library-category','terrain-category','map-category','sprite-category'].includes(id)){settings().textureCategory=el.value;state.mapPickedSourceId=null;changed(false);}
  if(id==='sprite-category'){renderRight();}
  if(id==='library-sort'){settings().librarySort=el.value;changed(false);renderLibraryResults();}
  if(id==='library-category'){renderLibraryResults();}
  if(id==='terrain-category'){renderLeft();renderRight();}
  if(id==='map-category'){state.mapSourceId='textures';state.textureSelection=null;state.mapTile='selection';renderLeft();drawOverlay();}
  if(id==='theme-setting'){settings().theme=el.value;applyTheme();changed();}
  if(el.matches('.palette-color-picker'))el.closest('.palette-color-row').querySelector('[name="palette-color"]').value=el.value;
  if(el.name==='palette-color'&&/^#[0-9a-f]{6}$/i.test(el.value))el.closest('.palette-color-row').querySelector('.palette-color-picker').value=el.value;
  if(id==='palette-select'){settings().palette=el.value;changed();renderLeft();}
  if(id==='color-input'||id==='hex-input'){let color=el.value.trim().toLowerCase();if(color!=='transparent'&&!color.startsWith('#'))color=`#${color}`;if(color!=='transparent'&&!/^#[0-9a-fA-F]{6}$/.test(color)){toast('Enter a six-digit hex color, like #738B51, or transparent.');el.value=settings().color;return;}settings().color=color.toLowerCase();changed();renderLeft();}
  if(id==='brush-range'){settings().brushSize=Number(el.value);changed();renderLeft();}
  if(id==='opacity'){if(!opacityEditing)checkpoint();layer().opacity=Number(el.value);opacityEditing=false;changed();updateCanvas();}
  if(id==='paste-new-layer'){settings().pasteNewLayer=el.checked;changed();}
  if(id==='sprite-repeat-preview'){state.spriteRepeatPreview=el.checked;updateCanvas();}
  if(['terrainA','terrainB','tile-size','tile-mode','tile-columns','tile-border','tile-border-type','tile-border-texture','tile-cutoff','tile-slopes1','tile-slopes2'].includes(id)){
    const key=({'tile-size':'size','tile-mode':'mode','tile-columns':'columns','tile-border':'border','tile-border-type':'borderType','tile-border-texture':'borderTexture','tile-cutoff':'cutoff','tile-slopes1':'slopes1','tile-slopes2':'slopes2'})[id]||id;
    if(el.type==='number'&&!el.checkValidity())throw new Error('Enter a value within the displayed range.');
    changeTile({[key]:el.type==='checkbox'?el.checked:['size','columns','border','cutoff'].includes(key)?Number(el.value):el.value});
    if(['tile-size','tile-columns','tile-mode','tile-slopes1','tile-slopes2'].includes(id))fitCanvas();
  }
  if(['selected-border-type','selected-border-texture','selected-border','selected-cutoff'].includes(id)){
    if(el.type==='number'&&!el.checkValidity())throw new Error('Enter a value within the displayed range.');
    const key=({'selected-border-type':'borderType','selected-border-texture':'borderTexture','selected-border':'border','selected-cutoff':'cutoff'})[id];changeTile({[key]:['border','cutoff'].includes(key)?Number(el.value):el.value},true);
  }
  if(id==='new-map-terrain'){const atlas=workspace.tilesets.find(t=>t.id===el.value);if(atlas){$('[name="cell-width"]').value=atlas.tileWidth;$('[name="cell-height"]').value=atlas.tileHeight;}}
  if(id==='map-texture'){state.mapTextureId=el.value;state.textureSelection=null;state.mapTile='selection';renderLeft();drawOverlay();}
  if(id==='map-collection'){state.mapCollectionId=el.value;state.mapSourceId=mapAtlasChoices()[0]?.id||'textures';state.mapTile=3;renderLeft();}
  if(id==='map-tileset'){
    state.mapSourceId=el.value;state.mapTile=3;renderLeft();
  }
  if(id==='map-opacity'){checkpoint();currentMapLayer().opacity=Number(el.value);changed();renderRight();updateCanvas();}
}catch(error){toast(error.message,true);}});
document.addEventListener('input',e=>{
  if(e.target.id==='brush-range'){$('#brush-output').textContent=e.target.value;settings().brushSize=Number(e.target.value);}
  if(e.target.id==='opacity'){if(!opacityEditing){checkpoint();opacityEditing=true;}layer().opacity=Number(e.target.value);$('#opacity-output').textContent=`${e.target.value}%`;updateCanvas();}
  if(e.target.id==='tile-border')e.target.nextElementSibling.textContent=`${e.target.value} px`;
  if(e.target.id==='library-search'){state.librarySearch=e.target.value;renderLibraryResults();}
});
document.addEventListener('keydown',e=>{try{
  if($('#dialog').open||e.target.closest('input,textarea,select,[contenteditable]'))return;
  const key=e.key.toLowerCase(),mod=e.ctrlKey||e.metaKey;
  const tab=e.target.closest('.document-tab [role="tab"]');
  if(tab&&e.altKey&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();moveTab(tab.dataset.id,workspace.session.tabs.indexOf(tab.dataset.id)+(e.key==='ArrowLeft'?-1:1));return;}
  if(key===' '){e.preventDefault();state.space=true;positionCanvas();return;}
  if(mod&&key==='s'){e.preventDefault();persist().then(()=>toast(state.saved?'Workspace saved in your browser.':'Export a backup to keep your work.',!state.saved));return;}
  if(state.view==='library')return;
  if(mod&&key==='z'){e.preventDefault();undo(e.shiftKey);return;}
  if(mod&&key==='y'){e.preventDefault();undo(true);return;}
  if(mod&&key==="'"){e.preventDefault();const option=state.view==='map'?'mapGrid':'grid';settings()[option]=!settings()[option];changed();drawOverlay();$('[data-action="grid"]').setAttribute('aria-pressed',settings()[option]);return;}
  if(state.view==='pixel'){
    if(mod&&key==='c'){e.preventDefault();copySelection();return;}
    if(mod&&key==='x'){e.preventDefault();copySelection(true);return;}
    if(mod&&key==='v'){e.preventDefault();pasteSelection();return;}
    if(mod&&key==='a'){e.preventDefault();state.selection=new Uint8Array(sprite().width*sprite().height).fill(1);drawOverlay();return;}
    if((mod&&key==='d')||key==='escape'){e.preventDefault();state.selection=null;drawOverlay();return;}
    if(key==='delete'||key==='backspace'){e.preventDefault();if(!layer().visible)return;checkpoint();for(let i=0;i<layer().pixels.length;i++)if(!state.selection||state.selection[i])layer().pixels[i]=0;changed();updateCanvas();return;}
  }
  if(mod||e.altKey)return;
  if(state.view==='map'){const tool={b:'paint',e:'erase',g:'fill',m:'rect',i:'picker',h:'pan'}[key];if(tool){state.mapTool=tool;renderLeft();positionCanvas();}}
  const tool=toolList.find(t=>t[3].toLowerCase()===key);if(tool&&state.view==='pixel'){state.tool=tool[0];renderLeft();positionCanvas();}
  if(key==='f')fitCanvas();if(key==='+'||key==='=')zoomBy(1.25);if(key==='-')zoomBy(.8);
  if(key==='x'){[settings().color,settings().secondaryColor]=[settings().secondaryColor,settings().color];changed();renderLeft();}
  if(key==='['||key===']'){settings().brushSize=clamp(settings().brushSize+(key==='['?-1:1),1,32);changed();renderLeft();}
}catch(error){toast(error.message,true);}});
document.addEventListener('keyup',e=>{if(e.key===' '){state.space=false;positionCanvas();}});
window.addEventListener('blur',()=>{flushMapPaint();state.space=false;if(state.drag&&['draw','line','move','map-draw','map-rect'].includes(state.drag.type))changed();state.drag=null;});
window.addEventListener('resize',()=>{const d=dimensions(),stage=$('#stage');if(stage&&d.width*state.zoom>stage.clientWidth*1.3)fitCanvas();else positionCanvas();});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&!state.saved)persist();});
window.addEventListener('beforeunload',e=>{if(!state.saved){persist();e.preventDefault();e.returnValue='';}});
// Browser-level drag and drop is supported for both images and workspace backups.
document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();});
document.addEventListener('drop',e=>{
  if(!e.dataTransfer.files.length)return;e.preventDefault();const file=e.dataTransfer.files[0],input=file.name.toLowerCase().endsWith('.json')?$('#json-file'):$('#image-file');importMode=state.view==='tiles'?'terrain':'sprite';const transfer=new DataTransfer();transfer.items.add(file);input.files=transfer.files;input.dispatchEvent(new Event('change'));
});
function hydrateSession(){
  const doc=allAssets().find(a=>a.id===workspace.session.activeTab)||sprite();
  if(doc.kind==='sprite')workspace.activeId=doc.id;
  if(doc.kind==='tileset'){state.tile=doc;settings().tile=structuredClone(doc.options);}
  if(doc.kind==='tilemap')state.mapId=doc.id;
  state.view=workspace.session.view==='library'?'library':assetView(doc);
}
hydrateSession();state.view='library';render();
if(!state.saved)persist();
// Save starter content too, so a backup is available before the first edit.
changed();
let previousAnimation='';
function animationTick(){
  if(!document.hidden&&state.animationPlaying&&!state.drag&&!$('#dialog').open){
    const time=performance.now()/1000;
    if(state.view==='tiles'){
      const frame=animatedTileIndex(state.tile,state.selectedTile,time),signature=`${state.tile.id}:${state.selectedTile}:${frame}`;
      if(signature!==previousAnimation){previousAnimation=signature;drawTilePreview();}
    }else if(state.view==='map'){
      let bounds=null;
      for(const cell of state.mapAnimations||[]){const frame=animatedTileIndex(cell.atlas,cell.id,time);if(cell.frame!==frame){cell.frame=frame;bounds=unionBounds(bounds,cell);}}
      if(bounds)drawMapRegion(bounds);
    }
  }
  requestAnimationFrame(animationTick);
}
requestAnimationFrame(animationTick);
