import { tileDescriptors, extractTile } from './tiles.js';

const textBytes=value=>new TextEncoder().encode(value);
const safeName=value=>String(value||'tileset').toLowerCase().replace(/[^a-z0-9_-]+/g,'-').slice(0,60)||'tileset';
export function terrainProperties(tile,atlas,prefix,terrain={set:0,inner:0,outer:1}) {
  if(atlas.imported||tile.mask===null||atlas.options.isometric)return [];
  const blob=atlas.options.mode==='blob',mask=tile.mask;
  const bits=blob?[[1,'top_side'],[2,'right_side'],[4,'bottom_side'],[8,'left_side'],[16,'top_right_corner'],[32,'bottom_right_corner'],[64,'bottom_left_corner'],[128,'top_left_corner']]:[[1,'top_left_corner'],[2,'top_right_corner'],[4,'bottom_right_corner'],[8,'bottom_left_corner']];
  return [`${prefix}/terrain_set = ${terrain.set}`,`${prefix}/terrain = ${blob||mask?terrain.inner:terrain.outer}`,...bits.map(([bit,name])=>`${prefix}/terrains_peering_bit/${name} = ${mask&bit?terrain.inner:terrain.outer}`)];
}
export async function godotPackage(atlas,encodePNG,terrain) {
  const folder=`pixfit-${safeName(atlas.name)}`,tiles=tileDescriptors(atlas),files=[],animations=Object.entries(atlas.animations||{}).filter(([,a])=>a.frames.length>0);
  files.push({name:`${folder}/atlas.png`,data:await encodePNG(atlas)});
  const external=[`[ext_resource type="Texture2D" path="res://${folder}/atlas.png" id="1_atlas"]`];
  const sources=[],mapping={};
  const normal=[`[sub_resource type="TileSetAtlasSource" id="Atlas"]`,`texture = ExtResource("1_atlas")`,`texture_region_size = Vector2i(${atlas.tileWidth}, ${atlas.tileHeight})`,`separation = Vector2i(${atlas.gap}, ${atlas.gap})`];
  for(const tile of tiles){
    const x=tile.x/(atlas.tileWidth+atlas.gap),y=tile.y/(atlas.tileHeight+atlas.gap),key=`${x}:${y}`;
    normal.push(`${key}/size_in_atlas = Vector2i(${tile.spanX}, ${tile.spanY})`,`${key}/0 = 0`);
    // Match the map editor's top-left anchor for multi-cell slope artwork.
    normal.push(`${key}/0/texture_origin = Vector2i(${-Math.floor((tile.width-atlas.tileWidth)/2)}, ${-Math.floor((tile.height-atlas.tileHeight)/2)})`);
    normal.push(...terrainProperties(tile,atlas,`${key}/0`,terrain));mapping[tile.id]={source:0,atlas:[x,y],alternative:0};
  }
  sources.push(normal.join('\n'));
  for(let i=0;i<animations.length;i++){
    const [key,animation]=animations[i],tile=tiles[Number(key)],frames=animation.frames.map(f=>extractTile(atlas,f));
    const columns=Math.min(frames.length,Math.floor(4096/tile.width)),rows=Math.ceil(frames.length/columns),width=columns*tile.width,height=rows*tile.height;
    const pixels=new Uint32Array(width*height);
    frames.forEach((frame,j)=>{for(let y=0;y<frame.height;y++)pixels.set(frame.pixels.subarray(y*frame.width,(y+1)*frame.width),(Math.floor(j/columns)*tile.height+y)*width+(j%columns)*tile.width);});
    const file=`animation-${Number(key)+1}.png`,id=`${i+2}_animation`;
    files.push({name:`${folder}/${file}`,data:await encodePNG({pixels,width,height})});
    external.push(`[ext_resource type="Texture2D" path="res://${folder}/${file}" id="${id}"]`);
    const lines=[`[sub_resource type="TileSetAtlasSource" id="Animation_${i}"]`,`texture = ExtResource("${id}")`,`texture_region_size = Vector2i(${tile.width}, ${tile.height})`,`0:0/animation_columns = ${columns}`,`0:0/animation_speed = ${animation.fps}`,`0:0/animation_frames_count = ${frames.length}`];
    for(let f=0;f<frames.length;f++)lines.push(`0:0/animation_frame_${f}/duration = 1.0`);
    lines.push('0:0/0 = 0',`0:0/0/texture_origin = Vector2i(${-Math.floor((tile.width-atlas.tileWidth)/2)}, ${-Math.floor((tile.height-atlas.tileHeight)/2)})`,...terrainProperties(tile,atlas,'0:0/0',terrain));
    sources.push(lines.join('\n'));mapping[key]={source:i+1,atlas:[0,0],alternative:0};
  }
  const resource=['[resource]',`resource_name = ${JSON.stringify(atlas.name||'Pixfit tileset')}`,`tile_size = Vector2i(${atlas.tileWidth}, ${atlas.tileHeight})`];
  if(atlas.options.isometric&&!atlas.imported)resource.push('tile_shape = 1','tile_layout = 5');
  if(!atlas.imported&&!atlas.options.isometric)resource.push(`terrain_set_0/mode = ${atlas.options.mode==='blob'?0:1}`,'terrain_set_0/terrain_0/name = "Inner terrain"','terrain_set_0/terrain_0/color = Color(0.56, 0.68, 0.39, 1)','terrain_set_0/terrain_1/name = "Outer terrain"','terrain_set_0/terrain_1/color = Color(0.43, 0.59, 0.66, 1)');
  resource.push('sources/0 = SubResource("Atlas")');for(let i=0;i<animations.length;i++)resource.push(`sources/${i+1} = SubResource("Animation_${i}")`);
  const tres=`[gd_resource type="TileSet" load_steps=${external.length+sources.length+1} format=3]\n\n${external.join('\n')}\n\n${sources.join('\n\n')}\n\n${resource.join('\n')}\n`;
  files.push({name:`${folder}/tileset.tres`,data:textBytes(tres)});
  files.push({name:`${folder}/tile-ids.json`,data:textBytes(JSON.stringify({format:'pixfit-godot',version:1,tiles:mapping},null,2))});
  files.push({name:`${folder}/README.txt`,data:textBytes(`PIXFIT → GODOT 4\n\nExtract this ${folder} folder into your Godot project root, preserving its name.\nOpen the project so Godot imports the PNG textures. Assign tileset.tres to a TileMap or TileMapLayer.\nSet the node's Texture Filter to Nearest for pixel art.\n\nThe base atlas includes every static tile. Additional atlas sources provide animated versions.\ntile-ids.json maps Pixfit's zero-based tile IDs to Godot source IDs and atlas coordinates.\nRotation and flips are baked into the PNG. Multi-cell slopes retain their full rectangle.\n${atlas.options.isometric?'Isometric diamond layout is configured. Set up terrain peering rules in Godot if needed.':'Generated orthogonal tiles include terrain peering bits. Custom cutoffs can intentionally change visual joins.'}\nCollision, navigation and physics polygons can be added in Godot's TileSet editor.\n`)});
  return {files,folder,tres,mapping};
}

