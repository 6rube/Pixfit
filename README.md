# Pixfit

A little space for pixel-perfect worlds. Pixfit is a browser-based sprite, terrain tileset, and tilemap editor, built with plain JavaScript and Canvas. It runs as a static site on GitHub Pages, with no application server, account, build step, or runtime dependencies. All artwork in the starter workspace is editable pixel art.

## Run locally

Install Node.js 22 or newer, then:

```sh
npm start
```

Open **http://127.0.0.1:5173**. No `npm install` is needed to run the app. Use an HTTP server rather than opening `index.html` directly, because the app uses JavaScript modules.

## Publish on GitHub Pages

1. Push this repository to GitHub on `main` or `master`.
2. In **Settings → Pages → Build and deployment**, select **GitHub Actions** as the source.
3. Run the **Deploy to GitHub Pages** workflow, or push another commit. It checks the source, runs the tests, and publishes only the static application files.
4. Open `https://<username>.github.io/Pixfit/` (use your actual repository name).

All application URLs are relative, so repository subpaths and custom domains work. You can also serve `index.html`, `favicon.svg`, and `src/` with any static web host. The app makes no external font, analytics, or API requests.

## Library and document tabs

**Library** is a full workspace page alongside Pixel editor, Tileset builder, and Tilemap editor. Search and filter sprites, tilesets, and tilemaps, or create, import, duplicate, and open assets. Each document opens in its own tab. The **+** button opens a new sprite, tileset, or map.

Closing a tab does not delete its asset. Open tabs and the active document are restored after reloading, and included in workspace backups. Views and selections are retained when switching between open tabs during a session; each document has its own undo history.

Full workspace export/import is under **Settings**, accessed with the sliders button at the top right. The main **Export** button exports only the current document.

## Pixel editor

- Pencil and eraser with brush sizes from 1 to 32 pixels.
- Connected bucket fill and a canvas color picker. Hold **Ctrl (Strg) + click** to temporarily pick a color without painting. Alt + click also works.
- Independent horizontal and vertical mirroring, plus checker-pattern dithering.
- Rectangle, ellipse, and exact-color selection. Painting, erasing, filling, and deleting respect the selection.
- Layers with names, visibility, opacity, reordering, duplication, deletion, and previews. Up to 32 layers per sprite.
- **Add layer** sits below the layer list. Rename, duplicate, reorder, and delete controls sit above it.
- **Ctrl/Cmd+C**, **Ctrl/Cmd+X**, and **Ctrl/Cmd+V** copy, cut, and paste the active layer through the current selection, including ellipse or exact-color selections. The clipboard works across sprite tabs. Enable **Paste into a new layer** to create a layer on paste, or uncheck it to paste into the current layer. The checkbox persists. Pasting into an existing selection respects its boundary; pasted pixels are selected and can be moved immediately. The clipboard is internal to Pixfit and lasts for the session.
- Move the active layer or selection; **Space + drag** or the hand tool pans the workspace without bounds. Artwork remains within its defined dimensions; moving outside them clips pixels and is undoable.
- Canvas resize with top-left anchoring, or nearest-neighbor artwork scaling, up to **512 × 512**.
- Three built-in palettes, custom palette colors, editable hex colors, and swappable foreground/background colors. Right-click paints with the background color.
- PNG, JPEG, WebP, BMP, and first-frame GIF import as a new sprite or layer. Oversized images can be scaled down during import.
- Transparent PNG export at 1×, 2×, 4×, or 8×.
- Undo/redo with a memory-bounded history. Selections, undo history, zoom, and viewport position last for the editing session.

Keyboard shortcuts are available under **Shortcuts & help**. On small screens, the layers button in the canvas toolbar opens the preview and layer inspector.

## Tileset builder

