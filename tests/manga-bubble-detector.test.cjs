const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function loadBubbleDetector() {
  const source = ts.transpileModule(
    fs.readFileSync("src/features/ocr/ocr-bubbles.ts", "utf8"),
    {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }
  ).outputText;
  const context = {
    exports: {},
    require: (name) => {
      if (name === "./ocr-engine") return {};
      return require(name);
    },
  };
  vm.runInNewContext(source, context);
  return context.exports;
}

test("detectMangaDialogueRegions detects oval speech bubble with vertical text lines", () => {
  const { detectMangaDialogueRegions } = loadBubbleDetector();
  const width = 600;
  const height = 800;
  const data = new Uint8ClampedArray(width * height * 4);

  // Fill with medium gray background (screentone / artwork, lum = 150)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 150;
    data[i * 4 + 1] = 150;
    data[i * 4 + 2] = 150;
    data[i * 4 + 3] = 255;
  }

  // Draw an oval white speech bubble at center (cx: 350, cy: 300, rx: 100, ry: 150)
  const cx = 350;
  const cy = 300;
  const rx = 100;
  const ry = 150;

  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        const idx = (y * width + x) * 4;
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
      }
    }
  }

  // Add vertical black text strokes inside the bubble
  // 2 vertical columns of text characters
  for (const colX of [370, 330]) {
    for (let block = 0; block < 4; block++) {
      const charY = cy - 80 + block * 40;
      for (let y = charY; y < charY + 25; y++) {
        for (let x = colX - 5; x <= colX + 5; x++) {
          if ((x === colX - 5 || x === colX + 5 || y === charY || y === charY + 12 || y === charY + 24)) {
            const idx = (y * width + x) * 4;
            data[idx] = 10;
            data[idx + 1] = 10;
            data[idx + 2] = 10;
          }
        }
      }
    }
  }

  const regions = detectMangaDialogueRegions({ data, width, height });
  assert.ok(regions.length >= 1, "Should detect at least 1 speech bubble");
  const bubble = regions[0];
  assert.equal(bubble.type, "bubble");
  assert.equal(bubble.orientation, "vertical");
  assert.ok(bubble.bbox.x0 < 340 && bubble.bbox.x1 > 360, "Bounding box should encompass the text columns");
  assert.ok(bubble.bbox.y0 < 250 && bubble.bbox.y1 > 350, "Bounding box should encompass the text height");
});

test("detectMangaDialogueRegions ignores empty white regions with no text", () => {
  const { detectMangaDialogueRegions } = loadBubbleDetector();
  const width = 400;
  const height = 400;
  const data = new Uint8ClampedArray(width * height * 4);

  // Fill with dark gray
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 60;
    data[i * 4 + 1] = 60;
    data[i * 4 + 2] = 60;
    data[i * 4 + 3] = 255;
  }

  // Pure white empty rectangle (e.g. wall/clothes) with no dark ink inside
  for (let y = 100; y <= 300; y++) {
    for (let x = 100; x <= 300; x++) {
      const idx = (y * width + x) * 4;
      data[idx] = 255;
      data[idx + 1] = 255;
      data[idx + 2] = 255;
    }
  }

  const regions = detectMangaDialogueRegions({ data, width, height });
  assert.equal(regions.length, 0, "Empty white region without ink strokes must not be detected as dialogue");
});

test("detectMangaDialogueRegions detects borderless text cluster", () => {
  const { detectMangaDialogueRegions } = loadBubbleDetector();
  const width = 500;
  const height = 500;
  const data = new Uint8ClampedArray(width * height * 4);

  // Fill with light background (lum = 230)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 230;
    data[i * 4 + 1] = 230;
    data[i * 4 + 2] = 230;
    data[i * 4 + 3] = 255;
  }

  // Draw borderless vertical text lines (e.g. thoughts/shout)
  const colX = 250;
  for (let block = 0; block < 5; block++) {
    const charY = 100 + block * 45;
    for (let y = charY; y < charY + 30; y++) {
      for (let x = colX - 8; x <= colX + 8; x++) {
        if (x === colX - 8 || x === colX + 8 || y === charY || y === charY + 15 || y === charY + 29) {
          const idx = (y * width + x) * 4;
          data[idx] = 15;
          data[idx + 1] = 15;
          data[idx + 2] = 15;
        }
      }
    }
  }

  const regions = detectMangaDialogueRegions({ data, width, height });
  assert.ok(regions.length >= 1, "Should detect borderless text cluster");
});

