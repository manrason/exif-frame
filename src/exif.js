// Minimal EXIF reader and value formatters. No dependencies; works in browsers and Node.

// ---------- EXIF reader (JPEG, HEIC, PNG, WebP, TIFF) ----------
const isTiff = (u, i) => i >= 0 && i + 8 <= u.length &&
  ((u[i] === 0x49 && u[i + 1] === 0x49 && u[i + 2] === 0x2A && u[i + 3] === 0) ||
   (u[i] === 0x4D && u[i + 1] === 0x4D && u[i + 2] === 0 && u[i + 3] === 0x2A));
export function findTiff(u) {
  if (u[0] === 0xFF && u[1] === 0xD8) {
    let o = 2;
    while (o + 10 < u.length) {
      if (u[o] !== 0xFF) { o++; continue; }
      const m = u[o + 1];
      if (m === 0xD9 || m === 0xDA) break;
      const len = (u[o + 2] << 8) | u[o + 3];
      if (m === 0xE1 && u[o + 4] === 0x45 && u[o + 5] === 0x78 && u[o + 6] === 0x69 && u[o + 7] === 0x66 && isTiff(u, o + 10)) return o + 10;
      o += 2 + len;
    }
  }
  if (isTiff(u, 0)) return 0;
  for (let i = 0; i < u.length - 12; i++) {
    // "Exif\0\0" (HEIC, some WebP) or PNG "eXIf" / WebP "EXIF" chunks
    if (u[i] === 0x45 && u[i + 1] === 0x78 && u[i + 2] === 0x69 && u[i + 3] === 0x66 && u[i + 4] === 0 && u[i + 5] === 0 && isTiff(u, i + 6)) return i + 6;
    if ((u[i] === 0x65 || u[i] === 0x45) && u[i + 1] === 0x58 && u[i + 2] === 0x49 && (u[i + 3] === 0x66 || u[i + 3] === 0x46)) {
      if (isTiff(u, i + 4)) return i + 4;
      if (isTiff(u, i + 8)) return i + 8;
    }
  }
  return -1;
}
export function parseExif(buf) {
  const u = new Uint8Array(buf);
  const t = findTiff(u);
  if (t < 0) return null;
  const dv = new DataView(buf);
  const le = u[t] === 0x49;
  const g16 = o => dv.getUint16(t + o, le), g32 = o => dv.getUint32(t + o, le), s32 = o => dv.getInt32(t + o, le);
  const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  function val(type, cnt, off) {
    const one = i => {
      switch (type) {
        case 1: case 7: return u[t + off + i];
        case 3: return g16(off + i * 2);
        case 4: return g32(off + i * 4);
        case 9: return s32(off + i * 4);
        case 5: { const d = g32(off + i * 8 + 4); return d ? g32(off + i * 8) / d : 0; }
        case 10: { const d = s32(off + i * 8 + 4); return d ? s32(off + i * 8) / d : 0; }
        default: return null;
      }
    };
    if (type === 2) {
      let s = '';
      for (let i = 0; i < cnt; i++) { const c = u[t + off + i]; if (!c) break; s += String.fromCharCode(c); }
      try { s = decodeURIComponent(escape(s)); } catch (e) {}
      return s.trim();
    }
    if (cnt === 1) return one(0);
    const a = []; for (let i = 0; i < Math.min(cnt, 64); i++) a.push(one(i)); return a;
  }
  function ifd(off) {
    const tags = {};
    if (!off || t + off + 2 > u.length) return tags;
    const n = g16(off);
    for (let i = 0; i < n; i++) {
      const e = off + 2 + i * 12;
      if (t + e + 12 > u.length) break;
      try {
        const tag = g16(e), type = g16(e + 2), cnt = g32(e + 4);
        const total = (SZ[type] || 1) * cnt;
        const vo = total <= 4 ? e + 8 : g32(e + 8);
        if (t + vo + total > u.length) continue;
        tags[tag] = val(type, cnt, vo);
      } catch (err) {}
    }
    return tags;
  }
  const i0 = ifd(g32(4));
  const ex = i0[0x8769] ? ifd(i0[0x8769]) : {};
  const gps = i0[0x8825] ? ifd(i0[0x8825]) : {};
  const dms = v => Array.isArray(v) ? v[0] + (v[1] || 0) / 60 + (v[2] || 0) / 3600 : (typeof v === 'number' ? v : null);
  let lat = dms(gps[2]), lon = dms(gps[4]);
  if (lat != null && gps[1] === 'S') lat = -lat;
  if (lon != null && gps[3] === 'W') lon = -lon;
  const iso = ex[0x8827];
  return {
    Make: i0[0x010F], Model: i0[0x0110], Artist: i0[0x013B],
    ExposureTime: ex[0x829A], FNumber: ex[0x829D], ISO: Array.isArray(iso) ? iso[0] : iso,
    DateTimeOriginal: ex[0x9003] || ex[0x9004] || i0[0x0132],
    FocalLength: ex[0x920A], FocalLength35: ex[0xA405], LensModel: ex[0xA434], LensMake: ex[0xA433],
    latitude: (lat != null && lon != null && (lat || lon)) ? lat : null, longitude: (lat != null && lon != null && (lat || lon)) ? lon : null,
  };
}