// A Godot TileSet is a collection of atlas sources, sharing terrain identities
// within each matching mode. Terrain pairs that share a texture can connect.
export async function godotCollectionPackage(collection,atlases,sprites,encodePNG) {
  const selected=collection.terrainIds.map(id=>atlases.find(t=>t.id===id));
  if(!selected.length||selected.some(t=>!t))throw new Error('Choose at least one existing auto terrain.');
  const base=selected[0],isometric=t=>!t.imported&&!!t.options.isometric;
  if(selected.some(t=>t.tileWidth!==base.tileWidth||t.tileHeight!==base.tileHeight||isometric(t)!==isometric(base)))throw new Error('A Godot TileSet needs terrains with the same tile size and projection.');
  const folder=`pixfit-${safeName(collection.name)}`,files=[],definitions=[],bindings=[],mapping={},groups=[];
  let sourceOffset=0,loadSteps=1;
  for(let i=0;i<selected.length;i++){
    const atlas=selected[i];let terrain;
    if(!atlas.imported&&!isometric(atlas)){
      const mode=atlas.options.mode==='blob'?0:1;
      let set=groups.findIndex(g=>g.mode===mode);
      if(set<0){set=groups.length;groups.push({mode,terrains:[]});}
      const identity=key=>{
        const assetId=atlas.options[key];
        if(assetId==='')return -1;
        const id=assetId||`${atlas.id}:${key}`,group=groups[set];
        let index=group.terrains.findIndex(t=>t.id===id);
        if(index<0){index=group.terrains.length;group.terrains.push({id,name:sprites.find(s=>s.id===assetId)?.name||`${atlas.name} · ${key==='terrainA'?'Inner':'Outer'}`});}
        return index;
      };
      terrain={set,inner:identity('terrainA'),outer:identity('terrainB')};
    }
    const pack=await godotPackage(atlas,encodePNG,terrain),prefix=`Terrain_${i}_`,path=`${folder}/terrain-${i+1}`;
    let text=pack.tres.replaceAll(`res://${pack.folder}/`,`res://${path}/`);
    text=text.replace(/id="([^"]+)"/g,(_,id)=>`id="${prefix}${id}"`).replace(/(ExtResource|SubResource)\("([^"]+)"\)/g,(_,type,id)=>`${type}("${prefix}${id}")`);
    const [head,resource]=text.split('[resource]');
    definitions.push(head.replace(/^\[gd_resource[^\n]+\]\s*/, '').trim());
    for(const match of resource.matchAll(/sources\/(\d+) = SubResource\("([^"]+)"\)/g))bindings.push(`sources/${sourceOffset+Number(match[1])} = SubResource("${match[2]}")`);
    mapping[atlas.id]={name:atlas.name,terrain,tiles:Object.fromEntries(Object.entries(pack.mapping).map(([id,tile])=>[id,{...tile,source:tile.source+sourceOffset}]))};
    sourceOffset+=1+Object.values(atlas.animations||{}).filter(a=>a.frames.length).length;
    loadSteps+=(head.match(/\[(?:ext_resource|sub_resource) /g)||[]).length;
    for(const file of pack.files)if(file.name.endsWith('.png'))files.push({...file,name:file.name.replace(pack.folder,path)});
  }
  // All external resources must precede subresources in a text resource.
  const blocks=definitions.join('\n\n').split(/\n(?=\[)/),external=blocks.filter(b=>b.startsWith('[ext_resource')),sub=blocks.filter(b=>b.startsWith('[sub_resource'));
  const resource=['[resource]',`resource_name = ${JSON.stringify(collection.name)}`,`tile_size = Vector2i(${base.tileWidth}, ${base.tileHeight})`];
  if(isometric(base))resource.push('tile_shape = 1','tile_layout = 5');
  groups.forEach((group,set)=>{
    resource.push(`terrain_set_${set}/mode = ${group.mode}`);
    group.terrains.forEach((t,id)=>resource.push(`terrain_set_${set}/terrain_${id}/name = ${JSON.stringify(t.name)}`,`terrain_set_${set}/terrain_${id}/color = Color(${(0.3+(id*.23)%0.6).toFixed(2)}, 0.65, 0.45, 1)`));
  });
  const tres=`[gd_resource type="TileSet" load_steps=${loadSteps} format=3]\n\n${[...external,...sub,resource.concat(bindings).join('\n')].join('\n\n')}\n`;
  files.push({name:`${folder}/tileset.tres`,data:textBytes(tres)},{name:`${folder}/tile-ids.json`,data:textBytes(JSON.stringify({format:'pixfit-godot',version:2,terrains:mapping},null,2))},{name:`${folder}/README.txt`,data:textBytes(`PIXFIT TILESET → GODOT 4\n\nExtract ${folder} into your project root. Assign tileset.tres to a TileMapLayer and use Nearest texture filtering.\nAll selected auto terrains and animations are atlas sources in this one TileSet. Terrain textures share identities within each matching mode; transparent outer space uses empty terrain (-1).\nOnly transitions present in your generated artwork can be painted automatically. Create an auto terrain for each material pair you want to connect.\nCorner and blob matching use separate terrain sets. Isometric artwork requires peering setup in Godot.\n`) });
  return {folder,files,tres,mapping};
}

const crcTable=Uint32Array.from({length:256},(_,n)=>{let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(bytes){let crc=0xffffffff;for(const byte of bytes)crc=crcTable[(crc^byte)&255]^(crc>>>8);return (crc^0xffffffff)>>>0;}
// ZIP's stored method keeps this static app dependency-free; PNG data is already compressed.
export function zipFiles(files) {
  const chunks=[],directory=[];let offset=0,dirSize=0;
  for(const file of files){
    const name=textBytes(file.name),data=typeof file.data==='string'?textBytes(file.data):file.data,crc=crc32(data);
    const header=new Uint8Array(30+name.length),h=new DataView(header.buffer);
    h.setUint32(0,0x04034b50,true);h.setUint16(4,20,true);h.setUint16(6,0x0800,true);h.setUint32(14,crc,true);h.setUint32(18,data.length,true);h.setUint32(22,data.length,true);h.setUint16(26,name.length,true);header.set(name,30);
    const central=new Uint8Array(46+name.length),c=new DataView(central.buffer);
    c.setUint32(0,0x02014b50,true);c.setUint16(4,20,true);c.setUint16(6,20,true);c.setUint16(8,0x0800,true);c.setUint32(16,crc,true);c.setUint32(20,data.length,true);c.setUint32(24,data.length,true);c.setUint16(28,name.length,true);c.setUint32(42,offset,true);central.set(name,46);
    chunks.push(header,data);directory.push(central);offset+=header.length+data.length;dirSize+=central.length;
  }
  const end=new Uint8Array(22),e=new DataView(end.buffer);e.setUint32(0,0x06054b50,true);e.setUint16(8,files.length,true);e.setUint16(10,files.length,true);e.setUint32(12,dirSize,true);e.setUint32(16,offset,true);
  return new Blob([...chunks,...directory,end],{type:'application/zip'});
}
