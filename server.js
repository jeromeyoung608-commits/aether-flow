// server.js — zero-dependency static server for local development.
// ES modules and module Workers require http(s); opening index.html via
// file:// will NOT work. Usage: npm run serve  →  http://localhost:5173
//
// It also sends the same CSP that Cloudflare Pages / Vercel would send, so
// local behaviour matches the deployed site exactly.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = process.env.PORT || 5173;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.aether': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

export const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self'",
  "connect-src 'self' http: https:",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export const server = createServer(async (req, res) => {
  try {
    let urlPath = decodeURIComponent(req.url.split('?')[0]);
    if (urlPath === '/') urlPath = '/index.html';
    const filePath = join(ROOT, normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
    if (!filePath.startsWith(ROOT)) { res.writeHead(403).end('Forbidden'); return; }
    const info = await stat(filePath).catch(() => null);
    if (!info || info.isDirectory()) { res.writeHead(404).end('Not found'); return; }
    const body = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(filePath)] || 'application/octet-stream',
      'Content-Security-Policy': CSP,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Cache-Control': 'no-cache',
    });
    res.end(body);
  } catch (err) {
    res.writeHead(500).end('Server error: ' + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`AetherFlow running at http://localhost:${PORT}`);
  console.log('CSP: connect-src \'self\' http: https: — BYOK endpoint is permitted; the runtime Egress Guard is the real boundary.');
});
