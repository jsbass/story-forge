// Local playtest server: serves build/dev and accepts feedback from the debug overlay.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { addFeedback } from '../lib/feedback.mjs';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg', '.webm': 'video/webm', '.mp4': 'video/mp4' };

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
    let file = path.normalize(path.join(dir, urlPath === '/' ? 'index.html' : urlPath));
    if (!file.startsWith(path.normalize(dir))) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  server.listen(port, '127.0.0.1', () => log(`Playtest server: http://127.0.0.1:${port}/  (feedback from the ⚙ overlay is logged to state/feedback/)`));
  return server;
}
