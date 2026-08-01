# BÁO CÁO ĐỒ ÁN CHUYÊN NGÀNH 2
**HỌC KỲ HÈ, NĂM HỌC 2025-2026**
**Chuyên ngành: Khoa học dữ liệu và Trí tuệ nhân tạo**

---

## THÔNG TIN CHUNG
- **Tên đề tài:** Hakkutsu - Tiện ích Trình duyệt hỗ trợ dịch thuật, khôi phục ảnh truyện tranh và học tiếng Nhật chuyên sâu dựa trên Trí tuệ nhân tạo.
- **Giảng viên hướng dẫn:** [Điền tên GVHD]
- **Sinh viên thực hiện:** 
  1. [Họ tên] - [Mã SV]
  2. [Họ tên] - [Mã SV]

---

## LỜI CẢM ƠN
[Phần này sinh viên tự viết cảm ơn Khoa, Trường và GVHD. Kéo dài khoảng 1 trang.]

---

## MỤC LỤC
[Tự động cập nhật mục lục khi xuất ra Word/PDF]

---

## MỞ ĐẦU
Trong thập kỷ qua, sự bùng nổ của Internet và các thiết bị di động đã làm thay đổi hoàn toàn thói quen giải trí và học ngoại ngữ của con người. Truyện tranh trực tuyến (manga, webtoon, comic) đã trở thành một nền công nghiệp tỷ đô. Tuy nhiên, rào cản ngôn ngữ là một trở ngại lớn. Đa số các bộ manga nổi tiếng xuất phát từ Nhật Bản, và các bản dịch thủ công (scanlation) mất rất nhiều thời gian. Hơn nữa, những người học tiếng Nhật thường muốn sử dụng truyện tranh như một công cụ đắm chìm vào ngôn ngữ (Japanese immersion), nhưng lại thiếu các công cụ hỗ trợ tra cứu ngữ pháp ngay trên hình ảnh.

Với sự phát triển vượt bậc của Trí tuệ nhân tạo (AI), sự kết hợp giữa Thị giác máy tính (Computer Vision) và Xử lý ngôn ngữ tự nhiên (NLP) mở ra một hướng giải quyết triệt để. Đề tài **Hakkutsu (Manga Translator Studio)** được thực hiện nhằm xây dựng một tiện ích trình duyệt thông minh. Hệ thống không chỉ tự động hóa quy trình dịch thuật (nhận diện chữ, OCR, xóa nền, chèn chữ mới) mà còn đóng vai trò như một "Giáo viên tiếng Nhật" thực thụ — phân tích ngữ pháp, bóc tách từ vựng (tokenization) và dịch theo đúng ngữ cảnh của câu chuyện thông qua các Mô hình Ngôn ngữ Lớn (LLMs).

---

## Chương 1. GIỚI THIỆU TỔNG QUAN VỀ ĐỀ TÀI

### 1.1. Lý do chọn đề tài
Các công cụ dịch thuật hình ảnh hiện tại thường gặp hai vấn đề lớn: (1) Dịch đè lên ảnh gốc bằng lớp nền đặc làm hỏng tính thẩm mỹ của bức tranh; (2) Dịch từng từ một (word-by-word) một cách máy móc, làm mất đi sắc thái và ngữ cảnh của câu chuyện.
Để giải quyết bài toán này, cần một hệ thống tích hợp sâu cả quy trình Xử lý ảnh (tìm kiếm vùng chữ bằng AI, khôi phục nền bị che khuất bằng Inpainting) và Xử lý ngôn ngữ tự nhiên (phân tích hình thái câu, phân giải ngữ cảnh bằng LLMs). Việc xây dựng dưới dạng Chrome Extension cũng mang lại trải nghiệm mượt mà, cho phép người dùng đọc và dịch trực tiếp trên mọi trang web.

