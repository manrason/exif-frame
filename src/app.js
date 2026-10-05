import { parseExif, cameraName, fmtShutter, fmtAperture, fmtFocal, parseDate, fmtDate, fmtStamp, fmtGps, jpegExifTiff, exifForExport, insertExif, expandLine } from './exif.js';
import { makeZip } from './zip.js';


const $ = s => document.querySelector(s);
const out = $('#out');

// ---------- state ----------
const FIELD_DEFS = [
  ['camera', 'Camera'], ['lens', 'Lens'], ['focal', 'Focal length'], ['aperture', 'Aperture'],
  ['shutter', 'Shutter'], ['iso', 'ISO'], ['date', 'Date'], ['location', 'Location'], ['author', 'Signature'],
];
const RATIOS = [
  ['orig', 'Original', ''], ['1:1', '1:1', 'Square'], ['4:5', '4:5', 'Portrait'], ['3:4', '3:4', 'Tall'],
  ['9:16', '9:16', 'Story'], ['16:9', '16:9', 'Wide'],
];
const S = {
  template: 'frame', ratio: '4:5', tone: 'light', font: 'sans', size: 1080, format: 'jpg',
  fields: {}, show: { camera: true, lens: true, focal: true, aperture: true, shutter: true, iso: true, date: true, location: false, author: true },
  img: null, iw: 0, ih: 0, isSample: true, dateObj: null, dateEdited: false, baseName: 'photo',
  sep: 'auto', dateFmt: 'dots', keepExif: true,
  custom: { on: false, l1: '{camera}', l2: '{focal}  {aperture}  {shutter}  {iso}', l3: '{lens} · {date}' },
  photos: [], cur: -1, // loaded photos; the active one is mirrored into img/iw/ih/fields/... above
};
const MAX_COLLAGE = 9;
const SAMPLE_FIELDS = { camera: 'Fujifilm X-T5', lens: 'XF23mmF2 R WR', focal: '23mm', aperture: 'f/8', shutter: '1/250s', iso: 'ISO 160', date: '2026.09.14  19:42', location: '', author: '' };

const store = {
  get() { try { return JSON.parse(localStorage.getItem('exif-frame-prefs') || 'null'); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem('exif-frame-prefs', JSON.stringify(v)); } catch (e) {} },
};
const saved = store.get();
if (saved) {
  for (const k of ['template', 'ratio', 'tone', 'font', 'format', 'sep', 'dateFmt']) if (typeof saved[k] === 'string') S[k] = saved[k];
  if (typeof saved.keepExif === 'boolean') S.keepExif = saved.keepExif;
  if (saved.custom) for (const k of ['l1', 'l2', 'l3']) if (typeof saved.custom[k] === 'string') S.custom[k] = saved.custom[k];
  if (saved.custom && typeof saved.custom.on === 'boolean') S.custom.on = saved.custom.on;
  if (!document.querySelector(`input[name="template"][value="${CSS.escape(S.template)}"]`)) S.template = 'frame';
  if (saved.size === 1080 || saved.size === 2160) S.size = saved.size;
  if (saved.show) for (const k in S.show) if (k !== 'location' && typeof saved.show[k] === 'boolean') S.show[k] = saved.show[k];
}
const savePrefs = () => store.set({
  template: S.template, ratio: S.ratio, tone: S.tone, font: S.font, size: S.size, format: S.format, show: S.show,
  author: S.fields.author || '', sep: S.sep, dateFmt: S.dateFmt, keepExif: S.keepExif, custom: S.custom,
});

// ---------- sample photo ----------
function makeSample() {
  const c = document.createElement('canvas');
  c.width = 1800; c.height = 1200;
  const g = c.getContext('2d');
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const sky = g.createLinearGradient(0, 0, 0, 760);
  sky.addColorStop(0, '#22324F'); sky.addColorStop(.45, '#7B5C7E'); sky.addColorStop(.8, '#E58C62'); sky.addColorStop(1, '#F6C68B');
  g.fillStyle = sky; g.fillRect(0, 0, 1800, 1200);
  const sun = g.createRadialGradient(1180, 640, 10, 1180, 640, 260);
  sun.addColorStop(0, 'rgba(255,236,190,1)'); sun.addColorStop(.18, 'rgba(255,214,150,.85)'); sun.addColorStop(1, 'rgba(255,190,120,0)');
  g.fillStyle = sun; g.fillRect(0, 0, 1800, 1200);
  const layers = [['#8E6A86', 560, 140], ['#5E4A6E', 650, 120], ['#3B3354', 740, 100], ['#221F36', 860, 90], ['#14131F', 990, 60]];
  for (const [col, base, amp] of layers) {
    g.fillStyle = col; g.beginPath(); g.moveTo(0, 1200);
    let y = base - rnd() * amp, v = 0;
    for (let x = 0; x <= 1800; x += 12) { v += (rnd() - .5) * 18; v *= .9; y = Math.min(base + amp * .4, Math.max(base - amp, y + v)); g.lineTo(x, y); }
    g.lineTo(1800, 1200); g.closePath(); g.fill();
    g.fillStyle = 'rgba(246,198,139,.08)'; g.fillRect(0, 0, 1800, 1200);
  }
  return c;
}

// ---------- rendering ----------
const FONTS = {
  sans: { title: p => `700 ${p}px Archivo, sans-serif`, body: p => `400 ${p}px Archivo, sans-serif`, data: p => `600 ${p}px Archivo, sans-serif` },
  serif: { title: p => `italic 400 ${p * 1.3}px "Instrument Serif", serif`, body: p => `400 ${p * 1.15}px "Instrument Serif", serif`, data: p => `400 ${p * 1.2}px "Instrument Serif", serif` },
  mono: { title: p => `600 ${p * .88}px "IBM Plex Mono", monospace`, body: p => `400 ${p * .9}px "IBM Plex Mono", monospace`, data: p => `500 ${p * .9}px "IBM Plex Mono", monospace` },
};
const TONES = {
  light: { bg: '#FFFFFF', fg: '#141414', muted: '#8B8B8B', rule: '#D6D6D6' },
  dark: { bg: '#0D0D0D', fg: '#F1F1F1', muted: '#8E8E8E', rule: '#3A3A3A' },
};
const v = k => (S.show[k] && (S.fields[k] || '').trim()) || '';
const settingsLine = sep => ['focal', 'aperture', 'shutter', 'iso'].map(v).filter(Boolean).join(S.sep === 'auto' ? sep : `  ${S.sep}  `);
// Text for a template: its own defaults, or the viewer's custom lines (t1 main, t2 settings, t3 small).
function pick(def) {
  if (!S.custom.on) return def;
  return { t1: expandLine(S.custom.l1, S.fields), t2: expandLine(S.custom.l2, S.fields), t3: expandLine(S.custom.l3, S.fields), t4: '' };
}
const joinNon = (sep, ...a) => a.filter(Boolean).join(sep);

function measure(ctx, s, font) { if (!s) return 0; ctx.font = font; return ctx.measureText(s).width; }
function text(ctx, s, x, y, font, color, align = 'left') {
  if (!s) return; ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y);
}
function setSpacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; }

