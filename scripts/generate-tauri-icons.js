import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const outDir = join(process.cwd(), "src-tauri", "icons");
mkdirSync(outDir, { recursive: true });

const pngSizes = [
  ["32x32.png", 32],
  ["128x128.png", 128],
  ["128x128@2x.png", 256],
  ["Square30x30Logo.png", 30],
  ["Square44x44Logo.png", 44],
  ["Square71x71Logo.png", 71],
  ["Square89x89Logo.png", 89],
  ["Square107x107Logo.png", 107],
  ["Square142x142Logo.png", 142],
  ["Square150x150Logo.png", 150],
  ["Square284x284Logo.png", 284],
  ["Square310x310Logo.png", 310],
  ["StoreLogo.png", 50]
];

for (const [name, size] of pngSizes) {
  writeFileSync(join(outDir, name), makePng(size));
}
writeFileSync(join(outDir, "icon.ico"), makeIco([16, 24, 32, 48, 64, 128, 256]));

function makePixels(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const cx = (size - 1) / 2;
  const cy = (size - 1) / 2;
  const radius = size * 0.44;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const dx = x - cx;
      const dy = y - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const edge = smoothstep(radius, radius - size * 0.06, dist);
      const glow = Math.max(0, 1 - dist / radius);
      const grid = (Math.abs((x % Math.max(3, Math.round(size / 8))) - 1) < 0.7 || Math.abs((y % Math.max(3, Math.round(size / 8))) - 1) < 0.7) ? 0.16 : 0;
      const r = Math.round((18 + 26 * glow + 15 * grid) * edge);
      const g = Math.round((65 + 86 * glow + 30 * grid) * edge);
      const b = Math.round((105 + 130 * glow + 40 * grid) * edge);
      pixels[i] = r;
      pixels[i + 1] = g;
      pixels[i + 2] = b;
      pixels[i + 3] = Math.round(255 * edge);
    }
  }
  drawLetter(pixels, size);
  return pixels;
}

function drawLetter(pixels, size) {
  const scale = size / 128;
  const strokes = [
    [36, 30, 16, 68],
    [52, 30, 34, 14],
    [52, 57, 29, 14],
    [52, 84, 36, 14]
  ];
  for (const [x, y, w, h] of strokes) fillRounded(pixels, size, x * scale, y * scale, w * scale, h * scale, 3 * scale);
}

function fillRounded(pixels, size, x, y, w, h, r) {
  for (let py = Math.floor(y); py < Math.ceil(y + h); py++) {
    for (let px = Math.floor(x); px < Math.ceil(x + w); px++) {
      const qx = Math.max(x + r, Math.min(px, x + w - r));
      const qy = Math.max(y + r, Math.min(py, y + h - r));
      if (Math.hypot(px - qx, py - qy) <= r + 0.75) {
        const i = (py * size + px) * 4;
        const alpha = pixels[i + 3] / 255;
        pixels[i] = Math.round(235 * alpha + pixels[i] * (1 - alpha));
        pixels[i + 1] = Math.round(244 * alpha + pixels[i + 1] * (1 - alpha));
        pixels[i + 2] = Math.round(255 * alpha + pixels[i + 2] * (1 - alpha));
        pixels[i + 3] = Math.max(pixels[i + 3], Math.round(245 * alpha));
      }
    }
  }
}

function makePng(size) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const pixels = makePixels(size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0;
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", makeIhdr(size)),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

function makeIhdr(size) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(size, 0);
  data.writeUInt32BE(size, 4);
  data[8] = 8;
  data[9] = 6;
  return data;
}

function chunk(type, data) {
  const name = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([len, name, data, crc]);
}

function makeIco(sizes) {
  const images = sizes.map((size) => makeDib(size));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const entries = Buffer.alloc(images.length * 16);
  let offset = 6 + entries.length;
  images.forEach((image, idx) => {
    const size = sizes[idx];
    const base = idx * 16;
    entries[base] = size >= 256 ? 0 : size;
    entries[base + 1] = size >= 256 ? 0 : size;
    entries[base + 2] = 0;
    entries[base + 3] = 0;
    entries.writeUInt16LE(1, base + 4);
    entries.writeUInt16LE(32, base + 6);
    entries.writeUInt32LE(image.length, base + 8);
    entries.writeUInt32LE(offset, base + 12);
    offset += image.length;
  });
  return Buffer.concat([header, entries, ...images]);
}

function makeDib(size) {
  const pixels = makePixels(size);
  const xor = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const src = (y * size + x) * 4;
      const dst = ((size - 1 - y) * size + x) * 4;
      xor[dst] = pixels[src + 2];
      xor[dst + 1] = pixels[src + 1];
      xor[dst + 2] = pixels[src];
      xor[dst + 3] = pixels[src + 3];
    }
  }
  const maskStride = Math.ceil(size / 32) * 4;
  const mask = Buffer.alloc(maskStride * size);
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8);
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(0, 16);
  header.writeUInt32LE(xor.length, 20);
  return Buffer.concat([header, xor, mask]);
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (const byte of buf) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function smoothstep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
