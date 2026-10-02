import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import path from 'node:path';

export const layouts = ['7x4', '4x7'];
const validId = /^[a-zA-Z0-9_-]{1,160}$/;
const validImage = /^images\/[a-f0-9]{64}\.webp$/;
export const digest = value => createHash('sha256').update(value).digest('hex');
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function urlBase(value, label) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.search || url.hash || !url.pathname.endsWith('/')) throw new Error(`${label} must be an HTTP(S) directory URL ending in /`);
  return url;
}

/** A crawler-readable HTML document.  The redirect is deliberately only an enhancement. */
export function staticEmbedHtml({ id, layout, title, embedSiteUrl, editorSiteUrl, image, defaultPage = false }) {
  const embed = urlBase(embedSiteUrl, 'EMBED_SITE_URL');
  const editor = urlBase(editorSiteUrl, 'EDITOR_SITE_URL');
  editor.hash = `/${encodeURIComponent(id)}?layout=${layout}`;
  const pathPart = defaultPage ? `embeds/${encodeURIComponent(id)}/` : `embeds/${encodeURIComponent(id)}/${layout}/`;
  const page = new URL(pathPart, embed);
  const imageUrl = image && new URL(`embeds/${image.file}`, embed).href;
  const meta = (property, value) => `<meta property="${property}" content="${escape(value)}">`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escape(title)}</title>${meta('og:type', 'website')}${meta('og:site_name', 'PvME Preset Maker')}${meta('og:title', `PvME Preset: ${title}`)}${meta('og:url', page.href)}${meta('og:description', 'Click the link above to view preset and notes')}${image ? `${meta('og:image', imageUrl)}${meta('og:image:type', 'image/webp')}${meta('og:image:width', image.width)}${meta('og:image:height', image.height)}` : ''}<meta name="twitter:card" content="summary_large_image"></head>