function canvasSize(info, side, top) {
  const W = S.size, s = W / 1080;
  const k = S.ratio === 'orig' ? null : S.ratio.split(':').map(Number);
  if (k) return { W, H: Math.round(W * k[1] / k[0]) };
  if (S.template === 'overlay' || S.template === 'viewfinder') return { W, H: Math.round(W * S.ih / S.iw) };
  if (S.template === 'lightroom') return { W, H: Math.round(Math.max((W * .68 - 80 * s) * S.ih / S.iw + 80 * s, 640 * s)) };
  if (S.template === 'collage') {
    const g = collageGrid(), cw = (W - 2 * side - (g.cols - 1) * g.gap * s) / g.cols;
    return { W, H: Math.round(2 * top + g.rows * (cw + info) + (g.rows - 1) * g.gap * s) };
  }
  const pw = W - 2 * side;
  return { W, H: Math.round(top + pw * S.ih / S.iw + info) };
}
function placeWithInfo(W, H, side, top, info) {
  const aw = W - 2 * side, ah = H - top - info;
  const k = Math.min(aw / S.iw, ah / S.ih);
  const pw = S.iw * k, ph = S.ih * k;
  const extra = H - (top + ph + info);
  return { px: (W - pw) / 2, py: top + Math.max(0, extra / 2), pw, ph };
}
function drawImg(ctx, x, y, w, h) {
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(S.img, x, y, w, h);
}

const LAYOUT = {
  frame: s => ({ side: 44 * s, top: 44 * s, info: 168 * s }),
  gallery: s => ({ side: 120 * s, top: 120 * s, info: 280 * s }),
  film: s => ({ side: 46 * s, top: 46 * s, info: 150 * s }),
  overlay: () => ({ side: 0, top: 0, info: 0 }),
  viewfinder: () => ({ side: 0, top: 0, info: 0 }),
  polaroid: s => ({ side: 56 * s, top: 56 * s, info: 250 * s }),
  backdrop: s => ({ side: 96 * s, top: 96 * s, info: 250 * s }),
  strap: s => ({ side: 0, top: 0, info: 104 * s }),
  oneline: s => ({ side: 36 * s, top: 36 * s, info: 100 * s }),
  lightroom: () => ({ side: 0, top: 0, info: 0 }),
  collage: s => ({ side: 48 * s, top: 48 * s, info: 78 * s }),
  spec: s => {
    const n = specRows().length, perCol = Math.ceil(n / (n > 4 ? 2 : 1));
    return { side: 64 * s, top: 64 * s, info: (n ? 70 + perCol * 54 + 40 : 64) * s };
  },
};

// Photos shown by the Collage template: every loaded photo (up to MAX_COLLAGE). With fewer
// than two, the photo (or the example) is padded with empty slots so the grid is visible.
function collageItems() {
  const items = S.photos.length ? S.photos.slice(0, MAX_COLLAGE) : [{ img: S.img, iw: S.iw, ih: S.ih, fields: S.fields }];
  if (S.photos.length < 2) while (items.length < 4) items.push({ empty: true });
  return items;
}
function collageReady() { return S.photos.length >= 2; }
// Grid for the collage. With a fixed format, pick the column count whose cells come out
// closest to square, so three photos in a 4:5 post don't become thin strips.
function collageGrid(aspect) {
  const n = collageItems().length;
  let cols = n <= 3 ? n : n === 4 ? 2 : 3;
  if (aspect) {
    let best = Infinity;
    for (let c = 1; c <= n; c++) {
      const r = Math.ceil(n / c), cell = (aspect * r) / c; // cell width / height, roughly
      const score = Math.abs(Math.log(cell)) + (r * c - n) * .15;
      if (score < best) { best = score; cols = c; }
    }
  }
  return { n, cols, rows: Math.ceil(n / cols), gap: 24 };
}
function drawCover(ctx, img, iw, ih, x, y, w, h) {
  const k = Math.max(w / iw, h / ih);
  ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, x + (w - iw * k) / 2, y + (h - ih * k) / 2, iw * k, ih * k);
  ctx.restore();
}
// RGB histogram of the photo (64 bins per channel), like Lightroom's.
const histCache = new WeakMap();
function histogram(img, iw, ih) {
  if (histCache.has(img)) return histCache.get(img);
  let res = null;
  try {
    const c = document.createElement('canvas');
    c.width = 200; c.height = Math.max(1, Math.round(200 * ih / iw));
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const ch = [new Float32Array(64), new Float32Array(64), new Float32Array(64)];
    for (let i = 0; i < d.length; i += 4) { ch[0][d[i] >> 2]++; ch[1][d[i + 1] >> 2]++; ch[2][d[i + 2] >> 2]++; }
    const all = [...ch[0], ...ch[1], ...ch[2]].sort((a, b) => a - b);
    res = { ch, max: Math.max(1, all[Math.floor(all.length * .97)]) };
  } catch (e) { res = null; }
  histCache.set(img, res);
  return res;
}
function drawHistogram(ctx, hist, x, y, w, h) {
  ctx.fillStyle = '#161616'; ctx.fillRect(x, y, w, h);
  if (!hist) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ['rgba(220,60,60,.75)', 'rgba(60,190,70,.75)', 'rgba(70,110,235,.85)'].forEach((col, c) => {
    ctx.beginPath(); ctx.moveTo(x, y + h);
    hist.ch[c].forEach((val, i) => ctx.lineTo(x + (i + .5) * w / 64, y + h - Math.min(1, val / hist.max) * h * .92));
    ctx.lineTo(x + w, y + h); ctx.closePath(); ctx.fillStyle = col; ctx.fill();
  });
  ctx.restore();
}

// Rows for the Spec sheet template: [label, value]
function specRows() {
  return [['Camera', 'camera'], ['Lens', 'lens'], ['Focal length', 'focal'], ['Aperture', 'aperture'], ['Shutter', 'shutter'],
    ['ISO', 'iso'], ['Date', 'date'], ['Location', 'location'], ['By', 'author']]
    .map(([label, k]) => [label, k === 'iso' ? v(k).replace(/^ISO\s*/i, '') : v(k)])
    .filter(r => r[1]);
}
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(x, y, w, h, r); else ctx.rect(x, y, w, h);
}
// Soft blurred copy of the photo covering the canvas. Downscale-then-upscale works in every browser.
function drawBlurredCover(ctx, W, H) {
  const k = Math.max(W / S.iw, H / S.ih);
  const small = document.createElement('canvas');
  small.width = 40; small.height = Math.max(1, Math.round(40 * H / W));
  const sc = small.getContext('2d');
  sc.imageSmoothingQuality = 'high';
  const sk = small.width / W;
  sc.drawImage(S.img, (W - S.iw * k) / 2 * sk, (H - S.ih * k) / 2 * sk, S.iw * k * sk, S.ih * k * sk);
  const mid = document.createElement('canvas');
  mid.width = Math.round(W / 6); mid.height = Math.round(H / 6);
  const mc = mid.getContext('2d');
  mc.imageSmoothingQuality = 'high';
  if ('filter' in mc) mc.filter = `blur(${Math.round(mid.width / 60)}px)`;
  mc.drawImage(small, -4, -4, mid.width + 8, mid.height + 8);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(mid, 0, 0, W, H);
}

