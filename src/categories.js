// Categories are names on textures, so backups and merges need no ID remapping.
export function cleanCategory(value) {
  return typeof value==='string'?value.trim().replace(/\s+/g,' ').slice(0,48):'';
}
export function textureCategories(sprites) {
  return [...new Set(sprites.map(s=>cleanCategory(s.category)).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
}
export function texturesInCategory(sprites,category='*') {
  return category==='*'?sprites:sprites.filter(s=>cleanCategory(s.category)===category);
}
