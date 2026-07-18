# BÁO CÁO TỔNG KẾT ĐỒ ÁN CHUYÊN NGÀNH 2
**Tên đề tài:** Hakkutsu - Tiện ích mở rộng hỗ trợ học tiếng Nhật và Phân loại độ khó bằng Trí tuệ nhân tạo (AI/ML)
**Sinh viên thực hiện:** [Tên sinh viên]
**Giảng viên hướng dẫn:** [Tên giảng viên]

*Ghi chú: Dàn ý và bản nháp dưới đây được thiết kế để mở rộng thành một báo cáo hoàn chỉnh dài ít nhất 20 trang. Sinh viên cần bổ sung hình ảnh, biểu đồ EDA, và mã nguồn minh họa vào các phần tương ứng.*

---

## MỤC LỤC
1. Tóm tắt đồ án (Abstract)
2. Chương 1: Tổng quan về đề tài
3. Chương 2: Cơ sở lý thuyết và Công nghệ
4. Chương 3: Thiết kế và Kiến trúc hệ thống
5. Chương 4: Xây dựng mô hình Học máy (AI/ML Pipeline)
6. Chương 5: Phát triển ứng dụng và các tính năng chính
7. Chương 6: Kết quả đạt được và Đánh giá
8. Chương 7: Kết luận và Hướng phát triển
9. Tài liệu tham khảo

---

## TÓM TẮT ĐỒ ÁN (ABSTRACT)
*(Mục tiêu: 0.5 - 1 trang)*
Báo cáo này trình bày quá trình nghiên cứu và phát triển Hakkutsu, một tiện ích mở rộng trên trình duyệt Chrome giúp người dùng học tiếng Nhật hiệu quả thông qua việc phân tích văn bản theo thời gian thực. Đóng góp chính của hệ thống là mô hình Trí tuệ nhân tạo (dựa trên kiến trúc Transformer) có khả năng phân loại độ khó của câu tiếng Nhật theo chuẩn JLPT (N5-N1). Hệ thống được chia làm ba phần chính: ML Pipeline để huấn luyện mô hình, Backend (FastAPI) để phục vụ suy luận, và Frontend (Plasmo/React) cung cấp giao diện tương tác với người dùng (như dịch thuật, phân tích ngữ pháp, đọc phụ đề YouTube và hệ thống thẻ ghi nhớ SRS). Báo cáo đi sâu vào quy trình thu thập dữ liệu, huấn luyện mô hình, cũng như các quyết định thiết kế phần mềm.

---

## CHƯƠNG 1: TỔNG QUAN VỀ ĐỀ TÀI
*(Mục tiêu: 2 trang)*

### 1.1 Đặt vấn đề và lý do chọn đề tài
- Khó khăn trong việc tìm kiếm tài liệu đọc hiểu tiếng Nhật phù hợp với trình độ.
- Các công cụ từ điển hiện tại chỉ tra cứu từng từ, thiếu ngữ cảnh và không đánh giá được độ khó tổng thể của cả câu.
- Sự cần thiết của một công cụ tích hợp trực tiếp vào trình duyệt, cho phép người dùng học ngay trong quá trình tiêu thụ nội dung thực tế (đọc tin tức, xem YouTube).

### 1.2 Mục tiêu đề tài
- Thu thập và xử lý tập dữ liệu tiếng Nhật được gán nhãn theo mức độ JLPT.
- Xây dựng và tinh chỉnh (fine-tune) mô hình ngôn ngữ lớn cỡ nhỏ (Transformer/BERT) để phân loại độ khó câu.
- Xây dựng hệ thống Backend xử lý ngôn ngữ tự nhiên (tokenization với Sudachi, tra cứu từ vựng với JMdict).
- Xây dựng một Chrome Extension hiện đại, tối ưu, hỗ trợ bóc tách phụ đề video và đồng bộ thẻ ghi nhớ (flashcard).

