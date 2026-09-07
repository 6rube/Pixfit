import { makeSprite, makeLayer, hexToColor } from './core.js';
import { DEFAULT_SETTINGS } from './storage.js';

export const PALETTES = {
  woodland: { name: 'Woodland · 24 colors', colors: ['#292f32', '#45504b', '#58694c', '#738b51', '#91aa66', '#b1c884', '#d5e1a0', '#eff0cd', '#483e42', '#72504c', '#9c6553', '#bd8060', '#d59c73', '#e9bb8e', '#f3dfb0', '#fff4da', '#354d66', '#4a6e87', '#7196a4', '#9fc3c7', '#655675', '#978498', '#c6a3b5', '#e6c6cd'] },
  pastel: { name: 'Daydream · 24 colors', colors: ['#3d3a56','#625779','#9b83a6','#c9afcb','#ead2e0','#fff4f0','#614858','#99657a','#c98394','#e8abb0','#f5cfc2','#ffe4ca','#466167','#6e9691','#9db9a1','#bfd5ad','#e0e6bb','#f6edcf','#4e6189','#7b8fb1','#a7bdd0','#cfdfdf','#d8b59b','#f1d19f'] },
  classic: { name: 'Arcade · 24 colors', colors: ['#140c1c','#442434','#30346d','#4e4a4e','#854c30','#346524','#d04648','#757161','#597dce','#d27d2c','#8595a1','#6daa2c','#d2aa99','#6dc2ca','#dad45e','#deeed6','#45283c','#663931','#8f563b','#df7126','#fbf236','#99e550','#639bff','#ffffff'] },
};

