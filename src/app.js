import { parseExif, cameraName, fmtShutter, fmtAperture, fmtFocal, parseDate, fmtDate, fmtStamp, fmtGps } from './exif.js';


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
};
const SAMPLE_FIELDS = { camera: 'Fujifilm X-T5', lens: 'XF23mmF2 R WR', focal: '23mm', aperture: 'f/8', shutter: '1/250s', iso: 'ISO 160', date: '2026.09.14  19:42', location: '', author: '' };

const store = {
  get() { try { return JSON.parse(localStorage.getItem('exif-frame-prefs') || 'null'); } catch (e) { return null; } },
  set(v) { try { localStorage.setItem('exif-frame-prefs', JSON.stringify(v)); } catch (e) {} },
};
const saved = store.get();
if (saved) {
  for (const k of ['template', 'ratio', 'tone', 'font', 'format']) if (typeof saved[k] === 'string') S[k] = saved[k];
  if (saved.size === 1080 || saved.size === 2160) S.size = saved.size;
  if (saved.show) for (const k in S.show) if (k !== 'location' && typeof saved.show[k] === 'boolean') S.show[k] = saved.show[k];
}
const savePrefs = () => store.set({ template: S.template, ratio: S.ratio, tone: S.tone, font: S.font, size: S.size, format: S.format, show: S.show, author: S.fields.author || '' });

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
const settingsLine = sep => ['focal', 'aperture', 'shutter', 'iso'].map(v).filter(Boolean).join(sep);
const joinNon = (sep, ...a) => a.filter(Boolean).join(sep);

function measure(ctx, s, font) { if (!s) return 0; ctx.font = font; return ctx.measureText(s).width; }
function text(ctx, s, x, y, font, color, align = 'left') {
  if (!s) return; ctx.font = font; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y);
}
function setSpacing(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; }

function canvasSize(info, side, top) {
  const W = S.size;
  const k = S.ratio === 'orig' ? null : S.ratio.split(':').map(Number);
  if (k) return { W, H: Math.round(W * k[1] / k[0]) };
  if (S.template === 'overlay') return { W, H: Math.round(W * S.ih / S.iw) };
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
};

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
    const t1 = v('camera'), t2 = settingsLine('   '), t3 = joinNon('  ·  ', v('lens'), v('date'), v('location')), au = v('author');
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

  const P = S.template === 'film' ? { bg: '#121110', fg: '#EDE6D6', muted: '#8E8676', rule: '#333' } : TONES[S.tone];
  ctx.fillStyle = P.bg; ctx.fillRect(0, 0, W, H);
  const b = placeWithInfo(W, H, L.side, L.top, L.info);
  drawImg(ctx, b.px, b.py, b.pw, b.ph);
  const below = b.py + b.ph;

  if (S.template === 'frame') {
    const L1 = v('camera'), L2 = joinNon('  ·  ', v('lens'), v('location'));
    const R1 = settingsLine('   '), R2 = joinNon('  ·  ', v('date'), v('author'));
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
    const t1 = v('camera'), t2 = settingsLine('  ·  '), t3 = joinNon('  ·  ', v('lens'), v('date'), v('location')), t4 = v('author');
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
    const L1 = v('camera').toUpperCase(), R1 = settingsLine('  ');
    const L2 = joinNon('  ·  ', v('lens'), v('location')), R2 = v('author');
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
  for (const n of ['template', 'ratio', 'tone', 'font', 'size', 'format']) {
    const el = document.querySelector(`input[name="${n}"][value="${S[n]}"]`); if (el) el.checked = true;
  }
  for (const [k] of FIELD_DEFS) {
    const cb = $(`#show-${k}`), tx = $(`#val-${k}`);
    cb.checked = !!S.show[k]; tx.value = S.fields[k] || ''; tx.placeholder = PLACEHOLDER[k] || '';
    tx.closest('.field').classList.toggle('off', !S.show[k]);
  }
  $('#styleRow').querySelector('div').hidden = S.template === 'film' || S.template === 'overlay';
}

document.querySelector('.controls').addEventListener('change', e => {
  const t = e.target;
  if (t.type === 'radio') {
    S[t.name] = t.name === 'size' ? +t.value : t.value;
    if (t.name === 'template') syncControls();
  } else if (t.type === 'checkbox' && t.id.startsWith('show-')) {
    const k = t.id.slice(5); S.show[k] = t.checked;
    t.closest('.field').classList.toggle('off', !t.checked);
  }
  savePrefs(); schedule();
});
$('#fields').addEventListener('input', e => {
  const t = e.target; if (!t.id.startsWith('val-')) return;
  const k = t.id.slice(4); S.fields[k] = t.value;
  if (k === 'date') S.dateEdited = true;
  if (t.value && !S.show[k]) { S.show[k] = true; $(`#show-${k}`).checked = true; t.closest('.field').classList.remove('off'); }
  if (k === 'author') savePrefs();
  schedule();
});

