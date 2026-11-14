// Pixel-art toolkit for the interface: two bitmap fonts drawn in code, a <px-t> element that
// renders text with them, and ordered-dither patterns. No font or image files.
//
// The interface is two tones and an accent. Every in-between shade is a dither pattern, and every
// length is a whole number of "logical pixels" (1em inside #ui), so the art stays on one grid.

export const PAPER = '#efe9dc', INK = '#0e1116', ACCENT = '#ff7a1a';
const COLORS = { paper: PAPER, ink: INK, accent: ACCENT };

// Glyphs: rows top to bottom, '#' is a set pixel. A glyph is as wide as its rows are long, so
// narrow letters and punctuation take less room; digits all share one width so timers do not jitter.
const BODY = `
A .###. #...# #...# ##### #...# #...# #...#
B ####. #...# #...# ####. #...# #...# ####.
C .###. #...# #.... #.... #.... #...# .###.
D ####. #...# #...# #...# #...# #...# ####.
E ##### #.... #.... ####. #.... #.... #####
F ##### #.... #.... ####. #.... #.... #....
G .###. #...# #.... #.### #...# #...# .###.
H #...# #...# #...# ##### #...# #...# #...#
I ### .#. .#. .#. .#. .#. ###
J ..### ...#. ...#. ...#. ...#. #..#. .##..
K #...# #..#. #.#.. ##... #.#.. #..#. #...#
L #.... #.... #.... #.... #.... #.... #####
M #...# ##.## #.#.# #.#.# #...# #...# #...#
N #...# ##..# #.#.# #..## #...# #...# #...#
O .###. #...# #...# #...# #...# #...# .###.
P ####. #...# #...# ####. #.... #.... #....
Q .###. #...# #...# #...# #.#.# #..#. .##.#
R ####. #...# #...# ####. #.#.. #..#. #...#
S .#### #.... #.... .###. ....# ....# ####.
T ##### ..#.. ..#.. ..#.. ..#.. ..#.. ..#..
U #...# #...# #...# #...# #...# #...# .###.
V #...# #...# #...# #...# #...# .#.#. ..#..
W #...# #...# #...# #.#.# #.#.# ##.## #...#
X #...# #...# .#.#. ..#.. .#.#. #...# #...#
Y #...# #...# .#.#. ..#.. ..#.. ..#.. ..#..
Z ##### ....# ...#. ..#.. .#... #.... #####
0 .###. #...# #..## #.#.# ##..# #...# .###.
1 ..#.. .##.. ..#.. ..#.. ..#.. ..#.. .###.
2 .###. #...# ....# ...#. ..#.. .#... #####
3 ####. ....# ....# .###. ....# ....# ####.
4 ...#. ..##. .#.#. #..#. ##### ...#. ...#.
5 ##### #.... ####. ....# ....# #...# .###.
6 .###. #.... #.... ####. #...# #...# .###.
7 ##### ....# ...#. ..#.. .#... .#... .#...
8 .###. #...# #...# .###. #...# #...# .###.
9 .###. #...# #...# .#### ....# ....# .###.
SP ... ... ... ... ... ... ...
. . . . . . . #
, .. .. .. .. .. .# #.
: . . # . . # .
- ... ... ... ### ... ... ...
+ ... ... .#. ### .#. ... ...
/ ..# ..# .#. .#. .#. #.. #..
% #...# #..#. ...#. ..#.. .#... .#..# #...#
! # # # # # . #
? .###. #...# ....# ...#. ..#.. ..... ..#..
( .# #. #. #. #. #. .#
) #. .# .# .# .# .# #.
' # # . . . . .
= ... ... ### ... ### ... ...
> ... #.. .#. ..# .#. #.. ...
< ... ..# .#. #.. .#. ..# ...
# .#.#. .#.#. ##### .#.#. ##### .#.#. .#.#.
DOT . . . # . . .
DOWN ####### ####### .#####. ..###.. ..###.. ...#... .......
`;
const TINY = `
A .#. #.# ### #.# #.#
B ##. #.# ##. #.# ##.
C .## #.. #.. #.. .##
D ##. #.# #.# #.# ##.
E ### #.. ##. #.. ###
F ### #.. ##. #.. #..
G .## #.. #.# #.# .##
H #.# #.# ### #.# #.#
I # # # # #
J ..# ..# ..# #.# .#.
K #.# #.# ##. #.# #.#
L #.. #.. #.. #.. ###
M #...# ##.## #.#.# #...# #...#
N #..# ##.# #.## #..# #..#
O .#. #.# #.# #.# .#.
P ##. #.# ##. #.. #..
Q .#. #.# #.# ### .##
R ##. #.# ##. #.# #.#
S .## #.. .#. ..# ##.
T ### .#. .#. .#. .#.
U #.# #.# #.# #.# ###
V #.# #.# #.# #.# .#.
W #...# #...# #.#.# ##.## #...#
X #.# #.# .#. #.# #.#
Y #.# #.# .#. .#. .#.
Z ### ..# .#. #.. ###
0 ### #.# #.# #.# ###
1 .#. ##. .#. .#. ###
2 ##. ..# .#. #.. ###
3 ##. ..# .#. ..# ##.
4 #.# #.# ### ..# ..#
5 ### #.. ##. ..# ##.
6 .## #.. ### #.# ###
7 ### ..# .#. .#. .#.
8 ### #.# ### #.# ###
9 ### #.# ### ..# ##.
SP .. .. .. .. ..
. . . . . #
, .. .. .. .# #.
: . # . # .
- .. .. ## .. ..
+ ... .#. ### .#. ...
/ ..# ..# .#. #.. #..
% #.# ..# .#. #.. #.#
! # # # . #
? ##. ..# .#. ... .#.
( .# #. #. #. .#
) #. .# .# .# #.
' # # . . .
= ... ### ... ### ...
> #.. .#. ..# .#. #..
< ..# .#. #.. .#. ..#
DOT . . # . .
DOWN ##### ##### .###. .###. ..#..
`;
const NAMES = { SP: ' ', DOT: '·', DOWN: '▼' };
function parse(src) {
  const glyphs = new Map();
  let h = 0;
  for (const line of src.trim().split('\n')) {
    const [name, ...rows] = line.trim().split(/\s+/);
    h = rows.length;
    const px = [];
    rows.forEach((r, y) => { for (let x = 0; x < r.length; x++) if (r[x] === '#') px.push(x, y); });
    glyphs.set(NAMES[name] || name, { w: rows[0].length, px });
  }
  return { glyphs, h, line: h + 2 };
}
const FONTS = { b: parse(BODY), t: parse(TINY) };
// characters the fonts lack fall back to the nearest they have (the interface is all capitals)
const ALIAS = { '−': '-', '–': '-', '—': '-', '"': "'", '’': "'", ';': ',', '_': '-', '*': '·', '[': '(', ']': ')', '&': '+' };