function painter(layer, w, h) {
  const dot = (x, y, color) => { if (x >= 0 && y >= 0 && x < w && y < h) layer.pixels[y * w + x] = typeof color === 'number' ? color : hexToColor(color); };
  const rect = (x, y, width, height, c) => { for (let py = y; py < y + height; py++) for (let px = x; px < x + width; px++) dot(px, py, c); };
  const poly = (points, c) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      let inside = false;
      for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const [xi, yi] = points[i], [xj, yj] = points[j];
        if (((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
      }
      if (inside) dot(x, y, c);
    }
  };
  return { dot, rect, poly };
}
export function createDemo() {
  const sprite = makeSprite('A little place', 64, 64);
  const ground = sprite.layers[0]; ground.name = 'Floating island';
  const building = makeLayer(64, 64, 'Cabin & trees');
  const detail = makeLayer(64, 64, 'Little details');
  sprite.layers.push(building, detail); sprite.activeLayerId = detail.id;
  let p = painter(ground, 64, 64);
  p.poly([[7,35],[14,29],[48,29],[58,35],[57,46],[49,53],[36,58],[24,56],[13,50],[8,44]], '#483e42');
  p.poly([[8,35],[56,35],[56,45],[48,50],[36,55],[24,53],[14,48],[9,43]], '#72504c');
  p.poly([[10,37],[23,40],[34,42],[48,40],[54,37],[53,44],[44,49],[34,51],[23,48],[14,44]], '#9c6553');
  p.rect(17,43,3,6,'#72504c'); p.rect(25,47,2,6,'#483e42'); p.rect(38,49,3,4,'#483e42'); p.rect(49,42,2,5,'#bd8060');
  p.poly([[7,34],[17,28],[29,26],[43,27],[56,33],[59,37],[55,42],[44,46],[30,48],[17,44],[8,40]], '#58694c');
  p.poly([[8,33],[18,28],[30,26],[44,28],[55,33],[58,36],[53,40],[44,44],[30,46],[17,42],[8,38]], '#91aa66');
  p.poly([[10,33],[20,28],[31,27],[44,29],[54,34],[54,37],[43,41],[31,44],[18,40],[10,37]], '#b1c884');
  p.poly([[31,32],[35,33],[33,37],[36,39],[39,41],[35,44],[31,43],[32,41],[28,38]], '#e9bb8e');
  p.poly([[31,33],[33,33],[31,37],[33,40],[35,41],[34,43],[32,42],[30,39],[29,37]], '#f3dfb0');
  p.poly([[41,35],[48,34],[52,36],[51,39],[46,41],[40,40],[38,38]], '#4a6e87');
  p.poly([[42,35],[48,35],[50,36],[49,38],[45,40],[40,39],[40,37]], '#7196a4');
  p.rect(42,36,5,1,'#9fc3c7'); p.rect(44,38,3,1,'#9fc3c7');
  for (let i = 0; i < 45; i++) { const x = 9 + i * 17 % 46, y = 28 + i * 11 % 17; if (ground.pixels[y * 64 + x] === hexToColor('#b1c884')) p.dot(x,y, i % 2 ? '#91aa66' : '#d5e1a0'); }
  p = painter(building, 64, 64);
  // The small cabin is made entirely of editable pixels.
  p.rect(23,22,18,12,'#72504c'); p.rect(24,23,16,10,'#e9bb8e');
  p.rect(36,22,5,12,'#bd8060'); p.rect(24,31,12,2,'#d59c73');
  p.poly([[20,23],[30,12],[34,12],[44,23]],'#483e42');
  p.poly([[21,22],[30,12],[34,12],[43,22]],'#9c6553');
  p.poly([[23,20],[30,13],[33,13],[40,20]],'#bd8060');
  p.rect(28,15,7,1,'#d59c73'); p.rect(25,18,6,1,'#d59c73'); p.rect(33,19,6,1,'#72504c');
  p.rect(36,11,3,6,'#72504c'); p.rect(35,10,5,2,'#483e42'); p.rect(37,12,1,3,'#bd8060');
  p.rect(29,26,5,8,'#72504c'); p.rect(30,27,3,7,'#483e42'); p.dot(32,30,'#e9bb8e');
  p.rect(25,24,3,4,'#72504c'); p.rect(25,25,2,2,'#9fc3c7');
  p.rect(36,24,3,4,'#72504c'); p.rect(36,25,2,2,'#f3dfb0'); p.rect(28,34,7,1,'#9c6553');
  function tree(x,y,s=1) {
    p.rect(x+5,y+12,2,9,'#72504c'); p.rect(x+6,y+13,1,7,'#bd8060');
    p.poly([[x+6,y],[x+11,y+6],[x+9,y+6],[x+14,y+12],[x+11,y+12],[x+15,y+17],[x+5,y+19],[x-2,y+16],[x+1,y+11],[x,y+11],[x+3,y+6],[x+2,y+6]],'#45504b');
    p.poly([[x+6,y+1],[x+10,y+6],[x+8,y+6],[x+12,y+11],[x+9,y+11],[x+13,y+16],[x+5,y+17],[x,y+15],[x+3,y+10],[x+2,y+10],[x+5,y+5],[x+4,y+5]],s ? '#738b51' : '#58694c');
    p.poly([[x+6,y+2],[x+7,y+6],[x+5,y+6],[x+8,y+11],[x+5,y+11],[x+8,y+15],[x+2,y+15],[x+5,y+10],[x+4,y+10],[x+6,y+5],[x+5,y+5]],'#91aa66');
  }
  tree(10,16); tree(43,16,0); tree(5,25);
  p = painter(detail,64,64);
  p.rect(38,6,3,2,'#c6a3b5'); p.rect(40,3,4,2,'#e6c6cd'); p.dot(44,2,'#e6c6cd');
  const flowers = [[20,35],[23,39],[17,38],[40,32],[50,33],[43,43]];
  for (const [x,y] of flowers) { p.dot(x,y+1,'#58694c'); p.dot(x,y, '#fff4da'); p.dot(x+1,y,'#d59c73'); }
  p.rect(20,29,1,6,'#bd8060'); p.rect(16,30,1,4,'#bd8060'); p.rect(16,30,5,1,'#f3dfb0'); p.rect(17,32,4,1,'#e9bb8e');
  p.dot(12,43,'#91aa66'); p.dot(12,44,'#738b51'); p.dot(13,45,'#738b51'); p.dot(47,46,'#91aa66'); p.dot(47,47,'#738b51');
  const grass = makeSprite('Meadow grass',16,16), water = makeSprite('Still water',16,16), stone = makeSprite('Cobblestone',16,16);
  grass.layers[0].pixels.fill(hexToColor('#91aa66')); water.layers[0].pixels.fill(hexToColor('#7196a4')); stone.layers[0].pixels.fill(hexToColor('#9fa295'));
  for(let y=0;y<16;y++) for(let x=0;x<16;x++) {
    const n = (x*73+y*31+x*y*7)%29;
    if(n<4) grass.layers[0].pixels[y*16+x]=hexToColor(n<2?'#b1c884':'#738b51');
    if((y%5===1 && (x+y*3)%11<4)) water.layers[0].pixels[y*16+x]=hexToColor('#9fc3c7');
    if(y%5===0 || (x+(Math.floor(y/5)%2)*4)%8===0) stone.layers[0].pixels[y*16+x]=hexToColor('#737d75');
    else if(y%5===1) stone.layers[0].pixels[y*16+x]=hexToColor('#c5c6ae');
  }
  return { sprites: [sprite,grass,water,stone], tilesets: [], activeId: sprite.id, palettes: { custom: [], saved: [] }, settings: { ...DEFAULT_SETTINGS, tile: { ...DEFAULT_SETTINGS.tile, terrainA: grass.id, terrainB: water.id } } };
}