// ---------- formatting ----------
const MAKES = [[/^nikon/i, 'Nikon'], [/^canon/i, 'Canon'], [/^fuji/i, 'Fujifilm'], [/^sony/i, 'Sony'], [/^leica/i, 'Leica'],
  [/^olympus/i, 'Olympus'], [/^om digital/i, 'OM System'], [/^ricoh/i, 'Ricoh'], [/^pentax/i, 'Pentax'], [/^panasonic/i, 'Panasonic'],
  [/^hasselblad/i, 'Hasselblad'], [/^samsung/i, 'Samsung'], [/^google/i, 'Google'], [/^apple/i, 'Apple'], [/^xiaomi/i, 'Xiaomi'],
  [/^dji/i, 'DJI'], [/^sigma/i, 'Sigma'], [/^gopro/i, 'GoPro'], [/^huawei/i, 'Huawei'], [/^oneplus/i, 'OnePlus'], [/^phase one/i, 'Phase One']];
export function niceMake(m) {
  m = (m || '').trim();
  for (const [re, n] of MAKES) if (re.test(m)) return n;
  return m.replace(/\b(corporation|corp\.?|co\.?,?\s*ltd\.?|inc\.?|imaging|camera ag|company)\b/gi, '').replace(/[\s,.]+$/, '').trim();
}
export function cameraName(make, model) {
  const nm = niceMake(make);
  let md = (model || '').trim();
  if (!md) return nm;
  if (/^(iphone|ipad|pixel|galaxy)/i.test(md)) return md;
  const first = md.split(/\s+/)[0].toLowerCase();
  const rawFirst = (make || '').trim().split(/\s+/)[0].toLowerCase();
  if (nm && (first === nm.toLowerCase() || first === rawFirst)) md = md.split(/\s+/).slice(1).join(' ');
  if (nm === 'Nikon') md = md.replace(/_2$/, 'II').replace(/_3$/, 'III');
  return nm ? `${nm} ${md}`.trim() : md;
}
const trimNum = (n, d) => String(+n.toFixed(d));
export function fmtShutter(t) {
  if (!t || !isFinite(t)) return '';
  if (t >= 1) return `${trimNum(t, 1)}s`;
  const d = 1 / t;
  return `1/${d >= 10 ? Math.round(d) : trimNum(d, 1)}s`;
}
export const fmtAperture = f => f ? `f/${trimNum(f, 1)}` : '';
export function fmtFocal(f, f35) {
  if (f35 && (!f || f < 12)) return `${Math.round(f35)}mm`;
  return f ? `${f < 10 ? trimNum(f, 1) : Math.round(f)}mm` : '';
}
export function parseDate(s) {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2})/.exec(s || '');
  return m ? { y: m[1], mo: m[2], d: m[3], h: m[4], mi: m[5] } : null;
}
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const DATE_FORMATS = {
  dots: d => `${d.y}.${d.mo}.${d.d}  ${d.h}:${d.mi}`,
  iso: d => `${d.y}-${d.mo}-${d.d} ${d.h}:${d.mi}`,
  dmy: d => `${d.d}/${d.mo}/${d.y}`,
  long: d => `${+d.d} ${MONTHS[+d.mo - 1]} ${d.y}`,
  us: d => `${MONTHS[+d.mo - 1].slice(0, 3)} ${+d.d}, ${d.y}`,
};
export const fmtDate = (d, fmt = 'dots') => d ? (DATE_FORMATS[fmt] || DATE_FORMATS.dots)(d) : '';
export const fmtStamp = d => `'${d.y.slice(2)}  ${+d.mo}  ${+d.d}`;
export function fmtGps(lat, lon) {
  if (lat == null || lon == null) return '';
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
}


