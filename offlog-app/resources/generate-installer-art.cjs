// Generates the Windows NSIS installer's welcome/finish sidebar image
// (offlog-desktop/src-tauri/installer-sidebar.bmp) from
// resources/source-logo.svg and the self-hosted Hanken Grotesk. Not part of
// the build pipeline; run manually from offlog-app/ whenever the logo, brand
// colour or wording changes, same convention as generate-icons.cjs:
//
//   node resources/generate-installer-art.cjs
//
// The page is drawn by headless Microsoft Edge (Windows only, like the
// desktop build), because the banner needs the brand font and an image
// library's SVG renderer can't load a webfont.
//
// Drawn at 1.5x (246x471, NSIS's 164x314 at 150%). MUI2's FitControl
// stretch resizes with a rough nearest-pixel filter, so the bitmap matches
// 150%, the most common laptop scaling, where it shows pixel for pixel; a 2x
// bitmap shrunk to 150% turned the small logo grainy. The layout below is
// written at 328x628 and zoomed to .75.
//
// Don't add a MUI_HEADERIMAGE_BITMAP. NSIS renders it at native size in
// the header control's top-left corner and fills the rest of that bar
// with the page's plain white background, so a coloured banner reads as a
// clashing square. There is no MUI2 define that recolours the remainder.
//
// NSIS needs classic uncompressed 24-bit BMP (no alpha): written by hand
// below (bottom-up rows, BGR, each row padded to 4 bytes).
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const W = 246, H = 471;
const ACCENT = '#575FCA'; // app.css --accent (light) / brand.md's only brand colour
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const SRC = path.join(__dirname, 'source-logo.svg');
const FONT = path.join(__dirname, '..', 'public', 'fonts', 'HankenGrotesk-variable.woff2');
const OUT = path.join(__dirname, '..', '..', 'offlog-desktop', 'src-tauri', 'installer-sidebar.bmp');
const fileUrl = p => 'file:///' + path.resolve(p).split(path.sep).join('/');

const svg = fs.readFileSync(SRC, 'utf8').replace(/<\?xml[^>]*>/, '')
  .replace(/fill="#000000"/g, 'fill="currentColor"').replace(/width="100%"/, 'width="100%" height="100%"');
const logo = (size, color, style = '') => `<div style="width:${size}px;height:${size}px;color:${color};${style}">${svg}</div>`;

// The website's line, under the name, on the accent; a large faint mark
// bleeds off the bottom-right corner.
const html = `<!doctype html><html><head><style>
@font-face { font-family: H; src: url(${fileUrl(FONT)}) format('woff2'); font-weight: 100 900; }
* { box-sizing: border-box; }
body { margin: 0; width: 328px; height: 628px; zoom: .75; overflow: hidden; position: relative; background: ${ACCENT}; font-family: H, sans-serif; color: #fff; }
.name { position: absolute; top: 40px; left: 34px; display: flex; align-items: center; gap: 12px; font-size: 30px; font-weight: 780; letter-spacing: -.03em; }
.line { position: absolute; left: 34px; bottom: 46px; font-size: 24px; font-weight: 700; line-height: 1.15; letter-spacing: -.02em; }
</style></head><body>
${logo(470, 'rgba(255, 255, 255, .14)', 'position:absolute;right:-170px;bottom:-120px')}
<div class="name">${logo(46, '#fff')}Offlog</div>
<div class="line">Your tasks.<br>Your devices.<br>Nobody else's.</div>
</body></html>`;

function render() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'offlog-installer-art-'));
  const page = path.join(dir, 'sidebar.html'), png = path.join(dir, 'sidebar.png');
  fs.writeFileSync(page, html);
  try {
    execFileSync(EDGE, ['--headless=new', '--inprivate', '--disable-sync', '--no-first-run', '--hide-scrollbars',
      `--user-data-dir=${path.join(dir, 'profile')}`, '--allow-file-access-from-files', '--force-device-scale-factor=1',
      `--window-size=${W},${H}`, '--virtual-time-budget=2000', `--screenshot=${png}`, fileUrl(page)], { stdio: 'ignore' });
    // Edge can return before the screenshot lands.
    for (let i = 0; i < 40 && !fs.existsSync(png); i++) execFileSync(process.execPath, ['-e', 'setTimeout(() => {}, 250)']);
    return fs.readFileSync(png);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// Just enough PNG decoding for Edge's screenshots: 8-bit RGB or RGBA,
// not interlaced. Returns tightly packed RGB.
function decodePng(buf) {
  let off = 8, width, height, channels;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off), type = buf.toString('ascii', off + 4, off + 8), data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0); height = data.readUInt32BE(4);
      const depth = data[8], color = data[9], interlace = data[12];
      if (depth !== 8 || ![2, 6].includes(color) || interlace) throw new Error(`unsupported PNG (depth ${depth}, colour ${color}, interlace ${interlace})`);
      channels = color === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(data);
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idat)), stride = width * channels;
  const px = Buffer.alloc(height * stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)], row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? px[y * stride + x - channels] : 0, b = y ? px[(y - 1) * stride + x] : 0;
      const c = x >= channels && y ? px[(y - 1) * stride + x - channels] : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
      px[y * stride + x] = (row[x] + pred) & 255;
    }
  }
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0, j = 0; i < px.length; i += channels, j += 3) { rgb[j] = px[i]; rgb[j + 1] = px[i + 1]; rgb[j + 2] = px[i + 2]; }
  return { width, height, rgb };
}

function toBmp24(rgb, width, height) {
  const rowSize = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + rowSize * height;
  const buf = Buffer.alloc(size);
  buf.write('BM', 0); buf.writeUInt32LE(size, 2); buf.writeUInt32LE(54, 10);
  buf.writeUInt32LE(40, 14); buf.writeInt32LE(width, 18); buf.writeInt32LE(height, 22);
  buf.writeUInt16LE(1, 26); buf.writeUInt16LE(24, 28); buf.writeUInt32LE(rowSize * height, 34);
  buf.writeInt32LE(2835, 38); buf.writeInt32LE(2835, 42);
  let o = 54;
  for (let y = height - 1; y >= 0; y--) {
    for (let x = 0; x < width; x++) { const i = (y * width + x) * 3; buf[o++] = rgb[i + 2]; buf[o++] = rgb[i + 1]; buf[o++] = rgb[i]; }
    o += rowSize - width * 3;
  }
  return buf;
}

const { width, height, rgb } = decodePng(render());
if (width !== W || height !== H) throw new Error(`rendered ${width}x${height}, expected ${W}x${H}`);
fs.writeFileSync(OUT, toBmp24(rgb, width, height));
console.log(`Wrote ${path.relative(process.cwd(), OUT)} (${W}x${H}).`);
