import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { stat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..'), source = path.join(root, 'presets'), output = path.join(root, '.cache', 'static-embeds'), port = Number(process.env.PORT || 3001);
const work = new Map<string, Promise<void>>(), sampleIds = new Set<string>();
let renderQueue = Promise.resolve(), rendererRevision = 0;
const presetRevisions = new Map<string, number>();
const escape = (v: unknown) => String(v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]!));
function render(id: string) {
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) return Promise.reject(new Error('Unsafe preset ID'));
  if (work.has(id)) return work.get(id)!;
  // Partial generations share a manifest, so serialize them to preserve every update.
  const job = renderQueue.then(async () => {
    let revision: number, presetRevision: number;
    do {
      revision = rendererRevision; presetRevision = presetRevisions.get(id) || 0;
      console.log(`Checking preview for ${id}…`);
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ['--import', 'tsx', 'utility/generate-embeds.ts', '--id', id], { cwd: root, stdio: 'inherit', env: { ...process.env, EMBED_SITE_URL: process.env.EMBED_SITE_URL || `http://localhost:${port}/` } });
        child.on('error', reject);
        child.on('exit', code => code ? reject(new Error(`Preview generation failed (${code})`)) : resolve());
      });
      // Changes arriving during generation must get another pass.
    } while (revision !== rendererRevision || presetRevision !== (presetRevisions.get(id) || 0));
  }).finally(() => work.delete(id));
  renderQueue = job.catch(() => {});
  work.set(id, job); return job;
}
async function dashboard() {
  let manifest: any = { entries: {} }; try { manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8')); } catch { /* Initial sample render is running. */ }
  const rows = [...sampleIds].map(id => { const e = manifest.entries?.[id], a = e?.images?.['7x4'], b = e?.images?.['4x7']; const image = (x: any, text: string) => x ? `<a href="/embeds/${x.file}">${text}</a>` : `${text} (rendering…)`; return `<tr><td><code>${escape(id)}</code><br>${escape(e?.title || 'Loading preset…')}</td><td><a href="/presets/${id}.json">JSON</a></td><td><a href="/embeds/${id}/?inspect=1">OG inspect</a><br><small>Production page redirects to the editor.</small></td><td>${image(a, '7x4 WebP')}</td><td>${image(b, '4x7 WebP')}</td></tr>`; }).join('');
  return `<!doctype html><title>Preset embed development</title><style>body{font:15px system-ui;margin:2rem;background:#17191d;color:#eee}table{border-collapse:collapse;width:100%}td,th{border:1px solid #555;padding:.6rem;text-align:left}a{color:#9bcaff}code{word-break:break-all}.note{color:#bdc3cb}</style><h1>Preset embed development</h1><p class="note">Ten random presets are generated on startup. Editing their JSON or the renderer regenerates previews automatically; refresh this dashboard for the latest image links. “OG inspect” serves the exact generated page without its human redirect, so you can inspect its OpenGraph metadata and image locally.</p><table><thead><tr><th>Preset</th><th>Source</th><th>Page</th><th>Landscape</th><th>Portrait</th></tr></thead><tbody>${rows}</tbody></table>`;
}
const mime: Record<string, string> = { '.html':'text/html; charset=utf-8', '.webp':'image/webp', '.json':'application/json; charset=utf-8' };
createServer(async (req, res) => { try {
  res.setHeader('cache-control', 'no-store');
  const url = new URL(req.url || '/', `http://localhost:${port}`), pathname = url.pathname;
  if (pathname === '/') { await Promise.allSettled([...work.values()]); res.setHeader('content-type', mime['.html']); return res.end(await dashboard()); }
  if (pathname.startsWith('/presets/')) { const name = path.basename(pathname); if (!/^[a-zA-Z0-9_-]{1,160}\.json$/.test(name)) throw new Error('Not found'); res.setHeader('content-type', mime['.json']); return res.end(await readFile(path.join(source, name))); }
  if (!pathname.startsWith('/embeds/')) throw new Error('Not found');
  const relative = pathname.slice('/embeds/'.length).replaceAll('\\', '/'), id = relative.split('/')[0], file = path.resolve(output, relative.endsWith('/') ? `${relative}index.html` : relative);
  if (!file.startsWith(output + path.sep)) throw new Error('Not found');
  // Existing HTML can reference obsolete content-addressed images. Check its
  // preset/renderer fingerprint before serving it, including nonsample presets.
  if (path.extname(file) === '.html') { sampleIds.add(id); await render(id); }
  if (!(await stat(file)).isFile()) throw new Error('Not found'); let content: Buffer | string = await readFile(file);
  if (url.searchParams.has('inspect') && path.extname(file) === '.html') content = content.toString().replace(/<script>window\.location\.replace[\s\S]*?<\/script>/, '');
  res.setHeader('content-type', mime[path.extname(file)] || 'application/octet-stream'); res.end(content);
} catch (error) { console.error(error instanceof Error ? error.message : error); res.writeHead(404, { 'content-type':'text/plain' }); res.end('Not found'); } }).listen(port, '127.0.0.1', () => console.log(`Preset embeds: http://localhost:${port}/ (ten-preset development sample)`));
const candidates = (await readdir(source)).filter(n => n.endsWith('.json') && n !== 'preset-index.json').sort(() => Math.random() - .5).slice(0, 10).map(n => path.basename(n, '.json'));
candidates.forEach(id => sampleIds.add(id)); console.log(`Selected ${candidates.length} sample presets.`);
void (async () => { for (const id of candidates) try { await render(id); } catch (error) { console.error(error); } })();
watch(source, { persistent:true }, (_, name) => { if (name?.endsWith('.json') && name !== 'preset-index.json') { const id = path.basename(name, '.json'); presetRevisions.set(id, (presetRevisions.get(id) || 0) + 1); if (sampleIds.has(id)) void render(id).catch(console.error); } });
let rendererDebounce: ReturnType<typeof setTimeout>;
watch(path.join(root, 'embed-renderer'), { recursive:true, persistent:true }, () => {
  rendererRevision++;
  clearTimeout(rendererDebounce);
  rendererDebounce = setTimeout(() => {
    console.log('Renderer changed; regenerating sample previews…');
    for (const id of sampleIds) void render(id).catch(console.error);
  }, 150);
});
