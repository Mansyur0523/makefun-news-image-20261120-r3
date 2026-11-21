// "The World in One Day" — newspaper poster, Friday 20 November 2026.
// Node.js standard library ONLY (node:fs, node:zlib, node:crypto).
// No dependencies, no network, no runtime date/time, no randomness.
// Deterministic: same input code always produces the same entry.png.
//
// The PNG is encoded by hand: raw scanlines (filter 0 per row), zlib
// deflate, IHDR / IDAT / IEND chunks with a hand-rolled CRC32 table.
// Text is drawn from an embedded 5x7 bitmap font (no font engine exists
// in the Node standard library), scaled 1x-5x.

import { writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { createHash } from "node:crypto";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------- palette
type RGB = [number, number, number];
const PAPER: RGB = [247, 243, 232];
const INK: RGB = [17, 17, 17];
const RED: RGB = [200, 16, 46];
const RED_DARK: RGB = [140, 10, 30];
const GREY: RGB = [90, 86, 78];
const GREY_LT: RGB = [214, 208, 194];
const WHITE: RGB = [255, 255, 255];
const NAVY: RGB = [16, 24, 48];
const SKY: RGB = [178, 214, 235];
const SEA: RGB = [140, 190, 220];
const LAND: RGB = [214, 196, 150];
const GREEN: RGB = [46, 125, 70];
const BLUE: RGB = [31, 90, 160];
const TEAL: RGB = [13, 122, 116];
const BROWN: RGB = [122, 74, 30];
const PURPLE: RGB = [104, 66, 150];
const ORANGE: RGB = [232, 110, 20];
const YELLOW: RGB = [245, 200, 40];
const GOLD: RGB = [201, 162, 39];

// ---------------------------------------------------------------- CRC32
const CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}

function encodePNG(rgb: Buffer, w: number, h: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type 2 = RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0; // filter: none
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const idat = deflateSync(raw, { level: 9 });
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------- canvas
class Canvas {
  buf: Buffer;
  w: number;
  h: number;
  constructor(w: number, h: number, bg: RGB) {
    this.w = w;
    this.h = h;
    this.buf = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) {
      this.buf[i * 3] = bg[0];
      this.buf[i * 3 + 1] = bg[1];
      this.buf[i * 3 + 2] = bg[2];
    }
  }
  px(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 3;
    this.buf[i] = c[0];
    this.buf[i + 1] = c[1];
    this.buf[i + 2] = c[2];
  }
  rect(x: number, y: number, w: number, h: number, c: RGB): void {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) this.px(xx, yy, c);
  }
  // Bresenham line, with optional thickness
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, th = 1): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      if (th <= 1) this.px(x, y, c);
      else this.rect(x - ((th / 2) | 0), y - ((th / 2) | 0), th, th, c);
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }
  circle(cx: number, cy: number, r: number, c: RGB, fill = true): void {
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        const d = Math.sqrt(x * x + y * y);
        if (fill ? d <= r : d <= r && d > r - 1.5) this.px(cx + x, cy + y, c);
      }
  }
  // filled polygon, scanline fill
  poly(pts: Array<[number, number]>, c: RGB): void {
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minY = Math.min(minY, p[1]);
      maxY = Math.max(maxY, p[1]);
    }
    for (let y = minY; y <= maxY; y++) {
      const xs: number[] = [];
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        const b = pts[(i + 1) % pts.length];
        if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
          const t = (y - a[1]) / (b[1] - a[1]);
          xs.push(Math.round(a[0] + t * (b[0] - a[0])));
        }
      }
      xs.sort((p, q) => p - q);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let x = xs[k]; x <= xs[k + 1]; x++) this.px(x, y, c);
    }
  }
  // vertical gradient between two colors
  vgrad(x: number, y: number, w: number, h: number, top: RGB, bot: RGB): void {
    for (let yy = 0; yy < h; yy++) {
      const t = h <= 1 ? 0 : yy / (h - 1);
      const c: RGB = [
        Math.round(top[0] + (bot[0] - top[0]) * t),
        Math.round(top[1] + (bot[1] - top[1]) * t),
        Math.round(top[2] + (bot[2] - top[2]) * t),
      ];
      this.rect(x, y + yy, w, 1, c);
    }
  }
}

