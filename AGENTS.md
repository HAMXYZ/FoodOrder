
# FoodOrder - Codex Instructions

## Project
Website bán đồ ăn trực tuyến cho một cửa hàng.
Chức năng AI chính là tự động gợi ý món bằng LinUCB.

## Requirements
Sử dụng docs/PROJECT_CONTEXT.md làm tài liệu
yêu cầu nghiệp vụ khi triển khai tính năng.

## Rules
- Đọc mã nguồn liên quan trước khi sửa.
- Không tự ý đổi framework hoặc database.
- Không viết lại dự án từ đầu.
- Không làm hỏng API và chức năng hiện có.
- Chỉ triển khai User Story được yêu cầu.
- Viết và chạy kiểm thử khi có thể.
- Giải thích những file đã sửa.
- Không tự commit, push hoặc merge.

## LinUCB
- AI tự động đề xuất món, không xây chatbot.
- Ghi nhận hành vi theo từng người dùng.
- Chỉ ghi nhận mua món khi đơn hoàn thành.
- Không ghi nhận trùng reward mua hàng.
- Hỗ trợ cold-start.
- Không gợi ý món hết bán.