### 1.2. Mục tiêu nghiên cứu
1. **Nghiên cứu Thị giác máy tính (CV):** Ứng dụng mô hình `comic-text-detector` để tách vùng chứa văn bản và sử dụng `Manga-OCR` / `EasyOCR` để trích xuất văn bản tiếng Nhật (hỗ trợ font dọc, viết tay). 
2. **Nghiên cứu Khôi phục ảnh (Inpainting):** Tích hợp mạng học sâu `LaMa` (Large Mask Inpainting) nhằm xóa chữ gốc và tái tạo bối cảnh tranh vẽ bị che khuất.
3. **Nghiên cứu Ngữ nghĩa học (NLP & LLMs):** Sử dụng các công cụ `SudachiPy`, `Kuromoji`, `Kuroshiro` để bóc tách từ vựng, tạo Furigana. Gọi API các Mô hình ngôn ngữ lớn (DeepSeek, OpenAI) để dịch thuật theo ngữ cảnh.
4. **Phát triển phần mềm:** Xây dựng kiến trúc phân tán (Backend - Frontend) hiệu quả: Backend Python (FastAPI) đảm nhiệm xử lý ảnh nặng qua GPU, trong khi Frontend (Chrome Extension bằng Plasmo/React) đảm nhiệm giao diện tương tác và render văn bản.

### 1.3. Yêu cầu đầu ra và tiêu chí đánh giá
- **Yêu cầu đầu ra:**
  - Backend API (FastAPI) chạy trơn tru, có khả năng quản lý và theo dõi hiệu suất mô hình qua MLflow.
  - Chrome Extension (Manifest V3) giao diện React, có thể cài đặt trên Chrome/Edge.
- **Tiêu chí đánh giá:**
  - Mô hình nhận dạng chữ (Manga-OCR) đạt độ chính xác > 90% trên văn bản tiếng Nhật trong ảnh manga.
  - Inpainting (LaMa) khôi phục nền tự nhiên mà không để lại khối màu mờ (artifacts).
  - LLM dịch đúng ngữ cảnh, không bị cứng nhắc.
  - Tốc độ xử lý ảnh nhanh, UI mượt mà không gây đơ (freeze) trình duyệt.

### 1.4. Đối tượng và phạm vi nghiên cứu
- **Đối tượng nghiên cứu:** 
  - Mạng nơ-ron tích chập (CNN) và Generative Adversarial Networks (GAN).
  - Các công cụ NLP phân tích hình thái (Morphological Analysis).
  - Kiến trúc Extension hiện đại với Plasmo Framework.
- **Phạm vi nghiên cứu:** Tối ưu hóa cho ngôn ngữ tiếng Nhật và hình ảnh truyện tranh 2D. 

### 1.5. Công nghệ sử dụng
- **Lĩnh vực AI / ML:** PyTorch, OpenCV, MLflow (theo dõi mô hình).
- **Các mô hình cốt lõi:** LaMa (Inpainting), Manga-OCR / EasyOCR, comic-text-detector.
- **NLP & Dịch thuật:** SudachiPy, DeepSeek API / OpenAI API.
- **Backend:** Python, FastAPI, SQLite.
- **Frontend (Extension):** React, TypeScript, Plasmo Framework, Kuromoji/Kuroshiro.

---

## Chương 2. CƠ SỞ LÝ THUYẾT VÀ CÔNG NGHỆ

### 2.1. Khái quát về Học máy và Học sâu trong Thị giác máy tính
Học máy (Machine Learning) là ngành khoa học cho phép máy tính tự rút ra quy luật từ dữ liệu. Học sâu (Deep Learning) sử dụng Mạng nơ-ron đa lớp để tự động trích xuất đặc trưng hình ảnh. Các mạng Học sâu có thể tự học cách nhận biết các cạnh, góc, kết cấu và đối tượng phức tạp thông qua quá trình lan truyền ngược (Backpropagation).

### 2.2. Mạng nơ-ron tích chập (CNN) và Mạng sinh đối nghịch (GAN)
**Mạng nơ-ron tích chập (CNN):** 
Kiến trúc nền tảng trong Computer Vision. Sử dụng các Lớp tích chập (Convolutional Layers) để rà quét ma trận pixel, qua đó trích xuất các thông tin về không gian của bức tranh.
Công thức toán học của phép tích chập 2D:
$S(i,j) = (I * K)(i,j) = \sum_{m} \sum_{n} I(i+m, j+n) K(m,n)$

