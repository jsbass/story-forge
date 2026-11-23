// Local playtest server: serves build/dev and accepts feedback from the debug overlay.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { addFeedback } from '../lib/feedback.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.opus': 'audio/ogg', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.flac': 'audio/flac', '.webm': 'video/webm', '.mp4': 'video/mp4' };

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
  });
}

/** Serve a file with HTTP Range support (browsers need 206 responses to seek/loop audio and video). */
function sendFile(res, dir, urlPath, req = null) {
  const file = path.normalize(path.join(dir, urlPath));
  if (!file.startsWith(path.normalize(dir))) { res.writeHead(403); res.end(); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    const headers = { 'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes' };
    const m = req && /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number(m[1]) : st.size - Number(m[2]);
      let end = m[1] && m[2] ? Number(m[2]) : st.size - 1;
      start = Math.max(0, start);
      end = Math.min(end, st.size - 1);
      if (start > end) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); res.end(); return; }
      res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    fs.createReadStream(file).pipe(res);
  });
}

/**
 * Asset review server: serves assets/ (gallery + candidates) and records approve/reject decisions.
 * `decide(body)` performs the decision and returns {message}.
 */
export function serveReview(root, { port = 4174, decide, log = console.log } = {}) {
  const assetsDir = path.join(root, 'assets');
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/__forge/assets/decision') {
      try {
        const out = await decide(await readBody(req));
        log(out.message);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(out));
      } catch (e) {
        res.writeHead(400); res.end(String(e.message));
      }
      return;
    }
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (urlPath === '/') { res.writeHead(302, { Location: '/assets/review/index.html' }); res.end(); return; }
    if (!urlPath.startsWith('/assets/')) { res.writeHead(404); res.end(); return; }
    sendFile(res, assetsDir, urlPath.slice('/assets'.length), req);
  });
  server.listen(port, '127.0.0.1', () => log(`Asset review: http://127.0.0.1:${port}/  (decisions update assets/manifest.yaml)`));
  return server;
}

export function servePlaytest(root, { port = 4173, dir = path.join(root, 'build', 'dev'), log = console.log } = {}) {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/__forge/feedback') {
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try {
          const j = JSON.parse(body);
          const item = addFeedback(root, {
            text: j.note,
            stage: 'playtest',
            targets: [],
            source: 'playtest',
            passage: j.passage || null,
            snapshot: { passage: j.passage, scene: j.scene, variables: j.variables, at: j.at },
          });
          log(`feedback ${item.id} @ ${j.passage}: ${item.summary}`);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ id: item.id }));
        } catch (e) {
          res.writeHead(400); res.end(String(e.message));
        }
      });
      return;
    }
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    sendFile(res, dir, urlPath === '/' ? 'index.html' : urlPath, req);
  });
  server.listen(port, '127.0.0.1', () => log(`Playtest server: http://127.0.0.1:${port}/  (feedback from the ⚙ overlay is logged to state/feedback/)`));
  return server;
}