function render() {
  if (!S.img) return;
  const s = S.size / 1080;
  const L = LAYOUT[S.template](s);
  const { W, H } = canvasSize(L.info, L.side, L.top);
  out.width = W; out.height = H;
  const ctx = out.getContext('2d');
  ctx.textBaseline = 'alphabetic';
  const F = FONTS[S.font];
  setSpacing(ctx, 0);

  if (S.template === 'overlay') {
    const k = Math.max(W / S.iw, H / S.ih);
    const w = S.iw * k, h = S.ih * k;
    drawImg(ctx, (W - w) / 2, (H - h) / 2, w, h);
    const gh = Math.min(H, 420 * s);
    const gr = ctx.createLinearGradient(0, H - gh, 0, H);
    gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.66)');
    ctx.fillStyle = gr; ctx.fillRect(0, H - gh, W, gh);
    const pad = 68 * s, maxW = W - 2 * pad;
    const { t1, t2, t3, t4: au } = pick({ t1: v('camera'), t2: settingsLine('   '), t3: joinNon('  ·  ', v('lens'), v('date'), v('location')), t4: v('author') });
    let m = 1;
    const widest = () => Math.max(measure(ctx, t1, F.title(50 * s * m)), measure(ctx, t2, F.data(32 * s * m)), measure(ctx, t3, F.body(23 * s * m)) + (au ? measure(ctx, au, F.body(23 * s * m)) + 40 * s : 0));
    const ww = widest(); if (ww > maxW) m *= maxW / ww;
    let y = H - pad;
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 12 * s;
    if (t3 || au) { text(ctx, t3, pad, y, F.body(23 * s * m), 'rgba(255,255,255,.78)'); text(ctx, au, W - pad, y, F.body(23 * s * m), 'rgba(255,255,255,.78)', 'right'); y -= 46 * s * m; }
    if (t2) { text(ctx, t2, pad, y, F.data(32 * s * m), '#FFFFFF'); y -= 58 * s * m; }
    if (t1) text(ctx, t1, pad, y, F.title(50 * s * m), '#FFFFFF');
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    return { W, H };
  }

  if (S.template === 'viewfinder') {
    const k = Math.max(W / S.iw, H / S.ih);
    drawImg(ctx, (W - S.iw * k) / 2, (H - S.ih * k) / 2, S.iw * k, S.ih * k);
    const u = Math.min(W, H) / 1080;
    const hud = p => `600 ${p}px "IBM Plex Mono", monospace`;
    const white = 'rgba(255,255,255,.95)';
    const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * .35, W / 2, H / 2, Math.hypot(W, H) / 2);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.35)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);
    ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 6 * u;
    // corner brackets
    const inset = 44 * u, len = 64 * u, barH = 92 * u, bot = H - barH - 22 * u;
    ctx.strokeStyle = white; ctx.lineWidth = Math.max(2, 3 * u); ctx.lineCap = 'square';
    for (const [x, y, dx, dy] of [[inset, inset, 1, 1], [W - inset, inset, -1, 1], [inset, bot, 1, -1], [W - inset, bot, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + dy * len); ctx.lineTo(x, y); ctx.lineTo(x + dx * len, y); ctx.stroke();
    }
    // focus point
    const fw = 110 * u, fh = 80 * u, t = 18 * u;
    ctx.lineWidth = Math.max(1.5, 2.5 * u); ctx.strokeStyle = '#8BFF7A';
    for (const [x, y, dx, dy] of [[W / 2 - fw / 2, H / 2 - fh / 2, 1, 1], [W / 2 + fw / 2, H / 2 - fh / 2, -1, 1], [W / 2 - fw / 2, H / 2 + fh / 2, 1, -1], [W / 2 + fw / 2, H / 2 + fh / 2, -1, -1]]) {
      ctx.beginPath(); ctx.moveTo(x, y + dy * t); ctx.lineTo(x, y); ctx.lineTo(x + dx * t, y); ctx.stroke();
    }
    // top row: mode, camera, date
    const ty = inset + 58 * u, maxTop = W - 2 * inset - 220 * u;
    text(ctx, 'M', inset + 26 * u, ty, hud(30 * u), white);
    const vt = pick({ t1: joinNon('  ·  ', v('camera'), v('lens')), t2: null, t3: v('date').replace(/\s+\d{2}:\d{2}$/, '') });
    let top = vt.t1;
    let tf = 22 * u; const tw = measure(ctx, top, hud(tf)); if (tw > maxTop) tf *= maxTop / tw;
    text(ctx, top, W / 2, ty - 4 * u, hud(tf), white, 'center');
    const dt = vt.t3;
    text(ctx, dt, W - inset - 26 * u, ty - 4 * u, hud(20 * u), white, 'right');
    // bottom readout bar
    const by = H - barH;
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(0, by, W, barH);
    const items = vt.t2 != null ? vt.t2.split(/\s{2,}|\s*[|·•\/]\s*/).filter(Boolean)
      : ['shutter', 'aperture', 'iso', 'focal'].map(v).filter(Boolean).map(x => x.replace(/s$/, '').replace(/^f\//, 'F'));
    if (items.length) {
      let fs = 34 * u; const total = items.reduce((a, x) => a + measure(ctx, x, hud(fs)), 0), room = W - 2 * inset;
      if (total > room * .8) fs *= room * .8 / total;
      items.forEach((x, i) => text(ctx, x, inset + room * (i + .5) / items.length, by + barH / 2 + fs * .36, hud(fs), white, 'center'));
    }
    // exposure scale above the bar
    const sy = by - 34 * u, step = 26 * u;
    ctx.fillStyle = white; ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 6 * u;
    for (let i = -9; i <= 9; i++) {
      const hgt = i % 3 === 0 ? 16 * u : 8 * u;
      ctx.fillRect(W / 2 + i * step - u, sy - hgt, Math.max(1, 2 * u), hgt);
    }
    ['-3', '0', '+3'].forEach((lab, i) => text(ctx, lab, W / 2 + (i - 1) * 9 * step, sy - 24 * u, hud(15 * u), white, 'center'));
    ctx.beginPath(); ctx.moveTo(W / 2, sy + 4 * u); ctx.lineTo(W / 2 - 7 * u, sy + 15 * u); ctx.lineTo(W / 2 + 7 * u, sy + 15 * u); ctx.closePath(); ctx.fill();
    text(ctx, v('author'), W - inset - 26 * u, sy - 24 * u, hud(18 * u), white, 'right');
    text(ctx, v('location'), inset + 26 * u, sy - 24 * u, hud(18 * u), white);
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    return { W, H };
  }

  if (S.template === 'backdrop') {
    drawBlurredCover(ctx, W, H);
    ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(0, 0, W, H);
    const b = placeWithInfo(W, H, L.side, L.top, L.info);
    const r = 22 * s;
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.45)'; ctx.shadowBlur = 60 * s; ctx.shadowOffsetY = 24 * s;
    roundRectPath(ctx, b.px, b.py, b.pw, b.ph, r); ctx.fillStyle = '#000'; ctx.fill();
    ctx.restore();
    ctx.save(); roundRectPath(ctx, b.px, b.py, b.pw, b.ph, r); ctx.clip(); drawImg(ctx, b.px, b.py, b.pw, b.ph); ctx.restore();
    const cx = W / 2, maxW = W - 2 * L.side;
    const { t1, t2, t3, t4 } = pick({ t1: v('camera'), t2: settingsLine('   '), t3: joinNon('  ·  ', v('lens'), v('date'), v('location')), t4: v('author') });
    let m = 1;
    const ww = Math.max(measure(ctx, t1, F.title(42 * s)), measure(ctx, t2, F.data(28 * s)), measure(ctx, t3, F.body(21 * s)));
    if (ww > maxW) m = maxW / ww;
    ctx.shadowColor = 'rgba(0,0,0,.35)'; ctx.shadowBlur = 10 * s;
    let y = b.py + b.ph + 92 * s;
    if (t1) { text(ctx, t1, cx, y, F.title(42 * s * m), '#FFFFFF', 'center'); y += 50 * s * m; }
    if (t2) { text(ctx, t2, cx, y, F.data(28 * s * m), 'rgba(255,255,255,.92)', 'center'); y += 40 * s * m; }
    if (t3) { text(ctx, t3, cx, y, F.body(21 * s * m), 'rgba(255,255,255,.72)', 'center'); y += 34 * s * m; }
    if (t4) text(ctx, t4, cx, y, F.body(21 * s * m), 'rgba(255,255,255,.72)', 'center');
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
    return { W, H };
  }

  const P = S.template === 'film' ? { bg: '#121110', fg: '#EDE6D6', muted: '#8E8676', rule: '#333' }
    : S.template === 'polaroid' ? (S.tone === 'dark' ? { bg: '#1A1A1A', fg: '#ECECEC', muted: '#9A9A9A' } : { bg: '#F6F4EE', fg: '#1E2A47', muted: '#55607A' })
    : TONES[S.tone];
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
  if (S.template === 'strap') {
    // edge-to-edge photo with a slim band underneath
    drawCover(ctx, S.img, S.iw, S.ih, 0, 0, W, H - L.info);
    ctx.fillStyle = P.rule; ctx.fillRect(0, H - L.info, W, Math.max(1, s));
    const { t1, t2, t3 } = pick({ t1: v('camera'), t2: settingsLine('   '), t3: joinNon('  ·  ', v('lens'), v('date'), v('author')), t4: '' });
    const pad = 48 * s, gap = 22 * s;
    let m = 1;
    const need = measure(ctx, t1, F.title(28 * s)) + (t3 ? gap + measure(ctx, t3, F.body(20 * s)) : 0) + 60 * s + measure(ctx, t2, F.data(25 * s));
    if (need > W - 2 * pad) m = (W - 2 * pad) / need;
    const y = H - L.info / 2 + 9 * s * m;
    text(ctx, t1, pad, y, F.title(28 * s * m), P.fg);
    text(ctx, t3, pad + (t1 ? measure(ctx, t1, F.title(28 * s * m)) + gap * m : 0), y, F.body(20 * s * m), P.muted);
    text(ctx, t2, W - pad, y, F.data(25 * s * m), P.fg, 'right');
    return { W, H };
  }

  if (S.template === 'collage') {
    const items = collageItems(), g = collageGrid(S.ratio === 'orig' ? 0 : W / H), gap = g.gap * s;
    const cw = (W - 2 * L.side - (g.cols - 1) * gap) / g.cols;
    const ch = Math.max(10, (H - 2 * L.top - g.rows * L.info - (g.rows - 1) * gap) / g.rows);
    const gridH = g.rows * (ch + L.info) + (g.rows - 1) * gap, y0 = (H - gridH) / 2;
    const keep = S.fields;
    items.forEach((it, i) => {
      const r = Math.floor(i / g.cols), c = i % g.cols;
      const inRow = Math.min(g.cols, items.length - r * g.cols);
      const x = (W - (inRow * cw + (inRow - 1) * gap)) / 2 + c * (cw + gap), y = y0 + r * (ch + L.info + gap);
      if (it.empty) {
        ctx.save();
        ctx.fillStyle = P.muted; ctx.globalAlpha = .12; ctx.fillRect(x, y, cw, ch); ctx.globalAlpha = 1;
        ctx.strokeStyle = P.muted; ctx.lineWidth = 2 * s; ctx.setLineDash([10 * s, 8 * s]);
        ctx.strokeRect(x + s, y + s, cw - 2 * s, ch - 2 * s);
        ctx.restore();
        text(ctx, '+ Add photo', x + cw / 2, y + ch / 2 + 8 * s, F.body(Math.min(24 * s, cw / 8)), P.muted, 'center');
        return;
      }
      drawCover(ctx, it.img, it.iw, it.ih, x, y, cw, ch);
      S.fields = it.fields;
      const { t1, t2 } = pick({ t1: v('camera'), t2: settingsLine('  '), t3: '', t4: '' });
      S.fields = keep;
      let m = 1;
      const ww = Math.max(measure(ctx, t2, F.data(20 * s)), measure(ctx, t1, F.body(17 * s)));
      if (ww > cw) m = cw / ww;
      text(ctx, t2, x, y + ch + 32 * s, F.data(20 * s * m), P.fg);
      text(ctx, t1, x, y + ch + 58 * s, F.body(17 * s * m), P.muted);
    });
    return { W, H };
  }

  if (S.template === 'lightroom') {
    // the photo next to a Lightroom-style info panel with a live histogram
    const C = { bg: '#141414', panel: '#202020', fg: '#E2E2E2', muted: '#8F8F8F', rule: '#2E2E2E' };
    const portrait = H / W > 1.15;
    const panelW = portrait ? W : Math.round(W * .32), panelH = portrait ? Math.round(Math.min(H * .4, 440 * s)) : H;
    const areaW = portrait ? W : W - panelW, areaH = portrait ? H - panelH : H;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    const pad = 40 * s, k = Math.min((areaW - 2 * pad) / S.iw, (areaH - 2 * pad) / S.ih);
    drawImg(ctx, (areaW - S.iw * k) / 2, (areaH - S.ih * k) / 2, S.iw * k, S.ih * k);
    const X = portrait ? 0 : areaW, Y = portrait ? areaH : 0;
    ctx.fillStyle = C.panel; ctx.fillRect(X, Y, panelW, panelH);
    const ui = p => `500 ${p}px Archivo, sans-serif`;
    const ip = 28 * s, px = X + ip, pw = panelW - 2 * ip;
    let y = Y + ip + 18 * s;
    setSpacing(ctx, 1.2 * s);
    text(ctx, 'HISTOGRAM', px, y, ui(14 * s), C.muted);
    setSpacing(ctx, 0);
    y += 14 * s;
    const hh = Math.min(150 * s, pw * .42, panelH * .38);
    drawHistogram(ctx, histogram(S.img, S.iw, S.ih), px, y, pw, hh);
    y += hh + 32 * s;
    const lt = pick({ t1: '', t2: null, t3: '' });
    const reads = lt.t2 != null ? lt.t2.split(/\s{2,}|\s*[|·•\/]\s*/).filter(Boolean)
      : [v('iso'), v('focal').replace(/mm$/, ' mm'), v('aperture'), v('shutter').replace(/s$/, ' sec')].filter(Boolean);
    if (reads.length) {
      let fs = 17 * s; const tot = reads.reduce((a, r) => a + measure(ctx, r, ui(fs)), 0);
      if (tot > pw * .9) fs *= pw * .9 / tot;
      reads.forEach((r, i) => text(ctx, r, px + pw * (i + .5) / reads.length, y, ui(fs), C.fg, 'center'));
      y += 30 * s;
    }
    const rows = S.custom.on ? [['', lt.t1], ['', lt.t3]].filter(r => r[1])
      : [['Camera', v('camera')], ['Lens', v('lens')], ['Date', v('date')], ['Location', v('location')], ['By', v('author')]].filter(r => r[1]);
    const rh = 40 * s;
    for (const [lab, val] of rows) {
      if (y + rh > Y + panelH - 12 * s) break;
      ctx.fillStyle = C.rule; ctx.fillRect(px, y, pw, Math.max(1, s));
      const labW = lab ? Math.min(pw * .34, 120 * s) : 0;
      let fs = 18 * s; const vw = measure(ctx, val, ui(fs)); if (vw > pw - labW) fs *= (pw - labW) / vw;
      if (lab) text(ctx, lab, px, y + rh * .65, ui(15 * s), C.muted);
      text(ctx, val, lab ? px + pw : px, y + rh * .65, ui(fs), C.fg, lab ? 'right' : 'left');
      y += rh;
    }
    return { W, H };
  }

  const b = placeWithInfo(W, H, L.side, L.top, L.info);
  drawImg(ctx, b.px, b.py, b.pw, b.ph);
  const below = b.py + b.ph;

  if (S.template === 'frame') {
    const ft = pick({ t1: v('camera'), t2: settingsLine('   '), t3: joinNon('  ·  ', v('lens'), v('location')), t4: joinNon('  ·  ', v('date'), v('author')) });
    const L1 = ft.t1, L2 = ft.t3, R1 = ft.t2, R2 = ft.t4;
    const gap = 64 * s;
    let m = 1;
    const lw = () => Math.max(measure(ctx, L1, F.title(34 * s * m)), measure(ctx, L2, F.body(22 * s * m)));
    const rw = () => Math.max(measure(ctx, R1, F.data(30 * s * m)), measure(ctx, R2, F.body(22 * s * m)));
    const avail = Math.max(b.pw, W * .6);
    const x0 = (W - avail) / 2 > b.px ? (W - avail) / 2 : b.px, x1 = W - x0;
    const tot = lw() + rw() + ((L1 || L2) && (R1 || R2) ? gap : 0);
    if (tot > x1 - x0) m *= (x1 - x0) / tot;
    const yc = below + L.info / 2;
    const block = (a, bb, x, align, fa, fb, ca, cb) => {
      if (a && bb) { text(ctx, a, x, yc - 3 * s * m, fa, ca, align); text(ctx, bb, x, yc + 31 * s * m, fb, cb, align); }
      else text(ctx, a || bb, x, yc + 11 * s * m, a ? fa : fb, a ? ca : cb, align);
    };
    block(L1, L2, x0, 'left', F.title(34 * s * m), F.body(22 * s * m), P.fg, P.muted);
    block(R1, R2, x1, 'right', F.data(30 * s * m), F.body(22 * s * m), P.fg, P.muted);
    if ((L1 || L2) && (R1 || R2)) {
      const rx = x1 - rw() - 30 * s * m;
      ctx.fillStyle = P.rule; ctx.fillRect(rx, yc - 34 * s * m, Math.max(1, 2 * s), 74 * s * m);
    }
  } else if (S.template === 'gallery') {
    const cx = W / 2, maxW = W - 2 * L.side * .7;
    const { t1, t2, t3, t4 } = pick({ t1: v('camera'), t2: settingsLine('  ·  '), t3: joinNon('  ·  ', v('lens'), v('date'), v('location')), t4: v('author') });
    let m = 1;
    setSpacing(ctx, 0);
    const ww = Math.max(measure(ctx, t1, F.title(40 * s * m)), measure(ctx, t2, F.data(24 * s * m)) * 1.12, measure(ctx, t3, F.body(21 * s * m)));
    if (ww > maxW) m *= maxW / ww;
    let y = below + 96 * s;
    if (t1) { text(ctx, t1, cx, y, F.title(40 * s * m), P.fg, 'center'); y += 50 * s * m; }
    if (t2) { setSpacing(ctx, 2 * s * m); text(ctx, t2, cx, y, F.data(24 * s * m), P.fg, 'center'); setSpacing(ctx, 0); y += 40 * s * m; }
    if (t3) { text(ctx, t3, cx, y, F.body(21 * s * m), P.muted, 'center'); y += 36 * s * m; }
    if (t4) text(ctx, t4, cx, y + 6 * s, F.body(21 * s * m), P.muted, 'center');
  } else if (S.template === 'film') {
    const amber = '#E8A33D';
    const mono = p => `500 ${p}px "IBM Plex Mono", monospace`;
    const fl = pick({ t1: v('camera'), t2: settingsLine('  '), t3: joinNon('  ·  ', v('lens'), v('location')), t4: v('author') });
    const L1 = fl.t1.toUpperCase(), R1 = fl.t2, L2 = fl.t3, R2 = fl.t4;
    let m = 1;
    const avail = b.pw, tot = Math.max(measure(ctx, L1, mono(26 * s)) + measure(ctx, R1, mono(26 * s)), measure(ctx, L2, mono(19 * s)) + measure(ctx, R2, mono(19 * s))) + 50 * s;
    if (tot > avail) m = avail / tot;
    setSpacing(ctx, 1.5 * s * m);
    const y1 = below + 62 * s, y2 = below + 100 * s;
    text(ctx, L1, b.px, y1, mono(26 * s * m), amber);
    text(ctx, R1, b.px + b.pw, y1, mono(26 * s * m), P.fg, 'right');
    text(ctx, L2, b.px, y2, mono(19 * s * m), P.muted);
    text(ctx, R2, b.px + b.pw, y2, mono(19 * s * m), P.muted, 'right');
    setSpacing(ctx, 0);
    if (S.show.date) {
      const st = (S.dateObj && !S.dateEdited) ? fmtStamp(S.dateObj) : v('date');
      if (st) {
        const fs = Math.min(36 * s, b.pw * .042);
        ctx.save();
        setSpacing(ctx, fs * .08);
        ctx.shadowColor = 'rgba(255,110,20,.85)'; ctx.shadowBlur = fs * .45;
        text(ctx, st, b.px + b.pw - fs * 1.1, b.py + b.ph - fs * .95, `600 ${fs}px "IBM Plex Mono", monospace`, '#FF9A3C', 'right');
        ctx.restore();
      }
    }
  } else if (S.template === 'polaroid') {
    // handwritten marker notes on the thick bottom edge
    const hand = p => `600 ${p}px Caveat, "Segoe Print", "Bradley Hand", cursive`;
    const { t1, t2, t3, t4 } = pick({ t1: joinNon(' + ', v('camera'), v('lens')), t2: settingsLine('  ·  '), t3: joinNon('  ·  ', v('date').replace(/\s+\d{2}:\d{2}$/, ''), v('location')), t4: v('author') });
    const maxW = b.pw - 20 * s;
    let m = 1;
    const ww = Math.max(measure(ctx, t1, hand(50 * s)), measure(ctx, t2, hand(42 * s)), measure(ctx, t3, hand(34 * s)) + measure(ctx, t4, hand(34 * s)) + 40 * s);
    if (ww > maxW) m = maxW / ww;
    ctx.save();
    ctx.translate(b.px + 10 * s, below + 82 * s);
    ctx.rotate(-0.012);
    text(ctx, t1, 0, 0, hand(50 * s * m), P.fg);
    text(ctx, t2, 0, 54 * s * m, hand(42 * s * m), P.fg);
    text(ctx, t3, 0, 104 * s * m, hand(34 * s * m), P.muted);
    text(ctx, t4, b.pw - 20 * s, 104 * s * m, hand(34 * s * m), P.muted, 'right');
    ctx.restore();
  } else if (S.template === 'oneline') {
    const { t1, t2 } = pick({ t1: v('camera'), t2: settingsLine('  '), t3: '', t4: '' });
    const gap = 26 * s, maxW = Math.max(b.pw, W * .6);
    let m = 1;
    const need = measure(ctx, t1, F.title(24 * s)) + (t1 && t2 ? gap : 0) + measure(ctx, t2, F.body(23 * s));
    if (need > maxW) m = maxW / need;
    const w1 = measure(ctx, t1, F.title(24 * s * m)), w2 = measure(ctx, t2, F.body(23 * s * m));
    const x0 = (W - (w1 + (t1 && t2 ? gap * m : 0) + w2)) / 2, y = below + L.info / 2 + 8 * s;
    text(ctx, t1, x0, y, F.title(24 * s * m), P.fg);
    text(ctx, t2, x0 + w1 + (t1 && t2 ? gap * m : 0), y, F.body(23 * s * m), P.muted);
  } else if (S.template === 'spec') {
    const rows = specRows();
    if (rows.length) {
      const cols = rows.length > 4 ? 2 : 1, perCol = Math.ceil(rows.length / cols);
      const tw = Math.max(b.pw, Math.min(W - 2 * L.side, W * .7)), x0 = (W - tw) / 2, gap = 48 * s;
      const cw = (tw - gap * (cols - 1)) / cols, rh = 54 * s;
      const labF = p => `500 ${p}px "IBM Plex Mono", monospace`;
      let m = 1;
      for (const [lab, val] of rows) {
        const need = measure(ctx, lab.toUpperCase(), labF(15 * s)) + 24 * s + measure(ctx, val, F.data(23 * s));
        if (need > cw) m = Math.min(m, cw / need);
      }
      const y0 = below + 58 * s;
      rows.forEach(([lab, val], i) => {
        const c = Math.floor(i / perCol), r = i % perCol;
        const x = x0 + c * (cw + gap), y = y0 + r * rh;
        ctx.fillStyle = P.rule; ctx.fillRect(x, y, cw, Math.max(1, 1.5 * s));
        setSpacing(ctx, 1.6 * s * m);
        text(ctx, lab.toUpperCase(), x, y + rh * .62, labF(15 * s * m), P.muted);
        setSpacing(ctx, 0);
        text(ctx, val, x + cw, y + rh * .64, F.data(23 * s * m), P.fg, 'right');
      });
      for (let c = 0; c < cols; c++) { ctx.fillStyle = P.rule; ctx.fillRect(x0 + c * (cw + gap), y0 + perCol * rh, cw, Math.max(1, 1.5 * s)); }
    }
  }
  return { W, H };
}

