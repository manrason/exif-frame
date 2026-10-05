# Exif Frame

Turn a photo into a social-media-ready image framed with its camera data: camera, lens, focal length, aperture, shutter speed, ISO, date and (optionally) location, read straight from the file's EXIF.

Everything runs in the browser. Photos are never uploaded.

## Features

- **Templates:**
  - Frame: white or black border with a data bar
  - Gallery: centered museum caption
  - Overlay: text over the bottom of the photo
  - Film: dark border with an orange date stamp
  - Polaroid: instant-print border with handwritten notes
  - Viewfinder: camera screen look with focus point, exposure scale and readouts
  - Spec sheet: the photo above a two-column table of every setting
  - Blur: the photo floating on a blurred copy of itself (good for stories)
  - Strap: edge-to-edge photo with a slim one-line band underneath
  - Lightroom: the photo beside an info panel with a live RGB histogram
  - One line: thin border and a single centered line
  - Collage: up to 9 loaded photos in a grid, each with its own settings
- **Formats:** original shape, 1:1, 4:5, 3:4, 9:16 (stories), 16:9, at 1080 or 2160 px wide, saved as JPEG or PNG.
- **Batch mode:** pick or drop several photos, click one to edit its details, then **Save all** to get every framed photo in one zip.
- **Custom text lines:** replace a template's text with your own lines using placeholders such as `{camera} | {focal} {aperture} {shutter} {iso}`. Choose the separator and the date format.
- **Camera data kept:** saved JPEGs carry the original EXIF (orientation reset, old thumbnail dropped). GPS is removed unless Location is ticked.
- **Editable details:** every value can be edited or hidden. Location is off by default.
- **Copy caption:** puts the shot details on the clipboard as text for the post.
- Reads EXIF from JPEG, HEIC, PNG, WebP and TIFF with a small built-in parser (no dependencies).

## Run it locally

The page uses ES modules, so it needs to be served over HTTP (opening `index.html` from disk won't load the scripts):

```sh
npm start          # serves on http://localhost:8000
```

Any static server works (`npx serve`, VS Code Live Server, etc.).

## Tests

```sh
npm test
```

Tests use Node's built-in test runner (Node 20+) against small JPEG fixtures in `tests/fixtures/`.

## Project layout

| Path | What it holds |
| --- | --- |
| `index.html` | Page markup |
| `src/styles.css` | App styles (light and dark themes) |
| `src/exif.js` | EXIF reader/writer, value formatters (camera names, shutter speed, dates, GPS) and line templates |
| `src/zip.js` | Minimal ZIP writer for batch downloads |
| `src/app.js` | UI, template rendering on canvas, export |
| `tests/` | Unit tests and fixture photos |

### Adding a template

1. Add its margins in `LAYOUT` in `src/app.js`.
2. Add its drawing branch in `render()`.
3. Add a tile with `value="<name>"` in the Template group of `index.html`.

## Hosting

`.github/workflows/pages.yml` publishes the site to GitHub Pages on every push to `main`. Turn it on once in the repository's **Settings → Pages → Source: GitHub Actions**.
