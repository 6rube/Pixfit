export const MAX_SIZE = 512;
export const uid = () => globalThis.crypto?.randomUUID?.() || `id-${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
export const rgba = (r, g, b, a = 255) => (((r << 24) | (g << 16) | (b << 8) | a) >>> 0);
export const hexToColor = (hex) => hex === 'transparent' ? 0 : (parseInt(hex.replace('#', '').slice(0, 6), 16) * 256 + 255) >>> 0;
export const colorToHex = (color) => `#${(color >>> 8).toString(16).padStart(6, '0')}`;
export const channels = (color) => [color >>> 24, (color >>> 16) & 255, (color >>> 8) & 255, color & 255];

export function makeLayer(width, height, name = 'Layer 1') {
  return { id: uid(), name, visible: true, opacity: 100, pixels: new Uint32Array(width * height) };
}
export function makeSprite(name, width, height) {
  const layer = makeLayer(width, height);
  return { id: uid(), kind: 'sprite', name, width, height, layers: [layer], activeLayerId: layer.id, updatedAt: Date.now() };
}
export function cloneSprite(sprite) {
  return { ...sprite, layers: sprite.layers.map(layer => ({ ...layer, pixels: new Uint32Array(layer.pixels) })) };
}
export function composite(sprite) {
  const out = new Uint32Array(sprite.width * sprite.height);
  for (const layer of sprite.layers) {
    if (!layer.visible || !layer.opacity) continue;
    for (let i = 0; i < out.length; i++) {
      const src = layer.pixels[i];
      if (!(src & 255)) continue;
      const sa = (src & 255) / 255 * layer.opacity / 100;
      if (sa === 1) { out[i] = src; continue; }
      const dst = out[i], da = (dst & 255) / 255, a = sa + da * (1 - sa);
      const mix = shift => Math.round((((src >>> shift) & 255) * sa + ((dst >>> shift) & 255) * da * (1 - sa)) / a);
      out[i] = rgba(mix(24), mix(16), mix(8), Math.round(a * 255));
    }
  }
  return out;
}
export function imageBytes(pixels) {
  const bytes = new Uint8ClampedArray(pixels.length * 4);
  for (let i = 0; i < pixels.length; i++) bytes.set(channels(pixels[i]), i * 4);
  return bytes;
}
export function pixelsFromBytes(bytes) {
  const pixels = new Uint32Array(bytes.length / 4);
  for (let i = 0; i < pixels.length; i++) pixels[i] = bytes[i * 4 + 3] ? rgba(...bytes.subarray(i * 4, i * 4 + 4)) : 0;
  return pixels;
}
export function linePoints(x0, y0, x1, y1, visit) {
  const dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
  const dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
  let error = dx + dy;
  for (;;) {
    visit(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * error;
    if (e2 >= dy) { error += dy; x0 += sx; }
    if (e2 <= dx) { error += dx; y0 += sy; }
  }
}
export function stamp(pixels, width, height, x, y, color, options = {}) {
  const size = options.size || 1, offset = Math.floor(size / 2);
  for (let by = y - offset; by < y - offset + size; by++) {
    for (let bx = x - offset; bx < x - offset + size; bx++) {
      if (options.dither && (bx + by) % 2) continue;
      const points = [[bx, by]];
      if (options.mirrorX) points.push([width - 1 - bx, by]);
      if (options.mirrorY) points.push([bx, height - 1 - by]);
      if (options.mirrorX && options.mirrorY) points.push([width - 1 - bx, height - 1 - by]);
      for (const [px, py] of points) {
        if (px < 0 || py < 0 || px >= width || py >= height) continue;
        const i = py * width + px;
        if (options.selection && !options.selection[i]) continue;
        pixels[i] = color;
      }
    }
  }
}
export function floodFill(pixels, width, height, x, y, color, selection = null, dither = false) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const start = y * width + x, target = pixels[start];
  if (target === color || (selection && !selection[start])) return;
  const visited = new Uint8Array(pixels.length), queue = [start];
  visited[start] = 1;
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const i = queue[cursor], px = i % width, py = Math.floor(i / width);
    if (!dither || (px + py) % 2 === 0) pixels[i] = color;
    for (const n of [px > 0 ? i - 1 : -1, px < width - 1 ? i + 1 : -1, py > 0 ? i - width : -1, py < height - 1 ? i + width : -1]) {
      if (n < 0 || visited[n] || pixels[n] !== target || (selection && !selection[n])) continue;
      visited[n] = 1;
      queue.push(n);
    }
  }
}
export function shapeSelection(width, height, x0, y0, x1, y1, ellipse = false) {
  const mask = new Uint8Array(width * height);
  // Drag endpoints are boundaries: 0 to 32 spans 32 pixels. Keep clicks
  // and horizontal/vertical drags at least one pixel thick.
  const left = Math.min(x0, x1), right = Math.max(x0, x1) + (x0 === x1 ? 1 : 0), top = Math.min(y0, y1), bottom = Math.max(y0, y1) + (y0 === y1 ? 1 : 0);
  const rx = (right - left) / 2, ry = (bottom - top) / 2, cx = left + rx - 0.5, cy = top + ry - 0.5;
  for (let y = Math.max(0, top); y < Math.min(height, bottom); y++) {
    for (let x = Math.max(0, left); x < Math.min(width, right); x++) {
      if (!ellipse || ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1) mask[y * width + x] = 1;
    }
  }
  return mask;
}
export function translatePixels(pixels, width, height, dx, dy, selection = null) {
  const result = selection ? new Uint32Array(pixels) : new Uint32Array(pixels.length);
  const nextSelection = selection ? new Uint8Array(pixels.length) : null;
  if (selection) for (let i = 0; i < pixels.length; i++) if (selection[i]) result[i] = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x, nx = x + dx, ny = y + dy;
    if ((selection && !selection[i]) || nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
    result[ny * width + nx] = pixels[i];
    if (nextSelection) nextSelection[ny * width + nx] = 1;
  }
  return { pixels: result, selection: nextSelection };
}
export function resizeSprite(sprite, width, height, scale = false) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_SIZE || height > MAX_SIZE) throw new Error('Use a size between 1 and 512 pixels.');
  const result = cloneSprite(sprite);
  result.width = width; result.height = height;
  result.layers = result.layers.map(layer => {
    const pixels = new Uint32Array(width * height);
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const sx = scale ? Math.floor(x * sprite.width / width) : x;
      const sy = scale ? Math.floor(y * sprite.height / height) : y;
      if (sx < sprite.width && sy < sprite.height) pixels[y * width + x] = layer.pixels[sy * sprite.width + sx];
    }
    return { ...layer, pixels };
  });
  return result;
}

