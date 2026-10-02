// This small adapter deliberately duplicates the editor's preset migration rules.
// Keep it self-contained until the editor and storage projects can share a package.
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';
GlobalFonts.registerFromPath(fileURLToPath(new URL("assets/PlayfairDisplay.ttf", import.meta.url)), "Playfair Display");
GlobalFonts.registerFromPath(fileURLToPath(new URL("assets/Gelasio.ttf", import.meta.url)), "Gelasio");
const require = createRequire(import.meta.url);
const { createRenderer } = require('./lib/render-core.js');

const catalogueUrl = 'https://raw.githubusercontent.com/pvme/pvme-settings/refs/heads/master/emojis/emojis_v2.json';
let catalogue;
async function loadCatalogue(signal) {
  if (catalogue) return catalogue;
  const response = await fetch(catalogueUrl, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error(`Emoji catalogue download failed: ${response.status}`);
  const data = await response.json(), byId = {}, byAlias = {}, bySlot = {};
  for (const category of Array.isArray(data.categories) ? data.categories : []) for (const raw of Array.isArray(category.emojis) ? category.emojis : []) {
    if (!raw?.id || !raw?.name) continue; const id = String(raw.id).trim().toLowerCase(); const entry = { ...raw, id };
    byId[id] = entry; for (const alias of Array.isArray(raw.id_aliases) ? raw.id_aliases : []) if (typeof alias === 'string') byAlias[alias.trim().toLowerCase()] = id;
    if (Number.isInteger(raw.preset_slot) && raw.preset_slot !== 0) (bySlot[raw.preset_slot] ||= []).push(entry);
  }
  const labels = { head: 1, cape: 12, neck: 10, weapon: 4, body: 2, shield: 5, legs: 3, hands: 6, feet: 7, ring: 11, ammo: 9, pocket: 13 };
  const resolve = value => { const key = String(value || '').trim().toLowerCase(); return byAlias[key] || key; };
  const get = value => { const key = resolve(value); return byId[key] || bySlot[labels[key] || Number(key)]?.[0]; };
  catalogue = { byId, resolve, get, getUrl(value) { const e = get(value); if (!e) return undefined; return e.emoji_id ? `https://cdn.discordapp.com/emojis/${e.emoji_id}.png` : e.image ? (String(e.image).startsWith('http') ? e.image : `https://img.pvme.io/images/${e.image}`) : undefined; } }; return catalogue;
}
function slot(value, maps) { const id = maps.resolve(value?.id ?? value?.label ?? (typeof value === 'string' ? value : '')); const e = maps.get(id); return { id, name: e?.name || id, image: maps.getUrl(id) }; }
async function normalize(raw) {
  const maps = await loadCatalogue(AbortSignal.timeout(15_000)); const legacy = Array.isArray(raw?.equipmentSlots) && raw.equipmentSlots.length >= 13;
  const equipment = (Array.isArray(raw?.equipmentSlots) ? raw.equipmentSlots : []).filter((_, i) => !legacy || i !== 11).map(v => slot(v, maps));
  const legacyFam = raw?.familiars?.primaryFamiliars?.[0], legacyRelics = raw?.relics?.primaryRelics;
  return { presetName: raw?.presetName, inventorySlots: (Array.isArray(raw?.inventorySlots) ? raw.inventorySlots : []).slice(0, 28).map(v => slot(v, maps)), equipmentSlots: equipment.slice(0, 12), relics: (Array.isArray(raw?.relics) ? raw.relics : legacyRelics || []).slice(0, 3).map(v => slot(v, maps)), prayers: (Array.isArray(raw?.prayers) ? raw.prayers : []).slice(0, 3).map(v => slot(v, maps)), familiar: slot(raw?.familiar || legacyFam, maps), ammoSpells: (Array.isArray(raw?.ammoSpells) ? raw.ammoSpells : []).slice(0, 3).map(v => slot(v, maps)), aspect: slot(raw?.aspect, maps) };
}
export function makeEmbedRenderer({ fetchImageBytes } = {}) {
  return createRenderer({ createCanvas, loadImage, renderScale: 2, failOnImageError: true, fetchImageBytes,
    loadLocal: name => loadImage(fileURLToPath(new URL(`assets/${name}`, import.meta.url))), loadIconMap: loadCatalogue,
    normalizePresetToV2: normalize, resolveSlot: slot, resolveArray: (items, maps) => (items || []).map(v => slot(v, maps)) });
}
