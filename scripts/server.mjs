import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = Number(process.env.PORT || 4173);
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.csv': 'text/csv', '.webm': 'video/webm' };
export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (req.method === 'POST' && pathname === '/api/recordings') {
        // Only our same-origin UI can persist a recording. No caller-chosen paths.
        if (req.headers.origin !== `http://${req.headers.host}` ||
            !req.headers['content-type']?.startsWith('video/webm')) {
          res.writeHead(403); res.end('Forbidden'); return;
        }
        const chunks = []; let bytes = 0;
        for await (const chunk of req) {
          bytes += chunk.length;
          if (bytes > 32 * 1024 * 1024) { res.writeHead(413); res.end('Recording exceeds 32 MB'); return; }
          chunks.push(chunk);
        }
        const name = `demo-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.webm`;
        await mkdir(path.join(root, 'artifacts'), { recursive: true });
        await writeFile(path.join(root, 'artifacts', name), Buffer.concat(chunks), { flag: 'wx' });
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ path: `artifacts/${name}`, url: `/artifacts/${name}` })); return;
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end('Method not allowed'); return; }
      const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const resolved = path.resolve(root, requested);
      const relative = path.relative(root, resolved);
      // Serve public UI/modules and generated result files only; never .git or local secrets.
      if (relative.startsWith('..') || path.isAbsolute(relative) ||
          !/^(index\.html|styles\.css|src[\\/][\w.-]+\.mjs|artifacts[\\/][\w.-]+\.(json|csv|webm))$/.test(relative)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      const data = await readFile(resolved);
      res.writeHead(200, { 'Content-Type': mime[path.extname(resolved)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    } catch (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 400); res.end('Not found'); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createServer();
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`Raahi simulation: http://127.0.0.1:${port}`));
}
