# Huấn luyện model cấu trúc DocDeco

Pipeline này huấn luyện một bộ phân loại theo **ngữ cảnh toàn tài liệu**, không phải model
sinh văn bản. Model đọc đồng thời nội dung tiếng Việt và 24 đặc trưng bố cục của mỗi
paragraph, sau đó dự đoán 28 vai trò như trang bìa, mục lục, tiêu đề cấp 1–4, thân bài,
chú thích hình/bảng, trường use case, header và footer.

## Chạy bằng một lệnh

Đặt các file DOCX mà bạn có quyền sử dụng vào:

```text
data/docdeco/corpus/raw
```

Sau đó chạy từ thư mục gốc:

```powershell
.\ml\scripts\train_docdeco_model.ps1
```

Lệnh này tự tạo môi trường Python riêng, cài thư viện, trích xuất DOCX, sinh dữ liệu bổ
sung, chia train/validation/test theo **tài liệu**, fine-tune model và lưu artifact. Nó
cũng tự nhập các chỉnh sửa thủ công trong `data/docdeco/docdeco.db`.

Muốn chỉ kiểm tra dữ liệu mà chưa train:

```powershell
.\ml\scripts\train_docdeco_model.ps1 -PrepareOnly -SyntheticDocuments 500
```

Muốn dùng encoder đa ngôn ngữ thay vì PhoBERT:

```powershell
.\ml\scripts\train_docdeco_model.ps1 -BaseModel xlm-roberta-base
```

## Đầu ra

- Dataset và manifest: `data/docdeco/training/contextual-v1/dataset`
- Model tốt nhất: `data/docdeco/models/contextual-v1`
- Báo cáo: `data/docdeco/models/contextual-v1/metrics.json`
- Metric: macro-F1, accuracy, F1 theo nhãn và tỷ lệ vi phạm cấp heading

Khi artifact tồn tại, `ml/scripts/start_docdeco.ps1` tự chạy model service ở cổng 8011.
Backend cổng 8010 ưu tiên model mới; nếu model service không chạy, nó tự quay về rule
engine/Ollama hiện có để ứng dụng không bị chết.

## Dữ liệu nên bổ sung

Dữ liệu tổng hợp giúp model học schema và chống lỗi style, nhưng chất lượng cuối cùng phụ
thuộc vào DOCX thật đã gắn nhãn. Nên thu thập báo cáo/khoá luận từ nhiều template, sửa
nhãn sai ngay trong DocDeco và định kỳ train lại. Không trộn cùng một tài liệu vào nhiều
split, kể cả các phiên bản chỉnh sửa của nó.

DocLayNet, DocBank và PubLayNet hữu ích để pretrain bố cục nhưng không có đúng schema ngữ
nghĩa báo cáo tiếng Việt. Danh sách nguồn chính thức nằm trong `ml/public_sources.json`;
pipeline không tự tải chúng vì dung lượng lớn và cần bước ánh xạ nhãn riêng.
