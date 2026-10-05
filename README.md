# Exif Frame

Turn a photo into a social-media-ready image framed with its camera data: camera, lens, focal length, aperture, shutter speed, ISO, date and (optionally) location, read straight from the file's EXIF.

Everything runs in the browser. Photos are never uploaded.

## Features

- **Templates:** Frame (white or black border with a data bar), Gallery (centered museum caption), Overlay (text over the photo), Film (dark border with an orange date stamp).
- **Formats:** original shape, 1:1, 4:5, 3:4, 9:16 (stories), 16:9, at 1080 or 2160 px wide, saved as JPEG or PNG.
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
| `src/exif.js` | EXIF reader and value formatters (camera names, shutter speed, dates, GPS) |
| `src/app.js` | UI, template rendering on canvas, export |
| `tests/` | Unit tests and fixture photos |

### Adding a template

1. Add its margins in `LAYOUT` in `src/app.js`.
2. Add its drawing branch in `render()`.
3. Add a tile with `value="<name>"` in the Template group of `index.html`.

## Hosting

`.github/workflows/pages.yml` publishes the site to GitHub Pages on every push to `main`. Turn it on once in the repository's **Settings → Pages → Source: GitHub Actions**.
