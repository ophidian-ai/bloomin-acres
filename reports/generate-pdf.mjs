import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function generatePDF() {
  // Read and base64 encode the logo
  const logoPath = 'C:/Claude Code/OphidianAI/shared/brand-assets/logo_icon.png';
  const logoBuffer = fs.readFileSync(logoPath);
  const logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;

  // Read the HTML template
  const htmlPath = path.resolve(__dirname, 'status-report-v2.html');
  let html = fs.readFileSync(htmlPath, 'utf-8');

  // Replace all logo placeholders
  html = html.replaceAll('LOGO_PLACEHOLDER', logoBase64);

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const page = await browser.newPage();

  await page.setContent(html, { waitUntil: 'networkidle0' });

  const pdfPath = path.resolve(__dirname, 'Bloomin-Acres-Status-Report.pdf');

  await page.pdf({
    path: pdfPath,
    format: 'Letter',
    printBackground: true,
    margin: { top: '0', right: '0', bottom: '0', left: '0' }
  });

  console.log(`PDF generated: ${pdfPath}`);
  await browser.close();
}

generatePDF().catch(err => {
  console.error('Error generating PDF:', err);
  process.exit(1);
});
