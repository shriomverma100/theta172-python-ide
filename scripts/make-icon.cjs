const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const root = path.join(__dirname, '..');
const svgPath = path.join(root, 'build-assets', 'icon.svg');
const outDir = path.join(root, 'build-assets');

async function main() {
  // Create 256x256 PNG (electron-builder uses this for Windows)
  await sharp(svgPath).resize(256, 256).png().toFile(path.join(outDir, 'icon.png'));
  console.log('✓ Created icon.png (256x256)');

  // Create 512x512 for macOS
  await sharp(svgPath).resize(512, 512).png().toFile(path.join(outDir, 'icon_512.png'));
  console.log('✓ Created icon_512.png (512x512)');

  // Create 1024x1024 for macOS Retina
  await sharp(svgPath).resize(1024, 1024).png().toFile(path.join(outDir, 'icon_1024.png'));
  console.log('✓ Created icon_1024.png (1024x1024)');

  // Create all macOS iconset sizes (for .icns generation on macOS)
  const iconsetDir = path.join(outDir, 'icon.iconset');
  if (!fs.existsSync(iconsetDir)) fs.mkdirSync(iconsetDir);

  const sizes = [16, 32, 64, 128, 256, 512, 1024];
  for (const size of sizes) {
    await sharp(svgPath).resize(size, size).png().toFile(
      path.join(iconsetDir, `icon_${size}x${size}.png`)
    );
    // @2x versions for Retina
    if (size <= 512) {
      await sharp(svgPath).resize(size * 2, size * 2).png().toFile(
        path.join(iconsetDir, `icon_${size}x${size}@2x.png`)
      );
    }
  }
  console.log('✓ Created icon.iconset/ (all macOS sizes)');

  console.log('\n── Build Targets ──');
  console.log('  Windows: electron-builder auto-converts icon.png → .ico');
  console.log('  macOS:   Run on macOS: iconutil -c icns build-assets/icon.iconset -o build-assets/icon.icns');
  console.log('  Linux:   Uses icon.png directly');
  console.log('\nDone!');
}

main().catch(err => { console.error(err); process.exit(1); });
