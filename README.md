# Manga Translator Studio

Đây là tài liệu mô tả kiến trúc và luồng hoạt động của **Manga Translator Studio** -- một ứng dụng dịch manga sử dụng AI, hỗ trợ tự động hóa từ quá trình crawl, OCR, dịch, xóa chữ, phục hồi nền đến chỉnh sửa và quản lý bản dịch.

---

## Cài đặt & Khởi chạy (Development)

Dự án hiện tại bao gồm một Backend xử lý AI/OCR, và hỗ trợ hai giao diện (frontend) khác nhau: Giao diện Extension hiện đại (Plasmo) và Giao diện Static Web (Vanilla JS cũ).

### 1. Khởi chạy Backend (Yêu cầu cho cả 2 giao diện)
Backend được xây dựng bằng FastAPI, sử dụng SQLite và Pillow.
Mở PowerShell tại thư mục gốc của dự án và chạy:
```powershell
.\run.ps1
```
*Script này sẽ tự động tạo môi trường ảo `.venv`, cài đặt `requirements.txt` và khởi chạy server Uvicorn tại `http://127.0.0.1:8000`.*

### 2. Chạy Frontend: Plasmo Extension (Mới / Khuyên dùng)
Giao diện chính hiện tại đã được chuyển sang dạng Browser Extension (React/TypeScript) nằm trong thư mục `extension/`.
- **Cài đặt thư viện:** Chạy lệnh `pnpm i` ở thư mục gốc.
- **Khởi chạy Dev Server:** Chạy lệnh `pnpm run dev`.
- **Cài đặt vào trình duyệt:** 
  1. Mở `chrome://extensions/` (hoặc `edge://extensions/`).
  2. Bật **Developer Mode**.
  3. Bấm **Load unpacked** và chọn thư mục `extension/build/chrome-mv3-dev`.

### 3. Chạy Frontend: Static Web (Cũ / Legacy)
Đây là giao diện web 4-panel gốc sử dụng HTML/CSS/JS thuần (nằm trong thư mục `static/`).
- Sau khi khởi chạy Backend thành công, chỉ cần mở trình duyệt và truy cập: `http://127.0.0.1:8000`

---

## Cấu hình AI & Models

### Cài đặt Models Xóa chữ (Inpainting) & Masking
1. **Mask chữ bằng comic-text-detector (CTD):** 
   Cài model tạo mask nét chữ một lần bằng lệnh:
   ```powershell
   .\scripts\setup_comic_text_detector.ps1
   ```
   *Pipeline ưu tiên mask học sâu CTD, chỉ dùng mask OpenCV cho vùng CTD bỏ sót. Đặt `CTD_ENABLED=false` trong `.env` để tắt.*

2. **Model xóa chữ LaMa:**
   Tải model Big-LaMa một lần trước khi dùng chế độ xóa SFX/nền phức tạp:
   ```powershell
   .\scripts\download_lama_model.ps1
   ```
   *Pipeline dùng Telea cho bong bóng phẳng và tự chuyển sang LaMa cho SFX/nền nhiều chi tiết. Đặt `LAMA_ENABLED=false` trong `.env` để tắt.*

### Cấu hình OCR
Hệ thống dùng pipeline lai: EasyOCR tìm vùng chữ, Manga-OCR đọc lại vùng đã crop cho tiếng Nhật:
```text
OCR_LANGUAGES=ja,en
OCR_GPU=auto
OCR_RECOGNIZER=manga_ocr
OCR_DETECTOR=comic
OCR_DETECTION_THRESHOLD=0.35
```
- `OCR_GPU=auto` sẽ tự dùng GPU nếu PyTorch có hỗ trợ CUDA. Để buộc chạy CPU, hãy sửa thành `OCR_GPU=cpu`.
- Đặt `OCR_RECOGNIZER=easyocr` để tắt Manga-OCR và quay về nhận dạng EasyOCR thuần.

### Cấu hình Dịch AI (Dịch Nhật - Việt)
Luồng dịch dùng API Chat Completions tương thích OpenAI. Đổi trong file `.env`:
```text
TRANSLATION_API_URL=https://api.deepseek.com/chat/completions
TRANSLATION_MODEL=deepseek-v4-flash
TRANSLATION_API_KEY=điền_khóa_tại_đây
```
*Không commit file `.env` lên git.*

---

## Tính năng & Luồng dữ liệu

### Mục tiêu dự án
- OCR đa ngôn ngữ.
- Dịch bằng nhiều mô hình AI (GPT, Gemini, Claude, DeepL...).
- Xóa text và phục hồi nền bằng AI.
- Chèn văn bản mới và cho phép chỉnh sửa thủ công.
- Quản lý tiến trình bằng Database SQLite.

### Luồng xử lý Manga
```text
Website → Crawler → Metadata → Database
   ↓
OCR → Translation → Bubble Detection → Background Detection → Inpainting → Editor → Export
```

### Editor 4 Panel (Chế độ Static Web)
1. **Original Image**: Ảnh gốc.
2. **Clean Image**: Ảnh sạch đã qua inpainting (không đè text lên database, chỉ lưu PNG riêng).
3. **Live Preview**: Xem trước bản dịch.
4. **Translation Manager**: Quản lý chữ, kéo thả, xoay, đổi màu và font.

### Cơ sở dữ liệu (Database)
- **Manga**: id, title, author, description, tags, thumbnail.
- **Chapter**: id, manga_id, chapter_number, status.
- **TextBlock**: page_id, x, y, w, h, original_text, ai_translation, final_translation, font, color, rotation.

### Chạy kiểm thử
```powershell
python -m unittest -v
```
