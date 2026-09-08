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
- Tilesetgenerator (Generates Combined Tilesets)
    - Tilesets with texture blending
    - Add Borders to the texture blend
- Tilemapeditor
    - Auto tileset paint
    - Place single textures

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