const glyph = (font, ch) => font.glyphs.get(ch) || font.glyphs.get(ALIAS[ch]) || font.glyphs.get('?');
const measure = (font, s) => { let w = 0; for (const ch of s) w += glyph(font, ch).w + 1; return Math.max(w - 1, 0); };

// Break text into lines no wider than maxW font pixels (0: only at explicit newlines).
function layout(font, text, maxW) {
  const lines = [];
  for (const para of text.split('\n')) {
    if (!maxW) { lines.push(para); continue; }
    let cur = '';
    for (const word of para.split(' ')) {
      const next = cur ? cur + ' ' + word : word;
      if (cur && measure(font, next) > maxW) { lines.push(cur); cur = word; } else cur = next;
    }
    lines.push(cur);
  }
  return lines;
}

// Draw text into a canvas at one canvas pixel per font pixel. Returns [width, height].
export function drawText(canvas, text, { font = 'b', color = 'paper', outline = false, wrap = 0, align = 'left' } = {}) {
  const F = FONTS[font] || FONTS.b;
  const lines = layout(F, text.toUpperCase(), wrap);
  const o = outline ? 1 : 0;
  const W = Math.max(...lines.map((l) => measure(F, l)), 1) + 2 * o;
  const H = lines.length * F.line - 2 + 2 * o;
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  const pass = (fill, grow) => {
    c.fillStyle = fill;
    lines.forEach((l, i) => {
      const lw = measure(F, l);
      let x = o + (align === 'center' ? Math.floor((W - 2 * o - lw) / 2) : align === 'right' ? W - 2 * o - lw : 0);
      const y = o + i * F.line;
      for (const ch of l) {
        const g = glyph(F, ch);
        for (let k = 0; k < g.px.length; k += 2) c.fillRect(x + g.px[k] - grow, y + g.px[k + 1] - grow, 1 + 2 * grow, 1 + 2 * grow);
        x += g.w + 1;
      }
    });
  };
  // the outline keeps text readable over a bright sea or sky
  if (outline) pass(INK, 1);
  pass(COLORS[color] || color, 0);
  return [W, H];
}