let raf = 0;
function schedule() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const r = render();
    if (r) {
      const lab = RATIOS.find(x => x[0] === S.ratio);
      $('#dims').textContent = `${r.W} × ${r.H} px${lab && lab[2] ? ' · ' + lab[2] : ''}`;
    }
  });
}

// ---------- UI build ----------
$('#ratios').innerHTML = RATIOS.map(([val, a, b]) =>
  `<label class="chip"><input type="radio" name="ratio" id="r-${val.replace(':', 'x')}" value="${val}">${a}${b ? ` <small>${b}</small>` : ''}</label>`).join('');
$('#fields').innerHTML = FIELD_DEFS.map(([k, label]) =>
  `<div class="field" data-k="${k}"><input type="checkbox" id="show-${k}" aria-label="Show ${label}"><label for="val-${k}">${label}</label><input type="text" id="val-${k}" autocomplete="off" spellcheck="false"></div>`).join('');
const PLACEHOLDER = { location: 'From GPS, or type a place', author: '@yourname' };

function syncControls() {
  for (const n of ['template', 'ratio', 'tone', 'font', 'size', 'format', 'sep']) {
    const el = document.querySelector(`input[name="${n}"][value="${S[n]}"]`); if (el) el.checked = true;
  }
  for (const [k] of FIELD_DEFS) {
    const cb = $(`#show-${k}`), tx = $(`#val-${k}`);
    cb.checked = !!S.show[k]; tx.value = S.fields[k] || ''; tx.placeholder = PLACEHOLDER[k] || '';
    tx.closest('.field').classList.toggle('off', !S.show[k]);
  }
  const [toneBox, fontBox] = $('#styleRow').children;
  toneBox.hidden = !['frame', 'gallery', 'polaroid', 'spec', 'strap', 'oneline', 'collage'].includes(S.template);
  fontBox.hidden = ['film', 'viewfinder', 'polaroid', 'lightroom'].includes(S.template);
  $(`input[name="textMode"][value="${S.custom.on ? 'custom' : 'auto'}"]`).checked = true;
  $('#customBox').hidden = !S.custom.on;
  for (const k of ['l1', 'l2', 'l3']) if (document.activeElement !== $(`#${k}`)) $(`#${k}`).value = S.custom[k];
  $('#dateFmt').value = S.dateFmt;
  $('#keepExif').checked = S.keepExif;
  $('#textNote').hidden = S.template !== 'spec' || !S.custom.on;
  $('#collageNote').hidden = S.template !== 'collage';
  $('#collageNote').classList.toggle('warn', !collageReady());
  $('#collageMsg').textContent = S.photos.length > MAX_COLLAGE ? `The collage uses your first ${MAX_COLLAGE} photos.`
    : !collageReady() ? 'A collage needs two or more photos. Pick several at once, or add them one by one.' : `${S.photos.length} photos in the collage.`;
  $('#collageAdd').hidden = S.photos.length >= MAX_COLLAGE;
  renderStrip();
  $('#styleRow').closest('.group').hidden = toneBox.hidden && fontBox.hidden;
}

