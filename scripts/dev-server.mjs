#!/usr/bin/env node
// Lokale server om de site met de configurator te bekijken: http://localhost:3000
//
//   npm run dev
//
// Doet wat Vercel ook doet: schone URL's (/mono in plaats van /mono.html) en POST /api/aanvraag.
// Er wordt lokaal géén e-mail verstuurd: de berichten verschijnen in de terminal.
// Met MAIL=uit gedraagt de server zich alsof de mailserver niet is ingesteld.

import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

import { catalog } from '../configurator/catalog.js';
import { createRequestHandler } from '../configurator/request.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8',
};

const mailer = {
  configured: process.env.MAIL !== 'uit',
  async send(message) {
    console.log('\n--- e-mail (niet verzonden) ---');
    console.log(`Aan: ${message.to ? message.to.address : 'Airtrailer (MAIL_TO)'}`);
    console.log(`Onderwerp: ${message.subject}\n`);
    console.log(message.text);
    console.log('--- einde ---\n');
  },
};
const handleRequest = createRequestHandler({ catalog, mailer });

function resolveFile(pathname) {
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  const base = join(ROOT, clean);
  if (!base.startsWith(ROOT)) return null;
  for (const candidate of [base, `${base}.html`, join(base, 'index.html')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/aanvraag') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request(url, {
      method: req.method,
      headers: req.headers,
      body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
    });
    const response = await handleRequest(request);
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
    return;
  }

  const file = resolveFile(url.pathname === '/' ? '/index.html' : url.pathname);
  if (!file) {
    res.writeHead(404, { 'Content-Type': TYPES['.html'] });
    createReadStream(join(ROOT, '404.html')).pipe(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(res);
}).listen(PORT, () => {
  console.log(`Airtrailer lokaal: http://localhost:${PORT}/mono#samenstellen`);
});