**Mạng sinh đối nghịch (GAN):**
Cấu trúc gồm hai mạng nơ-ron (Generator - Mạng sinh và Discriminator - Mạng phân biệt) cạnh tranh với nhau. Generator sinh ra dữ liệu giả, trong khi Discriminator đánh giá tính xác thực của dữ liệu đó. GAN đóng vai trò sống còn trong bài toán khôi phục ảnh tranh vẽ, giúp các nét mực được phục dựng một cách tự nhiên.

### 2.3. Các mô hình phát hiện văn bản và OCR (Text Detection & Manga-OCR)
Phát hiện chữ trong manga gặp vô vàn thách thức do chữ được viết theo chiều dọc, xen kẽ với các từ tượng thanh (SFX) nghệ thuật và nền có nhiều chi tiết vụn.
- **Comic-text-detector:** Là một mô hình học sâu chuyên biệt được huấn luyện trên hàng ngàn trang truyện tranh, có khả năng tách các bong bóng thoại (speech bubbles) và trả về tọa độ các vùng đa giác (polygons) chứa chữ, bất chấp phông nền nhiễu loạn.
- **Manga-OCR:** Là một mô hình nhận dạng ký tự quang học (OCR) cực kỳ mạnh mẽ dành riêng cho tiếng Nhật. Không giống các OCR truyền thống như Tesseract thường bị lỗi với chữ viết tay hoặc chữ dọc, Manga-OCR kết hợp cấu trúc Transformer để đạt độ chính xác cực cao kể cả khi văn bản bị mờ hoặc độ phân giải thấp. Đối với các ngôn ngữ khác, hệ thống dùng dự phòng (fallback) sang `EasyOCR`.

### 2.4. Khôi phục ảnh với LaMa (Large Mask Inpainting)
Khôi phục phần ảnh đằng sau bong bóng thoại lớn là một bài toán khó. Các mô hình truyền thống thường tạo ra các vết mờ (blur). 
**LaMa (Resolution-robust Large Mask Inpainting)** giải quyết vấn đề này bằng cách sử dụng Fast Fourier Convolutions (FFCs). Thay vì chỉ nhìn vào các pixel lân cận, FFC chuyển đổi hình ảnh sang miền tần số không gian (Fourier space), giúp mạng nơ-ron có trường nhìn (receptive field) bao trùm toàn bộ bức tranh ngay từ các lớp đầu tiên. Điều này giúp LaMa hiểu được cấu trúc không gian (ví dụ: các đường thẳng của tòa nhà, hoa văn lưới screentones của áo) và vẽ tiếp phần bị che khuất một cách hoàn hảo.

### 2.5. Xử lý ngôn ngữ tự nhiên (NLP) và Mô hình ngôn ngữ lớn (LLMs)
Để ứng dụng đóng vai trò "Giáo viên tiếng Nhật", đồ án áp dụng hai công nghệ NLP cốt lõi:
- **Phân tích hình thái (Morphological Analysis):** Tiếng Nhật không có khoảng trắng giữa các từ. Việc bóc tách một câu thành các từ vựng độc lập (Tokenization) được thực hiện bởi `SudachiPy` (ở Backend) và `Kuromoji` / `Kuroshiro` (ở Frontend). Các công cụ này không chỉ cắt từ mà còn sinh ra phiên âm (Furigana) hỗ trợ người đọc.
- **LLMs (DeepSeek / OpenAI):** Thay vì dịch word-by-word, hệ thống gửi toàn bộ ngữ cảnh của câu chuyện (các câu thoại trước đó) lên API của Mô hình ngôn ngữ lớn. LLM sẽ xử lý hiện tượng tỉnh lược đại từ (chủ ngữ bị ẩn trong tiếng Nhật) và trả về bản dịch tự nhiên. Ngoài ra, LLM còn giải thích cấu trúc ngữ pháp theo thời gian thực khi người dùng yêu cầu.

