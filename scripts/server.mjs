import http from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.csv': 'text/csv', '.webm': 'video/webm' };
export function serverConfig(env = process.env) {
  const production = env.NODE_ENV === 'production' || env.RENDER === 'true';
  const port = Number(env.PORT || 4173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535');
  return { production, port, host: env.HOST || (production ? '0.0.0.0' : '127.0.0.1') };
}

export function createServer({ production = serverConfig().production } = {}) {
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'none'");
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if ((req.method === 'GET' || req.method === 'HEAD') && (pathname === '/healthz' || pathname === '/api/config')) {
        const data = JSON.stringify(pathname === '/healthz' ? { status: 'ok' } : { localRecordingSave: !production });
        res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) });
        res.end(req.method === 'HEAD' ? undefined : data); return;
      }
      if (req.method === 'POST' && pathname === '/api/recordings') {
        // Hosted instances are read-only. Recordings download directly in the browser.
        if (production) { res.writeHead(403); res.end('Server recording storage is disabled; use the browser download.'); return; }
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
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }); res.end('Method not allowed'); return; }
      const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
      const resolved = path.resolve(root, requested);
      const relative = path.relative(root, resolved);
      // Serve public UI/modules and generated result files only; never .git or local secrets.
      if (relative.startsWith('..') || path.isAbsolute(relative) ||
          !/^(index\.html|styles\.css|src[\\/][\w.-]+\.mjs|artifacts[\\/][\w.-]+\.(json|csv|webm))$/.test(relative)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }
      const data = await readFile(resolved);
      res.writeHead(200, { 'Content-Type': mime[path.extname(resolved)] ?? 'application/octet-stream', 'Content-Length': data.length });
      res.end(req.method === 'HEAD' ? undefined : data);
    } catch (error) { res.writeHead(error.code === 'ENOENT' ? 404 : 400); res.end('Not found'); }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { port, host, production } = serverConfig();
  const server = createServer({ production });
  server.on('error', error => { console.error(error.message); process.exitCode = 1; });
  server.listen(port, host, () => console.log(`Raahi simulation listening on http://${host}:${port} (${production ? 'production' : 'local'})`));
  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('Shutting down HTTP server…');
    const deadline = setTimeout(() => server.closeAllConnections(), 10000);
    deadline.unref();
    server.close(() => clearTimeout(deadline));
  };
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
