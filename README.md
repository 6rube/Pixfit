<img src="https://raw.githubusercontent.com/6rube/Pixfit/refs/heads/main/favicon.svg" width="100">

# Pixfit

A Pixelart toolset.
The tools are all run locally.
You can use the app by just visiting: [6rube.github.io/Pixfit/](6rube.github.io/Pixfit/)

![til](https://raw.githubusercontent.com/6rube/Pixfit/refs/heads/main/media/pixeleditor.gif)

The main tools are:
- Pixeleditor
    - X, Y Mirroring
    - Color Pallets
        - Import / Export
    - Repeating pattern preview
    - Layers
    - Copy Pasting
    - Square and Round Select
    - Simple Dithering
- Auto terrain generator
    - Generate corner or blob transitions between terrain textures
    - Add borders, slopes, tile overrides, and animations
- Tileset collections
    - Combine multiple auto terrains into one Godot 4 TileSet resource
- Tilemapeditor
    - Mix multiple auto terrains and texture tiles on layers
    - Select texture tiles using the map grid; save rectangular patterns
    - Stamp patterns or repeat them with Fill and Rectangle
    - Export the complete map as one PNG image

## Terrains, tilesets, and patterns

Create **auto terrains** from your terrain textures first. In the Library, **New tileset** collects any compatible auto terrains into a reusable collection. Its **Godot 4** export contains one `tileset.tres`, all selected atlases, animation textures, and tile mappings. Terrains need matching tile dimensions and projection. Material textures share terrain identities within each matching mode; generate transitions for every material pair you want to connect. Corner and blob modes use separate terrain sets, following [Godot's terrain set model](https://docs.godotengine.org/en/stable/tutorials/2d/using_tilesets.html#creating-terrain-sets-autotiling).

In a tilemap, choose a tileset collection or use all library terrains. Choose **Texture tiles & patterns**, then a texture sheet. The map's cell dimensions define the sheet grid. Click one tile, or **Shift-click** a second tile to select a rectangle. **Save selected pattern** keeps that selection in the map. Paint stamps the block; Fill and Rectangle repeat it from the starting cell. Edge tiles retain their original pixels and use transparent padding. New maps support custom grid dimensions.

PNG export flattens all visible map layers into one image. The map ZIP also includes source images, selected tile IDs, and saved patterns. Workspace backups preserve collections and patterns; earlier maps retain their previous texture rendering and placements. Isometric terrain peering still requires setup in Godot.

### Border textures with transparency

For a 32×32 border sprite with transparent padding, choose **Transition texture**, select the sprite, then apply **Transparent strip · original pixels**. This keeps its original thickness and spacing instead of compressing all 32 rows into the border width. The source's top rows face the outer terrain; use **Reverse inner / outer side** to swap that direction.

Under **Placement, repeat & padding**, position the strip inside, outside, or centered on the edge; adjust its offset, pixel scale, repeat length, phase, and rotation. Leave **Trim fully transparent rows** off for intentional half-transparent padding. Enable it with **Fit image to border width** when only the visible artwork should fill a narrow band. Transparency reveals the underlying terrain. The same controls are available in the tile inspector for individual overrides, and settings survive workspace backups. Existing terrains keep their previous fitted-border behavior.

### Texture categories

Click the category button on a texture's Library card, or **Texture category** in its pixel editor, to assign an existing category or create one by name. A blank name means **Uncategorized**. Categories survive duplication, workspace backups, and merges.

Use **Texture category** in the auto terrain editor to filter inner, outer, and border texture choices. Current texture assignments remain selected when switching categories. In the tilemap editor, the same filter shows matching texture sheets, saved patterns, and terrains using those textures. **All categories** restores the complete list; changing the filter does not change painted cells.

The selected category is shared by the Library, pixel editor, auto terrain editor, and tilemap editor, and is remembered after reload. In the Library it filters sprites; auto terrains and tilemaps remain available.

### Library and document tabs

The Library groups assets by type and name. **Sort by** also offers **Name A–Z** and **Recently edited**, and remembers your choice. Use **Rename** on a card to update its name in the Library and any open tab.

Open tabs stay visible in the Library, and their assets show an **Open** badge. Drag tabs to reorder them, or focus a tab and press **Alt + Left/Right Arrow**. Tab order survives reload. **Close all** at the left of the tabs returns to the Library and keeps every saved asset.

Tilemap painting batches redraws per browser frame, skips repeated moves within one cell, and resolves terrain only around edited cells. Partial image updates include overlapping slopes, decals, and layers. Grid and brush previews are reused, and only animations placed on visible layers trigger redraws. PNG exports still render the complete image.

## Run locally

Install Node.js 22 or newer, then:

```sh
npm start
```

Open **http://127.0.0.1:5173**. No `npm install` is needed to run the app. Use an HTTP server rather than opening `index.html` directly, because the app uses JavaScript modules.

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
node tests/patterns-browser.mjs
node tests/border-textures-browser.mjs
node tests/categories-performance-browser.mjs
node tests/library-tabs-browser.mjs
```

The browser check exercises editing, clipboard destinations, Ctrl picking, tabs, the full-page library, map painting/fill/layers, tile overrides, slopes, animation configuration, reload persistence, full backup restore, Godot downloads, PNG import/export, 512 pixel canvases, and narrow layouts. Screenshots and test exports are written to the ignored `.screenshots/` directory.

The patterns browser check covers collections, combined Godot downloads, mixed terrain painting, texture grid selection, saved patterns, rectangle repetition, undo/redo, persistence, and PNG export. `tests/godot-collection-validation.gd` validates an exported collection in Godot after its textures have been imported.

## Source

| File | Responsibility |
| --- | --- |
| `src/app.js` | Interface, pointer tools, history, file workflows, canvas rendering |
| `src/core.js` | Pixel operations, compositing, selections, and terrain generation |
| `src/tiles.js` | Texture borders, cutoff, slope packing, transforms, animations, selection clipboard |
| `src/tilemap.js` | Map layers, painting, fill, resize, and rendering |
| `src/godot.js` | Godot 4 resource generation, animation sheets, and ZIP packaging |
| `src/storage.js` | IndexedDB/Local Storage, lossless serialization, validated restore |
| `src/categories.js` | Texture category names and filtering |
| `src/demo.js` | Original editable starter artwork and built-in palettes |
| `src/styles.css` | Responsive editor, library, and dialogs |
| `src/workspace.css` | Document tabs, full-page library, tile inspector, map tools |

MIT licensed. See [LICENSE](LICENSE).
