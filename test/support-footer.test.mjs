import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createCanvas, loadImage } from '@napi-rs/canvas';

const { createRenderer } = createRequire(import.meta.url)('../embed-renderer/lib/render-core.js');
const icon = createCanvas(20, 20);
icon.getContext('2d').fillRect(3, 3, 14, 14);
const item = { id: 'fixture', image: 'fixture' };
const empty = { id: '' };
const { renderPresetImage } = createRenderer({
  createCanvas, loadImage, failOnImageError: true,
  fetchImageBytes: async () => icon.toBuffer('image/png'),
  loadLocal: name => loadImage(fileURLToPath(new URL(`../embed-renderer/assets/${name}`, import.meta.url))),
  loadIconMap: async () => ({}), normalizePresetToV2: async preset => preset,
  resolveArray: items => items || [], resolveSlot: value => value,
});
const base = { presetName: 'Footer density', inventorySlots: [item], equipmentSlots: [item], relics: [] };
const sparse = { ...base, relics: [item, item], familiar: item };
const full = { ...sparse, relics: [item, item, item], prayers: [item, item, item], ammoSpells: [item, item, item], aspect: item };

for (const layout of ['7x4', '4x7']) {
  test(`${layout}: omit empty footer, compact sparse support, keep full support in two rows`, async () => {
    const images = await Promise.all([base, sparse, full].map(async preset => loadImage(await renderPresetImage(preset, layout))));
    const [bare, compact, populated] = images;
    assert.equal(compact.height - bare.height, layout === '4x7' ? 70 : 56);
    assert.equal(populated.height - bare.height, layout === '4x7' ? 120 : 92);
    // Support changes must not change any inventory, equipment, or title pixels.
    const pixels = image => {
      const canvas = createCanvas(bare.width, bare.height);
      canvas.getContext('2d').drawImage(image, 0, 0);
      return canvas.getContext('2d').getImageData(0, 0, bare.width, bare.height).data;
    };
    assert.deepEqual(pixels(compact), pixels(bare));
    assert.deepEqual(pixels(populated), pixels(bare));
  });

  test(`${layout}: empty sections and gaps never produce support placeholders`, async () => {
    const padded = { ...sparse, relics: [empty, item, null, item, empty], prayers: [empty, null], ammoSpells: [empty], aspect: empty };
    assert.deepEqual(await renderPresetImage(padded, layout), await renderPresetImage(sparse, layout));
    const allEmpty = { ...base, relics: [empty], prayers: [null], ammoSpells: [empty], familiar: empty, aspect: empty };
    assert.deepEqual(await renderPresetImage(allEmpty, layout), await renderPresetImage(base, layout));
  });
}