test("detectMangaDialogueRegions sorts regions in manga reading order (right-to-left, top-to-bottom)", () => {
  const { detectMangaDialogueRegions } = loadBubbleDetector();
  const width = 800;
  const height = 1000;
  const data = new Uint8ClampedArray(width * height * 4);

  // Background
  data.fill(130);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;

  function drawBubbleWithText(cx, cy, rx, ry) {
    for (let y = cy - ry; y <= cy + ry; y++) {
      for (let x = cx - rx; x <= cx + rx; x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) {
          const idx = (y * width + x) * 4;
          data[idx] = 255;
          data[idx + 1] = 255;
          data[idx + 2] = 255;
        }
      }
    }
    // Dark glyphs
    for (let block = 0; block < 3; block++) {
      const charY = cy - 20 + block * 20;
      for (let y = charY; y < charY + 12; y++) {
        for (let x = cx - 5; x <= cx + 5; x++) {
          if (x === cx - 5 || x === cx + 5 || y === charY || y === charY + 6 || y === charY + 11) {
            const idx = (y * width + x) * 4;
            data[idx] = 10;
            data[idx + 1] = 10;
            data[idx + 2] = 10;
          }
        }
      }
    }
  }

  // Draw 3 bubbles:
  // Bubble 1: Top-Right (cx: 650, cy: 150) -> should be #1 in manga reading order
  drawBubbleWithText(650, 150, 70, 90);
  // Bubble 2: Top-Left (cx: 200, cy: 150) -> should be #2
  drawBubbleWithText(200, 150, 70, 90);
  // Bubble 3: Bottom-Right (cx: 600, cy: 750) -> should be #3
  drawBubbleWithText(600, 750, 70, 90);

  const regions = detectMangaDialogueRegions({ data, width, height });
  assert.equal(regions.length, 3, "Should detect all 3 bubbles");

  // Verify manga reading order: Top-Right first, then Top-Left, then Bottom
  assert.ok(regions[0].bbox.x0 > 500 && regions[0].bbox.y0 < 300, "First bubble should be Top-Right");
  assert.ok(regions[1].bbox.x0 < 350 && regions[1].bbox.y0 < 300, "Second bubble should be Top-Left");
  assert.ok(regions[2].bbox.y0 > 600, "Third bubble should be Bottom panel");
});

test("detectMangaDialogueRegions keeps multi-line vertical dialogue bubble unified into a single box (no splitting)", () => {
  const { detectMangaDialogueRegions } = loadBubbleDetector();
  const width = 600;
  const height = 800;
  const data = new Uint8ClampedArray(width * height * 4);

  // Screentone background
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 160;
    data[i * 4 + 1] = 160;
    data[i * 4 + 2] = 160;
    data[i * 4 + 3] = 255;
  }

  // Large white speech bubble: center (300, 400), rx = 120, ry = 180
  const cx = 300, cy = 400, rx = 120, ry = 180;
  for (let y = cy - ry; y <= cy + ry; y++) {
    for (let x = cx - rx; x <= cx + rx; x++) {
      const dx = (x - cx) / rx;
      const dy = (y - cy) / ry;
      if (dx * dx + dy * dy <= 1) {
        const idx = (y * width + x) * 4;
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
      }
    }
  }

  // 4 dense vertical lines of text, with characters traversing across the height of the bubble
  const columnXs = [360, 320, 280, 240];
  for (const colX of columnXs) {
    for (let block = 0; block < 6; block++) {
      const charY = cy - 120 + block * 40;
      for (let y = charY; y < charY + 28; y++) {
        for (let x = colX - 6; x <= colX + 6; x++) {
          if (x === colX - 6 || x === colX + 6 || y === charY || y === charY + 14 || y === charY + 27) {
            const idx = (y * width + x) * 4;
            data[idx] = 10;
            data[idx + 1] = 10;
            data[idx + 2] = 10;
          }
        }
      }
    }
  }

  const regions = detectMangaDialogueRegions({ data, width, height });
  assert.equal(regions.length, 1, "Dense multi-column bubble should result in exactly 1 unified bounding box, not split");
  assert.ok(regions[0].bbox.y0 <= cy - 100 && regions[0].bbox.y1 >= cy + 100, "Bounding box should cover all lines vertically");
  assert.ok(regions[0].bbox.x0 <= 240 && regions[0].bbox.x1 >= 360, "Bounding box should cover all lines horizontally");
});

