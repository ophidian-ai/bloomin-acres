import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const url = process.argv[2] || 'http://localhost:3000';
const label = process.argv[3] || '';

// Ensure output directory exists
const outDir = path.join(__dirname, 'temporary screenshots');
if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

// Auto-increment filename
function getNextFilename() {
  const existing = fs.existsSync(outDir)
    ? fs.readdirSync(outDir).filter(f => f.endsWith('.png'))
    : [];
  const nums = existing
    .map(f => parseInt(f.match(/^screenshot-(\d+)/)?.[1] ?? 0))
    .filter(n => !isNaN(n));
  const next = nums.length ? Math.max(...nums) + 1 : 1;
  const suffix = label ? `-${label}` : '';
  return path.join(outDir, `screenshot-${next}${suffix}.png`);
}

const browser = await puppeteer.launch({
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
await page.goto(url, { waitUntil: 'networkidle0', timeout: 15000 });

// Scroll through the page to trigger IntersectionObserver for all sections
const pageHeight = await page.evaluate(() => document.body.scrollHeight);
for (let y = 0; y <= pageHeight; y += 500) {
  await page.evaluate(scrollY => window.scrollTo(0, scrollY), y);
  await new Promise(r => setTimeout(r, 60));
}
// Force all animated elements visible, then wait for transitions to complete
await page.evaluate(() => {
  document.querySelectorAll('.animate-fade-up').forEach(el => el.classList.add('visible'));
});
await page.evaluate(() => window.scrollTo(0, 0));
await new Promise(r => setTimeout(r, 1000));

const filename = getNextFilename();
await page.screenshot({ path: filename, fullPage: true });
await browser.close();

console.log(`Screenshot saved: ${filename}`);