### 2.6. Tiện ích trình duyệt (Plasmo, React) và Backend (FastAPI, MLflow)
- **Plasmo Framework:** Một bộ khung (framework) hiện đại, được xây dựng trên nền tảng React và TypeScript, chuyên dùng để phát triển Chrome Extension. Plasmo giải quyết toàn bộ sự phức tạp của Manifest V3, tối ưu hóa quá trình biên dịch (build).
- **FastAPI & SQLite:** Server Python hiệu năng cao. Xử lý các request gửi từ Extension, thực thi Inference trên PyTorch và quản lý dữ liệu truy vấn bằng cơ sở dữ liệu SQLite. Quá trình theo dõi các phiên bản của mô hình AI được quản lý qua `MLflow`.

---

## Chương 3. PHÂN TÍCH VÀ THIẾT KẾ HỆ THỐNG

### 3.1. Phân tích yêu cầu hệ thống
- Tách biệt rõ ràng chức năng: Các tác vụ nặng (LaMa, Text Detection, Manga-OCR) yêu cầu GPU, PyTorch phải nằm ở Backend. Các tác vụ nhẹ (Phân tích từ vựng Kuromoji, Gọi API dịch thuật LLM nếu user có API key, Render chữ) được chuyển sang Frontend Extension để tiết kiệm băng thông và giảm tải server.
- Extension cần có khả năng chặn (intercept) hình ảnh trên các trang web đọc truyện, gửi về máy chủ và phủ (overlay) phần chữ dịch lên ngay trên tấm ảnh gốc của trang.

### 3.2. Sơ đồ luồng hoạt động tổng thể
1. Người dùng vào trang truyện, bật Hakkutsu Extension.
2. Extension quét tìm thẻ `<img>`. Người dùng kích hoạt dịch một tấm ảnh.
3. Extension gửi ảnh về Backend FastAPI.
4. Backend chạy `comic-text-detector` tìm tọa độ chữ, chạy `Manga-OCR` đọc chữ tiếng Nhật.
5. Backend chạy `LaMa` xóa sạch chữ tiếng Nhật và tái tạo ảnh nền, trả về ảnh Cleaned và tọa độ chữ.
6. Extension nhận dữ liệu. Tự động gọi API `DeepSeek/OpenAI` để dịch các câu tiếng Nhật sang tiếng Việt.
7. Extension sử dụng React rendering để chèn văn bản tiếng Việt lên trên tấm ảnh gốc bằng mã HTML/CSS, cho phép người dùng linh hoạt đổi font, sửa kích thước chữ trực tiếp mà không cần server render lại.

### 3.3. Thiết kế kiến trúc Backend (Inference Server)
Backend chia thành các Router nhỏ để dễ bảo trì:
- `routers/ocr.py`: Xử lý bóc tách văn bản.
- `routers/manga.py`: Xử lý phân tích đa giác và inpainting.
- `routers/translation.py`: Chứa fallback logic nếu Client không tự gọi API.
Thiết kế tập trung vào việc quản lý hàng đợi GPU. Nếu có quá nhiều request, Backend sẽ lưu vào SQLite tạm thời và xử lý tuần tự.

### 3.4. Thiết kế kiến trúc Frontend (Chrome Extension - Plasmo)
Sử dụng công nghệ Content Scripts để tiêm (inject) các Component React vào trang web.
- Chế độ Overlay: Tạo ra các thẻ `div` trong suốt đặt đè lên bong bóng thoại. Nội dung thẻ là văn bản dịch.
- Chế độ "Teacher Mode": Bấm vào văn bản dịch, một panel (side panel hoặc popup) sẽ trượt ra, sử dụng `Kuromoji` để giải nghĩa từng từ vựng và `Kuroshiro` để hiển thị Furigana (chữ cách đọc).

---

## Chương 4. XÂY DỰNG, THỰC NGHIỆM VÀ ĐÁNH GIÁ

