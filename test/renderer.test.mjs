import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage, GlobalFonts } from '@napi-rs/canvas';

const { createRenderer } = createRequire(import.meta.url)('../embed-renderer/lib/render-core.js');
GlobalFonts.registerFromPath(fileURLToPath(new URL('../embed-renderer/assets/PlayfairDisplay.ttf', import.meta.url)), 'Playfair Display');

function renderer() {
  const labels = [];
  const icon = createCanvas(30, 30).toBuffer('image/png');
  const instance = createRenderer({
    createCanvas: (width, height) => {
      const canvas = createCanvas(width, height), ctx = canvas.getContext('2d');
      const fillText = ctx.fillText.bind(ctx);
      ctx.fillText = (text, ...args) => { labels.push(text); return fillText(text, ...args); };
      return canvas;
    },
    loadImage,
    loadLocal: name => loadImage(fileURLToPath(new URL(`../embed-renderer/assets/${name}`, import.meta.url))),
    loadIconMap: async () => ({}),
    normalizePresetToV2: async preset => ({ inventorySlots: [], equipmentSlots: [], relics: [], ...preset }),
    resolveArray: items => items || [],
    resolveSlot: item => item || {},
    fetchImageBytes: async () => icon,
  });
  return { ...instance, labels };
}
const item = { id: 'example', image: 'https://icons.test/example.png', name: 'Old item card name' };

test('empty support sections add no panel or headings in either layout', async () => {
  for (const [layout, width, height] of [['7x4', 472, 196], ['4x7', 381, 330]]) {
    const { renderPresetImage, labels } = renderer();
    const image = await loadImage(await renderPresetImage({ presetName: 'Empty' }, layout));
    assert.equal(image.width, width); assert.equal(image.height, height);
    assert.deepEqual(labels, ['Empty']);
  }
});

test('populated support uses compact slots without item-name cards', async () => {
  for (const [layout, height] of [['7x4', 256], ['4x7', 404]]) {
    const { renderPresetImage, labels } = renderer();
    const image = await loadImage(await renderPresetImage({ relics: [item] }, layout));
    assert.equal(image.height, height);
    assert.equal(labels.slice(1).join(''), 'RELICS');
    assert.ok(!labels.includes(item.name));
  }
});

test('all five populated support sections wrap and include prayers', async () => {
  for (const [layout, height] of [['7x4', 316], ['4x7', 478]]) {
    const { renderPresetImage, labels } = renderer();
    const image = await loadImage(await renderPresetImage({ relics: [item, item, item], ammoSpells: [item, item, item], prayers: [item, item, item], familiar: item, aspect: item }, layout));
    assert.equal(image.height, height);
    assert.equal(labels.slice(1).join(''), 'RELICSPRAYERSAMMO / SPELLSFAMILIARASPECT');
  }
});