// ---------- writing EXIF into exported JPEGs ----------
// The TIFF block (the EXIF data proper) from a JPEG's APP1 segment, or null.
export function jpegExifTiff(buf) {
  const u = new Uint8Array(buf);
  if (!(u[0] === 0xFF && u[1] === 0xD8)) return null;
  let o = 2;
  while (o + 10 < u.length) {
    if (u[o] !== 0xFF) { o++; continue; }
    const m = u[o + 1];
    if (m === 0xD9 || m === 0xDA) break;
    const len = (u[o + 2] << 8) | u[o + 3];
    if (m === 0xE1 && u[o + 4] === 0x45 && u[o + 5] === 0x78 && u[o + 6] === 0x69 && u[o + 7] === 0x66 &&
        u[o + 8] === 0 && u[o + 9] === 0 && isTiff(u, o + 10)) return u.slice(o + 10, o + 2 + len);
    o += 2 + len;
  }
  return null;
}

// A copy of the EXIF block fit for the framed image: orientation reset (the pixels are
// already upright), pixel size updated, the old embedded thumbnail dropped, and GPS
// wiped unless keepGps. Returns null if the block can't be read safely.
export function exifForExport(tiff, { keepGps = false, width = 0, height = 0 } = {}) {
  try {
    const t = tiff.slice();
    const dv = new DataView(t.buffer, t.byteOffset, t.byteLength);
    const le = t[0] === 0x49;
    const g16 = o => dv.getUint16(o, le), g32 = o => dv.getUint32(o, le);
    const p16 = (o, v) => dv.setUint16(o, v, le), p32 = (o, v) => dv.setUint32(o, v, le);
    const SZ = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
    const entries = off => { const n = g16(off); const a = []; for (let i = 0; i < n; i++) a.push(off + 2 + i * 12); return a; };
    const ifd0 = g32(4);
    let exifOff = 0, gpsOff = 0;
    for (const e of entries(ifd0)) {
      const tag = g16(e);
      if (tag === 0x0112) p16(e + 8, 1);
      if (tag === 0x8769) exifOff = g32(e + 8);
      if (tag === 0x8825) gpsOff = g32(e + 8);
    }
    p32(ifd0 + 2 + g16(ifd0) * 12, 0); // no IFD1: its thumbnail shows the unframed photo
    if (exifOff && width && height) {
      for (const e of entries(exifOff)) {
        const tag = g16(e), type = g16(e + 2);
        if (tag !== 0xA002 && tag !== 0xA003) continue;
        const val = tag === 0xA002 ? width : height;
        if (type === 3 && val <= 0xFFFF) p16(e + 8, val); else if (type === 4) p32(e + 8, val);
      }
    }
    if (gpsOff && !keepGps) {
      const list = entries(gpsOff);
      for (const e of list) {
        const total = (SZ[g16(e + 2)] || 1) * g32(e + 4);
        if (total > 4) { const vo = g32(e + 8); if (vo + total <= t.length) t.fill(0, vo, vo + total); }
      }
      t.fill(0, gpsOff + 2, gpsOff + 2 + list.length * 12 + 4);
      p16(gpsOff, 0);
    }
    return t;
  } catch (e) {
    return null;
  }
}

// Put an EXIF block into a JPEG (e.g. one made by canvas.toBlob), replacing any APP0/APP1.
export function insertExif(jpeg, tiff) {
  const u = jpeg instanceof Uint8Array ? jpeg : new Uint8Array(jpeg);
  if (!(u[0] === 0xFF && u[1] === 0xD8) || !tiff) return u;
  const segLen = tiff.length + 8;
  if (segLen > 0xFFFF) return u;
  let o = 2;
  while (u[o] === 0xFF && (u[o + 1] === 0xE0 || u[o + 1] === 0xE1)) o += 2 + ((u[o + 2] << 8) | u[o + 3]);
  const res = new Uint8Array(12 + tiff.length + (u.length - o));
  res.set([0xFF, 0xD8, 0xFF, 0xE1, segLen >> 8, segLen & 255, 0x45, 0x78, 0x69, 0x66, 0, 0], 0);
  res.set(tiff, 12);
  res.set(u.subarray(o), 12 + tiff.length);
  return res;
}

// Fill a line template like "{camera} | {focal} {aperture}". Empty placeholders are skipped
// along with the separator after them, so missing values don't leave stray separators.
export function expandLine(tpl, values) {
  const parts = String(tpl || '').split(/(\{\w+\})/); // literal, {key}, literal, {key}, ..., literal
  const n = (parts.length - 1) / 2;
  const vals = [];
  for (let i = 0; i < n; i++) vals.push(String(values[parts[2 * i + 1].slice(1, -1).toLowerCase()] ?? '').trim());
  if (n === 0) return parts[0].trim();
  const shown = vals.map((v, i) => v ? i : -1).filter(i => i >= 0);
  if (!shown.length) return '';
  let out = parts[0];
  shown.forEach((i, k) => {
    out += vals[i];
    if (k < shown.length - 1) out += parts[2 * i + 2];
  });
  if (shown[shown.length - 1] === n - 1) out += parts[parts.length - 1];
  return out.trim();
}
