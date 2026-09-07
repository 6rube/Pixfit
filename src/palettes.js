import { uid } from './core.js';

export const MAX_PALETTES = 32;
export function validatePalette(value) {
  if(!value||typeof value.name!=='string'||!value.name.trim()||value.name.length>100)throw new Error('Give the palette a name of 1–100 characters.');
  if(!Array.isArray(value.colors)||value.colors.length>128||value.colors.some(c=>typeof c!=='string'||!/^#[0-9a-f]{6}$/i.test(c)))throw new Error('Use up to 128 colors in #RRGGBB format.');
  return {name:value.name.trim(),colors:value.colors.map(c=>c.toLowerCase())};
}
export function importPalette(value) {
  if(value?.format!=='pixfit-palette'||value.version!==1)throw new Error('Choose a Pixfit palette JSON file.');
  return {id:uid(),...validatePalette(value)};
}
export function exportPalette(palette) {
  return {format:'pixfit-palette',version:1,...validatePalette(palette)};
}
export function savedPalettes(raw) {
  if(raw===undefined)return [];
  if(!Array.isArray(raw)||raw.length>MAX_PALETTES)throw new Error('A workspace supports up to 32 named palettes.');
  const ids=new Set(['woodland','pastel','classic','custom']);
  return raw.map(p=>{
    if(typeof p?.id!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(p.id)||ids.has(p.id))throw new Error('Invalid or duplicate palette ID.');
    ids.add(p.id);return {id:p.id,...validatePalette(p)};
  });
}