// ---------- loading photos ----------
async function loadFile(file) {
  if (!file) return;
  const note = $('#exifNote');
  note.classList.remove('warn');
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try { await img.decode(); } catch (e) {
    URL.revokeObjectURL(url);
    note.classList.add('warn');
    note.textContent = /heic|heif/i.test(file.type + file.name)
      ? 'This browser cannot open HEIC photos. Open the page in Safari, or export the photo as JPEG first.'
      : 'This file could not be opened as an image. Try a JPEG, PNG or WebP.';
    return;
  }
  let x = null;
  try { x = parseExif(await file.arrayBuffer()); } catch (e) { x = null; }
  S.img = img; S.iw = img.naturalWidth; S.ih = img.naturalHeight; S.isSample = false;
  S.baseName = (file.name || 'photo').replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').slice(0, 60) || 'photo';
  const d = x ? parseDate(x.DateTimeOriginal) : null;
  S.dateObj = d; S.dateEdited = false;
  const author = S.fields.author || (saved && saved.author) || (x && x.Artist) || '';
  S.fields = {
    camera: x ? cameraName(x.Make, x.Model) : '',
    lens: x ? (x.LensModel || '').replace(/\s+/g, ' ').trim() : '',
    focal: x ? fmtFocal(x.FocalLength, x.FocalLength35) : '',
    aperture: x ? fmtAperture(x.FNumber) : '',
    shutter: x ? fmtShutter(x.ExposureTime) : '',
    iso: x && x.ISO ? `ISO ${x.ISO}` : '',
    date: fmtDate(d),
    location: x ? fmtGps(x.latitude, x.longitude) : '',
    author,
  };
  S.show.location = false;
  const found = ['camera', 'lens', 'focal', 'aperture', 'shutter', 'iso', 'date', 'location'].filter(k => S.fields[k]).length;
  $('#foundCount').textContent = found ? `${found} read from file` : '';
  $('#fileName').textContent = file.name || 'Photo';
  $('#fileHint').textContent = `${S.iw} × ${S.ih} px · choose another`;
  $('#badge').hidden = true;
  if (!x || !found) {
    note.classList.add('warn');
    note.textContent = 'No camera data found in this file. Social apps and screenshots strip it. Type the details below, or use the original file from your camera.';
  } else {
    note.textContent = S.fields.location
      ? 'Camera data loaded. This photo has GPS coordinates; tick Location only if you want them on the image.'
      : 'Camera data loaded. Edit anything below before saving.';
  }
  syncControls(); schedule();
}
$('#file').addEventListener('change', e => { loadFile(e.target.files[0]); e.target.value = ''; });
const drop = $('#drop');
['dragenter', 'dragover'].forEach(n => document.addEventListener(n, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(n => document.addEventListener(n, e => { e.preventDefault(); if (n === 'drop' || !e.relatedTarget) drop.classList.remove('over'); }));
document.addEventListener('drop', e => { const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) loadFile(f); });
document.addEventListener('paste', e => { const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/')); if (f) loadFile(f); });

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
let sheetUrl = '';
function showSheet(blob, name) {
  if (sheetUrl) URL.revokeObjectURL(sheetUrl);
  sheetUrl = URL.createObjectURL(blob);
  $('#sheetImg').src = sheetUrl; $('#sheetLink').href = sheetUrl; $('#sheetLink').download = name;
  $('#sheet').hidden = false; $('#sheetClose').focus();
}
$('#sheetClose').addEventListener('click', () => $('#sheet').hidden = true);
$('#sheet').addEventListener('click', e => { if (e.target.id === 'sheet') $('#sheet').hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') $('#sheet').hidden = true; });

$('#save').addEventListener('click', async () => {
  render();
  const png = S.format === 'png';
  const blob = await new Promise(r => out.toBlob(r, png ? 'image/png' : 'image/jpeg', .93));
  if (!blob) { toast('The image could not be created. Try the 1080 px size.'); return; }
  const name = `${S.baseName}-${S.template}-${S.ratio === 'orig' ? 'original' : S.ratio.replace(':', 'x')}.${png ? 'png' : 'jpg'}`;
  const dl = await downloadsP;
  if (dl) {
    try { await dl.save({ filename: name, data: blob }); toast(`Saved ${name}`); return; }
    catch (err) {
      const c = err && err.code;
      if (c === 'declined') { toast('Save cancelled'); return; }
      if (c === 'rate_limited') { toast('A save prompt is already open'); return; }
    }
  }
  if (!inArtifact) { directDownload(blob, name); toast(`Saved ${name}`); return; }
  showSheet(blob, name);
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
S.img = sample; S.iw = sample.width; S.ih = sample.height;
S.fields = { ...SAMPLE_FIELDS, author: (saved && saved.author) || '' };
S.dateObj = { y: '2026', mo: '09', d: '14', h: '19', mi: '42' };
syncControls();
schedule();
if (document.fonts) {
  Promise.all(['700 20px Archivo', '400 20px Archivo', '600 20px Archivo', '500 20px "IBM Plex Mono"', '600 20px "IBM Plex Mono"', 'italic 400 20px "Instrument Serif"', '400 20px "Instrument Serif"']
    .map(f => document.fonts.load(f).catch(() => null))).then(schedule);
  document.fonts.ready.then(schedule);
}
