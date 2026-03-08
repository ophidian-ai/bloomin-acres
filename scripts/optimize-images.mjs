import sharp from 'sharp';
import { readdir, mkdir, rename, stat, writeFile, unlink } from 'fs/promises';
import { join, extname, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BRAND_DIR = join(__dirname, '..', 'brand-assets');
const SOURCE_DIR = join(BRAND_DIR, 'source');
const MAX_WIDTH = 1200;

// Files to move to source/ (design templates, not used on web)
const SOURCE_ONLY = ['basket-template.png', 'basket-background.png', 'blank-menu-template.png'];

// Files that must stay PNG (favicon/icon use) -- compress in-place
const KEEP_PNG = ['color-logo.png', 'sprout.png', 'basket-icon.png', 'badge.png'];

async function run() {
  console.log(`Brand dir: ${BRAND_DIR}`);

  // Ensure source directory exists
  await mkdir(SOURCE_DIR, { recursive: true });

  // Step 1: Move source-only files
  for (const file of SOURCE_ONLY) {
    const src = join(BRAND_DIR, file);
    const dest = join(SOURCE_DIR, file);
    try {
      await stat(src);
      await rename(src, dest);
      console.log(`[move] ${file} -> source/${file}`);
    } catch {
      console.log(`[skip] ${file} not found, skipping move`);
    }
  }

  // Step 2: Process remaining files
  const files = await readdir(BRAND_DIR);

  for (const file of files) {
    const filePath = join(BRAND_DIR, file);
    const ext = extname(file).toLowerCase();
    const name = basename(file, ext);

    // Skip directories (like source/)
    const fileStat = await stat(filePath);
    if (fileStat.isDirectory()) continue;

    // Skip non-image files
    if (!['.png', '.jpg', '.jpeg'].includes(ext)) continue;

    const sizeBefore = fileStat.size;

    if (KEEP_PNG.includes(file)) {
      // Compress PNG in-place
      const meta = await sharp(filePath).metadata();
      let pipeline = sharp(filePath);
      if (meta.width > MAX_WIDTH) {
        pipeline = pipeline.resize({ width: MAX_WIDTH });
      }
      const buffer = await pipeline.png({ quality: 80, compressionLevel: 9 }).toBuffer();
      await writeFile(filePath, buffer);
      console.log(`[png]  ${file}: ${fmt(sizeBefore)} -> ${fmt(buffer.length)} (${pct(sizeBefore, buffer.length)})`);
    } else {
      // Convert to WebP
      const meta = await sharp(filePath).metadata();
      let pipeline = sharp(filePath);
      if (meta.width > MAX_WIDTH) {
        pipeline = pipeline.resize({ width: MAX_WIDTH });
      }
      const outPath = join(BRAND_DIR, `${name}.webp`);
      await pipeline.webp({ quality: 80 }).toFile(outPath);
      const outStat = await stat(outPath);
      console.log(`[webp] ${file} -> ${name}.webp: ${fmt(sizeBefore)} -> ${fmt(outStat.size)} (${pct(sizeBefore, outStat.size)})`);

      // Remove original after successful conversion
      await unlink(filePath);
    }
  }

  console.log('\nDone.');
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function pct(before, after) {
  const reduction = ((1 - after / before) * 100).toFixed(1);
  return `-${reduction}%`;
}

run().catch(console.error);
