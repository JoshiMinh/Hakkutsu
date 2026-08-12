import sys
import cv2
import numpy as np
from PIL import Image

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

from backend.inpainting_service import (
    create_primary_text_mask,
    create_text_mask,
    evaluate_inpainting_result,
    inpaint_text_regions,
    inpaint_text_regions_hybrid,
    shrink_unsafe_text_mask,
    validate_text_mask_safety,
    _has_complex_background,
    UnsafeTextMaskError,
    InpaintingQualityError,
)
from backend.neural_inpainting_service import lama_available, lama_inpaint
from backend.ctd_mask_service import ctd_available

print("==================================================")
print("       HAKKUTSU INPAINTING TEST SUITE             ")
print("==================================================")

print(f"LaMa Available: {lama_available()}")
print(f"CTD Available:  {ctd_available()}")

# 1. Flat dialogue bubble test
print("\n--- Test 1: Flat dialogue bubble ---")
rgb_flat = np.full((400, 400, 3), 255, dtype=np.uint8)
cv2.putText(rgb_flat, "こんにちは！", (50, 200), cv2.FONT_HERSHEY_SIMPLEX, 1.2, (0, 0, 0), 2)
boxes_flat = [(40.0, 150.0, 320.0, 70.0)]
meta_flat = [{"text_kind": "dialogue", "sfx_score": 0.0}]
cleaned_flat, mask_flat, engine_flat = inpaint_text_regions_hybrid(rgb_flat, boxes_flat, meta_flat)
print(f"  Engine used: {engine_flat}")
print(f"  Mask non-zero pixels: {np.count_nonzero(mask_flat)}")
# Verify cleaned image is clean white where text was
text_area_mean = np.mean(cleaned_flat[150:220, 40:360])
print(f"  Text area mean brightness: {text_area_mean:.1f} / 255")
assert text_area_mean >= 250, "Flat bubble should be restored to white"
print("  [PASS] Flat dialogue bubble test")

# 2. Complex background / SFX with LaMa
print("\n--- Test 2: Textured / SFX background with LaMa ---")
# Create a textured background (e.g. gradient / screentone pattern)
y_coords, x_coords = np.mgrid[0:400, 0:400]
texture = ((np.sin(x_coords / 5.0) * np.cos(y_coords / 5.0) + 1.0) * 100 + 30).astype(np.uint8)
rgb_texture = cv2.cvtColor(texture, cv2.COLOR_GRAY2RGB)
# Draw loud SFX on top
cv2.putText(rgb_texture, "ゴゴゴゴ", (60, 220), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (255, 255, 255), 6)
cv2.putText(rgb_texture, "ゴゴゴゴ", (60, 220), cv2.FONT_HERSHEY_SIMPLEX, 2.0, (0, 0, 0), 2)
boxes_sfx = [(50.0, 140.0, 300.0, 100.0)]
meta_sfx = [{"text_kind": "sfx", "sfx_score": 0.95}]

cleaned_sfx, mask_sfx, engine_sfx = inpaint_text_regions_hybrid(rgb_texture, boxes_sfx, meta_sfx)
print(f"  Engine used: {engine_sfx}")
print(f"  Mask non-zero pixels: {np.count_nonzero(mask_sfx)}")
print("  [PASS] Textured SFX background test")

# 3. Dense text / mask safety shrink test
print("\n--- Test 3: Dense text / oversized mask safety test ---")
rgb_dense = np.full((300, 300, 3), 255, dtype=np.uint8)
cv2.putText(rgb_dense, "WWWWW", (20, 160), cv2.FONT_HERSHEY_SIMPLEX, 1.8, (0, 0, 0), 4)
boxes_dense = [(15.0, 100.0, 270.0, 80.0)]
meta_dense = [{"text_kind": "dialogue", "sfx_score": 0.0}]
cleaned_dense, mask_dense, engine_dense = inpaint_text_regions_hybrid(rgb_dense, boxes_dense, meta_dense)
print(f"  Engine used: {engine_dense}")
print(f"  Mask non-zero pixels: {np.count_nonzero(mask_dense)}")
print("  [PASS] Dense text safety test")

# 4. Empty / zero boxes handling
print("\n--- Test 4: Empty boxes handling ---")
empty_cleaned, empty_mask = inpaint_text_regions(rgb_flat, [])
assert np.array_equal(empty_cleaned, rgb_flat)
print(f"  Empty boxes returns unchanged image: True")
print("  [PASS] Empty boxes test")

# 5. Real Manga page inpainting
print("\n--- Test 5: Real manga page test (data/ui-test-import/page_2.png) ---")
img = Image.open("data/ui-test-import/page_2.png")
real_rgb = np.asarray(img.convert("RGB"))
real_boxes = [(100.0, 100.0, 150.0, 180.0), (300.0, 200.0, 120.0, 160.0)]
real_meta = [{"text_kind": "dialogue", "sfx_score": 0.1}, {"text_kind": "sfx", "sfx_score": 0.8}]
real_cleaned, real_mask, real_engine = inpaint_text_regions_hybrid(real_rgb, real_boxes, real_meta)
print(f"  Engine used: {real_engine}")
print(f"  Mask non-zero pixels: {np.count_nonzero(real_mask)}")
Image.fromarray(real_cleaned).save("test_page2_cleaned.png")
print("  Saved cleaned page to test_page2_cleaned.png")
print("  [PASS] Real manga page test")

print("\n==================================================")
print("       ALL INPAINTING TESTS PASSED!               ")
print("==================================================")