// ---------------------------------------------------------------- 5x7 font
// Each glyph: 7 rows of 5 cells, "#" = on, "." = off.
const GLYPHS: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "10001", "11111", "10001", "10001", "10001"],
  I: ["01110", "00100", "00100", "00100", "00100", "00100", "01110"],
  J: ["00111", "00010", "00010", "00010", "00010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10010", "01101"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  ".": ["00000", "00000", "00000", "00000", "00000", "01100", "01100"],
  ",": ["00000", "00000", "00000", "00000", "01100", "00100", "01000"],
  ":": ["00000", "01100", "01100", "00000", "01100", "01100", "00000"],
  ";": ["00000", "01100", "01100", "00000", "01100", "00100", "01000"],
  "!": ["00100", "00100", "00100", "00100", "00100", "00000", "00100"],
  "?": ["01110", "10001", "00001", "00110", "00100", "00000", "00100"],
  "'": ["00100", "00100", "01000", "00000", "00000", "00000", "00000"],
  '"': ["01010", "01010", "00000", "00000", "00000", "00000", "00000"],
  "-": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  "–": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "—": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "−": ["00000", "00000", "00000", "01110", "00000", "00000", "00000"],
  "(": ["00010", "00100", "01000", "01000", "01000", "00100", "00010"],
  ")": ["01000", "00100", "00010", "00010", "00010", "00100", "01000"],
  "/": ["00001", "00010", "00010", "00100", "01000", "01000", "10000"],
  "%": ["11001", "11010", "00010", "00100", "01000", "01011", "10011"],
  $: ["00100", "01111", "10100", "01110", "00101", "11110", "00100"],
  "€": ["00111", "01000", "10000", "11110", "10000", "01000", "00111"],
  "£": ["00110", "01000", "01000", "01110", "01000", "01000", "11111"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  "+": ["00000", "00100", "00100", "01110", "00100", "00100", "00000"],
  "=": ["00000", "00000", "11111", "00000", "11111", "00000", "00000"],
  "*": ["00000", "10101", "01110", "11111", "01110", "10101", "00000"],
  "•": ["00000", "00000", "01100", "01100", "00000", "00000", "00000"],
  _: ["00000", "00000", "00000", "00000", "00000", "00000", "11111"],
  "[": ["01110", "01000", "01000", "01000", "01000", "01000", "01110"],
  "]": ["01110", "00010", "00010", "00010", "00010", "00010", "01110"],
  ">": ["10000", "01000", "00100", "00010", "00100", "01000", "10000"],
  "<": ["00001", "00010", "00100", "01000", "00100", "00010", "00001"],
  "#": ["01010", "01010", "11111", "01010", "11111", "01010", "01010"],
  "@": ["01110", "10001", "10111", "10101", "10110", "10000", "01110"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

const CHAR_W = 6; // 5 px glyph + 1 px gap
const CHAR_H = 7;

function textWidth(s: string, scale: number): number {
  return s.length * CHAR_W * scale - scale;
}

function drawText(
  cv: Canvas,
  s: string,
  x: number,
  y: number,
  scale: number,
  c: RGB,
  bold = false,
): void {
  const up = s.toUpperCase();
  x = Math.floor(x);
  y = Math.floor(y);
  for (let i = 0; i < up.length; i++) {
    const g = GLYPHS[up[i]] || GLYPHS[" "];
    const ox = x + i * CHAR_W * scale;
    for (let r = 0; r < 7; r++)
      for (let col = 0; col < 5; col++) {
        if (g[r][col] !== "1") continue;
        const px0 = ox + col * scale;
        const py0 = y + r * scale;
        cv.rect(px0, py0, scale, scale, c);
        if (bold) cv.rect(px0 + scale, py0, 1, scale, c);
      }
  }
}

function drawTextCentered(
  cv: Canvas,
  s: string,
  cx: number,
  y: number,
  scale: number,
  c: RGB,
  bold = false,
): void {
  drawText(cv, s, cx - Math.floor(textWidth(s, scale) / 2), y, scale, c, bold);
}

// Greedy word wrap: returns lines that fit maxWidth at given scale.
function wrapText(s: string, scale: number, maxWidth: number): string[] {
  const words = s.split(" ");
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (textWidth(trial, scale) <= maxWidth || !cur) cur = trial;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

function drawWrapped(
  cv: Canvas,
  s: string,
  x: number,
  y: number,
  scale: number,
  maxWidth: number,
  c: RGB,
  lineH: number,
  maxLines = 99,
): number {
  const lines = wrapText(s, scale, maxWidth).slice(0, maxLines);
  lines.forEach((ln, i) => drawText(cv, ln, x, y + i * lineH, scale, c));
  return y + lines.length * lineH;
}

// ---------------------------------------------------------------- illustrations
// All artwork is drawn in code: rectangles, Bresenham lines, circles,
// polygons and gradients. Each of the 13 stories gets a distinct picture.

function illKyiv(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, [10, 14, 34], [38, 52, 96]);
  // stars
  const stars: Array<[number, number]> = [
    [8, 8], [30, 16], [58, 6], [84, 20], [110, 10], [140, 18], [170, 8],
    [200, 14], [230, 6], [260, 18], [290, 10], [44, 30], [150, 30], [250, 28],
  ];
  for (const [sx, sy] of stars) cv.px(x + sx, y + sy, WHITE);
  // missile trails (curved, drawn as short segments along a parabola)
  for (let t = 0; t <= 20; t++) {
    const px = x + 40 + t * 6;
    const py = y + 78 - Math.round(0.09 * (t - 10) * (t - 10)) + 8;
    cv.rect(px, py, 3, 2, [255, 214, 130]);
  }
  for (let t = 0; t <= 16; t++) {
    const px = x + 190 + t * 5;
    const py = y + 84 - Math.round(0.07 * (t - 8) * (t - 8)) + 6;
    cv.rect(px, py, 3, 2, [255, 214, 130]);
  }
  // missile dots
  cv.circle(x + 164, y + 20, 3, WHITE);
  cv.circle(x + 274, y + 26, 3, WHITE);
  // buildings
  const blds: Array<[number, number, number, number]> = [
    [0, 52, 42, 58], [48, 38, 34, 72], [88, 58, 46, 52], [140, 44, 38, 66],
    [184, 60, 44, 50], [234, 40, 36, 70], [276, 56, 44, 54],
  ];
  for (const [bx, by, bw, bh] of blds) {
    cv.rect(x + bx, y + by, bw, bh, [8, 10, 26]);
    for (let wy = by + 6; wy < by + bh - 4; wy += 9)
      for (let wx = bx + 5; wx < bx + bw - 4; wx += 9)
        if ((wx * 7 + wy * 3) % 5 !== 0) cv.rect(x + wx, y + wy, 4, 5, YELLOW);
  }
  // fires at the bottom
  cv.poly(
    [[x + 60, y + h], [x + 74, y + h - 22], [x + 88, y + h]],
    ORANGE,
  );
  cv.poly(
    [[x + 210, y + h], [x + 226, y + h - 26], [x + 242, y + h]],
    [255, 90, 20],
  );
  cv.circle(x + 74, y + h - 6, 8, [255, 160, 40]);
  cv.circle(x + 226, y + h - 6, 9, [255, 160, 40]);
}

function illCyclone(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, SEA);
  // landmass (India / Bay of Bengal coast) on the left
  cv.poly(
    [
      [x, y], [x + 150, y], [x + 138, y + 30], [x + 118, y + 52],
      [x + 96, y + 78], [x + 84, y + h], [x, y + h],
    ],
    LAND,
  );
  cv.poly(
    [
      [x + 150, y], [x + 210, y], [x + 205, y + 26], [x + 176, y + 40],
      [x + 138, y + 30],
    ],
    [196, 176, 128],
  );
  // coastline
  cv.line(x + 150, y, x + 138, y + 30, [90, 70, 40], 2);
  cv.line(x + 138, y + 30, x + 118, y + 52, [90, 70, 40], 2);
  cv.line(x + 118, y + 52, x + 96, y + 78, [90, 70, 40], 2);
  cv.line(x + 96, y + 78, x + 84, y + h, [90, 70, 40], 2);
  // cyclone spiral, centred off the coast
  const cx = x + 165;
  const cy = y + 62;
  for (let a = 0; a < 540; a += 6) {
    const r = 4 + a * 0.075;
    const px = Math.round(cx + r * Math.cos((a * Math.PI) / 180));
    const py = Math.round(cy + r * Math.sin((a * Math.PI) / 180) * 0.85);
    cv.rect(px - 1, py - 1, 3, 3, WHITE);
  }
  cv.circle(cx, cy, 6, WHITE);
  cv.circle(cx, cy, 3, [220, 235, 245]);
  drawText(cv, "AKVAN", cx - 16, cy - 34, 1, INK, true);
  drawText(cv, "BAY OF", x + w - 52, y + h - 22, 1, [20, 60, 90], true);
  drawText(cv, "BENGAL", x + w - 52, y + h - 12, 1, [20, 60, 90], true);
  drawText(cv, "GOPALPUR", x + 8, y + h - 12, 1, [90, 70, 40], true);
}

function illChart(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, WHITE);
  cv.rect(x, y, w, h, GREY_LT); // thin frame via border lines below
  cv.rect(x, y, w, 1, GREY);
  cv.rect(x, y + h - 1, w, 1, GREY);
  cv.rect(x, y, 1, h, GREY);
  cv.rect(x + w - 1, y, 1, h, GREY);
  // grid
  for (let gy = y + 22; gy < y + h - 14; gy += 20)
    cv.line(x + 8, gy, x + w - 8, gy, [228, 228, 228], 1);
  // descending red line with dots
  const pts: Array<[number, number]> = [
    [x + 14, y + 26], [x + 70, y + 34], [x + 120, y + 30], [x + 165, y + 52],
    [x + 210, y + 48], [x + 255, y + 74], [x + 300, y + 88],
  ];
  for (let i = 0; i + 1 < pts.length; i++)
    cv.line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], RED, 3);
  for (const [px, py] of pts) cv.circle(px, py, 4, RED);
  drawText(cv, "TAIWAN -6.2%", x + 30, y + 6, 1, RED, true);
  drawText(cv, "KOSPI -5.2%  NIKKEI -5.1%", x + 12, y + h - 12, 1, INK, true);
}