document.querySelector('.controls').addEventListener('change', e => {
  const t = e.target;
  if (t.name === 'textMode') {
    S.custom.on = t.value === 'custom'; syncControls();
  } else if (t.type === 'radio') {
    S[t.name] = t.name === 'size' ? +t.value : t.value;
    if (t.name === 'template') syncControls();
  } else if (t.id === 'keepExif') {
    S.keepExif = t.checked;
  } else if (t.id === 'dateFmt') {
    S.dateFmt = t.value;
    for (const ph of [...S.photos, S]) if (ph.dateObj && !ph.dateEdited) ph.fields.date = fmtDate(ph.dateObj, S.dateFmt);
    syncControls();
  } else if (t.type === 'checkbox' && t.id.startsWith('show-')) {
    const k = t.id.slice(5); S.show[k] = t.checked;
    t.closest('.field').classList.toggle('off', !t.checked);
  }
  savePrefs(); schedule();
});
$('#fields').addEventListener('input', e => {
  const t = e.target; if (!t.id.startsWith('val-')) return;
  const k = t.id.slice(4); S.fields[k] = t.value;
  if (k === 'author') for (const ph of S.photos) ph.fields.author = t.value; // signature is the same on every photo
  if (k === 'date') { S.dateEdited = true; if (S.photos[S.cur]) S.photos[S.cur].dateEdited = true; }
  if (t.value && !S.show[k]) { S.show[k] = true; $(`#show-${k}`).checked = true; t.closest('.field').classList.remove('off'); }
  if (k === 'author') savePrefs();
  schedule();
});