### 1.3 Đối tượng và phạm vi nghiên cứu
- Đối tượng: Người học tiếng Nhật từ sơ cấp (N5) đến thượng cấp (N1).
- Phạm vi: Phân tích văn bản tiếng Nhật hiện đại; tích hợp hoạt động trên trình duyệt nhân Chromium.

---

## CHƯƠNG 2: CƠ SỞ LÝ THUYẾT VÀ CÔNG NGHỆ SỬ DỤNG
*(Mục tiêu: 3-4 trang)*

### 2.1 Tổng quan về xử lý ngôn ngữ tự nhiên (NLP) cho tiếng Nhật
- Đặc điểm của tiếng Nhật: Không có khoảng trắng giữa các từ, sử dụng 3 bảng chữ cái (Hiragana, Katakana, Kanji).
- Kỹ thuật Word Segmentation (Tokenization) và POS Tagging sử dụng SudachiPy/MeCab.

### 2.2 Mô hình Transformer và kiến trúc BERT
- Kiến trúc cơ bản của Transformer (Attention Mechanism).
- Ưu điểm của pre-trained models (như `cl-tohoku/bert-base-japanese`) trong các bài toán phân loại văn bản.

### 2.3 Công nghệ phát triển Hệ thống
- **Backend**: Python, FastAPI (High performance, async support).
- **Extension**: TypeScript, React, Plasmo (Framework tối ưu cho browser extensions).
- **Cơ sở dữ liệu**: Firebase (Auth, Firestore) cho lưu trữ đám mây và AnkiConnect cho đồng bộ thẻ cục bộ.
- **Machine Learning**: PyTorch, Hugging Face Transformers, Pandas, Scikit-learn.

---

## CHƯƠNG 3: THIẾT KẾ VÀ KIẾN TRÚC HỆ THỐNG
*(Mục tiêu: 3 trang)*

### 3.1 Kiến trúc tổng thể (System Architecture)
*(Vẽ sơ đồ khối thể hiện sự tương tác giữa 3 thành phần: Extension <-> Backend <-> ML Model)*
- **Client Layer**: Content Scripts (quét DOM, bắt subtitle), Background Service Workers, UI (Popup/Options).
- **API Layer**: FastAPI endpoints, Firebase Auth middleware.
- **Inference/Data Layer**: Sudachi tokenizer, BERT Model, SQLite/JMdict local dictionary.

### 3.2 Luồng dữ liệu (Data Flow)
- Quy trình khi người dùng bôi đen đoạn văn bản -> Gửi request -> Backend phân tích (Tokenize & Predict) -> Trả về JSON -> Client render Popup.
- Quy trình đồng bộ thẻ nhớ (SRS) lên Firebase hoặc Anki.

---

## CHƯƠNG 4: XÂY DỰNG MÔ HÌNH HỌC MÁY (AI/ML PIPELINE)
*(Mục tiêu: 5-6 trang - ĐÂY LÀ TRỌNG TÂM AI/ML CỦA ĐỒ ÁN)*

### 4.1 Thu thập và tiền xử lý dữ liệu
- Nguồn dữ liệu: Tatoeba, corpus JLPT.
- Kỹ thuật làm sạch: Loại bỏ nhiễu, chuẩn hóa Unicode (NFKC), lọc độ dài câu.
- Mã hóa nhãn (Label encoding): N5 (0) đến N1 (4).

### 4.2 Phân tích khám phá dữ liệu (EDA - Exploratory Data Analysis)
*(Chèn các biểu đồ phân bố)*
- Phân bố số lượng câu theo từng cấp độ JLPT (Class distribution).
- Phân bố chiều dài câu (Sentence length distribution) theo số lượng ký tự và số lượng token.
- Xử lý vấn đề mất cân bằng dữ liệu (Data Imbalance) nếu có (Oversampling/Undersampling hoặc Class Weights).