function illGlobe(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, [232, 240, 244]);
  const cx = x + 48;
  const cy = y + 26;
  cv.circle(cx, cy, 21, BLUE);
  cv.poly(
    [[cx - 16, cy - 6], [cx - 3, cy - 15], [cx + 7, cy - 5], [cx - 2, cy + 5], [cx - 13, cy + 8]],
    GREEN,
  );
  cv.poly(
    [[cx + 3, cy + 6], [cx + 15, cy + 3], [cx + 16, cy + 13], [cx + 6, cy + 18], [cx, cy + 11]],
    GREEN,
  );
  cv.circle(cx, cy, 21, BLUE, false);
  // thermometer
  cv.rect(x + 104, y + 8, 12, 32, WHITE);
  cv.rect(x + 104, y + 8, 12, 32, GREY);
  cv.rect(x + 106, y + 10, 8, 28, WHITE);
  cv.rect(x + 107, y + 26, 6, 13, RED);
  cv.circle(x + 110, y + 42, 7, RED);
  cv.circle(x + 110, y + 42, 4, [255, 120, 110]);
  drawText(cv, "1.5C", x + 122, y + 40, 1, RED, true);
}

function illFlags(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, [240, 236, 226]);
  // Union Jack (simplified)
  const ux = x + 8;
  const uy = y + 4;
  cv.rect(ux, uy, 76, 36, [1, 33, 105]);
  cv.rect(ux, uy + 14, 76, 8, WHITE);
  cv.rect(ux + 33, uy, 8, 36, WHITE);
  cv.rect(ux, uy + 16, 76, 4, RED);
  cv.rect(ux + 35, uy, 4, 36, RED);
  cv.line(ux, uy, ux + 76, uy + 36, WHITE, 2);
  cv.line(ux + 76, uy, ux, uy + 36, WHITE, 2);
  // EU flag
  const ex = x + 96;
  const ey = y + 4;
  cv.rect(ex, ey, 76, 36, [0, 51, 153]);
  for (let k = 0; k < 12; k++) {
    const a = (k * Math.PI) / 6;
    cv.circle(
      Math.round(ex + 38 + 12 * Math.cos(a)),
      Math.round(ey + 18 + 12 * Math.sin(a)),
      2,
      YELLOW,
    );
  }
  drawText(cv, "UK  +  EU", x + 62, y + h - 10, 1, INK, true);
}

