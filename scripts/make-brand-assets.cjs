/**
 * Draws the app icon and the installer pictures from the THETA172 brand
 * (the Ti mark, the THETA172 wordmark, #070505 and #f4473a) into build-assets/.
 *
 *   node scripts/make-brand-assets.cjs
 *
 * The installer pictures must be real 24-bit BMP files (NSIS shows nothing,
 * or fails, with anything else), so they are written by hand here.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const out = path.join(__dirname, '..', 'build-assets');
const BG = '#070505';
const RED = '#f4473a';
const FG = '#f4ede9';

const MARK = '<rect x="0" y="60" width="134" height="40"/><rect x="51" y="100" width="48" height="83"/><rect x="134" y="100" width="35" height="83"/><rect x="141" y="35" width="26" height="26"/><rect x="173" y="0" width="35" height="34"/>';
const WORD = (fg) => `<g stroke="${fg}"><path d="M0 .6H10M5 .6V14"/><path transform="translate(19 0)" d="M.6 0V14M9.4 0V14M.6 7H9.4"/><path transform="translate(38 0)" d="M10 .6H.6V13.4H10M.6 7H9"/><path transform="translate(57 0)" d="M0 .6H10M5 .6V14"/><path transform="translate(76 0)" d="M0 14L5 .5L10 14"/></g><g stroke="${RED}"><path transform="translate(95 0)" d="M2.6 3.2L6.2 .6V14"/><path transform="translate(114 0)" d="M.3 .6H9.6L3.8 14"/><path transform="translate(133 0)" d="M.9 3.6C1.3 1.7 3 .6 5 .6c2.4 0 4.2 1.5 4.2 3.7 0 1.8-1 2.9-2.7 4.2L.8 13.4H10"/></g>`;

/** The app icon: the Ti mark on a dark rounded square. */
const iconSvg = (size) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 256 256">
  <rect width="256" height="256" rx="${size <= 32 ? 40 : 52}" fill="${BG}"/>
  <rect x="1.5" y="1.5" width="253" height="253" rx="${size <= 32 ? 39 : 51}" fill="none" stroke="#2a1d1b" stroke-width="3"/>
  <g fill="${RED}" transform="translate(40 50) scale(${176 / 208})">${MARK}</g>
</svg>`;

/** Welcome / finish pages: a tall dark panel (NSIS: 164 × 314). */
const sidebarSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="164" height="314" viewBox="0 0 164 314">
  <defs><radialGradient id="g" cx="50%" cy="38%" r="60%"><stop offset="0" stop-color="#3a0f0b"/><stop offset="1" stop-color="${BG}"/></radialGradient></defs>
  <rect width="164" height="314" fill="url(#g)"/>
  <g transform="translate(82 104)">
    <circle r="56" fill="none" stroke="#4d3632" stroke-width="1"/>
    <circle r="47" fill="none" stroke="#4d3632" stroke-width=".8" stroke-dasharray="1.5 3.5"/>
    <path d="M56 0A56 56 0 0 0 -55.46 7.79" fill="none" stroke="${RED}" stroke-width="1.6" opacity=".85"/>
    <g fill="${RED}" transform="translate(-30 -28) scale(${60 / 208})">${MARK}</g>
  </g>
  <text x="82" y="200" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="25" font-weight="300" fill="${FG}">Python</text>
  <text x="56" y="221" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="10" fill="#a3948f">by</text>
  <g transform="translate(66 213) scale(.42)" fill="none" stroke-width="1.6">${WORD(FG)}</g>
  <text x="82" y="290" text-anchor="middle" font-family="Consolas, monospace" font-size="8" letter-spacing="1.2" fill="#a3948f">θ = 172°</text>
</svg>`;

/** Page header (NSIS: 150 × 57), on the white wizard pages. */
const headerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="57" viewBox="0 0 150 57">
  <rect width="150" height="57" fill="#ffffff"/>
  <g fill="${RED}" transform="translate(18 15) scale(${30 / 208})">${MARK}</g>
  <g transform="translate(60 22) scale(.55)" fill="none" stroke-width="1.6">${WORD('#17100f')}</g>
</svg>`;

/** A 24-bit bottom-up BMP from raw RGB pixels. */
function bmp(width, height, rgb) {
  const row = Math.ceil((width * 3) / 4) * 4;
  const size = 54 + row * height;
  const b = Buffer.alloc(size);
  b.write('BM', 0, 'ascii');
  b.writeUInt32LE(size, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(40, 14);
  b.writeInt32LE(width, 18);
  b.writeInt32LE(height, 22);
  b.writeUInt16LE(1, 26);
  b.writeUInt16LE(24, 28);
  b.writeUInt32LE(row * height, 34);
  b.writeInt32LE(2835, 38);
  b.writeInt32LE(2835, 42);
  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 3;
    const dst = 54 + y * row;
    for (let x = 0; x < width; x++) {
      b[dst + x * 3] = rgb[src + x * 3 + 2];
      b[dst + x * 3 + 1] = rgb[src + x * 3 + 1];
      b[dst + x * 3 + 2] = rgb[src + x * 3];
    }
  }
  return b;
}

async function writeBmp(svg, w, h, file) {
  const raw = await sharp(Buffer.from(svg), { density: 144 }).resize(w, h).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer();
  fs.writeFileSync(path.join(out, file), bmp(w, h, raw));
}

(async () => {
  const pngToIco = (await import('png-to-ico')).default;
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const s of sizes) pngs.push(await sharp(Buffer.from(iconSvg(s)), { density: 300 }).resize(s, s).png().toBuffer());
  fs.writeFileSync(path.join(out, 'icon.ico'), await pngToIco(pngs));
  fs.writeFileSync(path.join(out, 'icon.svg'), iconSvg(512).replace('width="512" height="512" ', 'width="512" height="512" '));
  await sharp(Buffer.from(iconSvg(512)), { density: 300 }).resize(256, 256).png().toFile(path.join(out, 'icon.png'));
  await sharp(Buffer.from(iconSvg(512)), { density: 300 }).resize(512, 512).png().toFile(path.join(out, 'icon_512.png'));
  await sharp(Buffer.from(iconSvg(1024)), { density: 600 }).resize(1024, 1024).png().toFile(path.join(out, 'icon_1024.png'));
  await writeBmp(sidebarSvg, 164, 314, 'installer-sidebar.bmp');
  await writeBmp(headerSvg, 150, 57, 'installer-header.bmp');
  // Previews (not used by the build)
  const prev = path.join(__dirname, '..', 'tmp', 'inst');
  fs.mkdirSync(prev, { recursive: true });
  await sharp(Buffer.from(sidebarSvg), { density: 288 }).resize(328, 628).png().toFile(path.join(prev, 'sidebar.png'));
  await sharp(Buffer.from(headerSvg), { density: 288 }).resize(300, 114).png().toFile(path.join(prev, 'header.png'));
  await sharp(Buffer.from(iconSvg(256)), { density: 300 }).resize(128, 128).png().toFile(path.join(prev, 'icon.png'));
  console.log('brand assets written to build-assets/');
})().catch((e) => { console.error(e); process.exit(1); });
