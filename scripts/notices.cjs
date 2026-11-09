/**
 * Writes public/third-party-notices.txt: the licence texts for code and
 * fonts bundled into the app (pixelfx is MIT; the fonts are SIL OFL 1.1).
 * Run after adding or upgrading one of them: node scripts/notices.cjs
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const packages = [
  ['pixelfx (pixel effects)', 'pixelfx'],
  ['Inter (font)', '@fontsource/inter'],
  ['Unbounded (font)', '@fontsource/unbounded'],
  ['JetBrains Mono (font)', '@fontsource/jetbrains-mono'],
];

let out = 'Python by THETA172 includes the following third-party software.\n';
out += 'The Patch Pixel font from the pixelfx repository is NOT included.\n';
for (const [title, pkg] of packages) {
  const dir = path.join(root, 'node_modules', pkg);
  const { version } = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const license = fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8').trim();
  out += `\n${'='.repeat(72)}\n${title} — ${pkg} ${version}\n${'='.repeat(72)}\n\n${license}\n`;
}
fs.writeFileSync(path.join(root, 'public', 'third-party-notices.txt'), out);
console.log('wrote public/third-party-notices.txt');