function illBars(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, WHITE);
  cv.rect(x, y, w, h, GREY_LT);
  const base = y + h - 12;
  const bars: Array<[number, number, RGB, string]> = [
    [18, 20, BLUE, "2.3%"],
    [62, 19, TEAL, "2.2%"],
    [106, 26, RED, "3.0%"],
  ];
  for (const [bx, bh, c, lab] of bars) {
    cv.rect(x + bx, base - bh, 30, bh, c);
    drawText(cv, lab, x + bx - 2, base - bh - 10, 1, INK, true);
  }
  cv.line(x + 8, base, x + w - 8, base, INK, 2);
}

function illRig(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, [250, 238, 205], [232, 210, 160]);
  const bx = x + 70;
  const by = y + h - 8;
  cv.line(bx - 26, by, bx, y + 8, INK, 3);
  cv.line(bx + 26, by, bx, y + 8, INK, 3);
  cv.line(bx - 18, by - 18, bx + 18, by - 18, INK, 2);
  cv.line(bx - 12, by - 34, bx + 12, by - 34, INK, 2);
  cv.line(bx - 26, by, bx + 26, by, INK, 3);
  cv.rect(bx - 4, y + 4, 8, 10, RED);
  // pumpjack
  cv.line(x + 128, y + h - 8, x + 128, y + 30, INK, 2);
  cv.line(x + 118, y + 34, x + 158, y + 26, INK, 3);
  cv.line(x + 158, y + 26, x + 158, y + 44, INK, 2);
  cv.circle(x + 158, y + 46, 3, INK);
}

function illBallot(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, [238, 234, 224]);
  // ballot paper going in
  cv.poly(
    [[x + 84, y + 2], [x + 104, y + 2], [x + 102, y + 14], [x + 86, y + 14]],
    WHITE,
  );
  cv.line(x + 88, y + 6, x + 100, y + 6, RED, 2);
  cv.line(x + 88, y + 10, x + 100, y + 10, GREY, 1);
  cv.rect(x + 48, y + 16, 88, 26, [70, 90, 140]);
  cv.rect(x + 48, y + 12, 88, 6, [52, 68, 112]);
  cv.rect(x + 78, y + 13, 28, 4, INK);
  drawText(cv, "VOTE", x + 78, y + 24, 2, WHITE, true);
  drawText(cv, "3RD TERM?", x + 62, y + h - 9, 1, RED, true);
}

function illStrike(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, [226, 232, 238]);
  // rail sign: circle with bar
  const cx = x + 38;
  const cy = y + 22;
  cv.circle(cx, cy, 15, WHITE);
  cv.circle(cx, cy, 15, RED, false);
  cv.circle(cx, cy, 12, RED, false);
  cv.line(cx - 10, cy + 10, cx + 10, cy - 10, RED, 3);
  drawText(cv, "SCIOPERO 24H", x + 62, y + 19, 1, INK, true);
  // train strip at the bottom
  cv.rect(x + 8, y + h - 14, w - 16, 10, [40, 90, 130]);
  cv.rect(x + 16, y + h - 12, 22, 6, SKY);
  cv.rect(x + 48, y + h - 12, 22, 6, SKY);
  cv.rect(x + 80, y + h - 12, 22, 6, SKY);
  cv.circle(x + 28, y + h - 3, 2, YELLOW);
  cv.circle(x + 150, y + h - 3, 2, YELLOW);
}

function illCricket(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, [200, 230, 190], [150, 200, 140]);
  // bat (angled)
  cv.poly(
    [[x + 118, y + 8], [x + 128, y + 12], [x + 96, y + 52], [x + 86, y + 48]],
    [222, 184, 120],
  );
  cv.rect(x + 118, y + 6, 6, 12, [120, 82, 40]);
  cv.line(x + 121, y + 18, x + 121, y + 30, [120, 82, 40], 3);
  // ball
  cv.circle(x + 52, y + 44, 9, RED);
  cv.circle(x + 52, y + 44, 9, WHITE, false);
  // stumps
  cv.line(x + 150, y + h - 22, x + 150, y + h - 6, YELLOW, 3);
  cv.line(x + 158, y + h - 22, x + 158, y + h - 6, YELLOW, 3);
  cv.line(x + 166, y + h - 22, x + 166, y + h - 6, YELLOW, 3);
  drawText(cv, "118 PHILLIPS", x + 26, y + 6, 1, INK, true);
}

