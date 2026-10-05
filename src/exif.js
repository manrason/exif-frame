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
export const fmtDate = d => d ? `${d.y}.${d.mo}.${d.d}  ${d.h}:${d.mi}` : '';
export const fmtStamp = d => `'${d.y.slice(2)}  ${+d.mo}  ${+d.d}`;
export function fmtGps(lat, lon) {
  if (lat == null || lon == null) return '';
  return `${Math.abs(lat).toFixed(4)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(4)}° ${lon >= 0 ? 'E' : 'W'}`;
}

