import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../scripts/server.mjs';
import { unlink } from 'node:fs/promises';

test('local server serves the app and modules while refusing private files', async t => {
  const server = createServer();
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