function illCourt(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, [234, 230, 220]);
  const bx = x + 22;
  const by = y + h - 10;
  // columns
  for (let i = 0; i < 4; i++) cv.rect(bx + i * 36, y + 26, 10, 30, WHITE);
  cv.rect(bx - 6, y + 56, 140, 6, GREY);
  // pediment
  cv.poly(
    [[bx - 10, y + 26], [bx + 64, y + 6], [bx + 138, y + 26]],
    [200, 190, 170],
  );
  cv.circle(bx + 64, y + 18, 5, GOLD);
}

function illTank(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, [222, 214, 190], [190, 178, 140]);
  const by = y + h - 18;
  // hull + turret + barrel
  cv.rect(x + 30, by - 14, 110, 14, [74, 90, 52]);
  cv.rect(x + 62, by - 26, 44, 12, [60, 76, 44]);
  cv.line(x + 106, by - 22, x + 168, by - 30, [60, 76, 44], 4);
  // wheels
  for (let i = 0; i < 5; i++) cv.circle(x + 44 + i * 20, by + 2, 6, INK);
  cv.circle(x + 44, by + 2, 3, GREY);
  cv.circle(x + 124, by + 2, 3, GREY);
  drawText(cv, "JURF AL-SAKHAR", x + 26, y + 6, 1, INK, true);
}

function illField(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.vgrad(x, y, w, h, [168, 200, 230], [220, 228, 235]);
  // field
  cv.rect(x, y + 40, w, h - 40, [120, 170, 80]);
  for (let fx = x + 10; fx < x + w; fx += 18)
    cv.line(fx, y + 44, fx + 6, y + h - 6, [100, 150, 66], 1);
  // crashed missile, nose down
  cv.line(x + 118, y + 8, x + 96, y + 44, [90, 90, 96], 5);
  cv.poly(
    [[x + 96, y + 44], [x + 90, y + 52], [x + 102, y + 52]],
    [60, 60, 66],
  );
  // smoke puffs
  cv.circle(x + 96, y + 52, 8, [235, 235, 235]);
  cv.circle(x + 108, y + 58, 6, [225, 225, 225]);
  cv.circle(x + 84, y + 58, 6, [225, 225, 225]);
  drawText(cv, "POLAND", x + 26, y + 6, 1, INK, true);
}

// ---------------------------------------------------------------- layout
const M = 24; // margin
const CW = W - 2 * M; // 976 content width

interface Lead {
  num: string;
  kicker: string;
  head: string;
  body: string;
  src: string;
  ill: (cv: Canvas, x: number, y: number, w: number, h: number) => void;
}

interface Feature {
  num: string;
  kicker: string;
  head: string;
  body: string;
  src: string;
  ill: (cv: Canvas, x: number, y: number, w: number, h: number) => void;
}

const LEADS: Lead[] = [
  {
    num: "1",
    kicker: "KYIV • UKRAINE",
    head: "Missiles strike Kyiv bridges in overnight barrage",
    body: "About 515 weapons — 27 ballistic and 84 cruise missiles plus 404 drones, Reuters reports — hit three bridges overnight. Eight to nine people were killed and power and water were cut across the capital.",
    src: "REUTERS",
    ill: illKyiv,
  },
  {
    num: "2",
    kicker: "CYCLONE AKVAN • INDIA",
    head: "Cyclone Akvan hits Odisha coast; 300,000 evacuated",
    body: "Akvan made landfall near Gopalpur around 08:00 with winds of 90–100 km/h, gusting to 110. More than 300,000 people were moved to safety, 423 rescue teams were deployed, and no deaths were reported.",
    src: "IMD • PTI",
    ill: illCyclone,
  },
  {
    num: "3",
    kicker: "AI SELL-OFF • MARKETS",
    head: "AI sell-off sweeps Asia as Taiwan sinks 6.2%",
    body: "Taiwan fell 6.2% in its worst week since 1991; Seoul's KOSPI dropped 5.2% below 5,000 and Tokyo's Nikkei 5.1%. The Nasdaq lost 5.3% and the S&P 3.7%.",
    src: "AP • REUTERS",
    ill: illChart,
  },
];

