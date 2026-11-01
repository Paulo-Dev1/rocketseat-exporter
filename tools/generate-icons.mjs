/**
 * Gera os ícones PNG da extensão (assets/icons/iconXX.png) sem dependências
 * externas, usando apenas módulos nativos do Node.js.
 *
 * Uso: node tools/generate-icons.mjs
 * (Os PNGs já gerados ficam versionados; só é preciso rodar se o desenho mudar.)
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT_DIR = join(ROOT, 'assets', 'icons');
const SIZES = [16, 32, 48, 128];
const SUPERSAMPLING = 4;

const TOP_COLOR = [0x99, 0x6d, 0xff];
const BOTTOM_COLOR = [0x63, 0x3b, 0xbc];
const WHITE = [0xff, 0xff, 0xff];

function insideRoundedRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

function insideTriangle(px, py, [ax, ay], [bx, by], [cx, cy]) {
  const sign = (x1, y1, x2, y2, x3, y3) => (x1 - x3) * (y2 - y3) - (x2 - x3) * (y1 - y3);
  const d1 = sign(px, py, ax, ay, bx, by);
  const d2 = sign(px, py, bx, by, cx, cy);
  const d3 = sign(px, py, cx, cy, ax, ay);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** Desenho em coordenadas normalizadas (0..1): seta para baixo sobre uma base. */
function sample(x, y) {
  if (!insideRoundedRect(x, y, 0, 0, 1, 1, 0.22)) return null;
  const isGlyph =
    insideRoundedRect(x, y, 0.435, 0.18, 0.565, 0.56, 0.03) ||
    insideTriangle(x, y, [0.25, 0.46], [0.75, 0.46], [0.5, 0.72]) ||
    insideRoundedRect(x, y, 0.24, 0.77, 0.76, 0.86, 0.04);
  if (isGlyph) return WHITE;
  return TOP_COLOR.map((top, i) => Math.round(top + (BOTTOM_COLOR[i] - top) * y));
}

function renderIcon(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const n = SUPERSAMPLING;
  for (let py = 0; py < size; py += 1) {
    for (let px = 0; px < size; px += 1) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < n; sy += 1) {
        for (let sx = 0; sx < n; sx += 1) {
          const color = sample((px + (sx + 0.5) / n) / size, (py + (sy + 0.5) / n) / size);
          if (!color) continue;
          r += color[0];
          g += color[1];
          b += color[2];
          a += 1;
        }
      }
      const offset = (py * size + px) * 4;
      if (a) {
        pixels[offset] = Math.round(r / a);
        pixels[offset + 1] = Math.round(g / a);
        pixels[offset + 2] = Math.round(b / a);
        pixels[offset + 3] = Math.round((a / (n * n)) * 255);
      }
    }
  }
  return encodePng(size, size, pixels);
}

// --- Codificação PNG mínima (RGBA 8 bits) -----------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function encodePng(width, height, rgba) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    rows[y * (width * 4 + 1)] = 0; // filtro: nenhum
    rgba.copy(rows, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(rows)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUTPUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUTPUT_DIR, `icon${size}.png`);
  writeFileSync(file, renderIcon(size));
  console.log(`Gerado: ${file}`);
}

