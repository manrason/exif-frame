import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { parseExif, jpegExifTiff, exifForExport, insertExif, expandLine, fmtDate, parseDate } from '../src/exif.js';
import { crc32, makeZip } from '../src/zip.js';

const load = name => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const buf = u => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength);

test('camera data moves into a new JPEG, without GPS by default', () => {
  const tiff = jpegExifTiff(load('nikon.jpg'));
  assert.ok(tiff, 'reads the EXIF block');
  const out = insertExif(load('no-exif.jpg'), exifForExport(tiff, { width: 1080, height: 1350 }));
  const x = parseExif(buf(out));
  assert.equal(x.Model, 'NIKON Z 6_2');
  assert.equal(x.FNumber, 2.8);
  assert.equal(x.DateTimeOriginal, '2025:06:21 08:15:03');
  assert.equal(x.latitude, null, 'GPS is removed');
  assert.deepEqual([...out.slice(0, 4)], [0xFF, 0xD8, 0xFF, 0xE1]);
});

test('GPS stays when asked', () => {
  const tiff = exifForExport(jpegExifTiff(load('nikon.jpg')), { keepGps: true });
  const x = parseExif(buf(insertExif(load('no-exif.jpg'), tiff)));
  assert.ok(Math.abs(x.latitude - 48.8567) < 1e-3);
});

test('files without EXIF are left alone', () => {
  assert.equal(jpegExifTiff(load('no-exif.jpg')), null);
  const plain = load('no-exif.jpg');
  assert.equal(insertExif(plain, null), plain);
});

test('custom lines skip empty values and their separators', () => {
  const v = { camera: 'X-T5', lens: '', focal: '23mm', aperture: 'f/8', shutter: '', iso: 'ISO 160' };
  assert.equal(expandLine('{camera} | {focal} {aperture} {shutter} {iso}', v), 'X-T5 | 23mm f/8 ISO 160');
  assert.equal(expandLine('{lens} · {camera}', v), 'X-T5');
  assert.equal(expandLine('Shot on {camera}!', v), 'Shot on X-T5!');
  assert.equal(expandLine('{shutter}', v), '');
  assert.equal(expandLine('{CAMERA}', v), 'X-T5');
});

test('date formats', () => {
  const d = parseDate('2026:09:04 07:05:00');
  assert.equal(fmtDate(d, 'iso'), '2026-09-04 07:05');
  assert.equal(fmtDate(d, 'dmy'), '04/09/2026');
  assert.equal(fmtDate(d, 'long'), '4 September 2026');
  assert.equal(fmtDate(d, 'us'), 'Sep 4, 2026');
  assert.equal(fmtDate(null, 'iso'), '');
});

test('zip files open with standard tools', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const zip = makeZip([
    { name: 'a.jpg', data: load('nikon.jpg') },
    { name: 'photo é.txt', data: new TextEncoder().encode('hello') },
  ]);
  const dir = mkdtempSync(join(tmpdir(), 'zip-'));
  const file = join(dir, 'out.zip');
  writeFileSync(file, zip);
  const listing = execFileSync('python3', ['-c', 'import sys,zipfile;z=zipfile.ZipFile(sys.argv[1]);assert z.testzip() is None;print("|".join(z.namelist()))', file]).toString().trim();
  assert.equal(listing, 'a.jpg|photo é.txt');
});
