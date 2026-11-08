# PROJECT CONTEXT – FOODORDER

## 1. Thông tin dự án

**Tên dự án:** Website bán đồ ăn trực tuyến ứng dụng thuật toán LinUCB.

**Repository:** FoodOrder.

**Mục tiêu:** Xây dựng website đặt món ăn trực tuyến cho một cửa hàng, đồng thời tích hợp thuật toán Contextual Bandit LinUCB để tự động đề xuất món ăn dựa trên sở thích của từng khách hàng.

**Phạm vi dự án:**
- Website phục vụ một cửa hàng kinh doanh đồ ăn.
- Khách hàng có thể xem món, đặt món, theo dõi đơn hàng và đánh giá món.
- Quản trị viên có thể quản lý món và đơn hàng.
- Hệ thống học sở thích khách hàng từ hành vi tương tác.
- AI tự động hiển thị các món ăn được đề xuất.
- Không xây dựng chatbot.
- Không xây dựng hệ thống nhiều cửa hàng.

**Nguyên tắc:** Mã nguồn hiện có của trưởng nhóm là nền tảng chính. Không tự ý viết lại toàn bộ website hoặc thay đổi công nghệ đang sử dụng.

## 2. Các vai trò

**Khách hàng:**
- Quản lý tài khoản.
- Khám phá món ăn.
- Đặt hàng và theo dõi đơn hàng.
- Đánh giá món đã mua.
- Nhận gợi ý món ăn cá nhân hóa.

**Quản trị viên:**
- Thêm và sửa món ăn.
- Thay đổi trạng thái còn bán/hết món.
- Xem, xác nhận, từ chối và cập nhật trạng thái đơn hàng.

## 3. Theme và Epic

### Theme 1 – Trải nghiệm mua hàng của khách hàng

- Epic 01: Quản lý tài khoản khách hàng.
- Epic 02: Khám phá món ăn.
- Epic 03: Giỏ hàng và đặt hàng.
- Epic 04: Theo dõi và tra cứu đơn hàng.
- Epic 05: Đánh giá và nhận xét món ăn.

### Theme 2 – Quản lý và vận hành cửa hàng

- Epic 06: Quản lý món ăn.
- Epic 07: Quản lý đơn hàng của cửa hàng.

### Theme 3 – Cá nhân hóa và gợi ý món ăn bằng LinUCB

- Epic 08: Học sở thích từ hành vi và phản hồi khách hàng.
- Epic 09: Gợi ý món ăn cá nhân hóa.

Tổng cộng: **3 Theme, 9 Epic, 31 User Story**.

## 4. Product Backlog

Các giá trị Sprint là kế hoạch dự kiến, không có nghĩa các chức năng đã hoàn thành. Trạng thái thực tế phải kiểm tra trong repository.

