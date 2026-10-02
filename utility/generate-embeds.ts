import { readdir, readFile, mkdir, writeFile, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { generateStaticEmbeds, digest } from '../embed-renderer/static-pages.mjs';
import { makeEmbedRenderer } from '../embed-renderer/renderer.mjs';

const root = path.resolve(import.meta.dirname, '..');
const source = path.resolve(process.env.PRESET_SOURCE_DIR || path.join(root, 'presets'));
const outputDir = path.resolve(process.env.EMBED_OUTPUT_DIR || path.join(root, '.cache', 'static-embeds'));
const embedSiteUrl = process.env.EMBED_SITE_URL || 'http://localhost:3001/';
const editorSiteUrl = process.env.EDITOR_SITE_URL || 'http://localhost:5173/';
const requestedId = process.argv.includes('--id') ? process.argv[process.argv.indexOf('--id') + 1] : undefined;
const files = (await readdir(source)).filter(n => n.endsWith('.json') && n !== 'preset-index.json').sort().filter(n => !requestedId || n === `${requestedId}.json`);
if (requestedId && files.length !== 1) throw new Error(`Preset not found or unsafe ID: ${requestedId}`);
const entries = await Promise.all(files.map(async name => ({ id: name.slice(0, -5), content: await readFile(path.join(source, name), 'utf8') })));
const assetFiles = ['embed-renderer/renderer.mjs', 'embed-renderer/lib/render-core.js', 'embed-renderer/lib/layout.js', 'embed-renderer/assets/PlayfairDisplay.ttf', 'embed-renderer/assets/Gelasio.ttf', 'embed-renderer/assets/bg.png', 'embed-renderer/assets/border-side.png', 'embed-renderer/assets/border-top.png', 'embed-renderer/assets/corner.png', 'embed-renderer/assets/presetmap_desktop.png', 'package-lock.json'];
const rendererVersion = digest(Buffer.concat(await Promise.all(assetFiles.map(file => readFile(path.join(root, file))))));
const icons = path.resolve(process.env.EMBED_ICON_CACHE_DIR || path.join(root, '.cache', 'embed-icons')); await mkdir(icons, { recursive: true }); const downloads = new Map();
async function fetchImageBytes(url: string) { if (!downloads.has(url)) downloads.set(url, (async () => { const file = path.join(icons, `${digest(url)}.img`); try { if (process.env.EMBED_FORCE !== 'true') return await readFile(file); } catch (e: any) { if (e.code !== 'ENOENT') throw e; } const response = await fetch(url, { signal: AbortSignal.timeout(15_000) }); if (!response.ok) throw new Error(`Icon download failed: ${response.status}`); const bytes = Buffer.from(await response.arrayBuffer()); await loadImage(bytes); await writeFile(file, bytes); return bytes; })()); return downloads.get(url); }
const { renderPresetImage } = makeEmbedRenderer({ fetchImageBytes });
const result = await generateStaticEmbeds({ entries, outputDir, embedSiteUrl, editorSiteUrl, rendererVersion, siteRevision: process.env.GITHUB_SHA || '', partial: Boolean(requestedId), force: process.env.EMBED_FORCE === 'true' || process.argv.includes('--force'), renderBudgetMs: Number(process.env.EMBED_RENDER_BUDGET_MS || 300000), renderImage: async (preset: unknown, layout: string) => { const png = await renderPresetImage(preset, layout); const image = await loadImage(png); const canvas = createCanvas(image.width, image.height); canvas.getContext('2d').drawImage(image, 0, 0); return { buffer: await canvas.encode('webp', 90), width: image.width, height: image.height }; } });
if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `cache-key=${result.cacheKey}\nchanged=${result.changed}\n`);
if (result.failed) console.warn(`${result.failed} preset(s) failed; prior previews were retained and failures will retry.`);
