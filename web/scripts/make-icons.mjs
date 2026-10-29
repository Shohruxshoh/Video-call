// Renders the app icons (girih star on turquoise) to PNG with no image libraries.
// Run with `npm run icons -w web`; output goes to web/public/icons.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync, crc32 } from 'node:zlib';

const OUT = new URL('../public/icons/', import.meta.url);
const BG = [0x0f, 0x7f, 0x80];
const STAR_COLOR = [0xf2, 0xf5, 0xf6];
const CORE_COLOR = [0x2d, 0x4a, 0x9a];
const SAMPLES = 4;

function star(cx, cy, r, rotation = 0) {
  const inner = r * Math.cos(Math.PI / 4) / Math.cos(Math.PI / 8);
  const pts = [];
  for (let k = 0; k < 16; k++) {
    const a = -Math.PI / 2 + rotation + (k * Math.PI) / 8;
    const rad = k % 2 ? inner : r;
    pts.push([cx + rad * Math.cos(a), cy + rad * Math.sin(a)]);
  }
  return pts;
}

function inside(pts, x, y) {
  let hit = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

function inRoundedSquare(size, radius, x, y) {
  const dx = Math.max(radius - x, 0, x - (size - radius));
  const dy = Math.max(radius - y, 0, y - (size - radius));
  return dx * dx + dy * dy <= radius * radius;
}

function render(size, { rounded }) {
  const outer = star(size / 2, size / 2, size * 0.3);
  const core = star(size / 2, size / 2, size * 0.13, Math.PI / 8);
  const px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SAMPLES; sy++) {
        for (let sx = 0; sx < SAMPLES; sx++) {
          const fx = x + (sx + 0.5) / SAMPLES;
          const fy = y + (sy + 0.5) / SAMPLES;
          if (rounded && !inRoundedSquare(size, size * 0.22, fx, fy)) continue;
          const c = inside(core, fx, fy) ? CORE_COLOR : inside(outer, fx, fy) ? STAR_COLOR : BG;
          r += c[0];
          g += c[1];
          b += c[2];
          a += 255;
        }
      }
      const n = SAMPLES * SAMPLES;
      const covered = a / 255;
      const i = (y * size + x) * 4;
      px[i] = covered ? r / covered : 0;
      px[i + 1] = covered ? g / covered : 0;
      px[i + 2] = covered ? b / covered : 0;
      px[i + 3] = a / n;
    }
  }
  return png(size, px);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) rgba.copy(rows, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
const files = {
  'icon-192.png': render(192, { rounded: true }),
  'icon-512.png': render(512, { rounded: true }),
  // Maskable and Apple icons are full-bleed; the OS applies its own shape.
  'icon-maskable-512.png': render(512, { rounded: false }),
  'apple-touch-icon.png': render(180, { rounded: false }),
};
for (const [name, data] of Object.entries(files)) {
  writeFileSync(new URL(name, OUT), data);
  console.log(`${name}: ${(data.length / 1024).toFixed(1)} KB`);
}
