import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Stripe from 'stripe';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 3000;

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

function jsonResp(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(data));
}

const server = http.createServer(async (req, res) => {
  // --- API: public Supabase config ---
  if (req.method === 'GET' && req.url === '/api/config') {
    return jsonResp(res, {
      supabaseUrl: process.env.SUPABASE_URL || '',
      supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    });
  }

  // --- API: Stripe product catalogue ---
  if (req.method === 'GET' && req.url === '/api/stripe/products') {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) return jsonResp(res, { error: 'STRIPE_SECRET_KEY not set' }, 500);
    try {
      const stripe = new Stripe(secretKey);
      const result = await stripe.products.list({
        active: true,
        expand: ['data.default_price'],
        limit: 100,
      });
      const products = result.data.map(p => {
        const price = p.default_price;
        const unit_amount = price?.unit_amount ?? null;
        const currency = price?.currency ?? 'usd';
        return {
          id: p.id,
          name: p.name,
          description: p.description || '',
          unit_amount,
          currency,
          price_formatted: unit_amount != null
            ? new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(unit_amount / 100)
            : null,
        };
      });
      return jsonResp(res, products);
    } catch (err) {
      return jsonResp(res, { error: err.message }, 500);
    }
  }

  // --- Static file handler ---
  const parsedUrl = new URL(req.url, `http://localhost:${PORT}`);
  const urlPath = parsedUrl.pathname === '/' ? '/index.html' : parsedUrl.pathname;
  const filePath = path.join(__dirname, urlPath);

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end(`Not found: ${urlPath}`);
      return;
    }
    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Bloomin' Acres server running at http://localhost:${PORT}`);
});
