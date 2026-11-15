# Kết quả kiểm tra bản bàn giao

Cập nhật trợ lý hội thoại: 97 kiểm thử backend đạt (48,33 giây); frontend production và TypeScript đạt. Kiểm thử thêm chào/cảm ơn/tạm biệt, hỏi lại, mô tả từng món, giá nhiều phần, size/topping, theo dõi món ở lượt trước, phân biệt trường hợp nhiều món, giới hạn thông tin dị ứng và dữ liệu mới sau khi admin sửa món. Kiểm tra mô tả cho toàn bộ món trong database kiểm thử. Chế độ hiện tại vẫn không có mô hình ngôn ngữ do chưa cấu hình khóa API.

Cập nhật 27/10/2026 trên Windows, từ commit nền main 2ef559f. Thay đổi cục bộ, chưa push lên GitHub.

- **80/80 kiểm thử backend đạt** trên database tạm riêng. Có kiểm tra 31 User Story, dữ liệu CSV, giá/giỏ/đơn/đánh giá, LinUCB và chat, ảnh món, đăng nhập admin/khách và phân quyền; bổ sung ca admin mua hàng, khu tổng quan/tài khoản/danh mục và số liệu đánh giá mẫu không sinh bản ghi đánh giá giả.
- Frontend dựng production bằng Webpack thành công; TypeScript đạt, không dùng bỏ qua lỗi.
- Trước đó đã kiểm tra phụ thuộc: pip check không xung đột, npm audit 0 lỗ hổng tại thời điểm nâng bản vá. Không chạy lại audit trong lần sửa giao diện này.
- TestClient/httpx có một cảnh báo tương thích; không có ca thất bại trong lần chạy cuối. Lần chạy ngày 27/10: `python -m pytest tests -q`, kết quả 80 passed trong 53,88 giây.

## Tài khoản và phân quyền

Tạo riêng hai tài khoản thử trên database cục bộ, vai trò admin và customer, mật khẩu ngẫu nhiên lưu trong BE/.local, không nằm trong source ZIP. Không đổi mật khẩu hoặc nâng quyền người dùng cũ. `/` và `/admin` nay dùng cùng một phiên giống cách tham khảo từ BookNest: admin quay lại đặt món vẫn giữ quyền quản trị; muốn mở hai tài khoản đồng thời cần cửa sổ trình duyệt riêng/tạm ẩn danh.

API đăng nhập admin từ chối khách với 403 và không tạo phiên mới. Khách bị chặn khi sửa món, đổi trạng thái bán hoặc đọc toàn bộ đơn. API admin đọc được đơn. Các ca kiểm tra cũ vẫn bảo đảm khách chỉ đọc đơn của mình, chỉ đánh giá món đã mua trong đơn hoàn thành.

Ngày 26/10 đã kiểm tra trực tiếp trên trình duyệt: nút và hộp thoại ghi Đăng nhập; admin đăng nhập ở thực đơn vẫn ở lại thực đơn, hiện đúng nhãn Admin, mở được giỏ hàng và Đơn của tôi; chuyển sang Quản trị cửa hàng rồi bấm Đặt món trở lại vẫn giữ đúng tài khoản. Không tạo đơn hoặc đánh giá minh họa trên dữ liệu đang chạy. Luồng tạo đơn, hoàn thành, đánh giá và kiểm tra quyền giữa admin/khách được kiểm thử trên database tạm.

Đã mở Quản lý món ăn trong trình duyệt: thấy Thêm món, Sửa từng món, Đánh dấu hết/Mở bán và ô tìm món. Đã lưu chỉnh sửa ảnh trên bản ghi thử nghiệm US6.1 và nhận kết quả cập nhật. Không thay giá món thật hoặc tạo đơn để minh họa trong lần này.

Khu quản trị đã bổ sung Tổng quan, Tài khoản, Danh mục và Báo cáo bên cạnh Đơn hàng/Món ăn. API kiểm tra khách không được đọc các mục quản trị, admin không thể tự hạ quyền hoặc tự khóa. Điểm mẫu trên tất cả món nằm trong khoảng 4,5–4,9/5 và ít nhất 500 lượt; bộ kiểm thử xác nhận việc đọc/sắp xếp các số này không làm tăng số bản ghi đánh giá thật.

## Ảnh và dữ liệu

25 món nguồn dùng đủ 25 ảnh riêng. Trên danh mục cục bộ có 35 đường dẫn và 35 nội dung ảnh khác nhau (34 món thật và 1 ảnh giữ chỗ cho món thử đã hết bán). Tất cả URL ảnh được kiểm tra trả 200. Ảnh nguồn được ghi tác giả/trang/giấy phép, lưu trong source và có trang nguồn ảnh liên kết ở footer.

Các ca ảnh kiểm tra tồn tại/tính toàn vẹn file, nâng cấp ảnh giữ chỗ, không ghi đè ảnh quản trị tùy chỉnh, không đổi giá, không chạy trùng và không trùng ảnh giữa 34 món thật. Giá và số lượng món/đơn/dòng đơn/đánh giá/giỏ được đối chiếu trước–sau. Bản ghi người dùng tăng đúng hai tài khoản thử; dữ liệu cũ được giữ.

## CSV và gợi ý

25 món, 474 đánh giá nguồn; 366 train và 108 test không trùng cặp người–món. Không biến ID nguồn thành tài khoản đăng nhập. Điểm tham khảo và cold start chỉ đọc train, tách đánh giá mua hàng. CSV được kiểm tra mã/ngày/sao/null/trùng và chia tập trước khi nhập; các ca TC01–TC10 được đối chiếu trong bộ kiểm thử. Mô hình offline và giới hạn nằm trong DANH-GIA-DU-LIEU.md.

Chat đã kiểm tra câu hỏi giá/nguyên liệu, so sánh giá, combo, hỏi tiếp, tra đơn đúng tài khoản và không tự đặt đơn. Chưa có khóa API nên vẫn là trợ lý theo dữ liệu kết hợp LinUCB; bộ nối OpenAI/Gemini chỉ được kiểm tra HTTP giả lập, chưa nghiệm thu dịch vụ thật.

## Giới hạn

Chưa nghiệm thu MySQL, triển khai công khai, tải lớn, hiệu quả gợi ý trên người dùng thực hoặc thanh toán VNPAY/MoMo. Ảnh là ảnh tham khảo cách trình bày, không xác nhận khẩu phần hoặc thông tin dinh dưỡng của quán. Kiểm thử local không thay nghiệm thu trên môi trường triển khai.