1. Select saved sprites as the inner and outer terrain textures, or import a texture. Choose **Transparent** for cutout terrain. Textures are sampled at their native pixel size and repeated as needed; resize your texture in the pixel editor to change its scale.
2. Choose 8, 16, 32, or 64 pixel square source tiles and a layout of 4, 8, or 16 columns.
3. Generate **16 corner terrain tiles** or **47 blob autotiles** with normalized neighbor masks.
4. Choose a hard edge, dithered blend, or a **third sprite as the transition texture**. Border width is in pixels. **Cutoff/inset** moves the transition: positive values shrink the inner terrain, negative values expand it.
5. Optionally generate **1×1 and 1×2 slopes**, four directions per size. A 1×2 slope is one tile wide and two tall; rotate it to make a wide slope. The atlas packs complete multi-cell rectangles.
6. Adjust optional 1 pixel spacing and **2:1 isometric projection**.
7. Click a tile to override its border type, texture, width, cutoff, quarter-turn rotation, or X/Y flips in the inspector. **Reset** restores the shared settings. Transforms update the connection mask as well as the pixels. Imported atlases support direct rotation/flips; use terrain generation to create texture borders.
8. Use the tile in a map, or export PNG, atlas JSON, or a Godot 4 package. Tileset documents autosave in the library.

For a transition texture, draw a horizontal border strip: its width repeats along the boundary and its full height scales to the border width using nearest-neighbor sampling. The top of the strip faces the outer terrain and the bottom faces the inner terrain. Transparent pixels reveal the terrain underneath.

Changes to the configuration update the preview automatically. **Generate tileset** recomposites from the current source artwork. **Open in tileset builder** creates a tileset document using the active sprite as its inner terrain source. You can keep several independent tileset documents open.

### Animated tiles

Select the tile that should animate. In the inspector, enter a comma-separated sequence of tile numbers (for example `2, 3, 4, 3`), set FPS, and press **Apply**. Up to 32 frames and 1–60 FPS are supported. Frames must have matching dimensions. The inspector and tiles placed in maps preview the sequence. **Pause** stops playback; **Clear** removes the selected animation.

Animation sequences are saved with the tileset, included in workspace backups and atlas JSON, and exported as real animated Godot atlas sources. The PNG atlas itself is a still image. Changing tile dimensions can invalidate and remove incompatible animation sequences; undo restores them.

Atlas JSON includes tile rectangles, spacing, projection, and connection masks. Corner terrain uses bits `1 = top left`, `2 = top right`, `4 = bottom right`, `8 = bottom left`. Blob masks use `1 = N`, `2 = E`, `4 = S`, `8 = W`, `16 = NE`, `32 = SE`, `64 = SW`, `128 = NW`. A diagonal bit is valid only when both adjoining cardinal neighbors are present. A set bit represents the inner terrain. Use these masks to choose matching tiles in your engine; there is no engine-specific atlas ordering assumption.

**Import existing tileset** imports a PNG or other supported image as an atlas. Specify tile dimensions and spacing; the image must contain complete tiles with no outer padding. Imported atlases retain their pixels and tile positions, with `null` connection masks because those cannot be inferred from an image. Limits: 4096 tiles, 512 pixels per tile dimension, 4096 pixels per image dimension, and 16 million image pixels.

### Godot 4 export

Choose **Godot 4 · TileSet + textures (.zip)** in Export, or **Export to Godot 4** in the tile inspector. Extract the contained `pixfit-…` folder into the root of your Godot project, retaining its name. Godot will import the textures; assign `tileset.tres` to a TileMap or TileMapLayer and use Nearest texture filtering.

The ZIP contains the atlas PNG, a ready-to-load `.tres` TileSet, animation texture sheets, atlas metadata, a tile-ID mapping, and instructions. Rotations and flips are baked into the image. Multi-cell slope rectangles and animation speeds are preserved. Generated orthogonal tiles include terrain peering rules; isometric resources include the diamond layout, with terrain rules left for configuration in Godot. Collision and navigation polygons can be added in Godot.

The resource format follows Godot's [TileSetAtlasSource API](https://docs.godotengine.org/en/stable/classes/class_tilesetatlassource.html). The exported package was loaded and checked in **Godot 4.4.1**, including terrain rules, 1×2 rectangles, and animation frame count/speed.

## Tilemap editor

Create a map from Library, the **+** document menu, or **Use in map** in a tileset. Choose a generated terrain set and dimensions in cells. The palette offers its two source textures and one autotile brush. Paint by clicking or dragging, erase with the eraser or right-click, fill connected areas, draw filled rectangles, and pick a terrain brush with the picker or Ctrl + click. Space + drag pans; scroll zooms.