<body><h1>${escape(title)}</h1><p><a id="editor" href="${escape(editor.href)}">Open preset in the editor</a></p>${image ? `<img src="${escape(imageUrl)}" width="${image.width}" height="${image.height}" alt="${escape(title)}">` : '<p>The image preview is being prepared. You can still open the preset above.</p>'}<script>window.location.replace(document.getElementById('editor').href)</script></body></html>`;
}

async function writeChanged(file, data) {
  const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
  try { if ((await readFile(file)).equals(bytes)) return false; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes); return true;
}

export async function generateStaticEmbeds({ entries, outputDir, embedSiteUrl, editorSiteUrl, rendererVersion, renderImage, siteRevision = '', force = false, partial = false, maxBytes = 900_000_000, renderBudgetMs = Infinity, now = Date.now, logger = console }) {
  const started = now(), root = path.resolve(outputDir), ids = new Set();
  for (const { id } of entries) { if (!validId.test(id) || ids.has(id) || ['images', 'manifest'].includes(id)) throw new Error(`Invalid or duplicate preset ID: ${id}`); ids.add(id); }
  if (!entries.length) throw new Error('Refusing to publish an empty preset snapshot');
  await mkdir(root, { recursive: true }); const existing = await readdir(root);
  if (existing.length && !existing.includes('.static-embeds-output')) throw new Error('Refusing to modify a nonempty directory not owned by the static embed generator');
  await writeFile(path.join(root, '.static-embeds-output'), 'Static preset embed output\n');
  let previous = { entries: {} }; try { previous = JSON.parse(await readFile(path.join(root, 'manifest.json'), 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const pending = new Set(previous.pending?.deferred || []);
  entries = [...entries.filter(e => pending.has(e.id)), ...entries.filter(e => !pending.has(e.id))];
  // Local on-demand generation is intentionally a partial snapshot. Preserve
  // unrelated cache records and never run deletion/image cleanup in that mode.
  const next = { version: 2, embedSiteUrl, editorSiteUrl, siteRevision,
    entries: partial ? { ...(previous.entries || {}) } : {},
    pending: partial ? { deferred: [...(previous.pending?.deferred || [])], failed: [...(previous.pending?.failed || [])] } : { deferred: [], failed: [] } };
  const result = { rendered: 0, reused: 0, failed: 0, deferred: 0, removed: 0, changed: false, bytes: 0 };
  const referenced = new Set();
  for (const [index, { id, content }] of entries.entries()) {
    const fingerprint = digest(`${rendererVersion}\n${content}`); let old = previous.entries?.[id];
    if (old) for (const layout of layouts) { const image = old.images?.[layout]; if (!image || !validImage.test(image.file) || !Number.isInteger(image.width) || !Number.isInteger(image.height)) { old = undefined; break; } try { if (!(await stat(path.join(root, image.file))).size) old = undefined; } catch (e) { if (e.code !== 'ENOENT') throw e; old = undefined; } if (!old) break; }
    let record = old, title = old?.title || 'RuneScape preset';
    if (!force && old?.fingerprint === fingerprint) result.reused++;
    else if (now() - started >= renderBudgetMs) { result.deferred++; next.pending.deferred.push(id); }
    else try {
      const preset = JSON.parse(content); if (!preset || (!Array.isArray(preset.inventorySlots) && !Array.isArray(preset.equipmentSlots))) throw new Error('Preset has no inventory or equipment slots');
      title = String(preset.presetName || 'Unnamed preset').slice(0, 300); const images = {}, rendered = [];
      for (const layout of layouts) rendered.push([layout, await renderImage(preset, layout)]);
      for (const [layout, image] of rendered) { const file = `images/${digest(image.buffer)}.webp`; if (await writeChanged(path.join(root, file), image.buffer)) result.changed = true; images[layout] = { file, width: image.width, height: image.height }; }
      record = { fingerprint, title, images }; result.rendered++;
    } catch (error) { result.failed++; next.pending.failed.push(id); logger.warn(`Preset ${id}: ${error.message}`); }
    if (record) next.entries[id] = record;
    for (const layout of layouts) { const image = record?.images[layout]; if (image) referenced.add(image.file); if (await writeChanged(path.join(root, id, layout, 'index.html'), staticEmbedHtml({ id, layout, title: record?.title || title, embedSiteUrl, editorSiteUrl, image }))) result.changed = true; }
    const landscape = record?.images?.['7x4']; if (landscape) referenced.add(landscape.file);
    if (await writeChanged(path.join(root, id, 'index.html'), staticEmbedHtml({ id, layout: '7x4', title: record?.title || title, embedSiteUrl, editorSiteUrl, image: landscape, defaultPage: true }))) result.changed = true;
    if ((index + 1) % 100 === 0) logger.log(`Processed ${index + 1}/${entries.length}; rendered ${result.rendered}, reused ${result.reused}, failed ${result.failed}`);
  }
  if (!partial) {
    for (const item of await readdir(root, { withFileTypes: true })) if (item.isDirectory() && item.name !== 'images' && validId.test(item.name) && !ids.has(item.name)) { const target = path.resolve(root, item.name); if (path.dirname(target) !== root) throw new Error('Refusing cleanup outside output directory'); await rm(target, { recursive: true }); result.removed++; result.changed = true; }
    await mkdir(path.join(root, 'images'), { recursive: true }); for (const name of await readdir(path.join(root, 'images'))) { const file = `images/${name}`; if (validImage.test(file) && !referenced.has(file)) { await rm(path.join(root, file)); result.changed = true; } }
  }
  next.entries = Object.fromEntries(Object.entries(next.entries).sort(([a], [b]) => a.localeCompare(b))); const manifest = JSON.stringify(next);
  if (await writeChanged(path.join(root, 'manifest.json'), manifest)) result.changed = true;
  async function measure(dir) { for (const item of await readdir(dir, { withFileTypes: true })) { if (item.isSymbolicLink()) throw new Error('Generated output must not contain symbolic links'); const file = path.join(dir, item.name); if (item.isDirectory()) await measure(file); else result.bytes += (await stat(file)).size; } }
  await measure(root); if (result.bytes > maxBytes) throw new Error(`Embeds exceed the ${maxBytes} byte publication budget (${result.bytes} bytes)`);
  result.cacheKey = digest(`${manifest}\n${embedSiteUrl}\n${editorSiteUrl}\n${[...ids].join('\n')}`); logger.log(JSON.stringify(result)); return result;
}