// <px-t>: text in the bitmap font. Its text content is the text; change it and it redraws.
// Attributes: f="t" tiny font, s="2" integer scale, c="paper|ink|accent", o outline, w="120" wrap
// width in font pixels, a="center|right" alignment of wrapped lines.
class PxText extends HTMLElement {
  static get observedAttributes() { return ['f', 's', 'c', 'o', 'w', 'a']; }
  connectedCallback() {
    if (!this.cv) {
      const root = this.attachShadow({ mode: 'open' });
      root.innerHTML = '<style>:host{display:inline-block;vertical-align:middle;line-height:0}canvas{display:block;image-rendering:pixelated}</style>';
      this.cv = document.createElement('canvas');
      root.appendChild(this.cv);
      new MutationObserver(() => this.draw()).observe(this, { childList: true, characterData: true, subtree: true });
    }
    this.draw();
  }
  attributeChangedCallback() { if (this.cv) this.draw(); }
  draw() {
    const a = (k) => this.getAttribute(k);
    const text = this.textContent, key = [text, a('f'), a('s'), a('c'), a('o'), a('w'), a('a')].join('|');
    if (key === this.key) return;
    this.key = key;
    const s = Number(a('s')) || 1;
    const [w, h] = drawText(this.cv, text, { font: a('f') || 'b', color: a('c') || 'paper', outline: this.hasAttribute('o'), wrap: Number(a('w')) || 0, align: a('a') || 'left' });
    this.cv.style.width = `${w * s}em`;
    this.cv.style.height = `${h * s}em`;
    this.setAttribute('aria-label', text);
  }
}
if (!customElements.get('px-t')) customElements.define('px-t', PxText);

// markup helper: T('Start', 's=2 c=ink')
export const T = (text, attrs = '') => `<px-t ${attrs}>${text}</px-t>`;

// Ordered (Bayer 4x4) dither: `level` of 16 pixels are `fg`, the rest `bg` (null: transparent).
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export function dither(level, fg, bg = null) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 4;
  const c = cv.getContext('2d');
  if (bg) { c.fillStyle = bg; c.fillRect(0, 0, 4, 4); }
  c.fillStyle = fg;
  for (let i = 0; i < 16; i++) if (BAYER[i] < level) c.fillRect(i % 4, i >> 2, 1, 1);
  return `url(${cv.toDataURL()})`;
}

// Size of one logical pixel in CSS pixels: a whole number of device pixels, about 1/360 of the
// window height, so a 1080p screen is a 640x360 canvas of 3x3 blocks.
export function unit() {
  const dpr = window.devicePixelRatio || 1;
  return Math.max(1, Math.round((innerHeight * dpr) / 360)) / dpr;
}

// Line and block drawing on a small canvas without anti-aliasing (the minimap).
export class Bitmap {
  constructor(canvas, w, h) {
    canvas.width = w; canvas.height = h;
    this.w = w; this.h = h;
    this.c = canvas.getContext('2d');
  }
  clear() { this.c.clearRect(0, 0, this.w, this.h); }
  block(x, y, r, color) { this.c.fillStyle = color; this.c.fillRect(Math.round(x) - r, Math.round(y) - r, 2 * r + 1, 2 * r + 1); }
  // Bresenham; r is the half-thickness in pixels
  line(x0, y0, x1, y1, r, color) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    this.c.fillStyle = color;
    for (let n = 0; n < 4096; n++) {
      this.c.fillRect(x0 - r, y0 - r, 2 * r + 1, 2 * r + 1);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }
}