// A compact, lossless representation, including transparent pixels.
export function encodePixels(pixels) {
  const runs = [];
  for (let i = 0; i < pixels.length;) {
    const color = pixels[i]; let count = 1;
    while (i + count < pixels.length && pixels[i + count] === color) count++;
    runs.push(count, color); i += count;
  }
  return runs;
}
export function decodePixels(runs, length) {
  if (!Array.isArray(runs) || runs.length % 2 || runs.length > length * 2) throw new Error('Invalid pixel data.');
  const pixels = new Uint32Array(length); let offset = 0;
  for (let i = 0; i < runs.length; i += 2) {
    const count = runs[i], color = runs[i + 1];
    if (!Number.isInteger(count) || count < 1 || offset + count > length || !Number.isInteger(color) || color < 0 || color > 0xffffffff) throw new Error('Invalid pixel data.');
    pixels.fill(color, offset, offset + count); offset += count;
  }
  if (offset !== length) throw new Error('Incomplete pixel data.');
  return pixels;
}
export const BLOB_MASKS = Array.from({ length: 256 }, (_, n) => n).filter(m =>
  (!(m & 16) || ((m & 1) && (m & 2))) && (!(m & 32) || ((m & 2) && (m & 4))) &&
  (!(m & 64) || ((m & 4) && (m & 8))) && (!(m & 128) || ((m & 8) && (m & 1))));

export function generateTileset(terrainA, terrainB, options = {}) {
  const size = clamp(Math.round(Number(options.size) || 16), 4, 64);
  const iso = !!options.isometric, columns = clamp(Math.round(Number(options.columns) || 8), 1, 16);
  const masks = options.mode === 'blob' ? BLOB_MASKS : Array.from({ length: 16 }, (_, i) => i);
  const tileWidth = iso ? size * 2 : size, tileHeight = size, gap = options.gap ? 1 : 0;
  const rows = Math.ceil(masks.length / columns), width = columns * tileWidth + (columns - 1) * gap, height = rows * tileHeight + (rows - 1) * gap;
  const pixels = new Uint32Array(width * height);
  const a = terrainA ? composite(terrainA) : null, b = terrainB ? composite(terrainB) : null;
  const sample = (data, sprite, x, y, fallback) => data ? data[(y % sprite.height) * sprite.width + x % sprite.width] : fallback;
  const border = clamp(Number(options.border) || 0, 0, 4) / size;
  masks.forEach((mask, tileIndex) => {
    const square = new Uint32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / (size - 1), v = y / (size - 1);
      let field;
      if (options.mode === 'blob') {
        field = 0.5;
        if (!(mask & 1)) field = Math.min(field, v - 0.25);
        if (!(mask & 2)) field = Math.min(field, 0.75 - u);
        if (!(mask & 4)) field = Math.min(field, 0.75 - v);
        if (!(mask & 8)) field = Math.min(field, u - 0.25);
        if ((mask & 3) === 3 && !(mask & 16)) field = Math.min(field, Math.hypot(1 - u, v) - 0.25);
        if ((mask & 6) === 6 && !(mask & 32)) field = Math.min(field, Math.hypot(1 - u, 1 - v) - 0.25);
        if ((mask & 12) === 12 && !(mask & 64)) field = Math.min(field, Math.hypot(u, 1 - v) - 0.25);
        if ((mask & 9) === 9 && !(mask & 128)) field = Math.min(field, Math.hypot(u, v) - 0.25);
      } else {
        field = ((mask & 1 ? 1 : 0) * (1 - u) + (mask & 2 ? 1 : 0) * u) * (1 - v)
          + ((mask & 8 ? 1 : 0) * (1 - u) + (mask & 4 ? 1 : 0) * u) * v - 0.5;
      }
      const mixed = border && Math.abs(field) < border;
      const useA = mixed ? (field / border + 1) / 2 > [0.125, 0.625, 0.875, 0.375][(y % 2) * 2 + x % 2] : field >= 0;
      square[y * size + x] = useA ? sample(a, terrainA, x, y, hexToColor('#8bba68')) : sample(b, terrainB, x, y, hexToColor('#547d93'));
    }
    const ox = tileIndex % columns * (tileWidth + gap), oy = Math.floor(tileIndex / columns) * (tileHeight + gap);
    for (let y = 0; y < tileHeight; y++) for (let x = 0; x < tileWidth; x++) {
      let sx = x, sy = y;
      if (iso) { const a = (x + 0.5 - size) / 2, b = y + 0.5; sx = Math.floor(b + a); sy = Math.floor(b - a); }
      if (sx >= 0 && sy >= 0 && sx < size && sy < size) pixels[(oy + y) * width + ox + x] = square[sy * size + sx];
    }
  });
  return { pixels, width, height, tileWidth, tileHeight, columns, rows, masks, gap, options: { ...options, size, columns } };
}
