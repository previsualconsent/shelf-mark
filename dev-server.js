#!/usr/bin/env node
/* Static file server for local dev that injects FIREBASE_APPCHECK_DEBUG_TOKEN
   from .env into index.html, so App Check uses a fixed debug token instead of
   generating a new one every run (see index.html's App Check setup comment).
   Usage: node dev-server.js [port]  (default port 8000) */

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = Number(process.argv[2]) || 8000;

function loadEnv(file) {
  const env = {};
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const env = loadEnv(path.join(ROOT, '.env'));
const debugToken = env.FIREBASE_APPCHECK_DEBUG_TOKEN;

if (!debugToken) {
  console.warn('dev-server: FIREBASE_APPCHECK_DEBUG_TOKEN not set in .env — App Check will fall back to an auto-generated token.');
}

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.css': 'text/css',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const server = http.createServer((req, res) => {
  const reqPath = decodeURIComponent(req.url.split('?')[0]);
  let filePath = path.join(ROOT, reqPath === '/' ? '/index.html' : reqPath);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    res.writeHead(404);
    return res.end('Not found');
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || 'application/octet-stream';

  if (filePath === path.join(ROOT, 'index.html') && debugToken) {
    let html = fs.readFileSync(filePath, 'utf8');
    html = html.replace(
      'self.FIREBASE_APPCHECK_DEBUG_TOKEN = true;',
      `self.FIREBASE_APPCHECK_DEBUG_TOKEN = '${debugToken}';`
    );
    res.writeHead(200, { 'Content-Type': contentType });
    return res.end(html);
  }

  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(filePath).pipe(res);
});

server.listen(PORT, () => {
  console.log(`Shelfmark dev server: http://localhost:${PORT} (App Check debug token ${debugToken ? 'loaded from .env' : 'NOT set'})`);
});