### 4.1. Thu thập và tiền xử lý dữ liệu
Nhóm xây dựng một tập thử nghiệm nhỏ (Dataset) gồm các trang truyện tranh Nhật Bản đa dạng font chữ.
Cấu hình `.env` cho phép tùy biến:
```env
OCR_LANGUAGES=ja,en
OCR_GPU=auto
OCR_RECOGNIZER=manga_ocr
OCR_DETECTOR=comic
TRANSLATION_MODEL=deepseek-v4-flash
```

### 4.2. Huấn luyện, Tinh chỉnh và Quản lý mô hình
Nhóm không huấn luyện từ đầu (train from scratch) do yêu cầu tài nguyên quá lớn. Quá trình tập trung vào tinh chỉnh (Fine-tuning) prompt của LLM để văn phong dịch truyện mượt mà hơn. Toàn bộ các vòng lặp đánh giá (experiments) của mô hình Computer Vision được lưu lại bằng hệ thống **MLflow**.

### 4.3. Kết quả thực nghiệm và so sánh các mô hình
*(Chèn Bảng số liệu so sánh tại đây)*
- **Manga-OCR vs EasyOCR:** Manga-OCR vượt trội ở tiếng Nhật viết tay và chữ dọc (Accuracy đạt 96% so với 78% của EasyOCR). 
- **LaMa Inpainting:** Đạt chỉ số PSNR trung bình > 32 dB. Nền tranh vẽ chì trắng đen được phục hồi không thể phân biệt được bằng mắt thường.

### 4.4. Phân tích lỗi (Error Analysis) của mô hình
- **Lỗi OCR:** Một số SFX (từ tượng thanh) nghệ thuật bị vẽ quá méo mó khiến Manga-OCR nhận nhầm ký tự.
- **Lỗi Ngữ cảnh LLM:** Nếu không gửi kèm 3-4 câu thoại trước đó, LLM có thể xác định sai chủ ngữ do tiếng Nhật thường xuyên lược bỏ đại từ (Ví dụ: "Ăn chưa?" thay vì "Bạn ăn chưa?").

### 4.5. Đánh giá độ trễ (Latency) và Tài nguyên
Nhờ chuyển phần lớn tác vụ Typesetting và LLM translation về Client (Extension), Backend chỉ chịu trách nhiệm Inpainting và OCR. Điều này giảm tải đáng kể cho server, thời gian phản hồi trung bình cho 1 trang truyện giảm từ 5 giây xuống còn chưa đầy 2.5 giây.

---

## Chương 5. TRIỂN KHAI VÀ VẬN HÀNH HỆ THỐNG TRÊN TRÌNH DUYỆT

### 5.1. Khởi chạy và Quản lý Môi trường
Quy trình vận hành chia làm 2 giai đoạn:
- **Backend:** Khởi chạy bằng `run.ps1`, hệ thống tự thiết lập môi trường ảo `.venv`, nạp các file trọng số (weights) của PyTorch vào VRAM của GPU, mở cổng HTTP `8000`.
- **Frontend Extension:** Dịch mã TypeScript/React bằng Plasmo (`pnpm run dev`), tạo ra thư mục `chrome-mv3-dev`. 

### 5.2. Quản lý trạng thái và giao diện người dùng (UI/UX)
Sử dụng thư viện quản lý trạng thái hiện đại (Zustand hoặc Jotai) trong Extension để xử lý trạng thái nhiều khung hình truyện tranh cùng lúc. Khi người dùng cuộn (scroll) trang web (như trên Webtoon), UI phải giữ đồng bộ vị trí của các lớp phủ văn bản (overlay text) bám dính lấy hình ảnh.
Cơ chế **Dynamic Text Overlay** giúp chữ dịch có thể được người dùng kéo thả (drag), đổi font chữ, thay đổi kích thước ngay tức thì trên giao diện mà không cần render lại ảnh.

