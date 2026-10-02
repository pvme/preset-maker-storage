const { normalizeLayout } = require("./layout");
function createRenderer({ createCanvas, loadImage, loadLocal, loadIconMap,
  resolveArray, resolveSlot, normalizePresetToV2, failOnImageError = false, fetchImageBytes, renderScale = 1 }) {
// -----------------------------------------------------
// Constants
// -----------------------------------------------------

const PRESET_WIDTH = 472;
const TITLE_HEIGHT = 34;

const FRAME_CORNER_SIZE = 4;
const FRAME_TOP_HEIGHT = 4;
const FRAME_SIDE_WIDTH = 4;

const EXTRAS_PADDING_X = 18;
const EXTRAS_GAP_X = 14;
const SUPPORT_SLOT_SIZE = 32;
const SUPPORT_SLOT_GAP = 4;
const SECTION_TITLE_FONT = '600 10.5px "Playfair Display"';

// Desktop coords from UI
const SLOT_METRICS = {
  inventory: {
    width: 38,
    height: 34,
    slotBoxWidth: 36,
    slotBoxHeight: 32,
  },
  equipment: {
    width: 32,
    height: 34,
    slotBoxWidth: 32,
    slotBoxHeight: 29,
  },
};

const inventoryCoords = Array.from({ length: 28 }, (_, index) => {
  const column = index % 7;
  const row = Math.floor(index / 7);
  return {
    x: 7 + column * 44,
    y: 7 + row * 36,
  };
});

const equipmentCoords = Array.from({ length: 12 }, (_, index) => {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return {
    x: 334 + column * 49,
    y: 7 + row * 38,
  };
});

// -----------------------------------------------------
// Helpers
// -----------------------------------------------------

function rgba(r, g, b, a) {
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function ellipsiseText(ctx, text, maxWidth) {
  if (!text) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;

  let output = text;
  while (
    output.length > 0 &&
    ctx.measureText(`${output}...`).width > maxWidth
  ) {
    output = output.slice(0, -1);
  }

  return output ? `${output}...` : "";
}

function drawFrame(ctx, x, y, width, height, assets) {
  const { borderTop, borderSide, corner } = assets;

  ctx.drawImage(corner, x, y, FRAME_CORNER_SIZE, FRAME_CORNER_SIZE);

  ctx.save();
  ctx.translate(x + width, y);
  ctx.scale(-1, 1);
  ctx.drawImage(corner, 0, 0, FRAME_CORNER_SIZE, FRAME_CORNER_SIZE);
  ctx.restore();

  ctx.save();
  ctx.translate(x, y + height);
  ctx.scale(1, -1);
  ctx.drawImage(corner, 0, 0, FRAME_CORNER_SIZE, FRAME_CORNER_SIZE);
  ctx.restore();

  ctx.save();
  ctx.translate(x + width, y + height);
  ctx.scale(-1, -1);
  ctx.drawImage(corner, 0, 0, FRAME_CORNER_SIZE, FRAME_CORNER_SIZE);
  ctx.restore();

  for (let px = x + 4; px < x + width - 4; px += 3) {
    const w = Math.min(3, x + width - 4 - px);
    ctx.drawImage(borderTop, 0, 0, 3, 4, px, y, w, FRAME_TOP_HEIGHT);

    ctx.save();
    ctx.translate(0, y + height);
    ctx.scale(1, -1);
    ctx.drawImage(borderTop, 0, 0, 3, 4, px, 0, w, FRAME_TOP_HEIGHT);
    ctx.restore();
  }

  for (let py = y + 4; py < y + height - 4; py += 3) {
    const h = Math.min(3, y + height - 4 - py);
    ctx.drawImage(borderSide, 0, 0, 4, 3, x, py, FRAME_SIDE_WIDTH, h);

    ctx.save();
    ctx.translate(x + width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(borderSide, 0, 0, 4, 3, 0, py, FRAME_SIDE_WIDTH, h);
    ctx.restore();
  }
}

const imageCache = new Map();
async function loadResolvedImage(slot) {
  if (!slot?.image) return null;
  if (imageCache.has(slot.image)) return imageCache.get(slot.image);
  const loading = (async () => { try {
    let buffer;
    if (fetchImageBytes) buffer = await fetchImageBytes(slot.image);
    else {
      const res = await fetch(slot.image, { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      buffer = Buffer.from(await res.arrayBuffer());
    }
    return await loadImage(buffer);
  } catch (error) {
    imageCache.delete(slot.image);
    if (failOnImageError) throw error;
    console.warn(`Unable to load icon ${slot.id}: ${error.message}`);
    return null;
  } })();
  if (imageCache.size >= 512) imageCache.clear();
  imageCache.set(slot.image, loading);
  return loading;
}

// The support layout mirrors PresetEditor: only populated sections are shown,
// with compact icon slots and gold labels rather than named item cards.
function supportRows(preset, portrait, panelWidth) {
  const sections = [
    { title: "Relics", items: preset.relics, max: 3, row: 0, side: "left" },
    { title: "Ammo / Spells", items: preset.ammoSpells, max: 3, row: 1, side: "left" },
    { title: "Prayers", items: preset.prayers, max: 3, row: 0, side: "right" },
    { title: "Familiar", items: [preset.familiar], max: 1, row: 1, side: "right" },
    { title: "Aspect", items: [preset.aspect], max: 1, row: 1, side: "right" },
  ].map(section => {
    const items = (section.items || []).slice(0, section.max).filter(item => item?.id && item.image);
    const slotsWidth = items.length * SUPPORT_SLOT_SIZE + Math.max(0, items.length - 1) * SUPPORT_SLOT_GAP;
    return { ...section, items, slotsWidth,
      width: portrait ? Math.max(slotsWidth, section.title.length * 7) : slotsWidth + section.title.length * 7 + 10 };
  }).filter(section => section.items.length);
  const width = sections.reduce((sum, section) => sum + section.width, 0) + Math.max(0, sections.length - 1) * EXTRAS_GAP_X;
  return !sections.length ? [] : width <= panelWidth - 28 ? [sections]
    : [0, 1].map(row => sections.filter(section => section.row === row)).filter(row => row.length);
}

async function drawSupportSection(ctx, section, x, y, portrait) {
  ctx.save();
  ctx.fillStyle = "#e7c779";
  ctx.font = SECTION_TITLE_FONT;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const title = section.title.toUpperCase();
  let labelX = x;
  for (const character of title) {
    ctx.fillText(character, labelX, y + (portrait ? 6 : 16));
    labelX += ctx.measureText(character).width + 0.8;
  }
  ctx.restore();
  const slotsX = portrait ? x : labelX + 9.2;
  const slotsY = y + (portrait ? 18 : 0);
  for (const [i, slot] of section.items.entries()) {
    const sx = slotsX + i * (SUPPORT_SLOT_SIZE + SUPPORT_SLOT_GAP);
    ctx.fillStyle = "#100e0c";
    ctx.fillRect(sx, slotsY, 32, 32);
    ctx.strokeStyle = "#493b27";
    ctx.lineWidth = 1;
    ctx.strokeRect(sx + 0.5, slotsY + 0.5, 31, 31);
    const image = await loadResolvedImage(slot);
    if (image) {
      const scale = Math.min(30 / image.width, 30 / image.height);
      const w = image.width * scale, h = image.height * scale;
      ctx.drawImage(image, sx + (32 - w) / 2, slotsY + (32 - h) / 2, w, h);
    }
  }
}

async function drawSupportRows(ctx, rows, y, width, portrait) {
  const paddingY = portrait ? 12 : 14;
  const gapY = portrait ? 24 : 28;
  const rowHeight = portrait ? 50 : 32;
  const availableWidth = width - EXTRAS_PADDING_X * 2;
  for (const [index, row] of rows.entries()) {
    const rowY = y + paddingY + index * (rowHeight + gapY);
    if (index) {
      ctx.fillStyle = "rgba(92, 73, 46, 0.45)";
      ctx.fillRect(EXTRAS_PADDING_X, rowY - gapY / 2, availableWidth, 1);
    }
    const totalWidth = row.reduce((sum, section) => sum + section.width, 0) + (row.length - 1) * EXTRAS_GAP_X;
    const firstRight = row.findIndex(section => section.side === "right");
    const singleRight = portrait && row.some(section => section.side === "right" && section.max === 1);
    let x = EXTRAS_PADDING_X;
    for (const [i, section] of row.entries()) {
      if (i === firstRight && i > 0) {
        if (portrait && !singleRight) x = EXTRAS_PADDING_X + availableWidth / 2;
        else x += Math.max(0, availableWidth - totalWidth);
      }
      await drawSupportSection(ctx, section, x, rowY, portrait);
      x += section.width + EXTRAS_GAP_X;
    }
  }
}

function drawTiledBackground(ctx, image, x, y, width, height) {
  for (let py = y; py < y + height; py += image.height) {
    for (let px = x; px < x + width; px += image.width) {
      const drawW = Math.min(image.width, x + width - px);
      const drawH = Math.min(image.height, y + height - py);
      ctx.drawImage(image, 0, 0, drawW, drawH, px, py, drawW, drawH);
    }
  }
}

async function drawSlotAtCoord(ctx, slot, coord, metric, options = {}) {
  if (!slot?.image) return;

  const img = await loadResolvedImage(slot);
  if (!img) return;

  const boxW = metric.slotBoxWidth;
  const boxH = metric.slotBoxHeight;
  const x = coord.x + (metric.width - boxW) / 2;
  const y = coord.y + (metric.height - boxH) / 2;

  if (options.slotBackground) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, boxW, boxH);
    ctx.clip();
    ctx.globalAlpha = 1;
    ctx.drawImage(options.slotBackground, x, y, boxW, boxH);
    ctx.restore();
  }

  const scale = Math.min(boxW / img.width, boxH / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  const dx = x + (boxW - w) / 2;
  const dy = y + (boxH - h) / 2;

  ctx.drawImage(img, dx, dy, w, h);
}

// -----------------------------------------------------
// Main render
// -----------------------------------------------------

async function renderPresetImage(rawPreset, layout) {
  const portrait = normalizeLayout(layout) === "4x7";
  const preset = await normalizePresetToV2(structuredClone(rawPreset));
  const invCoords = portrait ? Array.from({ length: 28 }, (_, i) => ({
    x: 12 + (i % 4) * 45, y: 12 + Math.floor(i / 4) * 39,
  })) : inventoryCoords;
  const eqCoords = portrait ? [
    [1, 0], [0.25, 1], [1, 1], [0, 2], [1, 2], [2, 2],
    [1, 3], [0, 4], [1, 4], [2, 4], [1.75, 1], [1.75, 0],
  ].map(([col, row]) => ({ x: 202 + 14 + col * 59, y: 46 + row * 44 })) : equipmentCoords;
  const panelWidth = portrait ? 381 : PRESET_WIDTH;

  const iconMap = await loadIconMap();

  preset.inventorySlots = resolveArray(preset.inventorySlots, iconMap);
  preset.equipmentSlots = resolveArray(preset.equipmentSlots, iconMap);
  preset.relics = resolveArray(preset.relics, iconMap);
  preset.ammoSpells = resolveArray(
    preset.ammoSpells ?? preset.AmmoSpells ?? [],
    iconMap,
  );
  preset.prayers = resolveArray(preset.prayers || [], iconMap);
  preset.familiar = resolveSlot(preset.familiar, iconMap);
  preset.aspect = resolveSlot(preset.aspect, iconMap);

  await Promise.all([
    ...preset.inventorySlots, ...preset.equipmentSlots, ...preset.relics,
    ...preset.ammoSpells, ...preset.prayers, preset.familiar, preset.aspect,
  ].map(loadResolvedImage));

  const [presetMapDesktop, extrasBackground, borderTop, borderSide, corner] =
    await Promise.all([
      loadLocal("presetmap_desktop.png"),
      loadLocal("bg.png"),
      loadLocal("border-top.png"),
      loadLocal("border-side.png"),
      loadLocal("corner.png"),
    ]);

  const frameAssets = { borderTop, borderSide, corner };

  const topPanelHeight = portrait ? 296 : presetMapDesktop.height;
  const rows = supportRows(preset, portrait, panelWidth);
  const extrasPanelHeight = rows.length ? (portrait ? 24 : 28)
    + rows.length * (portrait ? 50 : 32) + (rows.length - 1) * (portrait ? 24 : 28) : 0;

  const canvasWidth = panelWidth;
  const canvasHeight = TITLE_HEIGHT + topPanelHeight + extrasPanelHeight;

  const canvas = createCanvas(canvasWidth * renderScale, canvasHeight * renderScale);
  const ctx = canvas.getContext("2d");
  ctx.scale(renderScale, renderScale);
  ctx.imageSmoothingQuality = "high";

  ctx.fillStyle = "#17120f";
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  ctx.save();
  ctx.fillStyle = "#e7c779";
  ctx.font = "700 18px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(
    ellipsiseText(ctx, preset.presetName || "Unnamed preset", canvasWidth - 16),
    canvasWidth / 2,
    TITLE_HEIGHT / 2,
  );
  ctx.restore();

  const topX = 0;
  const topY = TITLE_HEIGHT;

  if (portrait) {
    drawTiledBackground(ctx, extrasBackground, 0, topY, panelWidth, topPanelHeight);
    // Match the frontend's body-shaped equipment arrangement and sprite crops.
    ctx.save();
    ctx.translate(202, topY);
    ctx.strokeStyle = "#454134";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(89, 63); ctx.lineTo(89, 239);
    ctx.moveTo(30, 151); ctx.lineTo(148, 151);
    ctx.moveTo(30, 151); ctx.lineTo(30, 239);
    ctx.moveTo(148, 151); ctx.lineTo(148, 239);
    ctx.stroke(); ctx.restore();
    for (const [coords, slots, metric, equipment] of [
      [invCoords, preset.inventorySlots, SLOT_METRICS.inventory, false],
      [eqCoords, preset.equipmentSlots, SLOT_METRICS.equipment, true],
    ]) {
      coords.forEach((coord, i) => {
        const source = equipment && !slots[i]?.id ? equipmentCoords[i] : { x: 7, y: 7 };
        ctx.drawImage(presetMapDesktop, source.x, source.y, metric.width, metric.height,
          coord.x, topY + coord.y, metric.width, metric.height);
      });
    }
    drawFrame(ctx, 0, topY, 197, topPanelHeight, frameAssets);
    drawFrame(ctx, 202, topY, 179, topPanelHeight, frameAssets);
  } else {
    ctx.drawImage(presetMapDesktop, topX, topY);
    drawFrame(ctx, topX, topY, panelWidth, topPanelHeight, frameAssets);
  }

  for (
    let i = 0;
    i < Math.min(preset.inventorySlots.length, invCoords.length);
    i += 1
  ) {
    await drawSlotAtCoord(
      ctx,
      preset.inventorySlots[i],
      { x: topX + invCoords[i].x, y: topY + invCoords[i].y },
      SLOT_METRICS.inventory,
    );
  }

  for (
    let i = 0;
    i < Math.min(preset.equipmentSlots.length, eqCoords.length);
    i += 1
  ) {
    await drawSlotAtCoord(
      ctx,
      preset.equipmentSlots[i],
      { x: topX + eqCoords[i].x, y: topY + eqCoords[i].y },
      SLOT_METRICS.equipment,
      { slotBackground: extrasBackground },
    );
  }

  const extrasX = 0;
  const extrasY = topY + topPanelHeight;

  if (rows.length) {
    drawTiledBackground(ctx, extrasBackground, extrasX, extrasY, panelWidth, extrasPanelHeight);
    const shade = ctx.createLinearGradient(0, extrasY, 0, extrasY + extrasPanelHeight);
    shade.addColorStop(0, "rgba(21, 19, 17, 0.58)");
    shade.addColorStop(1, "rgba(12, 11, 10, 0.70)");
    ctx.fillStyle = shade;
    ctx.fillRect(extrasX, extrasY, panelWidth, extrasPanelHeight);
    drawFrame(ctx, extrasX, extrasY, panelWidth, extrasPanelHeight, frameAssets);
    await drawSupportRows(ctx, rows, extrasY, panelWidth, portrait);
  }

  const buffer = canvas.toBuffer("image/png");

  return buffer;
}

return { renderPresetImage };
}
module.exports = { createRenderer };