test("detectMangaDialogueRegions rejects cheek blush lines and artwork noise", () => {
  const { detectMangaDialogueRegions } = loadBubbleDetector();
  const width = 400;
  const height = 400;
  const data = new Uint8ClampedArray(width * height * 4);

  // Pale character skin background (lum = 245)
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = 245;
    data[i * 4 + 1] = 245;
    data[i * 4 + 2] = 245;
    data[i * 4 + 3] = 255;
  }

  // Draw 3 small cheek blush lines '///': short diagonal strokes (width ~12px, height ~18px)
  for (let i = 0; i < 3; i++) {
    const startX = 180 + i * 14;
    const startY = 190;
    for (let offset = 0; offset < 16; offset++) {
      const x = startX + Math.floor(offset * 0.5);
      const y = startY + offset;
      const idx = (y * width + x) * 4;
      data[idx] = 20;
      data[idx + 1] = 20;
      data[idx + 2] = 20;
    }
  }

  // Draw a curved hair strand near top
  for (let offset = 0; offset < 25; offset++) {
    const x = 120 + offset;
    const y = 80 + Math.floor(Math.sin(offset / 4) * 5);
    const idx = (y * width + x) * 4;
    data[idx] = 15;
    data[idx + 1] = 15;
    data[idx + 2] = 15;
  }

  const regions = detectMangaDialogueRegions({ data, width, height });
  assert.equal(regions.length, 0, "Cheek blush marks and hair artwork should be rejected, producing 0 boxes");
});




test('thin bubble outlines survive scaling and nearby ink does not inflate text crops', () => {
  const { detectMangaDialogueRegions } = loadBubbleDetector();
  const width = 800, height = 500;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x, y) => { const i = (y * width + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; };
  // Thin closed outlines with two widely separated vertical text columns.
  for (const [left, right] of [[100, 300], [450, 650]]) {
    for (let x = left; x <= right; x++) { ink(x, 100); ink(x, 300); }
    for (let y = 100; y <= 300; y++) { ink(left, y); ink(right, y); }
    for (const x of [left + 40, right - 40]) for (let y = 130; y < 250; y += 30) {
      for (let yy = y; yy < y + 20; yy++) for (let xx = x; xx < x + 12; xx++) {
        if (xx === x || xx === x + 11 || yy === y || yy === y + 10 || yy === y + 19) ink(xx, yy);
      }
    }
  }
  // Huge connected artwork outside the bubbles.
  for (let x = 305; x < 440; x++) for (let y = 50; y < 450; y++) ink(x, y);
  const regions = detectMangaDialogueRegions({ data, width, height }, { includeBorderlessText: false });
  assert.equal(regions.length, 2);
  assert.ok(regions.every(r => r.orientation === 'vertical'));
  assert.ok(regions.every(r => r.bbox.y0 > 100 && r.bbox.y1 < 300));
  assert.ok(regions.every(r => r.bbox.x1 - r.bbox.x0 < 200));
});

test('white page backgrounds and connected panel frames do not become giant OCR regions', () => {
  const { detectMangaDialogueRegions } = loadBubbleDetector();
  const width = 500, height = 700;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x, y) => { const i = (y * width + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; };
  for (let x = 20; x < 480; x++) { ink(x, 20); ink(x, 680); }
  for (let y = 20; y < 680; y++) { ink(20, y); ink(479, y); ink(250, y); }
  for (let y = 50; y < 620; y++) ink(100 + Math.floor(Math.sin(y / 25) * 30), y);
  const regions = detectMangaDialogueRegions({ data, width, height });
  assert.equal(regions.length, 0);
});


test('square text geometry marks detector direction as ambiguous', () => {
  const { detectMangaDialogueRegions } = loadBubbleDetector();
  const width = 300, height = 300;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x, y) => { const i = (y * width + x) * 4; data[i] = data[i + 1] = data[i + 2] = 0; };
  for (let x = 50; x <= 200; x++) { ink(x, 50); ink(x, 200); }
  for (let y = 50; y <= 200; y++) { ink(50, y); ink(200, y); }
  for (const x of [90, 130]) for (const y of [90, 130]) {
    for (let yy = y; yy < y + 20; yy++) for (let xx = x; xx < x + 20; xx++) {
      if (xx === x || xx === x + 19 || yy === y || yy === y + 19) ink(xx, yy);
    }
  }
  const regions = detectMangaDialogueRegions({ data, width, height }, { includeBorderlessText: false });
  assert.equal(regions.length, 1);
  assert.equal(regions[0].orientationAmbiguous, true);
});