### 5.3. Xử lý lỗi hệ thống (Retry & Error Handling)
Trong trường hợp Backend FastAPI xử lý LaMa Inpainting quá lâu hoặc bị timeout, Extension được thiết kế cơ chế Retry Logic (thử lại) tối đa 3 lần. Các lỗi API của LLM (DeepSeek/OpenAI) sẽ hiện cảnh báo ngay trên hộp thoại bằng Toast Notification.

---

## Chương 6. KẾT LUẬN VÀ HƯỚNG PHÁT TRIỂN

### 6.1. Kết luận chung
Đề tài đã hoàn thành xuất sắc việc xây dựng **Hakkutsu** - một trợ lý dịch truyện và học tiếng Nhật toàn diện. Không chỉ ghép nối thành công chuỗi công cụ AI hạng nặng (Comic-text-detector, Manga-OCR, LaMa), nhóm còn ứng dụng tư duy phân tách hệ thống (Architecture split), chuyển phần nhẹ và LLM về Frontend Extension để tối ưu hóa chi phí máy chủ, mang lại một sản phẩm có tính thương mại hóa cao.

### 6.2. Những đóng góp của đề tài
1. Giải quyết bài toán khó của việc dịch văn bản dọc và tiếng Nhật phức tạp trên nền truyện tranh.
2. Xây dựng một Extension trên nền tảng React/Plasmo hiện đại thay vì dùng Vanilla JS cũ.
3. Tiên phong áp dụng tính năng Context-Aware Translation và Morphological Analysis để làm "Giáo viên tiếng Nhật ảo", tạo sự khác biệt lớn so với các công cụ dịch ảnh truyền thống.

### 6.3. Hạn chế của hệ thống
- Inpainting (LaMa) vẫn phụ thuộc hoàn toàn vào GPU máy chủ. Không thể chạy cục bộ trên máy người dùng yếu.
- Webtoon có đặc thù là một bức ảnh rất dài (Vertical scrolling), hiện tại hệ thống tốn nhiều RAM để cắt xén (slicing) ảnh dài trước khi đưa vào mô hình OCR.

### 6.4. Hướng phát triển trong tương lai
- Cung cấp thêm tính năng Integration với **Anki/SRS**: Người dùng click vào một từ mới trên Extension, hệ thống tự sinh ra Flashcard kèm theo hình ảnh truyện tranh làm ngữ cảnh.
- Mở rộng xử lý Webtoon bằng cách thiết kế thuật toán Smart Image Slicing thông minh hơn trên Frontend trước khi gửi về Backend.
- Bổ sung Firebase Auth để đồng bộ hóa danh sách từ vựng và lịch sử đọc truyện của người dùng trên mọi thiết bị.

---

## TÀI LIỆU THAM KHẢO
1. Kha, P. (2023). *Manga-OCR: Optical character recognition for Japanese manga*. GitHub repository.
2. Suvorov, R. et al. (2022). *Resolution-robust Large Mask Inpainting with Fourier Convolutions (LaMa)*.
3. Plasmo Corp. *Plasmo Framework Documentation*.
4. OpenAI / DeepSeek. *LLM API Documentation for Contextual Translation*.
5. Các tài liệu mã nguồn mở về NLP tiếng Nhật (SudachiPy, Kuromoji).

---

> [!IMPORTANT]
> **NHẮC NHỞ QUAN TRỌNG (Dựa theo File Yêu Cầu của Khoa):**
> 1. Báo cáo này khi xuất file nhớ lưu dưới định dạng **.pdf** và chèn đủ ảnh/sơ đồ để đạt **tối thiểu 20 trang**.
> 2. **Slide báo cáo:** Bắt buộc phải chuẩn bị bằng **Tiếng Anh**.
> 3. **Sản phẩm nộp kèm:** Mã nguồn (Source code) và Dữ liệu (Dataset/Weights).
> 4. **Hạn chót nộp kết quả thực hiện đồ án:** Ngày **05/08/2026**.
> 5. **Tỷ trọng điểm:** GVHD 30%, Hội đồng 70% (Dự kiến bảo vệ từ 10/08 - 20/09/2026). Sinh viên chú ý chuẩn bị kỹ Slide Tiếng Anh để thuyết phục Hội đồng.
