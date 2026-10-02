const { normalizeLayout } = require("./layout");
const { join } = require("node:path");
const { GlobalFonts } = require("@napi-rs/canvas");

// Bundle the design fonts so local and static renders share the same metrics.
GlobalFonts.registerFromPath(join(__dirname, "../assets/fonts/PlayfairDisplay.ttf"), "Playfair Display");
GlobalFonts.registerFromPath(join(__dirname, "../assets/fonts/Inter.ttf"), "Inter");
function createRenderer({ createCanvas, loadImage, loadLocal, loadIconMap,
  resolveArray, resolveSlot, normalizePresetToV2, failOnImageError = false, fetchImageBytes, renderScale = 1 }) {
// -----------------------------------------------------
// Constants
// -----------------------------------------------------

const PRESET_WIDTH = 472;
const TITLE_HEIGHT = 28;

const FRAME_CORNER_SIZE = 4;
const FRAME_TOP_HEIGHT = 4;
const FRAME_SIDE_WIDTH = 4;

const SECTION_TITLE_HEIGHT = 18;
const HEADING_FAMILY = '"Playfair Display", "Cinzel", serif';
const SECTION_TITLE_FONT = `600 10.5px ${HEADING_FAMILY}`;
const TITLE_INITIAL_FONT = `600 14px ${HEADING_FAMILY}`;
const TITLE_REST_FONT = `600 12px ${HEADING_FAMILY}`;
const THEME = {
  gold: "#e7c779",
  brass: "#b89b58",
  border: "#7a6138",
  divider: "#5c492e",
  shadow: "#3b301f",
  background: "#0c0b0a",
  surface: "#151311",
  secondary: "#1c1a17",
  slot: "#100e0c",
};
const COMPACT_SLOT_SIZE = 32;
const ICON_ENVELOPE_SIZE = 30;
const COMPACT_SLOT_GAP = 4;
const FOOTER_PADDING = 14;
const SUPPORT_SECTION_GAP = 14;
const SUPPORT_LABEL_GAP = 10;
const SUPPORT_ROW_GAP = 8;
// Preserve the existing footer height budget while enlarging its contents.
const FOOTER_ROW_HEIGHT = 28;
const FOOTER_HEADING_HEIGHT = 14;

const RELICS_TITLE = "Relics";
const PRAYERS_TITLE = "Prayers";
const FAMILIAR_TITLE = "Familiar";
const AMMO_TITLE = "Ammo / Spells";
const ASPECT_TITLE = "Aspect";

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

function applyHeadingShadow(ctx) {
  ctx.shadowColor = "rgba(0, 0, 0, 0.85)";
  ctx.shadowBlur = 1.5;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
}

function titleGlyphs(ctx, text) {
  let wordStart = true;
  return Array.from(text.toUpperCase(), character => {
    const letter = /[\p{L}\p{N}]/u.test(character);
    const font = wordStart && letter ? TITLE_INITIAL_FONT : TITLE_REST_FONT;
    if (letter) wordStart = false;
    else if (/\s|[-/]/u.test(character)) wordStart = true;
    ctx.font = font;
    return { character, font, width: ctx.measureText(character).width + 0.6 };
  });
}

function drawPresetHeading(ctx, text, width) {
  ctx.save();
  ctx.fillStyle = THEME.gold;
  ctx.letterSpacing = "0px";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  applyHeadingShadow(ctx);
  const maxWidth = width - 24;
  let characters = Array.from(text);
  let glyphs = titleGlyphs(ctx, characters.join(""));
  const fits = () => glyphs.reduce((total, glyph) => total + glyph.width, 0) <= maxWidth;
  while (!fits() && characters.length) {
    characters.pop();
    glyphs = titleGlyphs(ctx, `${characters.join("").trimEnd()}…`);
  }
  let x = 12;
  for (const glyph of glyphs) {
    ctx.font = glyph.font;
    ctx.fillText(glyph.character, x, TITLE_HEIGHT / 2 + 4.5);
    x += glyph.width;
  }
  ctx.restore();
}

function drawFrame(ctx, x, y, width, height, assets, opacity = 1) {
  const { borderTop, borderSide, corner } = assets;
  ctx.save();
  ctx.globalAlpha = opacity;

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
  ctx.restore();
}

function drawSectionTitle(ctx, title, x, y, width, align = "center") {
  ctx.save();
  ctx.fillStyle = THEME.gold;
  ctx.font = SECTION_TITLE_FONT;
  ctx.letterSpacing = "0.8px";
  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 1;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";

  const textX =
    align === "left" ? x : align === "right" ? x + width : x + width / 2;

  ctx.fillText(title.toUpperCase(), textX, y + 11.5);
  ctx.restore();
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

async function drawCompactSlot(ctx, slot, x, y) {
  ctx.save();
  ctx.fillStyle = THEME.slot;
  ctx.fillRect(x, y, COMPACT_SLOT_SIZE, COMPACT_SLOT_SIZE);
  ctx.strokeStyle = "#493b27";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, COMPACT_SLOT_SIZE - 1, COMPACT_SLOT_SIZE - 1);
  // Keep the populated support slots quieter than the enclosing bronze frame.
  ctx.strokeStyle = "rgba(59, 48, 31, 0.32)";
  ctx.strokeRect(x + 1.5, y + 1.5, COMPACT_SLOT_SIZE - 3, COMPACT_SLOT_SIZE - 3);
  ctx.fillStyle = "rgba(0, 0, 0, 0.24)";
  ctx.fillRect(x + 2, y + 2, COMPACT_SLOT_SIZE - 4, 1);
  ctx.restore();
  const img = await loadResolvedImage(slot);

  if (img) drawContainedIcon(ctx, img, x, y, COMPACT_SLOT_SIZE, COMPACT_SLOT_SIZE);
}

const iconBoundsCache = new WeakMap();
function getIconBounds(img) {
  if (iconBoundsCache.has(img)) return iconBoundsCache.get(img);
  const source = createCanvas(img.width, img.height).getContext("2d");
  source.drawImage(img, 0, 0);
  const pixels = source.getImageData(0, 0, img.width, img.height).data;
  let left = img.width, top = img.height, right = -1, bottom = -1;
  for (let y = 0; y < img.height; y += 1) {
    for (let x = 0; x < img.width; x += 1) {
      if (!pixels[(y * img.width + x) * 4 + 3]) continue;
      left = Math.min(left, x); top = Math.min(top, y);
      right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  const bounds = right < 0 ? { x: 0, y: 0, width: img.width, height: img.height }
    : { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  iconBoundsCache.set(img, bounds);
  return bounds;
}

function drawContainedIcon(ctx, img, x, y, boxWidth, boxHeight) {
  const inset = 1;
  const availableWidth = boxWidth - inset * 2;
  const availableHeight = boxHeight - inset * 2;
  const bounds = getIconBounds(img);
  // Fit the visible sprite to the same target in every region, independently of
  // source PNG padding. Smaller equipment boxes still enforce their safety inset.
  const scale = Math.min(
    Math.min(ICON_ENVELOPE_SIZE, availableWidth) / bounds.width,
    Math.min(ICON_ENVELOPE_SIZE, availableHeight) / bounds.height,
  );
  const width = bounds.width * scale;
  const height = bounds.height * scale;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x + inset, y + inset, availableWidth, availableHeight);
  ctx.clip();
  ctx.drawImage(img, bounds.x, bounds.y, bounds.width, bounds.height,
    x + (boxWidth - width) / 2, y + (boxHeight - height) / 2, width, height);
  ctx.restore();
}

async function drawSupportSection(ctx, section, x, y, portrait) {
  drawSectionTitle(ctx, section.title, x, portrait ? y : y + 9, 0, "left");
  const slotsX = portrait ? x : x + section.labelWidth + SUPPORT_LABEL_GAP;
  const slotsY = portrait ? y + SECTION_TITLE_HEIGHT : y;
  for (let i = 0; i < section.items.length; i += 1) {
    await drawCompactSlot(ctx, section.items[i], slotsX + i * (COMPACT_SLOT_SIZE + COMPACT_SLOT_GAP), slotsY);
  }
}

function planSupportRows(preset, portrait, panelWidth) {
  const measure = createCanvas(1, 1).getContext("2d");
  measure.font = SECTION_TITLE_FONT;
  measure.letterSpacing = "0.8px";
  const sections = [
    [RELICS_TITLE, preset.relics, "left", 0],
    [AMMO_TITLE, preset.ammoSpells, "left", 1],
    [PRAYERS_TITLE, preset.prayers, "right", 0],
    [FAMILIAR_TITLE, [preset.familiar], "right", 1],
    [ASPECT_TITLE, [preset.aspect], "right", 1],
  ].flatMap(([title, slots, side, row]) => {
    const items = slots.filter(slot => slot?.image);
    if (!items.length) return [];
    const labelWidth = Math.ceil(measure.measureText(title.toUpperCase()).width);
    const slotsWidth = items.length * COMPACT_SLOT_SIZE + (items.length - 1) * COMPACT_SLOT_GAP;
    const width = portrait ? Math.max(labelWidth, slotsWidth) : labelWidth + SUPPORT_LABEL_GAP + slotsWidth;
    return [{ title, items, side, row, labelWidth, width }];
  });
  if (!sections.length) return [];
  const packedWidth = sections.reduce((sum, section) => sum + section.width, 0)
    + (sections.length - 1) * SUPPORT_SECTION_GAP;
  // Compact across the mockup's two bands whenever the real content fits.
  // Otherwise keep Relics/Prayers above Ammo/Familiar/Aspect.
  return packedWidth <= panelWidth - FOOTER_PADDING * 2
    ? [sections]
    : [0, 1].map(row => sections.filter(section => section.row === row)).filter(row => row.length);
}

function drawChromeFrame(ctx, x, y, width, height) {
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = THEME.border;
  ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
  ctx.strokeStyle = THEME.shadow;
  ctx.strokeRect(x + 2.5, y + 2.5, width - 5, height - 5);
  ctx.restore();
}

function drawChromeSurface(ctx, image, x, y, width, height, title = false) {
  drawTiledBackground(ctx, image, x, y, width, height);
  ctx.save();
  ctx.globalAlpha = title ? 0.35 : 0.58;
  ctx.fillStyle = THEME.surface;
  ctx.fillRect(x, y, width, height);
  ctx.globalAlpha = 1;
  const shade = ctx.createLinearGradient(0, y, 0, y + height);
  shade.addColorStop(0, title ? "rgba(92, 73, 46, 0.18)" : "rgba(28, 26, 23, 0.08)");
  shade.addColorStop(1, "rgba(12, 11, 10, 0.20)");
  ctx.fillStyle = shade;
  ctx.fillRect(x, y, width, height);
  ctx.restore();
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

  drawContainedIcon(ctx, img, x, y, boxW, boxH);
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
  preset.prayers = resolveArray(preset.prayers ?? [], iconMap);
  preset.ammoSpells = resolveArray(
    preset.ammoSpells ?? preset.AmmoSpells ?? [],
    iconMap,
  );
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
  const supportRows = planSupportRows(preset, portrait, panelWidth);
  const supportRowHeight = COMPACT_SLOT_SIZE + (portrait ? SECTION_TITLE_HEIGHT : 0);
  const footerRowHeight = FOOTER_ROW_HEIGHT + (portrait ? FOOTER_HEADING_HEIGHT : 0);
  const extrasPanelHeight = supportRows.length
    ? FOOTER_PADDING * 2 + supportRows.length * footerRowHeight + (supportRows.length - 1) * SUPPORT_ROW_GAP
    : 0;

  const canvasWidth = panelWidth;
  const canvasHeight = TITLE_HEIGHT + topPanelHeight + extrasPanelHeight;

  const canvas = createCanvas(canvasWidth * renderScale, canvasHeight * renderScale);
  const ctx = canvas.getContext("2d");
  ctx.scale(renderScale, renderScale);
  ctx.imageSmoothingQuality = "high";

  ctx.fillStyle = THEME.background;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);

  drawChromeSurface(ctx, extrasBackground, 0, 0, canvasWidth, TITLE_HEIGHT, true);
  drawChromeFrame(ctx, 0, 0, canvasWidth, TITLE_HEIGHT);
  drawPresetHeading(ctx, preset.presetName || "Unnamed preset", canvasWidth);

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

  if (extrasPanelHeight) {
    drawChromeSurface(ctx, extrasBackground, extrasX, extrasY, panelWidth, extrasPanelHeight);
    drawChromeFrame(ctx, extrasX, extrasY, panelWidth, extrasPanelHeight);
    const contentPadding = (extrasPanelHeight - supportRows.length * supportRowHeight
      - (supportRows.length - 1) * SUPPORT_ROW_GAP) / 2;
    for (const [rowIndex, sections] of supportRows.entries()) {
      const y = extrasY + contentPadding + rowIndex * (supportRowHeight + SUPPORT_ROW_GAP);
      if (rowIndex) {
        ctx.save();
        ctx.fillStyle = THEME.divider;
        ctx.globalAlpha = 0.45;
        ctx.fillRect(FOOTER_PADDING, y - SUPPORT_ROW_GAP / 2, panelWidth - FOOTER_PADDING * 2, 1);
        ctx.restore();
      }
      for (const side of ["left", "right"]) {
        const group = sections.filter(section => section.side === side);
        const width = group.reduce((sum, section) => sum + section.width, 0)
          + Math.max(0, group.length - 1) * SUPPORT_SECTION_GAP;
        let x = side === "left" ? FOOTER_PADDING : panelWidth - FOOTER_PADDING - width;
        for (const section of group) {
          await drawSupportSection(ctx, section, x, y, portrait);
          x += section.width + SUPPORT_SECTION_GAP;
        }
      }
    }
  }

  const buffer = canvas.toBuffer("image/png");

  return buffer;
}

return { renderPresetImage };
}
module.exports = { createRenderer };
