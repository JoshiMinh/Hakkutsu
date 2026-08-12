# DocDeco

DocDeco là nhánh ứng dụng độc lập trong Hakkutsu Multimedia Studio. Người dùng
soạn nội dung trực tiếp trong Word; add-in nhận diện vai trò ngữ nghĩa theo từng
paragraph rồi áp dụng một hệ style nhất quán.

## Kiến trúc

```text
Word task pane
  -> chỉ lấy paragraph mới/thay đổi
  -> FastAPI local :8010
       -> cache SQLite theo document + paragraph + content hash
       -> rule classifier (mặc định, nhanh)
       -> Gemini / LLM (chỉ đoạn mơ hồ, nếu bật)
  -> Style Engine cố định
  -> áp dụng style trực tiếp vào paragraph trong Word
```

Model chỉ chọn vai trò (`title`, `heading_1`, `body`, ...). Căn lề, font,
spacing và indentation không do model sinh ra, nhờ đó toàn bộ tài liệu giữ cùng
một chuẩn và có thể đổi theme sau này.

## Chạy bằng một lệnh

Từ thư mục gốc project:

```powershell
.\ml\scripts\start_docdeco.ps1
```

Lệnh này cài dependency còn thiếu, chạy FastAPI và Vite HTTPS rồi mở demo tại
`https://localhost:3000`. Dừng bằng:

```powershell
.\ml\scripts\stop_docdeco.ps1
```

## Cài vào Microsoft Word

1. Chạy `ml/scripts/start_docdeco.ps1`.
2. Trong Word mở **Insert > Get Add-ins > My Add-ins > Upload My Add-in**.
3. Chọn file `apps/doc-deco/word-addin/manifest.xml`.
4. Trên tab Home, chọn **Mở DocDeco**.

Nếu bản Word không có nút upload manifest, có thể sideload qua shared folder
catalog của Office. Trang demo web vẫn dùng được để kiểm tra classifier.

## Bật model cho đoạn mơ hồ

Mặc định DocDeco chạy hoàn toàn bằng rule engine, không cần model. Nếu muốn dùng
Gemini/LLM phân loại đoạn mơ hồ:

```powershell
$env:DOCDECO_MODEL_ENABLED="true"
$env:DOCDECO_MODEL="gemini-2.5-flash"
.\ml\scripts\start_docdeco.ps1
```

Các sửa vai trò thủ công được lưu vào `data/docdeco/docdeco.db`. Đây là nguồn
feedback được pipeline tự nhập lại khi fine-tune classifier.

## Model cấu trúc theo ngữ cảnh

Pipeline mới kết hợp nội dung paragraph, 24 đặc trưng layout và ngữ cảnh lân cận.
Xem cách chuẩn bị dữ liệu và chạy bằng một lệnh tại [TRAINING.md](TRAINING.md).
Khi artifact đã được tạo, `ml/scripts/start_docdeco.ps1` tự bật model service và backend ưu
tiên model này trước rule engine.