const FEATURES: Feature[] = [
  {
    num: "4",
    kicker: "COP31 • ANTALYA",
    head: "COP31 ends with no deal",
    body: "The final day closed without agreement: the draft omits fossil fuels, a $120bn finance gap remains.",
    src: "UN NEWS • REUTERS",
    ill: illGlobe,
  },
  {
    num: "5",
    kicker: "UK-EU • LONDON",
    head: "UK and EU strike first big post-Brexit 'reset'",
    body: "A deal on food trade, youth visas and a carbon link — the largest reset of relations since Brexit.",
    src: "REUTERS",
    ill: illFlags,
  },
  {
    num: "6",
    kicker: "JAPAN • TOKYO",
    head: "Japan inflation holds at 2.3% in October",
    body: "Core inflation was 2.2%, keeping the Bank of Japan in focus ahead of its next decision.",
    src: "REUTERS",
    ill: illBars,
  },
  {
    num: "7",
    kicker: "KENYA • TURKANA",
    head: "Kenya drills its first oil well",
    body: "Drilling begins in the Turkana basin; first oil is expected on 1 December.",
    src: "ALLAFRICA",
    ill: illRig,
  },
  {
    num: "8",
    kicker: "EL SALVADOR",
    head: "Bukele seeks a third term",
    body: "The president filed for a third term; voters decide on 28 February 2027.",
    src: "AP",
    ill: illBallot,
  },
  {
    num: "9",
    kicker: "ITALY • ROME",
    head: "General strike paralyses Italy over budget",
    body: "Workers and students marched nationwide in a 24-hour CGIL strike against the budget.",
    src: "REUTERS",
    ill: illStrike,
  },
  {
    num: "10",
    kicker: "CRICKET • WELLINGTON",
    head: "Phillips hits 118 as NZ beat India",
    body: "Glenn Phillips reached hundreds in every format in Wellington.",
    src: "ICC",
    ill: illCricket,
  },
  {
    num: "11",
    kicker: "SOUTH KOREA • SEOUL",
    head: "Ruling party moves to impeach top judge",
    body: "The move follows a ruling that overturned a conviction, the Korea Herald reports.",
    src: "KOREA HERALD",
    ill: illCourt,
  },
  {
    num: "12",
    kicker: "IRAQ",
    head: "Iraqi troops enter militia stronghold",
    body: "Soldiers moved into the Jurf al-Sakhar fortress in a rare operation against the militia.",
    src: "REUTERS",
    ill: illTank,
  },
  {
    num: "13",
    kicker: "POLAND",
    head: "Russian cruise missile crashes in Poland",
    body: "The missile came down in a field; two airports paused operations.",
    src: "REUTERS",
    ill: illField,
  },
];

const BRIEFS: string[] = [
  "Lviv — rail station strike kills two (BBC)",
  "Moscow — Russia says Estonia border closed (Reuters)",
  "Berlin — students strike against conscription (Al Jazeera)",
  "London — general: UK runs cyber attacks abroad (Sky News) — CLAIM",
  "Beijing — China holds loan rates for 18th month (Xinhua)",
  "Tokyo — SoftBank shares fall 14% in a day (Al Jazeera)",
  "Seoul — KOSPI ends week 7.9% lower (Anadolu)",
  "Ganjam — 209 mm rain as Akvan crossed Odisha (PTI)",
  "Lebanon — Israel air strikes hit south and east (Anadolu)",
  "Yemen — gunman fires on cargo ship off coast (UKMTO)",
  "Abuja — court bars new oil bids (Channels TV)",
  "Kampala — police told to enforce Ebola ban on rallies (allAfrica)",
  "Malawi — fuel crisis, overnight petrol queues (Al Jazeera)",
  "Africa — AfDB: 22 nations in debt distress (allAfrica)",
  "Las Vegas — Russell fastest in wet GP practice (Autosport)",
  "New York — Nasdaq futures down 1.6% pre-bell (24/7 Wall St)",
  "Washington — Democrats question law firms' free work (Al Jazeera) — FORECAST",
  "Wellington — Nicholls 175 in 216-run stand with Phillips (ICC)",
  "Brussels — EU agrees €1bn military aid for Kyiv (EU Council)",
  "Antalya — Panama asks COP31 to cap world oil output (Anadolu)",
  "Turin — ATP backs plan to lift player pay above $350m (Anadolu)",
  "Peru — 6.7 quake near Carhuamayo, felt in Lima (USGS)",
  "Space — BepiColombo reaches Mercury after 8-year trip (ESA • BBC)",
  "Sydney — Australian shares fall 1.8% (Reuters)",
  "Hormuz — 46 ships wait; Brent nears $92.50 (Straits Times)",
];

function drawHeader(cv: Canvas): number {
  let y = 12;
  drawTextCentered(
    cv,
    "THE WORLD IN ONE DAY • ALL THE NEWS THAT FITS ON ONE PAGE",
    W / 2,
    y,
    1,
    RED,
    true,
  );
  y += 16;
  drawTextCentered(cv, "FRIDAY 20 NOVEMBER 2026", W / 2, y, 5, INK, true);
  y += 5 * 7 + 8; // masthead height 35 + gap
  cv.rect(M, y, CW, 3, INK);
  y += 7;
  drawTextCentered(
    cv,
    "Kyiv bridges hit in overnight barrage • Cyclone Akvan lands in Odisha • Taiwan −6.2% in AI rout • COP31 ends without a deal",
    W / 2,
    y,
    1,
    INK,
  );
  y += 12;
  cv.rect(M, y, CW, 1, GREY);
  return y + 6;
}