| US ID | Chức năng | Story Point | Estimated Effort (h) | Priority | Sprint |
|---|---|---:|---:|---|---|
| US1.1 | Đăng ký tài khoản khách hàng | 3 | 8.17 | Must | 1 |
| US1.2 | Đăng nhập và sử dụng cá nhân hóa | 2 | 5.17 | Must | 1 |
| US1.3 | Đăng xuất | 1 | 2.00 | Must | 1 |
| US2.1 | Xem danh sách món ăn | 2 | 5.00 | Must | 1 |
| US2.2 | Xem chi tiết món ăn | 2 | 4.17 | Must | 1 |
| US2.3 | Tìm kiếm món ăn theo tên | 2 | 5.17 | Should | 1 |
| US3.1 | Thêm món vào giỏ hàng | 2 | 5.17 | Must | 2 |
| US3.2 | Thay đổi số lượng món trong giỏ | 2 | 4.33 | Must | 2 |
| US3.3 | Xóa món khỏi giỏ | 1 | 3.17 | Must | 2 |
| US3.4 | Nhập thông tin nhận hàng | 2 | 5.17 | Must | 2 |
| US3.5 | Kiểm tra và xác nhận đặt hàng | 5 | 12.33 | Must | 2 |
| US4.1 | Xem trạng thái đơn hàng | 2 | 4.33 | Must | 3 |
| US4.2 | Xem lịch sử đơn hàng | 2 | 5.17 | Should | 3 |
| US5.1 | Chấm điểm và nhận xét món đã mua | 3 | 8.17 | Should | 3 |
| US5.2 | Xem đánh giá và nhận xét món | 2 | 5.17 | Could | 3 |
| US6.1 | Admin thêm món ăn | 3 | 8.17 | Must | 1 |
| US6.2 | Admin chỉnh sửa món ăn | 3 | 8.17 | Must | 1 |
| US6.3 | Admin đổi trạng thái còn bán/hết món | 2 | 4.33 | Must | 1 |
| US7.1 | Admin xem danh sách đơn hàng | 3 | 8.17 | Must | 2 |
| US7.2 | Admin xác nhận đơn hàng | 2 | 5.17 | Must | 2 |
| US7.3 | Admin từ chối đơn hàng kèm lý do | 3 | 7.33 | Must | 3 |
| US7.4 | Admin cập nhật trạng thái đơn hàng | 3 | 8.17 | Must | 3 |
| US8.1 | Ghi nhận hành vi xem món | 3 | 8.17 | Must | 4 |
| US8.2 | Ghi nhận hành vi thêm giỏ | 3 | 8.17 | Must | 4 |
| US8.3 | Ghi nhận mua món khi đơn hoàn thành | 5 | 12.33 | Must | 4 |
| US8.4 | Sử dụng điểm đánh giá làm phản hồi | 5 | 12.67 | Should | 4 |
| US9.1 | Hiển thị danh sách gợi ý cá nhân hóa | 5 | 12.33 | Must | 5 |
| US9.2 | Xếp hạng món bằng LinUCB | 8 | 18.67 | Must | 5 |
| US9.3 | Gợi ý ban đầu cho khách hàng mới | 5 | 12.67 | Should | 4 |
| US9.4 | Lọc món hết bán khỏi gợi ý | 2 | 5.17 | Must | 5 |
| US9.5 | Cập nhật gợi ý sau tương tác mới | 8 | 19.00 | Must | 5 |

**Tổng Story Point:** 96.

**Tổng Estimated Effort:** khoảng 241.33 giờ, theo ước lượng PERT.

## 5. Quy tắc nghiệp vụ của website

### 5.1. Món ăn

- Món ăn có thông tin cơ bản như tên, giá, mô tả và trạng thái bán.
- Chỉ món ở trạng thái Còn bán mới được đặt.
- Món Hết món không được xuất hiện trong danh sách gợi ý cá nhân hóa.

### 5.2. Đơn hàng

Luồng trạng thái:

Chờ xác nhận → Đang chuẩn bị → Hoàn thành.

Đơn ở trạng thái Chờ xác nhận có thể bị từ chối và chuyển thành Đã hủy, kèm lý do.

Đơn mới được tạo có trạng thái Chờ xác nhận.

### 5.3. Đánh giá

- Khách hàng đã mua món có thể chấm điểm từ 1 đến 5 sao và viết nhận xét.
- Điểm đánh giá có thể được sử dụng làm tín hiệu phản hồi cho LinUCB.

### 5.4. Thanh toán

Phạm vi ban đầu sử dụng thanh toán khi nhận hàng (COD). Không yêu cầu tích hợp thanh toán trực tuyến.

## 6. Yêu cầu chính của Theme 3 – AI LinUCB

### 6.1. Hình thức AI

Hệ thống tự động đề xuất món ăn trên website, không sử dụng giao diện chatbot.

Danh sách gợi ý có thể xuất hiện trên trang chủ hoặc khu vực dành riêng cho khách hàng.

### 6.2. Dữ liệu đầu vào

Các hành vi cần xem xét:

- Xem chi tiết món ăn.
- Thêm món vào giỏ hàng.
- Mua món thành công.
- Đánh giá món ăn bằng điểm sao.

Mỗi hành vi phải liên kết đúng tài khoản khách hàng và món ăn.

### 6.3. Thuật toán LinUCB