### 4.3 Huấn luyện mô hình (Model Fine-tuning)
- Lựa chọn mô hình: `cl-tohoku/bert-base-japanese`.
- Thiết lập Hyperparameters: Learning rate, Batch size, Epochs.
- Cấu hình Optimizer (AdamW) và Learning Rate Scheduler.
- Quy trình training loop bằng PyTorch / Trainer API của HuggingFace.

### 4.4 Đánh giá hiệu năng mô hình
- Các metrics sử dụng: Accuracy, Precision, Recall, F1-Score (Macro/Micro).
- Phân tích Confusion Matrix *(Chèn hình ảnh Confusion Matrix)* để xem mô hình thường nhầm lẫn giữa các cấp độ nào (vd: N3 và N2).
- Thử nghiệm trên tập Test Set độc lập.

---

## CHƯƠNG 5: PHÁT TRIỂN ỨNG DỤNG VÀ CÁC TÍNH NĂNG CHÍNH
*(Mục tiêu: 3 trang)*

### 5.1 Giao diện người dùng và Trải nghiệm (UI/UX)
- Thiết kế Dark-mode first, bảng màu tối giản mang phong cách Nhật Bản.
- Tính năng hiển thị Furigana, dịch nghĩa và bóc tách từ vựng qua dạng Hover/Popup.

### 5.2 Tích hợp phân tích phụ đề YouTube trực tiếp
- Cơ chế tiêm (inject) React UI vào DOM của YouTube player.
- Đồng bộ hóa phụ đề lấy từ API với bộ đếm thời gian thực của video (`video.currentTime`).

### 5.3 Triển khai Spaced Repetition System (SRS)
- Thuật toán SRS được sử dụng (ví dụ: SM-2 hoặc FSRS).
- Lưu trữ tiến độ học tập, tính toán Heatmap độ khó dựa trên vốn từ vựng cá nhân của người dùng.

---

## CHƯƠNG 6: KẾT QUẢ ĐẠT ĐƯỢC VÀ KIỂM THỬ
*(Mục tiêu: 2 trang)*

### 6.1 Kết quả hệ thống
- Chụp ảnh màn hình (Screenshots) các tính năng:
  - Phân tích văn bản báo chí thực tế (Yahoo News Japan).
  - Giao diện xem YouTube.
  - Màn hình theo dõi từ vựng (Vocab dashboard).

### 6.2 Kiểm thử hiệu năng (Performance Testing)
- Độ trễ (Latency) của API phân loại độ khó: Thời gian phản hồi trung bình (ms) cho một câu văn.
- Tối ưu bộ nhớ Extension trên Chrome.

---

## CHƯƠNG 7: KẾT LUẬN VÀ HƯỚNG PHÁT TRIỂN
*(Mục tiêu: 1 trang)*

### 7.1 Kết luận
- Đồ án đã hoàn thành các mục tiêu đề ra: Xây dựng thành công ML pipeline, huấn luyện mô hình đạt độ chính xác kỳ vọng và tích hợp trơn tru vào một ứng dụng thực tiễn (Chrome Extension).

### 7.2 Hạn chế của hệ thống
- Mô hình chưa xử lý tốt các câu văn quá dài hoặc chứa nhiều tiếng lóng (slang).
- Chi phí chạy mô hình AI trên server (GPU/CPU) còn cao nếu triển khai diện rộng.

### 7.3 Hướng phát triển trong tương lai
- Áp dụng OCR (MangaOCR) để phân tích văn bản từ hình ảnh/truyện tranh.
- Tối ưu hóa mô hình bằng kỹ thuật Quantization (ONNX/TensorRT) để chạy trực tiếp mô hình ngay trên trình duyệt (WebAssembly) nhằm giảm tải cho Backend.

---

## TÀI LIỆU THAM KHẢO
1. Devlin, J., et al. (2018). BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding.
2. Tài liệu Hugging Face Transformers.
3. Tài liệu FastAPI và Plasmo Framework.
4. Cơ sở dữ liệu JMdict (Electronic Dictionary Research and Development Group).
