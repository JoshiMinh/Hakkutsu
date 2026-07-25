# Hakkutsu Ja–Vi Grammar Model Pipeline

Pipeline này tạo model `hakkutsu-javi` từ model nền Qwen3 bằng QLoRA.
Không script nào tự chạy khi backend hoặc extension khởi động.

## Nguyên tắc

- Không pretrain từ đầu.
- Dữ liệu song ngữ phải có manifest nguồn và license.
- OPUS/local data được lọc, chuẩn hóa, dedupe và chia train/validation/test.
- Qwen 9B chỉ làm teacher cho một phần mẫu ngữ pháp.
- Teacher output được append từng dòng nên có thể resume.
- QLoRA lưu checkpoint định kỳ và mặc định resume checkpoint mới nhất.
- Model cuối được đánh giá trước khi merge/quantize.
- Model Hakkutsu dùng cho phân tích thường ngày; Qwen 9B vẫn là deep analysis.

## Thư mục kết quả

```text
data/training/javi/
  raw/
  prepared/
  teacher/
  sft/
  checkpoints/
  reports/
  logs/
  runs/

data/models/hakkutsu-javi/
  adapter/
  merged/
  gguf/
```

Các thư mục này nằm trong `.gitignore`.

## Các stage

1. `setup`: tạo `.training-venv` và cài dependency.
2. `download`: tải nguồn đã chấp nhận license.
3. `prepare`: lọc, chuẩn hóa, dedupe, split.
4. `teacher`: Qwen 9B tạo phân tích ngữ pháp có checkpoint từng mẫu.
5. `dataset`: tạo JSONL chat SFT.
6. `train`: QLoRA, checkpoint và resume.
7. `evaluate`: JSON validity, BLEU, chrF và grammar recall.
8. `merge`: merge adapter vào base model.
9. `export_gguf.ps1`: chuyển merged model sang GGUF và quantize.
10. `register_ollama.ps1`: tạo `hakkutsu-javi:latest`.
11. `promote_model.ps1`: kiểm tra cổng chất lượng rồi mới cho phép bật model.

## License dữ liệu

Mở `sources.json`, đọc license của từng nguồn và chỉ đổi `accepted` thành
`true` sau khi xác nhận. Pipeline từ chối tải nguồn chưa được chấp nhận.
Có thể dùng `-AcceptLicenses`, nhưng cờ này có nghĩa người vận hành tự chịu
trách nhiệm đã đọc và chấp nhận toàn bộ license.

## Lệnh dự kiến

Các lệnh dưới đây chỉ là hướng dẫn; không được tự động chạy bởi project.

### Một lệnh hoàn chỉnh

Sau khi đã đọc và chấp nhận license trong `sources.json`, chỉ cần chủ động chạy:

```powershell
powershell -File scripts/start_hakkutsu_javi.ps1 -AcceptLicenses
```

Lệnh này chạy nền, chống sleep cho tiến trình và mặc định dùng 5.000 mẫu teacher.
Nó tự cài Python 3.11/Ollama khi thiếu, tải teacher model, setup môi trường,
resume phần đã hoàn thành, train, đánh giá, tải converter/binary `llama.cpp`,
xuất GGUF, đăng ký Ollama và chỉ cập nhật `.env` nếu model vượt cổng chất lượng.
Có thể đổi số mẫu bằng `-TeacherLimit`, ví dụ
`-TeacherLimit 10000`.

```powershell
powershell -File scripts/train_hakkutsu_javi.ps1 -Stage setup

powershell -File scripts/start_hakkutsu_training.ps1 `
  -Stage all `
  -AcceptLicenses `
  -PreventSleep `
  -TeacherLimit 5000
```

Theo dõi:

```powershell
powershell -File scripts/hakkutsu_training_status.ps1
```

Dừng an toàn:

```powershell
powershell -File scripts/stop_hakkutsu_training.ps1
```

Chạy lại `-Stage train -Resume auto` sẽ dùng checkpoint mới nhất.

## Export GGUF

Pipeline không tự clone hoặc build `llama.cpp`. Sau khi có llama.cpp đã build:

```powershell
powershell -File training/javi/export_gguf.ps1 `
  -LlamaCppPath D:\tools\llama.cpp

powershell -File training/javi/register_ollama.ps1
```

Kiểm tra khả năng phát hành nhưng chưa sửa `.env`:

```powershell
powershell -File training/javi/promote_model.ps1
```

Chỉ sau khi báo cáo đạt toàn bộ ngưỡng, chủ động bật model:

```powershell
powershell -File training/javi/promote_model.ps1 -Apply
```

Lệnh `-Apply` sao lưu `.env` trước khi thay đổi. Nếu chưa có model hoặc chưa có
báo cáo đánh giá, script dừng và không chỉnh cấu hình.

## Điều kiện phát hành model

Không đổi backend sang model mới nếu:

- `valid_json_rate < 0.98`;
- chrF/BLEU thấp hơn baseline;
- grammar recall thấp;
- test set bị trùng train set;
- license report còn nguồn `unknown`;
- chưa review thủ công các mẫu `ました`, `なかった`, `させられる`,
  kính ngữ và tên riêng.