- Sử dụng LinUCB thuộc nhóm Contextual Bandit.
- Xây dựng vector đặc trưng cho ngữ cảnh và món ăn.
- Tính điểm UCB để lựa chọn hoặc xếp hạng món.
- Kết hợp khai thác sở thích đã học và khám phá các món có tiềm năng.
- Cập nhật trạng thái mô hình sau khi có tín hiệu phản hồi hợp lệ.
- Không bắt buộc thứ hạng phải thay đổi sau mọi phản hồi.

Cần đề xuất rõ biểu diễn context, reward và phương án lưu trạng thái mô hình trước khi viết thuật toán.

### 6.4. Reward

Thiết kế reward dựa trên các tín hiệu tương tác.

Phải phân biệt mức độ quan tâm của các hành vi khác nhau.

Chưa ấn định trọng số reward cụ thể. Codex cần đề xuất và giải thích lựa chọn trước khi triển khai.

Đặc biệt, hành vi mua món chỉ được ghi nhận làm tín hiệu khi đơn ở trạng thái Hoàn thành và không được ghi trùng.

### 6.5. Cold-start

Với khách hàng mới hoặc chưa có đủ dữ liệu, hệ thống vẫn cần hiển thị được các món còn bán.

Cơ chế gợi ý ban đầu phải được trình bày và kiểm thử.

### 6.6. Kiểm thử và đánh giá AI

Cần kiểm tra:

- Tài khoản khác nhau có dữ liệu sở thích độc lập.
- Gợi ý có thể thích nghi với dữ liệu tương tác mới.
- Không có món hết bán trong kết quả.
- Không ghi trùng tín hiệu mua hàng.
- Người mới vẫn nhận được gợi ý.
- Hệ thống có thể đánh giá kết quả gợi ý bằng dữ liệu kiểm thử hoặc dữ liệu tương tác.

## 7. Kế hoạch Sprint

**Sprint 1:** Tài khoản, khám phá món, quản lý món.

**Sprint 2:** Giỏ hàng, đặt hàng, tiếp nhận đơn.

**Sprint 3:** Xử lý đơn, tra cứu và đánh giá.

**Sprint 4:** Ghi nhận hành vi, phản hồi và xử lý cold-start.

**Sprint 5:** Thuật toán LinUCB, hiển thị và cập nhật danh sách gợi ý.

Phân bổ Sprint chỉ là kế hoạch ban đầu và có thể điều chỉnh theo năng lực thực tế của nhóm.

## 8. Hướng dẫn Codex khi phát triển dự án

1. Đọc repository thực tế trước khi đề xuất giải pháp.
2. Xác định frontend, backend, database và các API đang tồn tại.
3. Không tự ý thay đổi framework hoặc database.
4. Không viết lại các chức năng đã có.
5. Xác minh trạng thái hoàn thành của từng User Story bằng mã nguồn và kiểm thử.
6. Mỗi lần chỉ triển khai một User Story hoặc một nhóm thay đổi nhỏ có liên quan.
7. Trước khi sửa code phải nêu kế hoạch triển khai.
8. Sau khi sửa code phải liệt kê các file thay đổi và kết quả kiểm thử.
9. Không tự commit, push, merge hoặc triển khai lên môi trường thật.
10. Không đưa lại những thay đổi AI cũ từ Git stash nếu chưa được yêu cầu.

## 9. Nhiệm vụ đầu tiên của Codex

Phân tích mã nguồn FoodOrder hiện tại và lập kế hoạch triển khai Theme 3 – Cá nhân hóa và gợi ý món ăn bằng LinUCB.

Báo cáo cần bao gồm:
- Kiến trúc hiện tại.
- Các chức năng đã và chưa có.
- Các model và API liên quan đến khách hàng, món ăn và đơn hàng.
- Những thành phần cần bổ sung để tích hợp LinUCB.
- Phương án xây dựng dữ liệu tương tác và reward.
- Kế hoạch triển khai từng User Story từ US8.1 đến US9.5.

**Chỉ phân tích và lập kế hoạch trước. Chưa sửa code.**

---

Tài liệu này là bối cảnh nghiệp vụ đã thống nhất trong quá trình lập kế hoạch dự án. Công nghệ và tình trạng hoàn thành các chức năng phải được xác minh từ mã nguồn thực tế.