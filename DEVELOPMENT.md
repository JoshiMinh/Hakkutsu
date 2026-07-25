# Manga Translator Studio - hướng dẫn phát triển

## Stack hiện tại

- Backend: FastAPI.
- Database: SQLite qua thư viện chuẩn `sqlite3`.
- Frontend: HTML, CSS và JavaScript thuần.
- Xử lý metadata ảnh: Pillow.

## Chạy ứng dụng

Trong PowerShell tại thư mục dự án:

```powershell
.\run.ps1
```

Sau đó mở `http://127.0.0.1:8000`.

Nếu môi trường đã có đủ dependency, có thể chạy nhanh:

```powershell
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

## Chạy kiểm thử

```powershell
python -m unittest -v
```

## Mốc chức năng hiện tại

1. Tạo manga.
2. Tạo chapter và chặn chapter trùng.
3. Upload JPG, PNG hoặc WebP; tối đa 20 MB mỗi ảnh.
4. Lưu ảnh theo chapter và lưu đúng kích thước ảnh.
5. Mở trang trong Editor bốn panel.
6. Tạo, sửa, kéo, thay đổi kích thước và xóa TextBlock.
7. Chỉnh văn bản OCR, đề xuất AI, bản dịch cuối và định dạng chữ.
8. Lưu TextBlock vào SQLite và tải lại khi mở trang.
9. Tải ảnh sạch thủ công để kiểm nghiệm Editor trước khi tích hợp inpainting.
10. Chạy EasyOCR nền trên một trang, theo dõi trạng thái job và tạo TextBlock từ kết quả.
11. Hiển thị provider cùng độ tin cậy OCR cho từng TextBlock.
12. Bảo vệ TextBlock đã chỉnh: chạy lại OCR phải xác nhận thay thế toàn bộ.

Dịch AI, inpainting, crawler và hàng đợi chapter chưa được triển khai ở mốc này.

## Cấu hình OCR

Mặc định hệ thống dùng pipeline lai: EasyOCR tìm vùng chữ, Manga-OCR đọc lại vùng
đã crop cho tiếng Nhật:

```text
OCR_LANGUAGES=ja,en
OCR_GPU=auto
OCR_RECOGNIZER=manga_ocr
OCR_DETECTOR=comic
OCR_DETECTION_THRESHOLD=0.35
```

Detector mặc định là `ogkalu/comic-text-and-bubble-detector` (RT-DETR v2), chỉ giữ
hai lớp `text_bubble` và `text_free`; các hộp chỉ chứa đường viền bóng thoại bị loại.
Model được cache cùng các model Hugging Face. Đặt `OCR_DETECTOR=easyocr` để quay về
detector cũ khi cần đối chiếu.

## Cấu hình dịch Nhật - Việt

Luồng dịch dùng API Chat Completions tương thích OpenAI. Mặc định cấu hình cho DeepSeek:

```text
TRANSLATION_API_URL=https://api.deepseek.com/chat/completions
TRANSLATION_MODEL=deepseek-v4-flash
TRANSLATION_API_KEY=điền_khóa_tại_đây
TRANSLATION_TIMEOUT=120
```

Không ghi khóa API vào source code hoặc commit `.env`. Có thể đổi URL và model để dùng một
dịch vụ tương thích khác hoặc máy chủ local. Nút `Dịch trang` gửi các TextBlock cùng lúc để
giữ ngữ cảnh, lưu đề xuất vào `ai_translation`, và chỉ tự điền `final_translation` khi người
dùng chưa sửa bản dịch cuối.

## Tạo ảnh sạch

Nút `Xóa chữ Nhật` tạo mask nét chữ bên trong các TextBlock rồi chạy OpenCV Telea
inpainting. Ảnh gốc luôn được giữ nguyên; kết quả PNG được lưu riêng vào
`clean_image_path` và được dùng làm nền cho Preview. Đây là phương án train-free phù hợp
với bóng thoại nền phẳng; chữ nằm trên tranh phức tạp vẫn cần người dùng kiểm nghiệm.

Mỗi TextBlock OCR lưu hai hình học độc lập: `source_x/y/width/height` ôm sát chữ Nhật và
`x/y/width/height` là vùng đặt chữ Việt theo bóng thoại. Inpainting chỉ được phép đọc vùng
source. Mask loại thành phần chạm biên, bảo vệ đường dài và có ảnh xem trước màu đỏ qua
nút `Xem mask`; nhờ đó việc mở rộng vùng lettering không làm lẹm viền bóng thoại.

## Tự căn và xuất chữ Việt

Nút `Tự căn chữ` đo font thật, tự xuống dòng và lưu cỡ chữ lớn nhất còn nằm gọn trong
TextBlock. Nút `Xuất PNG` render trực tiếp ảnh sạch cùng `final_translation`; ảnh hoàn chỉnh
được trả về theo yêu cầu và không lưu vào database.

Model EasyOCR được tải vào `data/models/easyocr`; model Manga-OCR được cache trong
`data/models/huggingface`. Lần đầu có thể mất vài phút và tải khoảng 400 MB. Các
lần sau dùng lại model đã tải.

`OCR_GPU=auto` chỉ sử dụng GPU khi bản PyTorch trong môi trường hỗ trợ CUDA. Để buộc
chạy CPU, đặt `OCR_GPU=false` trước khi khởi động ứng dụng.

Luồng OCR hiện tại:

```text
Editor → tạo OCR job → EasyOCR phát hiện vùng → crop có padding
→ Manga-OCR nhận dạng tiếng Nhật → lưu TextBlock → tải lại Editor
```

Đặt `OCR_RECOGNIZER=easyocr` để tắt Manga-OCR và quay về nhận dạng EasyOCR thuần.
Manga-OCR không trả confidence; giao diện sẽ hiển thị “không cung cấp” thay vì dùng
nhầm confidence recognition cũ của EasyOCR.