Texture brushes repeat the source artwork at its native pixel size. Blob autotiles choose edges and corners from neighboring terrain; corner autotiles paint junctions shared by four tiles. Painting and erasing update those connections automatically. Texture snapshots and terrain brush choices are saved with the map. Maps have independent layers, visibility/opacity/order, resizing, and undo/redo. Existing manually placed tiles, slopes, and animations remain supported, but are no longer listed as individual palette choices. Imported atlases have no terrain rules; select a generated set to use terrain brushes.

Map limits are 256 cells per side, 16 layers, and a rendered image no larger than 4096 pixels per side or 16 million pixels. Changing the source tileset keeps tile numbers; numbers absent from the new source become empty. Regeneration is blocked if removing tiles would invalidate a map that uses them. A tileset referenced by a map must be reassigned or its maps removed before it can be deleted.

Export a still PNG or a ZIP containing the map's layer/cell JSON, its atlas PNG and metadata, and a rendered PNG. Version 2 map packages also include texture snapshots and per-layer terrain brush data (0: legacy tile, 1/2: source texture, 3: autoterrain, 4: empty, 5: generated corner fringe). Texture cells with no atlas tile render from the corresponding texture snapshot. Map packages are intended for game tooling; use a full workspace backup to restore editable maps in Pixfit.

## Storage and backups

Sprites, layers, tilesets, tilemaps, animations, open tabs, palettes, and editor preferences autosave in **IndexedDB** after edits, with **Local Storage** as a fallback. The save indicator reports completion; storage failures display an error and suggest a backup. Changing a source sprite does not alter a tileset until you regenerate it. Editing a tileset updates maps using that tileset.

**Settings → Export workspace** exports all saved assets and settings as a versioned, lossless JSON file. **Settings → Import workspace** validates the file before offering:

- **Merge**: adds copies of the imported assets and combines custom colors, preserving your current settings.
- **Replace**: restores the backup’s complete collection and settings.

Drag an image or a Pixfit backup onto the app to import it. A workspace supports 100 assets of each type, with up to 32 million pixels/cells across all layers and atlases. Backup import is limited to 512 MB and the same pixel budget. Version 1 backups migrate automatically to the version 2 workspace model. Merging remaps sprite, tileset, map, and layer IDs to keep references intact.

Browser storage is specific to the browser profile and site origin. Clearing site data removes it. Localhost and your published GitHub Pages site have separate storage; use a JSON backup to move between them. Use one editing tab per origin to avoid competing autosaves.

## Checks

```sh
npm test
npm run check
```

The Node tests cover compositing, mirrored brushes, selection boundaries, clipboard masks, fill connectivity, movement, 512 pixel resizing, compressed pixel data, terrain borders, cutoff, slope packing, transformations, animation timing, tilemap rendering, Godot packages, and both backup schema versions.

An optional real-browser check uses an installed Chrome:

```sh
npm install --no-save --package-lock=false playwright
# Start npm start in a separate terminal, then:
node tests/browser.mjs
```

The browser check exercises editing, clipboard destinations, Ctrl picking, tabs, the full-page library, map painting/fill/layers, tile overrides, slopes, animation configuration, reload persistence, full backup restore, Godot downloads, PNG import/export, 512 pixel canvases, and narrow layouts. Screenshots and test exports are written to the ignored `.screenshots/` directory.

## Source

| File | Responsibility |
| --- | --- |
| `src/app.js` | Interface, pointer tools, history, file workflows, canvas rendering |
| `src/core.js` | Pixel operations, compositing, selections, and terrain generation |
| `src/tiles.js` | Texture borders, cutoff, slope packing, transforms, animations, selection clipboard |
| `src/tilemap.js` | Map layers, painting, fill, resize, and rendering |
| `src/godot.js` | Godot 4 resource generation, animation sheets, and ZIP packaging |
| `src/storage.js` | IndexedDB/Local Storage, lossless serialization, validated restore |
| `src/demo.js` | Original editable starter artwork and built-in palettes |
| `src/styles.css` | Responsive editor, library, and dialogs |
| `src/workspace.css` | Document tabs, full-page library, tile inspector, map tools |

MIT licensed. See [LICENSE](LICENSE).