// ---------- custom lines ----------
let lastLine = 'l1';
for (const k of ['l1', 'l2', 'l3']) {
  $(`#${k}`).addEventListener('input', e => { S.custom[k] = e.target.value; savePrefs(); schedule(); });
  $(`#${k}`).addEventListener('focus', () => { lastLine = k; });
}
$('#phChips').addEventListener('click', e => {
  const btn = e.target.closest('button[data-ph]'); if (!btn) return;
  const el = $(`#${lastLine}`), ph = `{${btn.dataset.ph}}`;
  const a = el.selectionStart ?? el.value.length, b = el.selectionEnd ?? el.value.length;
  const pre = el.value.slice(0, a), sp = pre && !/\s$/.test(pre) ? ' ' : '';
  el.value = pre + sp + ph + el.value.slice(b);
  el.focus(); el.selectionStart = el.selectionEnd = a + sp.length + ph.length;
  S.custom[lastLine] = el.value; savePrefs(); schedule();
});

// ---------- loading photos ----------
// Make photo i the one being edited: its image and details become S.img, S.fields, ...
function activate(i) {
  const ph = S.photos[i]; if (!ph) return;
  S.cur = i;
  S.img = ph.img; S.iw = ph.iw; S.ih = ph.ih; S.fields = ph.fields; S.dateObj = ph.dateObj; S.dateEdited = ph.dateEdited;
  S.baseName = ph.baseName; S.isSample = false;
}
function showPhotoNote(ph) {
  const note = $('#exifNote');
  note.classList.toggle('warn', !ph.found);
  $('#foundCount').textContent = ph.found ? `${ph.found} read from file` : '';
  $('#fileName').textContent = S.photos.length > 1 ? `${S.photos.length} photos` : ph.name;
  $('#fileHint').textContent = S.photos.length > 1 ? 'Add more, or pick one below to edit its details' : `${ph.iw} × ${ph.ih} px · choose another or add more`;
  note.textContent = !ph.found
    ? 'No camera data found in this file. Social apps and screenshots strip it. Type the details below, or use the original file from your camera.'
    : ph.fields.location ? 'Camera data loaded. This photo has GPS coordinates; tick Location only if you want them on the image.'
    : 'Camera data loaded. Edit anything below before saving.';
}
async function readPhoto(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch (e) { URL.revokeObjectURL(url); return null; }
  let x = null, exif = null;
  try { const buf = await file.arrayBuffer(); x = parseExif(buf); exif = jpegExifTiff(buf); } catch (e) { x = null; }
  const d = x ? parseDate(x.DateTimeOriginal) : null;
  const author = S.fields.author || (saved && saved.author) || (x && x.Artist) || '';
  const fields = {
    camera: x ? cameraName(x.Make, x.Model) : '',
    lens: x ? (x.LensModel || '').replace(/\s+/g, ' ').trim() : '',
    focal: x ? fmtFocal(x.FocalLength, x.FocalLength35) : '',
    aperture: x ? fmtAperture(x.FNumber) : '',
    shutter: x ? fmtShutter(x.ExposureTime) : '',
    iso: x && x.ISO ? `ISO ${x.ISO}` : '',
    date: fmtDate(d, S.dateFmt),
    location: x ? fmtGps(x.latitude, x.longitude) : '',
    author,
  };
  const found = ['camera', 'lens', 'focal', 'aperture', 'shutter', 'iso', 'date', 'location'].filter(k => fields[k]).length;
  return {
    img, url, iw: img.naturalWidth, ih: img.naturalHeight, name: file.name || 'Photo', exif, fields, found,
    dateObj: d, dateEdited: false,
    baseName: (file.name || 'photo').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').slice(0, 60) || 'photo',
  };
}
async function loadFiles(list) {
  const files = [...(list || [])].filter(f => f && (f.type.startsWith('image/') || /\.(heic|heif|jpe?g|png|webp|tiff?)$/i.test(f.name)));
  if (!files.length) return;
  const note = $('#exifNote');
  const first = S.photos.length;
  let failed = [];
  for (let i = 0; i < files.length; i++) {
    if (files.length > 1) $('#fileHint').textContent = `Reading ${i + 1} of ${files.length}…`;
    const ph = await readPhoto(files[i]);
    if (ph) S.photos.push(ph); else failed.push(files[i]);
  }
  if (S.photos.length > first) {
    activate(first);
    S.show.location = false;
    $('#badge').hidden = true;
    showPhotoNote(S.photos[first]);
  }
  if (failed.length) {
    note.classList.add('warn');
    const heic = failed.some(f => /heic|heif/i.test(f.type + f.name));
    note.textContent = (failed.length === 1 ? `${failed[0].name} could not be opened. ` : `${failed.length} files could not be opened. `) +
      (heic ? 'This browser cannot open HEIC photos. Open the page in Safari, or export them as JPEG first.' : 'Try JPEG, PNG or WebP.');
  }
  syncControls(); schedule();
}
function removePhoto(i) {
  const [ph] = S.photos.splice(i, 1);
  if (ph) URL.revokeObjectURL(ph.url);
  if (!S.photos.length) { useSample(); $('#fileName').textContent = 'Choose photos'; $('#fileHint').textContent = 'JPEG straight from the camera works best. Pick several to frame them all at once.'; $('#foundCount').textContent = ''; }
  else { activate(Math.min(i, S.photos.length - 1)); showPhotoNote(S.photos[S.cur]); }
  syncControls(); schedule();
}
function renderStrip() {
  const strip = $('#strip');
  strip.hidden = S.photos.length < 2;
  $('#saveAll').hidden = S.photos.length < 2 || S.template === 'collage';
  $('#saveAll').textContent = `Save all ${S.photos.length}`;
  if (strip.hidden) { strip.innerHTML = ''; return; }
  strip.innerHTML = S.photos.map((ph, i) =>
    `<div class="thumb${i === S.cur ? ' on' : ''}"><button type="button" class="pick" data-i="${i}" aria-label="Edit ${ph.name.replace(/"/g, '&quot;')}"${i === S.cur ? ' aria-current="true"' : ''}><img src="${ph.url}" alt=""></button>` +
    `<button type="button" class="drop-x" data-rm="${i}" aria-label="Remove ${ph.name.replace(/"/g, '&quot;')}">×</button></div>`).join('');
}
$('#strip').addEventListener('click', e => {
  const rm = e.target.closest('[data-rm]');
  if (rm) { removePhoto(+rm.dataset.rm); return; }
  const pickBtn = e.target.closest('[data-i]');
  if (pickBtn) { activate(+pickBtn.dataset.i); showPhotoNote(S.photos[S.cur]); syncControls(); schedule(); }
});
$('#file').addEventListener('change', e => { loadFiles(e.target.files); e.target.value = ''; });
const drop = $('#drop');
['dragenter', 'dragover'].forEach(n => document.addEventListener(n, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(n => document.addEventListener(n, e => { e.preventDefault(); if (n === 'drop' || !e.relatedTarget) drop.classList.remove('over'); }));
document.addEventListener('drop', e => { if (e.dataTransfer) loadFiles(e.dataTransfer.files); });
document.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])].filter(f => f.type.startsWith('image/')); if (f.length) loadFiles(f); });

