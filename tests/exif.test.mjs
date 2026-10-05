import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseExif, cameraName, fmtShutter, fmtAperture, fmtFocal, parseDate, fmtDate, fmtStamp, fmtGps,
} from '../src/exif.js';

const load = name => {
  const b = readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
};

test('reads camera, exposure, date and GPS from a camera JPEG', () => {
  const x = parseExif(load('nikon.jpg'));
  assert.equal(x.Make, 'NIKON CORPORATION');
  assert.equal(x.Model, 'NIKON Z 6_2');
  assert.equal(x.LensModel, 'NIKKOR Z 50mm f/1.8 S');
  assert.equal(x.ExposureTime, 1 / 500);
  assert.equal(x.FNumber, 2.8);
  assert.equal(x.ISO, 400);
  assert.equal(x.FocalLength, 50);
  assert.equal(x.DateTimeOriginal, '2025:06:21 08:15:03');
  assert.ok(Math.abs(x.latitude - 48.8567) < 1e-3);
  assert.ok(Math.abs(x.longitude + 2.35) < 1e-3, 'west longitude is negative');
});

test('returns null when a file has no EXIF', () => {
  assert.equal(parseExif(load('no-exif.jpg')), null);
});

test('phones use the 35mm-equivalent focal length', () => {
  const x = parseExif(load('iphone.jpg'));
  assert.equal(cameraName(x.Make, x.Model), 'iPhone 15 Pro');
  assert.equal(fmtFocal(x.FocalLength, x.FocalLength35), '24mm');
  assert.equal(fmtAperture(x.FNumber), 'f/1.8');
});

test('camera names drop corporate suffixes and repeated brands', () => {
  assert.equal(cameraName('NIKON CORPORATION', 'NIKON Z 6_2'), 'Nikon Z 6II');
  assert.equal(cameraName('Canon', 'Canon EOS R5'), 'Canon EOS R5');
  assert.equal(cameraName('FUJIFILM', 'X-T5'), 'Fujifilm X-T5');
  assert.equal(cameraName('SONY', 'ILCE-7M4'), 'Sony ILCE-7M4');
  assert.equal(cameraName('', 'X100VI'), 'X100VI');
});

test('exposure values format like a camera display', () => {
  assert.equal(fmtShutter(1 / 250), '1/250s');
  assert.equal(fmtShutter(1 / 4), '1/4s');
  assert.equal(fmtShutter(0.4), '1/2.5s');
  assert.equal(fmtShutter(2), '2s');
  assert.equal(fmtShutter(0), '');
  assert.equal(fmtAperture(8), 'f/8');
  assert.equal(fmtFocal(23), '23mm');
  assert.equal(fmtFocal(0, 0), '');
});

test('dates and coordinates', () => {
  const d = parseDate('2026:09:14 19:42:10');
  assert.equal(fmtDate(d), '2026.09.14  19:42');
  assert.equal(fmtStamp(d), "'26  9  14");
  assert.equal(parseDate('nonsense'), null);
  assert.equal(fmtGps(-33.8688, 151.2093), '33.8688° S, 151.2093° E');
  assert.equal(fmtGps(null, 2), '');
});