function drawStats(cv: Canvas, y: number): number {
  const stats: Array<[string, string, string]> = [
    ["515", "weapons fired at Kyiv overnight", "Source: Reuters"],
    ["300,000+", "people evacuated for Cyclone Akvan", "Source: IMD"],
    ["-6.2%", "Taiwan stocks, worst week since 1991", "Source: AP"],
    ["2.3%", "Japan inflation, October", "Source: Reuters"],
    ["118", "runs: Glenn Phillips v India", "Source: ICC"],
    ["$3.8bn", "GTA VI day-one sales", "Source: Reuters"],
  ];
  const colW = CW / 6;
  for (let i = 0; i < stats.length; i++) {
    const x = M + Math.floor(i * colW);
    if (i > 0) cv.rect(x - 4, y + 2, 1, 56, GREY_LT);
    const [num, lab, src] = stats[i];
    drawText(cv, num, x + 4, y, 3, RED, true);
    const ly = drawWrapped(cv, lab, x + 4, y + 26, 1, Math.floor(colW) - 10, INK, 9, 2);
    drawText(cv, src, x + 4, ly + 2, 1, GREY);
  }
  return y + 62;
}

function drawRegions(cv: Canvas, y: number): number {
  const regs: Array<[string, RGB]> = [
    ["EUROPE", RED],
    ["MIDDLE EAST", BROWN],
    ["ASIA", BLUE],
    ["AFRICA", GREEN],
    ["AMERICAS", PURPLE],
    ["SPORT", TEAL],
    ["MARKETS", RED_DARK],
  ];
  const segW = CW / regs.length;
  for (let i = 0; i < regs.length; i++) {
    const x = M + Math.floor(i * segW);
    const w = Math.floor(segW) - 2;
    cv.rect(x, y, w, 20, regs[i][1]);
    drawTextCentered(cv, regs[i][0], x + w / 2, y + 7, 1, WHITE, true);
  }
  return y + 26;
}

function drawLeads(cv: Canvas, y: number): number {
  const gap = 8;
  const colW = Math.floor((CW - 2 * gap) / 3);
  const illH = 108;
  let maxEnd = y;
  for (let i = 0; i < LEADS.length; i++) {
    const x = M + i * (colW + gap);
    const L = LEADS[i];
    // illustration frame
    cv.rect(x, y, colW, illH, GREY_LT);
    L.ill(cv, x + 1, y + 1, colW - 2, illH - 2);
    // number badge on the illustration
    cv.circle(x + 14, y + 14, 10, RED);
    drawText(cv, L.num, x + 11, y + 11, 1, WHITE, true);
    let cy = y + illH + 8;
    drawText(cv, L.num + ". " + L.kicker, x, cy, 1, RED, true);
    cy += 12;
    cy = drawWrapped(cv, L.head, x, cy, 2, colW, INK, 18, 3);
    cy += 4;
    cy = drawWrapped(cv, L.body, x, cy, 1, colW, INK, 9, 5);
    cy += 3;
    drawText(cv, "SOURCE: " + L.src, x, cy, 1, GREY);
    cy += 10;
    cv.rect(x, cy, colW, 1, GREY_LT);
    maxEnd = Math.max(maxEnd, cy);
  }
  return maxEnd + 6;
}

function drawFeatures(cv: Canvas, y: number): number {
  const gap = 8;
  const cols = 5;
  const colW = Math.floor((CW - (cols - 1) * gap) / cols);
  const rowH = 132;
  const illH = 54;
  for (let r = 0; r < 2; r++) {
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      if (idx >= FEATURES.length) break;
      const F = FEATURES[idx];
      const x = M + c * (colW + gap);
      const yy = y + r * rowH;
      cv.rect(x, yy, colW, illH, GREY_LT);
      F.ill(cv, x + 1, yy + 1, colW - 2, illH - 2);
      cv.circle(x + 12, yy + 12, 9, RED);
      drawText(cv, F.num, x + 9, yy + 9, 1, WHITE, true);
      let cy = yy + illH + 5;
      drawText(cv, F.num + ". " + F.kicker, x, cy, 1, RED, true);
      cy += 11;
      cy = drawWrapped(cv, F.head, x, cy, 1, colW, INK, 9, 2);
      cy += 2;
      cy = drawWrapped(cv, F.body, x, cy, 1, colW, GREY, 9, 2);
      cy += 2;
      drawText(cv, "SOURCE: " + F.src, x, cy, 1, GREY);
    }
  }
  return y + 2 * rowH + 4;
}

