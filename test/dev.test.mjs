import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdir, mkdtemp, copyFile, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
async function until(check) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error('Timed out waiting for dev server');
}

test('dev renderer edits regenerate previews, preserve the manifest, and bypass HTTP cache', { timeout: 30000 }, async t => {
  await mkdir(path.join(root, '.cache'), { recursive: true });
  const fixture = await mkdtemp(path.join(root, '.cache', 'dev-test-'));
  for (const dir of ['utility', 'presets', 'embed-renderer']) await mkdir(path.join(fixture, dir));
  await copyFile(path.join(root, 'utility/dev.ts'), path.join(fixture, 'utility/dev.ts'));
  await writeFile(path.join(fixture, 'package.json'), '{"type":"module"}');
  const asset = path.join(fixture, 'embed-renderer/version');
  await writeFile(asset, 'before');
  for (const id of ['one', 'two']) await writeFile(path.join(fixture, `presets/${id}.json`), '{}');
  // A deliberately slow generator reproduces overlapping partial manifest writes.
  await writeFile(path.join(fixture, 'utility/generate-embeds.ts'), `
    import { mkdir, readFile, writeFile } from 'node:fs/promises';
    import { setTimeout } from 'node:timers/promises';
    const id = process.argv[process.argv.indexOf('--id') + 1];
    const output = '.cache/static-embeds';
    await mkdir(output + '/' + id, { recursive: true });
    let manifest = { entries: {} };
    try { manifest = JSON.parse(await readFile(output + '/manifest.json', 'utf8')); } catch {}
    const version = await readFile('embed-renderer/version', 'utf8');
    await setTimeout(100);
    manifest.entries[id] = { title: version, images: {} };
    await writeFile(output + '/' + id + '/index.html', version);
    await writeFile(output + '/manifest.json', JSON.stringify(manifest));
  `);
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn(process.execPath, ['--import', 'tsx', 'utility/dev.ts'], {
    cwd: fixture, env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', chunk => { logs += chunk; });
  child.stderr.on('data', chunk => { logs += chunk; });
  t.after(async () => {
    if (child.exitCode === null) {
      const exited = new Promise(resolve => child.once('exit', resolve));
      child.kill(); await exited;
    }
    await rm(fixture, { recursive: true, force: true });
  });
  const manifestFile = path.join(fixture, '.cache/static-embeds/manifest.json');
  const manifest = async () => { try { return JSON.parse(await readFile(manifestFile, 'utf8')); } catch { return { entries: {} }; } };
  await until(async () => Object.keys((await manifest()).entries).length === 2);
  const url = `http://127.0.0.1:${port}`;
  const dashboard = await fetch(url);
  assert.equal(dashboard.headers.get('cache-control'), 'no-store');
  assert.equal(dashboard.status, 200);
  await writeFile(asset, 'after');
  await until(async () => Object.values((await manifest()).entries).filter(e => e.title === 'after').length === 2);
  assert.match(logs, /Renderer changed; regenerating sample previews/);
  const inspect = await fetch(`${url}/embeds/one/?inspect=1`);
  assert.equal(inspect.headers.get('cache-control'), 'no-store');
  assert.equal(await inspect.text(), 'after');
  // Even an existing page outside the startup sample gets checked on demand.
  await mkdir(path.join(fixture, '.cache/static-embeds/three'), { recursive: true });
  await writeFile(path.join(fixture, 'presets/three.json'), '{}');
  await writeFile(path.join(fixture, '.cache/static-embeds/three/index.html'), 'stale');
  const third = await fetch(`${url}/embeds/three/?inspect=1`);
  assert.equal(await third.text(), 'after');
  assert.equal(Object.keys((await manifest()).entries).length, 3);
});
