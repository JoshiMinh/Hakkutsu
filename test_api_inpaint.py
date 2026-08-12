import sys
from fastapi.testclient import TestClient
from backend.main import app
from backend.database import db_session, init_database, utc_now
from backend.config import UPLOAD_DIR
from PIL import Image
import numpy as np

if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

init_database()
client = TestClient(app)

print("--- Testing Inpainting via FastAPI TestClient ---")

# 1. Create a test Manga, Chapter, and Page
now = utc_now()
test_upload_dir = UPLOAD_DIR / "test_chapter_99"
test_upload_dir.mkdir(parents=True, exist_ok=True)
test_orig_path = test_upload_dir / "test_page_1.png"

# Generate a synthetic manga page with dialogue and SFX
img = np.full((600, 400, 3), 255, dtype=np.uint8)
import cv2
cv2.putText(img, "やあ、元気？", (50, 200), cv2.FONT_HERSHEY_SIMPLEX, 1.0, (0, 0, 0), 2)
cv2.putText(img, "ドドド", (150, 400), cv2.FONT_HERSHEY_SIMPLEX, 1.5, (0, 0, 0), 3)
Image.fromarray(img).save(test_orig_path)
rel_path = test_orig_path.relative_to(UPLOAD_DIR).as_posix()

with db_session() as conn:
    manga_id = conn.execute(
        "INSERT INTO manga (title, author, created_at, updated_at) VALUES (?, ?, ?, ?)",
        ("Test Inpainting Manga", "Tester", now, now)
    ).lastrowid
    chapter_id = conn.execute(
        "INSERT INTO chapters (manga_id, chapter_number, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
        (manga_id, "1", "Chapter 1", now, now)
    ).lastrowid
    page_id = conn.execute(
        "INSERT INTO pages (chapter_id, page_number, original_image_path, width, height, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ready', ?, ?)",
        (chapter_id, 1, rel_path, 400, 600, now, now)
    ).lastrowid
    # Add text blocks
    conn.execute(
        "INSERT INTO text_blocks (page_id, x, y, width, height, original_text, text_kind, sfx_score, render_mode, translation_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'replace', 'translate', ?, ?)",
        (page_id, 40, 160, 200, 60, "やあ、元気？", "dialogue", 0.0, now, now)
    )
    conn.execute(
        "INSERT INTO text_blocks (page_id, x, y, width, height, original_text, text_kind, sfx_score, render_mode, translation_mode, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'replace', 'translate', ?, ?)",
        (page_id, 140, 350, 150, 80, "ドドド", "sfx", 0.9, now, now)
    )

print(f"Created test Manga ID={manga_id}, Chapter ID={chapter_id}, Page ID={page_id}")

# 2. Call inpainting endpoint
res = client.post(f"/api/pages/{page_id}/inpaint")
print("POST /api/pages/{page_id}/inpaint status:", res.status_code)
assert res.status_code == 202
job_data = res.json()
print("Job response:", job_data)
job_id = job_data["job_id"]

# 3. Check job status
res_job = client.get(f"/api/jobs/{job_id}")
print("GET /api/jobs/{job_id} status:", res_job.json())

# 4. Check page details
res_page = client.get(f"/api/pages/{page_id}")
page_data = res_page.json()
print(f"Page clean_image_path: {page_data.get('clean_image_path')}")
print(f"Page mask_preview_path: {page_data.get('mask_preview_path')}")
assert page_data.get("clean_image_path") is not None
print("API inpainting test PASSED!")
