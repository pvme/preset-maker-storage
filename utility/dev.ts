import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { stat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';

const root = path.resolve(import.meta.dirname, '..'), source = path.join(root, 'presets'), output = path.join(root, '.cache', 'static-embeds'), port = Number(process.env.PORT || 3001);
const work = new Map<string, Promise<void>>(), sampleIds = new Set<string>();
const subscribers = new Map<string, Set<ServerResponse>>();
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
const dirty = new Set<string>();
const presetRevisions = new Map<string, string>();
async function rendererSignature() {
  const rendererRoot = path.join(root, 'embed-renderer');
  const hash = createHash('sha256');
  for (const name of (await readdir(rendererRoot, { recursive: true })).sort()) {
    const file = path.join(rendererRoot, name);
    if ((await stat(file)).isFile()) { hash.update(name); hash.update(await readFile(file)); }
  }
  return hash.digest('hex');
}
let rendererRevision = await rendererSignature();
let rendererTimer: ReturnType<typeof setTimeout> | undefined;
// Generation updates a shared manifest, so serialize jobs to prevent lost records.
let renderQueue = Promise.resolve();
const escape = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
function render(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) return Promise.reject(new Error('Unsafe preset ID'));
  if (work.has(id)) return work.get(id)!;
  console.log(`Regenerating preview for ${id}…`);
  const job = renderQueue.then(async () => {
    presetRevisions.set(id, createHash('sha256').update(await readFile(path.join(source, id + '.json'))).digest('hex'));
    return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'utility/generate-embeds.ts', '--id', id], { cwd: root, stdio: 'inherit', env: { ...process.env, EMBED_SITE_URL: process.env.EMBED_SITE_URL || `http://localhost:${port}/` } });
    child.on('error', reject);
    child.on('exit', code => code ? reject(new Error(`Preview generation failed (${code})`)) : resolve());
    });
  }).then(() => {
    for (const client of subscribers.get(id) || []) client.write('event: rendered\ndata: {}\n\n');
  }).finally(() => {
    work.delete(id);
    if (dirty.delete(id)) scheduleRender(id);
  });
  renderQueue = job.catch(() => {});
  work.set(id, job); return job;
}
function scheduleRender(id: string) {
  if (work.has(id)) { dirty.add(id); return; }
  clearTimeout(debounceTimers.get(id));
  debounceTimers.set(id, setTimeout(() => {
    debounceTimers.delete(id);
    void render(id).catch(console.error);
  }, 150));
}

