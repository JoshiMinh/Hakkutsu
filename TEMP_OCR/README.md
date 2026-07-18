# Manga Translator Studio

## Tổng quan

Đây là tài liệu mô tả kiến trúc và luồng hoạt động của **Manga
Translator Studio** -- một ứng dụng dịch manga sử dụng AI, hỗ trợ tự
động hóa từ quá trình crawl, OCR, dịch, xóa chữ, phục hồi nền đến chỉnh
sửa và quản lý bản dịch.

------------------------------------------------------------------------

# Mục tiêu

-   Tự động crawl manga từ website.
-   OCR đa ngôn ngữ.
-   Dịch bằng nhiều mô hình AI (GPT, Gemini, Claude, DeepL...).
-   Xóa text và phục hồi nền bằng AI.
-   Chèn văn bản mới.
-   Cho phép chỉnh sửa thủ công.
-   Quản lý manga, chapter và tiến trình bằng Database.

------------------------------------------------------------------------

# Ba chức năng chính

## 1. Crawl & Dịch tự động nhiều Chapter

Luồng:

``` text
Nhập Link
    ↓
Crawler
    ↓
Lấy Metadata
    ↓
Kiểm tra Database
    ↓
Chọn Chapter
    ↓
AI tự động dịch
```

Quy trình AI:

``` text
Download ảnh
    ↓
OCR
    ↓
Dịch
    ↓
Xóa Text
    ↓
Inpainting
    ↓
Render Text
    ↓
Lưu Database
    ↓
Chapter tiếp theo
```

Đặc điểm:

-   Không cần người dùng can thiệp.
-   Lưu từng chapter ngay khi hoàn thành.
-   Có thể tiếp tục sau khi mất mạng hoặc hết API.

------------------------------------------------------------------------

## 2. Dịch từng Chapter

Editor 4 Panel:

1.  Original Image
2.  Clean Image
3.  Live Preview
4.  Translation Manager

Cho phép:

-   sửa nội dung
-   đổi font
-   đổi màu
-   xoay
-   kéo thả
-   dịch lại bằng model khác

------------------------------------------------------------------------

## 3. Xem bản dịch

``` text
Danh sách Manga
      ↓
Danh sách Chapter
      ↓
Mở Chapter
      ↓
Editor
```

Chức năng:

-   xem lại
-   chỉnh sửa
-   lưu lại

------------------------------------------------------------------------

# Luồng dữ liệu tổng thể

``` text
Website
   ↓
Crawler
   ↓
Metadata
   ↓
Database
   ↓
OCR
   ↓
Translation
   ↓
Bubble Detection
   ↓
Background Detection
   ↓
Inpainting
   ↓
Editor
   ↓
Export
```

------------------------------------------------------------------------

# Chiến lược lưu dữ liệu

Không lưu ảnh đã chèn chữ.

Chỉ lưu:

-   Ảnh nền sạch
-   Bounding Box
-   Văn bản OCR
-   Văn bản AI
-   Văn bản cuối
-   Font
-   Màu
-   Rotation

Mỗi lần sửa chỉ render lại lớp PNG chứa chữ và đè lên nền sạch.

------------------------------------------------------------------------

# Database

## Manga

-   id
-   title
-   author
-   description
-   thumbnail
-   tags

## Chapter

-   id
-   manga_id
-   chapter_number
-   status

## Page

Thông tin từng trang.

## TextBlock

-   page_id
-   x
-   y
-   width
-   height
-   original_text
-   ai_translation
-   final_translation
-   font
-   color
-   rotation

------------------------------------------------------------------------

# Quy trình thêm truyện

``` text
Paste Link
     ↓
Crawler
     ↓
Auto Fill Metadata
     ↓
Cho phép chỉnh sửa
     ↓
Kiểm tra Database
     ↓
Nếu trùng → Cảnh báo
     ↓
Lưu Manga
     ↓
Chọn Chapter
```

------------------------------------------------------------------------

# Dashboard dịch tự động

Trạng thái:

-   Pending
-   Processing
-   Completed
-   Failed

Có thể mở trực tiếp Editor từ bất kỳ Chapter nào.

------------------------------------------------------------------------

# Editor

Panel 1: Ảnh gốc

↓

Panel 2: Ảnh sạch

↓

Panel 3: Preview

↓

Panel 4: Translation Manager

Luồng chỉnh sửa:

``` text
Final Translation
      ↓
Render PNG Text
      ↓
Update Preview
```

------------------------------------------------------------------------

# Mục tiêu cuối cùng

Xây dựng một hệ thống dịch manga chuyên nghiệp:

-   AI tự động hóa tối đa.
-   Có Editor mạnh để hiệu chỉnh.
-   Lưu tiến trình theo Chapter.
-   Tiết kiệm dung lượng nhờ lưu dữ liệu thay vì ảnh hoàn chỉnh.
-   Một Editor dùng chung cho dịch và chỉnh sửa.