// ---------- export ----------
const toastEl = $('#toast'); let toastT = 0;
function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => toastEl.hidden = true, 2600); }
// Inside a claude.ai Artifact viewer, files are saved through its downloads capability.
// On a normal website (GitHub Pages, local server) a plain download link works.
const inArtifact = !!(window.claude && window.claude.use);
const downloadsP = inArtifact ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
function directDownload(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
// On phones (iPhone especially) a download lands in Files, not Photos. The share sheet
// has "Save Image", so images go there when the browser can share files.
const isPhone = matchMedia('(pointer: coarse)').matches;
function shareable(files) {
  try { return !inArtifact && isPhone && !!navigator.canShare && navigator.canShare({ files }); } catch (e) { return false; }
}
// Resolves 'shared', 'cancelled', or 'blocked' (the tap that started it has expired).
async function shareFiles(files) {
  try { await navigator.share({ files }); return 'shared'; }
  catch (err) { return err && err.name === 'AbortError' ? 'cancelled' : 'blocked'; }
}
let sheetUrl = '', sheetFiles = null;
function showSheet(blob, name, files) {
  if (sheetUrl) URL.revokeObjectURL(sheetUrl);
  sheetUrl = blob ? URL.createObjectURL(blob) : '';
  sheetFiles = files || null;
  const many = files && files.length > 1;
  $('#sheetTitle').textContent = many ? `${files.length} images are ready` : 'Your image is ready';
  $('#sheetHint').textContent = files ? 'Tap Save to Photos, then choose Save Image.' : 'Press and hold the image (phone) or right-click it (computer) and choose Save image.';
  $('#sheetImg').hidden = !blob; if (blob) $('#sheetImg').src = sheetUrl;
  $('#sheetLink').hidden = !blob || !!files; if (blob) { $('#sheetLink').href = sheetUrl; $('#sheetLink').download = name; }
  $('#sheetShare').hidden = !files;
  $('#sheet').hidden = false; (files ? $('#sheetShare') : $('#sheetClose')).focus();
}
$('#sheetShare').addEventListener('click', async () => {
  if (!sheetFiles) return;
  const r = await shareFiles(sheetFiles);
  if (r === 'shared') { $('#sheet').hidden = true; toast('Shared'); }
});
$('#collageAdd').addEventListener('click', () => $('#file').click());
$('#sheetClose').addEventListener('click', () => $('#sheet').hidden = true);
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('#sheet').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#sheet').hidden = true; });

// Render the current settings to a file. JPEGs get the photo's own camera data back.
async function exportCurrent() {
  render();
  const png = S.format === 'png';
  let blob = await new Promise(r => out.toBlob(r, png ? 'image/png' : 'image/jpeg', .93));
  if (!blob) return null;
  const ph = S.photos[S.cur];
  if (!png && S.keepExif && ph && ph.exif && S.template !== 'collage') {
    const tiff = exifForExport(ph.exif, { keepGps: !!S.show.location, width: out.width, height: out.height });
    if (tiff) blob = new Blob([insertExif(new Uint8Array(await blob.arrayBuffer()), tiff)], { type: 'image/jpeg' });
  }
  const name = `${S.template === 'collage' ? 'collage' : S.baseName}-${S.template}-${S.ratio === 'orig' ? 'original' : S.ratio.replace(':', 'x')}.${png ? 'png' : 'jpg'}`;
  return { blob, name };
}
async function offer(blob, name) {
  const dl = await downloadsP;
  if (dl) {
    try { await dl.save({ filename: name, data: blob }); toast(`Saved ${name}`); return; }
    catch (err) {
      const c = err && err.code;
      if (c === 'declined') { toast('Save cancelled'); return; }
      if (c === 'rate_limited') { toast('A save prompt is already open'); return; }
    }
  }
  const files = [new File([blob], name, { type: blob.type })];
  if (shareable(files)) {
    const r = await shareFiles(files);
    if (r === 'blocked') showSheet(blob, name, files);
    return;
  }
  if (!inArtifact) { directDownload(blob, name); toast(`Saved ${name}`); return; }
  showSheet(blob, name);
}
$('#save').addEventListener('click', async () => {
  if (S.template === 'collage' && !collageReady()) { toast('Add at least two photos to save a collage'); $('#file').click(); return; }
  const r = await exportCurrent();
  if (!r) { toast('The image could not be created. Try the 1080 px size.'); return; }
  offer(r.blob, r.name);
});
$('#saveAll').addEventListener('click', async () => {
  const btn = $('#saveAll'); if (btn.disabled) return;
  btn.disabled = true;
  const keep = S.cur, files = [], used = new Set();
  try {
    for (let i = 0; i < S.photos.length; i++) {
      btn.textContent = `Rendering ${i + 1} of ${S.photos.length}…`;
      activate(i);
      const r = await exportCurrent();
      if (!r) continue;
      let name = r.name, n = 2;
      while (used.has(name)) name = r.name.replace(/(\.\w+)$/, `-${n++}$1`);
      used.add(name);
      files.push({ name, data: new Uint8Array(await r.blob.arrayBuffer()) });
      await new Promise(res => setTimeout(res, 0));
    }
  } finally {
    activate(keep); btn.disabled = false; syncControls(); schedule();
  }
  if (!files.length) { toast('The images could not be created. Try the 1080 px size.'); return; }
  // On a phone, hand every image to the share sheet so they can go straight to Photos.
  const each = files.map(f => new File([f.data], f.name, { type: /\.png$/.test(f.name) ? 'image/png' : 'image/jpeg' }));
  if (shareable(each)) {
    const r = await shareFiles(each);
    if (r === 'blocked') showSheet(null, '', each);
    return;
  }
  offer(new Blob([makeZip(files)], { type: 'application/zip' }), `exif-frame-${files.length}-photos.zip`);
});

$('#copyCaption').addEventListener('click', async () => {
  const line1 = joinNon(' + ', v('camera'), v('lens'));
  const cap = [line1 && `Shot on ${line1}`, settingsLine(' · '), joinNon(' · ', v('date').replace(/\s+\d{2}:\d{2}$/, ''), v('location'))].filter(Boolean).join('\n');
  try { await navigator.clipboard.writeText(cap); toast('Caption copied'); }
  catch (e) {
    const ta = document.createElement('textarea'); ta.value = cap; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch (err) {}
    ta.remove(); toast(ok ? 'Caption copied' : cap);
  }
});

// ---------- start ----------
const sample = makeSample();
function useSample() {
  S.img = sample; S.iw = sample.width; S.ih = sample.height; S.isSample = true; S.cur = -1; S.baseName = 'photo';
  S.dateObj = { y: '2026', mo: '09', d: '14', h: '19', mi: '42' }; S.dateEdited = false;
  S.fields = { ...SAMPLE_FIELDS, date: fmtDate(S.dateObj, S.dateFmt), author: S.fields.author || (saved && saved.author) || '' };
  $('#badge').hidden = false;
  $('#exifNote').classList.remove('warn');
  $('#exifNote').textContent = 'Showing an example. The values below are made up until you add a photo.';
}
useSample();
syncControls();
schedule();
if (document.fonts) {
  Promise.all(['700 20px Archivo', '400 20px Archivo', '600 20px Archivo', '500 20px "IBM Plex Mono"', '600 20px "IBM Plex Mono"', 'italic 400 20px "Instrument Serif"', '400 20px "Instrument Serif"', '600 20px Caveat']
    .map(f => document.fonts.load(f).catch(() => null))).then(schedule);
  document.fonts.ready.then(schedule);
}

// Installed on a phone's home screen, the app keeps working without a connection.
if ('serviceWorker' in navigator && !inArtifact && (location.protocol === 'https:' || location.hostname === 'localhost')) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
