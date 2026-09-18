#!/usr/bin/env node
// Local preview: serves public/ and runs the real /api/state handler against a file in
// .data/, so the shortlist can be clicked through without a Redis account.
//
//   npm run build && npm run dev     ->  http://localhost:3000
//
// The demo weeks are the ones to click: they carry the same camera and recorder as a live week,
// so the whole Tuesday flow can be walked through on a season that is already over. Nothing
// asks who you are — see api/wheel.js for why the wheel has no login.
//
// From a phone on the same wifi:
//
//   HTTPS=1 npm run dev   ->  https://<this machine's LAN address>:3000
//
// HTTPS because a phone will not hand a camera to a plain http:// page that is not localhost.
// The certificate is self-signed and made on the spot into .data/ (git-ignored), so the phone
// warns once — "Show details" -> "visit this website" on iOS — and then it is an ordinary page.

import { createServer as httpServer } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import handler from './api/state.js';
import wheelHandler from './api/wheel.js';

// Nothing to serve until something has been built. Say so, and say what to run.
if (!existsSync('public')) {
  console.error('Nothing to serve yet: public/ does not exist. Run `npm start` to set up and build, or `npm run build`.');
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;
const ROOT = 'public';
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json',
  '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.png': 'image/png' };

// Just enough of Vercel's req/res shape for api/state.js to be the same code in both places.
function shim(req, res) {
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(b)); return res; };
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
      resolve();
    });
  });
}

// Every non-loopback IPv4 this machine has; the first is almost always the wifi one.
const lan = Object.values(networkInterfaces()).flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => i.address);

// A throwaway certificate for the LAN, minted once. It names the current addresses so a
// browser that has accepted it once does not ask again on the next run.
function devCert() {
  const dir = '.data', key = join(dir, 'dev-key.pem'), cert = join(dir, 'dev-cert.pem');
  if (!existsSync(key) || !existsSync(cert)) {
    mkdirSync(dir, { recursive: true });
    const san = ['DNS:localhost', 'IP:127.0.0.1', ...lan.map((ip) => `IP:${ip}`)].join(',');
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '825',
      '-keyout', key, '-out', cert, '-subj', '/CN=Side Prizes dev', '-addext', `subjectAltName=${san}`],
    { stdio: 'ignore' });
    console.error(`  minted ${cert} for ${san}`);
  }
  return { key: readFileSync(key), cert: readFileSync(cert) };
}

const secure = Boolean(process.env.HTTPS) || process.argv.includes('--https');
const handle = async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/state') {
    await shim(req, res);
    return handler(req, res);
  }

  if (url.pathname === '/api/wheel') {
    await shim(req, res);
    return wheelHandler(req, res);
  }

  // cleanUrls, the same as Vercel does it.
  let path = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  if (path === '/') path = '/index.html';
  else if (!extname(path)) path += '.html';

  try {
    const body = await readFile(join(ROOT, path));
    res.writeHead(200, { 'Content-Type': TYPES[extname(path)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404');
  }
};
const server = secure ? httpsServer(devCert(), handle) : httpServer(handle);

server.on('error', (e) => {
  if (e.code !== 'EADDRINUSE') throw e;
  console.error(`Port ${PORT} is already in use. Try PORT=5177 npm run dev`);
  process.exit(1);
});

server.listen(PORT, () => {
  const scheme = secure ? 'https' : 'http';
  console.error(`${scheme}://localhost:${PORT}  (storage: ${process.env.SHORTLIST_FILE || '.data/shortlist.json'})`);
  for (const ip of lan) console.error(`${scheme}://${ip}:${PORT}  <- a phone on this wifi`);
  if (!secure) console.error('  (plain http: a phone will browse it but will not give it a camera. HTTPS=1 npm run dev)');
});