const liveReloadScript = `<script>
(() => {
  const id = location.pathname.split('/')[2];
  const events = new EventSource('/__dev/events?id=' + encodeURIComponent(id));
  let refreshing = false, pending = false;
  async function refresh() {
    if (refreshing) { pending = true; return; }
    refreshing = true;
    try {
      const response = await fetch(location.href, { cache: 'no-store' });
      if (!response.ok) throw new Error('Preview refresh failed');
      const page = new DOMParser().parseFromString(await response.text(), 'text/html');
      const image = page.querySelector('img');
      if (image) {
        image.src = new URL(image.getAttribute('src'), location.href).pathname;
        const preload = new Image();
        preload.src = image.src;
        await preload.decode();
        const current = document.querySelector('img');
        if (current) current.replaceWith(image);
        else document.body.append(image);
      }
      document.title = page.title;
      const heading = document.querySelector('h1'), nextHeading = page.querySelector('h1');
      if (heading && nextHeading) heading.textContent = nextHeading.textContent;
    } catch (error) { console.error(error); }
    finally { refreshing = false; if (pending) { pending = false; void refresh(); } }
  }
  // Also refresh on reconnect, covering saves made while the connection was down.
  events.onopen = refresh;
  events.addEventListener('rendered', refresh);
  addEventListener('pagehide', () => events.close());
})();
</script>`;
async function dashboard() {
  let manifest: any = { entries: {} }; try { manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8')); } catch { /* Initial sample render is running. */ }
  const rows = [...sampleIds].map(id => { const e = manifest.entries?.[id], a = e?.images?.['7x4'], b = e?.images?.['4x7']; const image = (x: any, text: string) => x ? `<a href="/embeds/${x.file}">${text}</a>` : `${text} (rendering…)`; return `<tr><td><code>${escape(id)}</code><br>${escape(e?.title || 'Loading preset…')}</td><td><a href="/presets/${id}.json">JSON</a></td><td><a href="/embeds/${id}/?inspect=1">OG inspect</a><br><small>Production page redirects to the editor.</small></td><td>${image(a, '7x4 WebP')}</td><td>${image(b, '4x7 WebP')}</td></tr>`; }).join('');
  return `<!doctype html><title>Preset embed development</title><style>body{font:15px system-ui;margin:2rem;background:#17191d;color:#eee}table{border-collapse:collapse;width:100%}td,th{border:1px solid #555;padding:.6rem;text-align:left}a{color:#9bcaff}code{word-break:break-all}.note{color:#bdc3cb}</style><h1>Preset embed development</h1><p class="note">Ten random presets are generated on startup. “OG inspect” shows the generated page without its editor redirect. Open inspect pages update their images automatically when you save preset JSON, renderer code, or renderer assets.</p><table><thead><tr><th>Preset</th><th>Source</th><th>Page</th><th>Landscape</th><th>Portrait</th></tr></thead><tbody>${rows}</tbody></table>`;
}
const mime: Record<string, string> = { '.html':'text/html; charset=utf-8', '.webp':'image/webp', '.json':'application/json; charset=utf-8' };
createServer(async (req, res) => { try {
  const url = new URL(req.url || '/', `http://localhost:${port}`), pathname = url.pathname;
  res.setHeader('cache-control', 'no-store');
  if (pathname === '/__dev/events') {
    const id = url.searchParams.get('id') || '';
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id) || !(await stat(path.join(source, id + '.json'))).isFile()) throw new Error('Not found');
    res.writeHead(200, { 'content-type': 'text/event-stream', connection: 'keep-alive' });
    res.write(': connected\n\n');
    const clients = subscribers.get(id) || new Set<ServerResponse>();
    clients.add(res); subscribers.set(id, clients); sampleIds.add(id);
    const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 15000);
    res.on('close', () => {
      clearInterval(heartbeat); clients.delete(res);
      if (!clients.size) subscribers.delete(id);
    });
    return;
  }
  if (pathname === '/') { res.setHeader('content-type', mime['.html']); return res.end(await dashboard()); }
  if (pathname.startsWith('/presets/')) { const name = path.basename(pathname); if (!/^[a-zA-Z0-9_-]{1,160}\.json$/.test(name)) throw new Error('Not found'); res.setHeader('content-type', mime['.json']); return res.end(await readFile(path.join(source, name))); }
  if (!pathname.startsWith('/embeds/')) throw new Error('Not found');
  const relative = pathname.slice('/embeds/'.length).replaceAll('\\', '/'), id = relative.split('/')[0], file = path.resolve(output, relative.endsWith('/') ? `${relative}index.html` : relative);
  if (!file.startsWith(output + path.sep)) throw new Error('Not found'); try { if (!(await stat(file)).isFile()) throw new Error('Missing'); } catch { sampleIds.add(id); await render(id); }
  if (!(await stat(file)).isFile()) throw new Error('Not found'); let content: Buffer | string = await readFile(file);
  if (url.searchParams.has('inspect') && path.extname(file) === '.html') {
    sampleIds.add(id);
    content = content.toString().replace(/<script>window\.location\.replace[\s\S]*?<\/script>/, '').replace('</body>', liveReloadScript + '</body>');
  }
  res.setHeader('content-type', mime[path.extname(file)] || 'application/octet-stream'); res.end(content);
} catch (error) { console.error(error instanceof Error ? error.message : error); res.writeHead(404, { 'content-type':'text/plain' }); res.end('Not found'); } }).listen(port, '127.0.0.1', () => console.log(`Preset embeds: http://localhost:${port}/ (ten-preset development sample)`));
const candidates = (await readdir(source)).filter(n => n.endsWith('.json') && n !== 'preset-index.json').sort(() => Math.random() - .5).slice(0, 10).map(n => path.basename(n, '.json'));
candidates.forEach(id => sampleIds.add(id)); console.log(`Selected ${candidates.length} sample presets.`);
void (async () => { for (const id of candidates) try { await render(id); } catch (error) { console.error(error); } })();
watch(source, { persistent:true }, (_, name) => {
  if (!name?.endsWith('.json') || name === 'preset-index.json') return;
  const id = path.basename(name, '.json');
  if (!sampleIds.has(id)) return;
  void readFile(path.join(source, name)).then(bytes => {
    const revision = createHash('sha256').update(bytes).digest('hex');
    if (revision === presetRevisions.get(id)) return;
    presetRevisions.set(id, revision); scheduleRender(id);
  }).catch(console.error);
});
watch(path.join(root, 'embed-renderer'), { recursive:true, persistent:true }, () => {
  clearTimeout(rendererTimer);
  rendererTimer = setTimeout(() => {
    void rendererSignature().then(revision => {
      if (revision === rendererRevision) return;
      rendererRevision = revision;
      // Refresh visible presets first, then the remaining development samples.
      for (const id of new Set([...subscribers.keys(), ...sampleIds])) scheduleRender(id);
    }).catch(console.error);
  }, 150);
});
