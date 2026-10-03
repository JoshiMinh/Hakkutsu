const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');
const { createOcrRuntime, root } = require('./helpers/ocr-runtime.cjs');
const { scanFixture, checkAcceptance, intersects, bounds } = require('./helpers/ocr-fixtures.cjs');

async function main() {
  const manifestPath = path.join(root, 'tests/fixtures/reliable-regions.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const runtime = createOcrRuntime();
  const output = path.join(root, 'test-results/ocr');
  fs.mkdirSync(output, { recursive: true });
  let failures = 0;
  try {
    for (const selection of [undefined, ...manifest.selections]) {
      const events = [];
      const result = await scanFixture(runtime, manifestPath, { selection, diagnostics: event => events.push(event) });
      const errors = checkAcceptance(result, selection);
      failures += errors.length;
      const id = selection?.id || 'full-page';
      const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
      const report = { fixture: manifest.id, source: manifest.source, imageSha256: hash(result.imagePath), selection,
        models: { jpn: hash(path.join(root, 'public/ocr/jpn.traineddata.gz')), jpn_vert: hash(path.join(root, 'public/ocr/jpn_vert.traineddata.gz')) },
        transcripts: manifest.passages.filter(passage => !selection || selection.passages.includes(passage.id)).map(passage => ({
          passage: passage.id, expected: passage.text, actual: result.regions.filter(region => intersects(region.bbox, bounds(passage.envelope))).map(region => region.text).join(' / '),
        })),
        errors, regions: result.regions, events };
      fs.writeFileSync(path.join(output, `${id}.json`), `${JSON.stringify(report, null, 2)}\n`);
      const rectangles = result.regions.map(region => `<rect x="${region.bbox.x0}" y="${region.bbox.y0}" width="${region.bbox.x1-region.bbox.x0}" height="${region.bbox.y1-region.bbox.y0}" fill="#38bdf8" fill-opacity=".12" stroke="#0077aa" stroke-width="2"/>`).join('');
      const overlay = Buffer.from(`<svg width="${manifest.width}" height="${manifest.height}">${rectangles}</svg>`);
      await sharp(result.imagePath).composite([{ input: overlay }]).png().toFile(path.join(output, `${id}.png`));
      console.log(`${id}: ${result.regions.length} regions; ${errors.length} acceptance failures`);
      console.log(result.regions.map(region => region.text).join(' / '));
      errors.forEach(error => console.error(`  ${error}`));
    }
  } finally { await runtime.engine.terminate(); }
  console.log(`Local reports: ${output}`);
  if (failures) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