function drawWorldMap(cv: Canvas, x: number, y: number, w: number, h: number): void {
  cv.rect(x, y, w, h, [196, 216, 232]); // sea
  // continents, rough shapes in muted green-tan
  const land: RGB = [168, 178, 120];
  // North America
  cv.poly(
    [[x + 18, y + 30], [x + 70, y + 18], [x + 118, y + 26], [x + 122, y + 52],
     [x + 92, y + 66], [x + 60, y + 62], [x + 30, y + 52]], land,
  );
  // South America
  cv.poly(
    [[x + 88, y + 84], [x + 128, y + 82], [x + 138, y + 108], [x + 118, y + 140],
     [x + 100, y + 118], [x + 86, y + 100]], land,
  );
  // Europe
  cv.poly(
    [[x + 218, y + 26], [x + 252, y + 20], [x + 268, y + 34], [x + 250, y + 48],
     [x + 224, y + 44]], land,
  );
  // Africa
  cv.poly(
    [[x + 222, y + 58], [x + 262, y + 54], [x + 282, y + 76], [x + 268, y + 106],
     [x + 240, y + 104], [x + 224, y + 80]], land,
  );
  // Asia
  cv.poly(
    [[x + 268, y + 22], [x + 360, y + 14], [x + 420, y + 26], [x + 424, y + 52],
     [x + 380, y + 70], [x + 330, y + 64], [x + 300, y + 48], [x + 272, y + 40]],
    land,
  );
  // SE Asia / Indonesia
  cv.poly(
    [[x + 372, y + 74], [x + 404, y + 72], [x + 400, y + 84], [x + 370, y + 86]],
    land,
  );
  // Australia
  cv.poly(
    [[x + 386, y + 108], [x + 424, y + 106], [x + 430, y + 124], [x + 396, y + 130],
     [x + 380, y + 120]], land,
  );
  // graticule
  for (let gx = x + 40; gx < x + w; gx += 40)
    cv.line(gx, y, gx, y + h, [170, 196, 214], 1);
  for (let gy = y + 30; gy < y + h; gy += 30)
    cv.line(x, gy, x + w, gy, [170, 196, 214], 1);
  // pins 1-13 (stories with illustrations)
  const pins: Array<[number, number, string]> = [
    [250, 30, "1"], // Kyiv
    [352, 62, "2"], // Odisha
    [412, 56, "3"], // Taiwan
    [262, 44, "4"], // Antalya
    [218, 28, "5"], // London
    [418, 40, "6"], // Tokyo
    [258, 82, "7"], // Turkana
    [58, 72, "8"], // El Salvador
    [232, 42, "9"], // Rome
    [436, 138, "10"], // Wellington
    [404, 46, "11"], // Seoul
    [282, 52, "12"], // Jurf al-Sakhar
    [244, 18, "13"], // Poland
  ];
  for (const [px, py, n] of pins) {
    cv.circle(x + px, y + py, 6, RED);
    cv.circle(x + px, y + py, 6, WHITE, false);
    const ox = n.length > 1 ? x + px - 6 : x + px - 3;
    drawText(cv, n, ox, y + py - 3, 1, WHITE, true);
  }
  drawText(cv, "WORLD MAP — STORIES 1-13", x + 4, y + h - 12, 1, INK, true);
}

function drawBottom(cv: Canvas, y: number): number {
  const h = 196;
  const mapW = 470;
  const alsoX = M + mapW + 16;
  const alsoW = W - M - alsoX;
  drawText(cv, "WORLD MAP — STORIES 1–13", M, y, 1, RED, true);
  drawWorldMap(cv, M, y + 12, mapW, h - 12);
  drawText(cv, "ALSO ON FRIDAY 20 NOVEMBER", alsoX, y, 1, RED, true);
  let cy = y + 13;
  for (const b of BRIEFS) {
    const lines = wrapText("• " + b, 1, alsoW);
    for (const ln of lines) {
      drawText(cv, ln, alsoX, cy, 1, INK);
      cy += 8;
    }
  }
  return y + h + 6;
}

function drawDateCheck(cv: Canvas, y: number): number {
  const h = 46;
  cv.rect(M, y, CW, h, [255, 252, 240]);
  cv.rect(M, y, CW, 1, RED);
  cv.rect(M, y + h - 1, CW, 1, RED);
  cv.rect(M, y, 1, h, RED);
  cv.rect(M + CW - 1, y, 1, h, RED);
  drawText(cv, "DATE CHECK — WHAT WE LEFT OUT, AND WHY", M + 8, y + 5, 1, RED, true);
  const txt =
    "LEFT OUT ON PURPOSE — Thursday 19 Nov: the ICJ ruling on Myanmar; the Trump–Xi–Putin summit in Shenzhen; " +
    "the APEC Shenzhen declaration; the second COP31 draft; the Riyadh tower attack; Colombia tax protests; " +
    "Wall Street's 2% fall. Saturday 21 Nov: BepiColombo's Mercury orbit entry. Not yet published at press time: " +
    "the COP31 final text and Asia's closing prices.";
  drawWrapped(cv, txt, M + 8, y + 17, 1, CW - 16, INK, 9, 3);
  return y + h + 6;
}

function drawFooter(cv: Canvas, y: number): void {
  drawTextCentered(
    cv,
    "All figures sourced as labelled; unconfirmed items are marked CLAIM or FORECAST. Prices at press time.",
    W / 2,
    y,
    1,
    GREY,
  );
  drawTextCentered(
    cv,
    "THE WORLD IN ONE DAY • FRIDAY 20 NOVEMBER 2026 • 38 STORIES, 13 ILLUSTRATIONS",
    W / 2,
    y + 11,
    1,
    INK,
    true,
  );
}

// ---------------------------------------------------------------- main
function main(): void {
  const cv = new Canvas(W, H, PAPER);
  let y = drawHeader(cv);
  y = drawStats(cv, y);
  y = drawRegions(cv, y);
  y = drawLeads(cv, y);
  y = drawFeatures(cv, y);
  y = drawBottom(cv, y);
  y = drawDateCheck(cv, y);
  drawFooter(cv, y);
  const png = encodePNG(cv.buf, W, H);
  writeFileSync("entry.png", png);
  const hash = createHash("sha256").update(png).digest("hex");
  console.log(`entry.png ${png.length} bytes sha256=${hash}`);
}

main();
