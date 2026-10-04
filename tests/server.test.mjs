import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, serverConfig } from '../scripts/server.mjs';
import { unlink } from 'node:fs/promises';

test('local server serves the app and modules while refusing private files', async t => {
  const server = createServer({ production: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  const page = await fetch(root); assert.equal(page.status, 200); assert.match(await page.text(), /Raahi/);
  const module = await fetch(`${root}/src/engine.mjs`); assert.equal(module.status, 200);
  assert.match(module.headers.get('content-type'), /javascript/);
  assert.equal((await fetch(`${root}/.git/config`)).status, 403);
  assert.equal((await fetch(`${root}/src/%2e%2e%5c.git%5cconfig`)).status, 403);
  assert.equal((await fetch(`${root}/src/missing.mjs`)).status, 404);
  assert.equal((await fetch(`${root}/%ZZ`)).status, 400);
  assert.equal((await fetch(`${root}/api/recordings`, { method: 'POST', headers: { Origin: 'https://unrelated.invalid', 'Content-Type': 'video/webm' }, body: 'blocked' })).status, 403);
  const recording = await fetch(`${root}/api/recordings`, { method: 'POST', headers: { Origin: root, 'Content-Type': 'video/webm' }, body: 'test recording fixture' });
  assert.equal(recording.status, 201);
  const saved = await recording.json(); assert.match(saved.path, /^artifacts\/demo-[\w-]+\.webm$/);
  t.after(() => unlink(new URL(`../${saved.path}`, import.meta.url)));
  assert.equal(await (await fetch(`${root}/${saved.path}`)).text(), 'test recording fixture');
});

test('hosting configuration respects Render PORT and binds publicly only in hosted mode', () => {
  assert.deepEqual(serverConfig({}), { production: false, port: 4173, host: '127.0.0.1' });
  assert.deepEqual(serverConfig({ NODE_ENV: 'production', PORT: '10000' }), { production: true, port: 10000, host: '0.0.0.0' });
  assert.equal(serverConfig({ RENDER: 'true' }).production, true);
  assert.equal(serverConfig({ RENDER: 'true' }).host, '0.0.0.0');
  assert.equal(serverConfig({ NODE_ENV: 'production', HOST: '127.0.0.1' }).host, '127.0.0.1');
  for (const PORT of ['invalid', '0', '-1', '65536', '1.5']) assert.throws(() => serverConfig({ PORT }), /PORT/);
});

test('production supports health probes and refuses recording uploads behind HTTPS proxies', async t => {
  const server = createServer({ production: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  const health = await fetch(`${root}/healthz`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok' });
  assert.equal(health.headers.get('cache-control'), 'no-store');
  const probe = await fetch(`${root}/healthz`, { method: 'HEAD' });
  assert.equal(probe.status, 200); assert.equal(await probe.text(), '');
  assert.deepEqual(await (await fetch(`${root}/api/config`)).json(), { localRecordingSave: false });
  for (const origin of [root, 'https://raahi.example']) {
    const response = await fetch(`${root}/api/recordings`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'video/webm', 'X-Forwarded-Proto': 'https' }, body: 'do not persist',
    });
    assert.equal(response.status, 403);
    assert.match(await response.text(), /storage is disabled/);
  }
  // HTTPS termination is handled by Render. The app never redirects into an HTTP/HTTPS loop.
  const page = await fetch(root, { headers: { 'X-Forwarded-Proto': 'https' } });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
  const head = await fetch(root, { method: 'HEAD' });
  assert.equal(head.headers.get('content-length'), page.headers.get('content-length'));
  assert.equal(await head.text(), '');
  for (const file of ['.env', 'package.json', 'render.yaml', 'tests/server.test.mjs']) {
    assert.equal((await fetch(`${root}/${file}`)).status, 403);
  }
  const post = await fetch(`${root}/healthz`, { method: 'POST' });
  assert.equal(post.status, 405); assert.equal(post.headers.get('allow'), 'GET, HEAD');
});

test('development capabilities retain local recording saves', async t => {
  const server = createServer({ production: false });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const root = `http://127.0.0.1:${server.address().port}`;
  assert.deepEqual(await (await fetch(`${root}/api/config`)).json(), { localRecordingSave: true });
});
