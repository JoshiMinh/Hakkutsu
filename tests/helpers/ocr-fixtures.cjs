const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const bounds = ([x0, y0, x1, y1]) => ({ x0, y0, x1, y1 });
const intersects = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);

async function scanFixture(runtime, manifestPath, { selection, diagnostics, scale = 1, preprocess = true } = {}) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const imagePath = path.resolve(path.dirname(manifestPath), manifest.image);
  const image = await sharp(imagePath).resize(Math.round(manifest.width * scale), Math.round(manifest.height * scale)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const pixels = { data: new Uint8ClampedArray(image.data), width: image.info.width, height: image.info.height };
  const selected = selection ? bounds(selection.bbox.map(value => Math.round(value * scale))) : { x0: 0, y0: 0, x1: pixels.width, y1: pixels.height };
  const rawCrop = async (b, padding, cropScale = 1) => {
    const { data, info } = await sharp(image.data, { raw: { width: pixels.width, height: pixels.height, channels: 4 } })
      .extract({ left: b.x0, top: b.y0, width: b.x1 - b.x0, height: b.y1 - b.y0 })
      .resize(Math.round((b.x1 - b.x0) * cropScale), Math.round((b.y1 - b.y0) * cropScale))
      .extend({ top: padding, bottom: padding, left: padding, right: padding, background: 'white' }).raw().toBuffer({ resolveWithObject: true });
    const output = new Uint8ClampedArray(data);
    if (preprocess) runtime.cropper.applyMangaPreprocess({ getImageData: () => ({ data: output }), putImageData() {} }, info.width, info.height);
    const png = await sharp(Buffer.from(output), { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
    return { dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: info.width, height: info.height,
      bbox: b, transform: { originX: b.x0, originY: b.y0, scale: cropScale, padding } };
  };
  const local = await sharp(image.data, { raw: { width: pixels.width, height: pixels.height, channels: 4 } })
    .extract({ left: selected.x0, top: selected.y0, width: selected.x1 - selected.x0, height: selected.y1 - selected.y0 }).raw().toBuffer();
  let detected = runtime.bubbles.detectMangaDialogueRegions(pixels).flatMap(region => {
    const bbox = { x0: Math.max(selected.x0, region.bbox.x0), y0: Math.max(selected.y0, region.bbox.y0),
      x1: Math.min(selected.x1, region.bbox.x1), y1: Math.min(selected.y1, region.bbox.y1) };
    return bbox.x1 > bbox.x0 && bbox.y1 > bbox.y0 ? [{ ...region, bbox }] : [];
  });
  if (selection && !detected.length) detected = runtime.bubbles.detectMangaDialogueRegions({ data: new Uint8ClampedArray(local), width: selected.x1 - selected.x0, height: selected.y1 - selected.y0 }).map(region => ({
    ...region, bbox: { x0: region.bbox.x0 + selected.x0, y0: region.bbox.y0 + selected.y0, x1: region.bbox.x1 + selected.x0, y1: region.bbox.y1 + selected.y0 },
  }));
  const crops = await Promise.all(detected.map(async region => {
    const b = region.bbox;
    return { ...await rawCrop(b, 10, runtime.cropper.ocrCropScale(b.x1 - b.x0, b.y1 - b.y0, region.textSize)), id: `${manifest.id}:${selection?.id || 'page'}:${region.id}`, orientation: 'auto', adaptiveThreshold: preprocess,
      orientationHint: region.orientationAmbiguous ? undefined : region.orientation, textColumn: region.textColumn };
  }));
  if (selection && !crops.length) crops.push({ ...await rawCrop(selected, 10), id: `${manifest.id}:${selection.id}:manual`, orientation: 'auto' });
  diagnostics?.({ stage: 'grouping', reason: 'detected-crops', details: { crops: crops.map(({ dataUrl, ...crop }) => crop), selection, scale, preprocess } });
  const results = await runtime.engine.recognizeBatch(crops, undefined, diagnostics);
  const primary = results.flatMap(result => runtime.geometry.mapCropFragments(result.lines, crops.find(crop => crop.id === result.id), diagnostics));
  const full = await rawCrop(selected, 0);
  const page = await runtime.engine.recognize(full.dataUrl, { orientation: 'auto', boxWidth: full.width, boxHeight: full.height, diagnostics });
  const recovered = runtime.geometry.mapCropFragments(page.lines, { ...full, id: `${manifest.id}:${selection?.id || 'page'}:recovery` }, diagnostics);
  const options = { pixels, automatic: !selection, manual: Boolean(selection), diagnostics };
  const regions = runtime.pipeline.assembleOcrRegions(primary, recovered, options);
  const divide = b => ({ x0: b.x0 / scale, y0: b.y0 / scale, x1: b.x1 / scale, y1: b.y1 / scale });
  return { manifest, imagePath, regions: regions.map(region => ({ ...region, bbox: divide(region.bbox),
    fragments: region.fragments.map(fragment => runtime.geometry.transformOcrFragment(fragment, divide)) })), primary, recovered, detected };
}

/** Coverage and precision are one gate: eliminating all regions cannot pass. */
function checkAcceptance({ manifest, regions }, selection) {
  const errors = [];
  for (let i = 0; i < regions.length; i++) for (let j = i + 1; j < regions.length; j++) {
    if (intersects(regions[i].bbox, regions[j].bbox)) errors.push(`Intersecting regions: ${regions[i].text} / ${regions[j].text}`);
  }
  for (const forbidden of manifest.forbidden) for (const region of regions) {
    if (intersects(region.bbox, bounds(forbidden.bbox))) errors.push(`Artwork highlight: ${forbidden.id} / ${region.text}`);
  }
  const expected = manifest.passages.filter(passage => !selection || selection.passages.includes(passage.id));
  if (regions.length !== expected.length) errors.push(`Expected ${expected.length} passages, got ${regions.length} regions`);
  const matches = new Map();
  for (const passage of expected) {
    const envelope = bounds(passage.envelope);
    const matched = regions.filter(region => intersects(region.bbox, envelope));
    if (matched.length !== 1) { errors.push(`${passage.id}: expected one region, got ${matched.length}`); continue; }
    const region = matched[0];
    matches.set(passage.id, region);
    if (region.orientation !== passage.orientation) errors.push(`${passage.id}: wrong orientation`);
    if (region.bbox.x0 < envelope.x0 || region.bbox.y0 < envelope.y0 || region.bbox.x1 > envelope.x1 || region.bbox.y1 > envelope.y1) errors.push(`${passage.id}: bounds exceed allowed envelope`);
    // P0 measures available glyph coverage; exact transcription is reported
    // separately so recognizer character errors cannot conceal missing columns.
    for (const column of passage.columns) {
      const count = [...column.text].length;
      const b = bounds([column.x, column.y, column.x + (column.step ? column.size : column.size * count), column.y + (column.step ? (count - 1) * column.step + column.size : column.size)]);
      const coverage = region.fragments.filter(f => intersects(f.bbox, b));
      if (!coverage.length) { errors.push(`${passage.id}: missing column ${column.text}`); continue; }
      const along = passage.orientation === 'vertical' ? ['y0', 'y1'] : ['x0', 'x1'];
      const low = Math.min(...coverage.map(f => f.bbox[along[0]])), high = Math.max(...coverage.map(f => f.bbox[along[1]]));
      if (low > b[along[0]] + column.size || high < b[along[1]] - column.size) errors.push(`${passage.id}: incomplete column ${column.text}`);
      for (let index = 0; index < count; index++) {
        const center = column.step ? column.y + index * column.step + column.size * .5 : column.x + index * column.size + column.size * .5;
        if (!coverage.some(f => f.bbox[along[0]] <= center + column.size * .2 && f.bbox[along[1]] >= center - column.size * .2)) errors.push(`${passage.id}: uncovered glyph ${index + 1}`);
      }
      if (coverage.reduce((sum, f) => sum + [...f.text].length, 0) < count * .75) errors.push(`${passage.id}: insufficient readable text`);
    }
    if (!/[\u3040-\u30ff\u3400-\u9fff]/u.test(region.text)) errors.push(`${passage.id}: unreadable dialogue`);
  }
  if (new Set(matches.values()).size !== matches.size) errors.push('Separate passages/speakers share one region');
  for (const reading of manifest.furigana || []) {
    const body = matches.get(reading.body);
    if (body?.text.includes(reading.text)) errors.push(`${reading.body}: duplicated furigana pronunciation`);
    if (body && (body.bbox.x1 < reading.x + reading.size * .5 || body.bbox.y1 < reading.y + reading.step * ([...reading.text].length - 1))) errors.push(`${reading.body}: missing furigana bounds`);
  }
  return errors;
}
module.exports = { scanFixture, checkAcceptance, intersects, bounds };
