# Đối chiếu 31 User Story

Phạm vi lấy từ workbook người dùng cung cấp; giữ nguyên mã và tiêu chí. Kết quả kiểm tra local ngày 22/10/2026, database SQLite.

| User Story | Nhu cầu | API | Giao diện | Kiểm tra |
|---|---|---|---|---|
| US1.1 | Là một khách hàng, tôi muốn đăng ký tài khoản để tôi có thể sử dụng các chức năng dành cho người dùng của cửa hàng. | /api/auth/register, login, logout; /api/users/me | Đăng nhập, Đăng ký, Tài khoản | Đạt `test_US1_1_registration` |
| US1.2 | Là một khách hàng, tôi muốn đăng nhập vào tài khoản để tôi có thể sử dụng các chức năng cá nhân và nhận các gợi ý món ăn phù hợp với mình. | /api/auth/register, login, logout; /api/users/me | Đăng nhập, Đăng ký, Tài khoản | Đạt `test_US1_2_login` |
| US1.3 | Là một khách hàng, tôi muốn đăng xuất khỏi tài khoản để tôi có thể bảo vệ thông tin cá nhân sau khi sử dụng website. | /api/auth/register, login, logout; /api/users/me | Đăng nhập, Đăng ký, Tài khoản | Đạt `test_US1_3_logout_revokes_old_session` |
| US2.1 | Là một khách hàng, tôi muốn xem danh sách các món ăn đang được cửa hàng cung cấp để tôi có thể lựa chọn món phù hợp. | GET /api/dishes?search=...; GET /api/dishes/{id} | Thực đơn, tìm theo tên, chi tiết | Đạt `test_US2_1_catalogue_has_sold_out` |
| US2.2 | Là một khách hàng, tôi muốn xem thông tin chi tiết của một món ăn để tôi có thể hiểu rõ món trước khi lựa chọn. | GET /api/dishes?search=...; GET /api/dishes/{id} | Thực đơn, tìm theo tên, chi tiết | Đạt `test_US2_2_exact_detail_and_unavailable` |
| US2.3 | Là một khách hàng, tôi muốn tìm kiếm món ăn theo tên để tôi có thể nhanh chóng tìm được món mình quan tâm. | GET /api/dishes?search=...; GET /api/dishes/{id} | Thực đơn, tìm theo tên, chi tiết | Đạt `test_US2_3_search_name_only` |
| US3.1 | Là một khách hàng, tôi muốn thêm món ăn vào giỏ hàng để tôi có thể lưu những món mình muốn đặt. | /api/cart; /api/cart/items; POST /api/orders/preview, /api/orders | Giỏ, số lượng, người nhận, xác nhận | Đạt `test_US3_1_persistent_cart_and_server_prices` |
| US3.2 | Là một khách hàng, tôi muốn thay đổi số lượng món trong giỏ hàng để tôi có thể điều chỉnh đơn hàng theo nhu cầu. | /api/cart; /api/cart/items; POST /api/orders/preview, /api/orders | Giỏ, số lượng, người nhận, xác nhận | Đạt `test_US3_2_positive_integer_quantity_and_owner` |
| US3.3 | Là một khách hàng, tôi muốn xóa món khỏi giỏ hàng để tôi có thể loại bỏ những món mình không còn muốn mua. | /api/cart; /api/cart/items; POST /api/orders/preview, /api/orders | Giỏ, số lượng, người nhận, xác nhận | Đạt `test_US3_3_remove_cart_item` |
| US3.4 | Là một khách hàng, tôi muốn nhập thông tin nhận hàng để tôi có thể nhận đơn tại địa điểm mong muốn. | /api/cart; /api/cart/items; POST /api/orders/preview, /api/orders | Giỏ, số lượng, người nhận, xác nhận | Đạt `test_US3_4_recipient_validation` |
| US3.5 | Là một khách hàng, tôi muốn xác nhận đặt hàng sau khi kiểm tra thông tin đơn để tôi có thể gửi yêu cầu mua món đến cửa hàng. | /api/cart; /api/cart/items; POST /api/orders/preview, /api/orders | Giỏ, số lượng, người nhận, xác nhận | Đạt `test_US3_5_atomic_checkout_and_idempotency` |
| US4.1 | Là một khách hàng, tôi muốn xem trạng thái đơn hàng của mình để tôi có thể biết cửa hàng đang xử lý đơn đến bước nào. | GET /api/orders; GET /api/orders/{id} | Đơn của tôi, chi tiết trạng thái | Đạt `test_US4_1_status_and_ownership` |
| US4.2 | Là một khách hàng, tôi muốn xem lịch sử các đơn hàng đã đặt để tôi có thể tra cứu lại những lần mua hàng trước đây. | GET /api/orders; GET /api/orders/{id} | Đơn của tôi, chi tiết trạng thái | Đạt `test_US4_2_history_isolation` |
| US5.1 | Là một khách hàng đã mua món, tôi muốn chấm điểm và nhận xét món ăn để tôi có thể chia sẻ trải nghiệm của mình về món đã sử dụng. | GET/PUT /api/dishes/{id}/reviews | Đánh giá trong đơn hoàn thành, đánh giá ở chi tiết món | Đạt `test_US5_1_reviews_only_owned_completed_purchase` |
| US5.2 | Là một khách hàng, tôi muốn xem đánh giá và nhận xét về món ăn để tôi có thể tham khảo trải nghiệm của những khách hàng khác trước khi lựa chọn. | GET/PUT /api/dishes/{id}/reviews | Đánh giá trong đơn hoàn thành, đánh giá ở chi tiết món | Đạt `test_US5_2_review_average_and_isolation` |
| US6.1 | Là một quản trị viên, tôi muốn thêm món ăn mới để tôi có thể cập nhật các món cửa hàng đang cung cấp lên website. | POST/PUT /api/admin/dishes; PATCH .../{id}/availability | /admin → Thực đơn | Đạt `test_US6_1_admin_create_and_zero_price` |
| US6.2 | Là một quản trị viên, tôi muốn chỉnh sửa thông tin món ăn để tôi có thể đảm bảo thông tin hiển thị cho khách hàng luôn chính xác. | POST/PUT /api/admin/dishes; PATCH .../{id}/availability | /admin → Thực đơn | Đạt `test_US6_2_atomic_edit` |
| US6.3 | Là một quản trị viên, tôi muốn thay đổi trạng thái còn bán hoặc hết món để tôi có thể ngăn khách hàng đặt những món hiện không thể phục vụ. | POST/PUT /api/admin/dishes; PATCH .../{id}/availability | /admin → Thực đơn | Đạt `test_US6_3_availability_rechecked_at_checkout` |
| US7.1 | Là một quản trị viên, tôi muốn xem các đơn hàng khách hàng đã đặt để tôi có thể biết những đơn cần được xử lý. | GET /api/admin/orders, /{id}; PATCH .../{id}/status | /admin → Đơn hàng → Xem đơn | Đạt `test_US7_1_admin_orders_and_details` |
| US7.2 | Là một quản trị viên, tôi muốn xác nhận đơn hàng mà cửa hàng có thể phục vụ để tôi có thể bắt đầu chuẩn bị món cho khách hàng. | GET /api/admin/orders, /{id}; PATCH .../{id}/status | /admin → Đơn hàng → Xem đơn | Đạt `test_US7_2_confirm_pending_only` |
| US7.3 | Là một quản trị viên, tôi muốn từ chối đơn hàng mà cửa hàng không thể phục vụ để tôi có thể thông báo kết quả cho khách hàng. | GET /api/admin/orders, /{id}; PATCH .../{id}/status | /admin → Đơn hàng → Xem đơn | Đạt `test_US7_3_reject_with_reason` |
| US7.4 | Là một quản trị viên, tôi muốn cập nhật trạng thái xử lý của đơn hàng để tôi có thể thông báo cho khách hàng về tiến trình thực hiện đơn. | GET /api/admin/orders, /{id}; PATCH .../{id}/status | /admin → Đơn hàng → Xem đơn | Đạt `test_US7_4_complete_only_preparing` |
| US8.1 | Là một khách hàng, tôi muốn những món ăn mình thường xem được sử dụng để nhận biết sở thích của mình để tôi có thể nhận được các gợi ý phù hợp hơn. | POST /api/dishes/{id}/views; giỏ/hoàn thành đơn/đánh giá tự ghi sự kiện | Chi tiết, thêm giỏ, hoàn thành đơn, đánh giá | Đạt `test_US8_1_view_record_and_dedup` |
| US8.2 | Là một khách hàng, tôi muốn hành vi thêm món vào giỏ hàng được sử dụng để nhận biết mức độ quan tâm của mình để tôi có thể nhận được các gợi ý phù hợp hơn. | POST /api/dishes/{id}/views; giỏ/hoàn thành đơn/đánh giá tự ghi sự kiện | Chi tiết, thêm giỏ, hoàn thành đơn, đánh giá | Đạt `test_US8_2_cart_event_valid_only` |
| US8.3 | Là một khách hàng, tôi muốn những món mình đã đặt mua được sử dụng để nhận biết sở thích của mình để các gợi ý phản ánh tốt hơn những món tôi thực sự lựa chọn. | POST /api/dishes/{id}/views; giỏ/hoàn thành đơn/đánh giá tự ghi sự kiện | Chi tiết, thêm giỏ, hoàn thành đơn, đánh giá | Đạt `test_US8_3_purchase_completed_only_no_duplicates` |
| US8.4 | Là một khách hàng, tôi muốn điểm đánh giá món ăn của mình được sử dụng để nhận biết món tôi thích hoặc không thích để các gợi ý trong tương lai phù hợp hơn. | POST /api/dishes/{id}/views; giỏ/hoàn thành đơn/đánh giá tự ghi sự kiện | Chi tiết, thêm giỏ, hoàn thành đơn, đánh giá | Đạt `test_US8_4_rating_feedback_updates_not_duplicates` |
| US9.1 | Là một khách hàng, tôi muốn xem danh sách món ăn được gợi ý dựa trên sở thích của mình để tôi có thể tìm món phù hợp nhanh hơn. | GET /api/recommendations | Hôm nay ăn gì, làm mới gợi ý | Đạt `test_US9_1_personalized_recommendation_cards` |
| US9.2 | Là một khách hàng, tôi muốn những món phù hợp hơn với sở thích của mình được ưu tiên trong danh sách gợi ý để tôi có thể dễ dàng nhận thấy những lựa chọn phù hợp nhất. | GET /api/recommendations | Hôm nay ăn gì, làm mới gợi ý | Đạt `test_US9_2_scores_sorted_and_user_isolation` |
| US9.3 | Là một khách hàng mới, tôi muốn nhận được các gợi ý món ăn ban đầu khi hệ thống chưa có đủ dữ liệu về sở thích của tôi để tôi vẫn có thể tham khảo các món phù hợp. | GET /api/recommendations | Hôm nay ăn gì, làm mới gợi ý | Đạt `test_US9_3_cold_start_and_transition` |
| US9.4 | Là một khách hàng, tôi muốn danh sách gợi ý chỉ chứa những món hiện còn bán để tôi không mất thời gian xem những món không thể đặt. | GET /api/recommendations | Hôm nay ăn gì, làm mới gợi ý | Đạt `test_US9_4_no_unavailable_recommendations` |
| US9.5 | Là một khách hàng, tôi muốn danh sách gợi ý được cập nhật sau những tương tác và phản hồi mới của mình để các đề xuất có thể dần thích nghi với sở thích của tôi. | GET /api/recommendations | Hôm nay ăn gì, làm mới gợi ý | Đạt `test_US9_5_fresh_interactions_update_ranking` |

## Tiêu chí nguồn

### US1.1
Là một khách hàng, tôi muốn đăng ký tài khoản để tôi có thể sử dụng các chức năng dành cho người dùng của cửa hàng.

1. Biểu mẫu đăng ký: Có các trường Họ tên, Email, Số điện thoại, Mật khẩu và Xác nhận mật khẩu.

2. Xác thực dữ liệu: Các trường bắt buộc không được để trống; Email phải đúng định dạng; Số điện thoại chỉ chứa ký tự số và đúng định dạng; Email chưa được sử dụng bởi tài khoản khác; Mật khẩu và Xác nhận mật khẩu phải trùng nhau.

3. Lưu trữ dữ liệu: Khi toàn bộ thông tin hợp lệ, tài khoản mới được lưu vào hệ thống.

4. Thông báo trạng thái: Hiển thị thông báo đăng ký thành công sau khi tài khoản được tạo.

5. Thông báo lỗi: Nếu còn dữ liệu không hợp lệ, hệ thống hiển thị lỗi tương ứng và không tạo tài khoản.

### US1.2
Là một khách hàng, tôi muốn đăng nhập vào tài khoản để tôi có thể sử dụng các chức năng cá nhân và nhận các gợi ý món ăn phù hợp với mình.

1. Biểu mẫu đăng nhập: Có trường Email và Mật khẩu.

2. Xác thực dữ liệu: Email và Mật khẩu không được để trống; thông tin nhập phải khớp với một tài khoản đã đăng ký.

3. Trạng thái đăng nhập: Sau khi đăng nhập thành công, hệ thống nhận diện đúng tài khoản đang sử dụng.

4. Kết quả: Khách hàng được sử dụng các chức năng yêu cầu đăng nhập.

5. Thông báo lỗi: Hiển thị thông báo khi Email hoặc Mật khẩu không chính xác.

### US1.3
Là một khách hàng, tôi muốn đăng xuất khỏi tài khoản để tôi có thể bảo vệ thông tin cá nhân sau khi sử dụng website.

1. Chức năng đăng xuất: Khách hàng đang đăng nhập có thể thực hiện đăng xuất.

2. Trạng thái đăng nhập: Sau khi đăng xuất, tài khoản chuyển về trạng thái chưa đăng nhập.

3. Quyền truy cập: Phiên đăng nhập cũ không được tiếp tục sử dụng để truy cập các chức năng yêu cầu đăng nhập.

### US2.1
Là một khách hàng, tôi muốn xem danh sách các món ăn đang được cửa hàng cung cấp để tôi có thể lựa chọn món phù hợp.

1. Hiển thị danh sách: Hiển thị các món ăn hiện có trong thực đơn.

2. Thông tin món: Mỗi món hiển thị tối thiểu Tên món, Hình ảnh, Giá và Trạng thái còn bán/hết món.

3. Chính xác dữ liệu: Thông tin hiển thị phải khớp với dữ liệu hiện tại của món ăn.

4. Trường hợp không có dữ liệu: Nếu chưa có món ăn, hiển thị thông báo danh sách trống.

### US2.2
Là một khách hàng, tôi muốn xem thông tin chi tiết của một món ăn để tôi có thể hiểu rõ món trước khi lựa chọn.

1. Hiển thị chi tiết: Hiển thị Tên món, Hình ảnh, Mô tả, Giá và Trạng thái của món được chọn.

2. Chính xác dữ liệu: Thông tin hiển thị phải thuộc đúng món khách hàng đã chọn.

3. Trạng thái món: Nếu món ở trạng thái Hết món, phải hiển thị rõ và không cho phép thêm món đó vào giỏ hàng.

4. Thông báo lỗi: Nếu món không tồn tại, hiển thị thông báo không tìm thấy món.

### US2.3
Là một khách hàng, tôi muốn tìm kiếm món ăn theo tên để tôi có thể nhanh chóng tìm được món mình quan tâm.

1. Chức năng tìm kiếm: Có ô cho phép nhập tên hoặc từ khóa món ăn.

2. Kết quả tìm kiếm: Hiển thị các món có tên phù hợp với từ khóa đã nhập.

3. Thông tin kết quả: Kết quả phải hiển thị đúng tên, giá và trạng thái của món.

4. Không có kết quả: Hiển thị thông báo khi không tìm thấy món phù hợp.

### US3.1
Là một khách hàng, tôi muốn thêm món ăn vào giỏ hàng để tôi có thể lưu những món mình muốn đặt.

1. Chức năng thêm giỏ: Khách hàng có thể thêm một món đang Còn bán vào giỏ hàng.

2. Điều kiện nghiệp vụ: Không cho phép thêm món đang Hết món.

3. Cập nhật giỏ hàng: Sau khi thêm thành công, món và số lượng tương ứng phải xuất hiện trong giỏ.

4. Tính tiền: Tổng tạm tính của giỏ được cập nhật theo giá và số lượng món.

5. Thông báo lỗi: Hiển thị thông báo khi món không thể được thêm vào giỏ.

### US3.2
Là một khách hàng, tôi muốn thay đổi số lượng món trong giỏ hàng để tôi có thể điều chỉnh đơn hàng theo nhu cầu.

1. Chức năng số lượng: Cho phép tăng hoặc giảm số lượng món đang có trong giỏ.

2. Xác thực dữ liệu: Số lượng món phải là số nguyên lớn hơn 0.

3. Cập nhật giá: Thành tiền của món và tổng tạm tính của giỏ phải được tính lại sau khi thay đổi số lượng.

4. Thông báo lỗi: Không chấp nhận giá trị số lượng không hợp lệ.

### US3.3
Là một khách hàng, tôi muốn xóa món khỏi giỏ hàng để tôi có thể loại bỏ những món mình không còn muốn mua.

1. Chức năng xóa: Khách hàng có thể xóa một món đang có trong giỏ hàng.

2. Cập nhật giỏ: Món đã xóa không còn xuất hiện trong giỏ.

3. Tính tiền: Tổng tạm tính được tính lại sau khi xóa món.

4. Trạng thái rỗng: Nếu món cuối cùng bị xóa, hiển thị trạng thái giỏ hàng trống.

### US3.4
Là một khách hàng, tôi muốn nhập thông tin nhận hàng để tôi có thể nhận đơn tại địa điểm mong muốn.

1. Biểu mẫu nhận hàng: Có các trường Người nhận, Số điện thoại và Địa chỉ nhận hàng.

2. Xác thực dữ liệu: Các trường bắt buộc không được để trống; Số điện thoại chỉ chứa ký tự số và đúng định dạng; Địa chỉ phải có nội dung.

3. Ghi nhận thông tin: Thông tin hợp lệ được sử dụng cho đơn hàng đang tạo.

4. Thông báo lỗi: Nếu dữ liệu không hợp lệ, hiển thị lỗi tương ứng và không cho xác nhận đơn hàng.

### US3.5
Là một khách hàng, tôi muốn xác nhận đặt hàng sau khi kiểm tra thông tin đơn để tôi có thể gửi yêu cầu mua món đến cửa hàng.

1. Hiển thị thông tin đơn: Trước khi xác nhận phải hiển thị các món, số lượng, đơn giá, tổng tiền và thông tin nhận hàng.

2. Điều kiện đặt hàng: Giỏ hàng không được trống; tất cả món trong giỏ phải đang Còn bán; thông tin nhận hàng phải hợp lệ.

3. Lưu trữ dữ liệu: Khi xác nhận thành công, đơn hàng và chi tiết các món được lưu vào hệ thống.

4. Trạng thái đơn hàng: Đơn mới được tạo với trạng thái Chờ xác nhận.

5. Thông báo trạng thái: Hiển thị thông báo đặt hàng thành công và mã đơn hàng.

6. Thông báo lỗi: Không tạo đơn nếu có món Hết món hoặc thông tin đặt hàng không hợp lệ.

### US4.1
Là một khách hàng, tôi muốn xem trạng thái đơn hàng của mình để tôi có thể biết cửa hàng đang xử lý đơn đến bước nào.

1. Hiển thị trạng thái: Hiển thị trạng thái hiện tại của đơn hàng khách hàng đã đặt.

2. Trạng thái hỗ trợ: Trạng thái đơn được thể hiện theo các giá trị Chờ xác nhận, Đang chuẩn bị, Hoàn thành hoặc Đã hủy.

3. Chính xác dữ liệu: Trạng thái hiển thị phải khớp với trạng thái hiện tại của đơn hàng.

4. Quyền truy cập: Khách hàng chỉ được xem trạng thái các đơn thuộc tài khoản của mình.

### US4.2
Là một khách hàng, tôi muốn xem lịch sử các đơn hàng đã đặt để tôi có thể tra cứu lại những lần mua hàng trước đây.

1. Danh sách đơn: Hiển thị các đơn hàng thuộc tài khoản đang đăng nhập.

2. Thông tin đơn: Mỗi đơn hiển thị tối thiểu Mã đơn, Thời gian đặt, Tổng tiền và Trạng thái.

3. Tra cứu: Khách hàng có thể chọn một đơn để xem chi tiết.

4. Quyền riêng tư: Không hiển thị đơn hàng của tài khoản khác.

5. Trường hợp không có dữ liệu: Hiển thị thông báo nếu khách hàng chưa có đơn hàng.

### US5.1
Là một khách hàng đã mua món, tôi muốn chấm điểm và nhận xét món ăn để tôi có thể chia sẻ trải nghiệm của mình về món đã sử dụng.

1. Điều kiện đánh giá: Chỉ được đánh giá món thuộc đơn hàng của chính khách hàng và đơn hàng phải ở trạng thái Hoàn thành.

2. Biểu mẫu đánh giá: Cho phép chọn điểm từ 1 đến 5 sao và nhập nội dung nhận xét.

3. Xác thực dữ liệu: Điểm đánh giá phải nằm trong khoảng 1–5; nhận xét nếu có phải nằm trong giới hạn nội dung của hệ thống.

4. Lưu trữ dữ liệu: Đánh giá được lưu và gắn đúng khách hàng, món ăn và đơn hàng liên quan.

5. Thông báo trạng thái: Hiển thị thông báo sau khi gửi đánh giá thành công.

### US5.2
Là một khách hàng, tôi muốn xem đánh giá và nhận xét về món ăn để tôi có thể tham khảo trải nghiệm của những khách hàng khác trước khi lựa chọn.

1. Hiển thị đánh giá: Hiển thị điểm đánh giá và nhận xét của đúng món ăn.

2. Điểm trung bình: Nếu hiển thị điểm trung bình, giá trị phải được tính từ các đánh giá hợp lệ của món.

3. Chính xác dữ liệu: Không hiển thị đánh giá thuộc món ăn khác.

4. Trường hợp không có dữ liệu: Hiển thị thông báo khi món chưa có đánh giá.

### US6.1
Là một quản trị viên, tôi muốn thêm món ăn mới để tôi có thể cập nhật các món cửa hàng đang cung cấp lên website.

1. Biểu mẫu món ăn: Có các trường Tên món, Mô tả, Giá, Hình ảnh và Trạng thái bán.

2. Xác thực dữ liệu: Tên món không được để trống; Giá phải là số lớn hơn hoặc bằng 0; dữ liệu nhập phải đúng định dạng.

3. Lưu trữ dữ liệu: Khi dữ liệu hợp lệ, món ăn mới được lưu vào hệ thống.

4. Thông báo trạng thái: Hiển thị thông báo thêm món thành công.

5. Thông báo lỗi: Nếu dữ liệu không hợp lệ, hiển thị lỗi tương ứng và không tạo món mới.

### US6.2
Là một quản trị viên, tôi muốn chỉnh sửa thông tin món ăn để tôi có thể đảm bảo thông tin hiển thị cho khách hàng luôn chính xác.

1. Chức năng chỉnh sửa: Cho phép chọn một món hiện có và thay đổi Tên món, Mô tả, Giá hoặc Hình ảnh.

2. Xác thực dữ liệu: Tên món không được để trống; Giá phải là số lớn hơn hoặc bằng 0.

3. Lưu trữ dữ liệu: Dữ liệu mới chỉ được cập nhật cho đúng món khi hợp lệ.

4. Thông báo trạng thái: Hiển thị thông báo cập nhật thành công.

5. Thông báo lỗi: Nếu dữ liệu mới không hợp lệ, không cập nhật và hiển thị lỗi tương ứng.

### US6.3
Là một quản trị viên, tôi muốn thay đổi trạng thái còn bán hoặc hết món để tôi có thể ngăn khách hàng đặt những món hiện không thể phục vụ.

1. Chức năng trạng thái: Cho phép chuyển món giữa trạng thái Còn bán và Hết món.

2. Lưu trữ dữ liệu: Trạng thái mới được cập nhật cho đúng món.

3. Điều kiện nghiệp vụ: Món ở trạng thái Hết món không được phép thêm mới vào giỏ hàng.

4. Hiển thị: Khách hàng phải nhìn thấy đúng trạng thái hiện tại của món.

### US7.1
Là một quản trị viên, tôi muốn xem các đơn hàng khách hàng đã đặt để tôi có thể biết những đơn cần được xử lý.

1. Danh sách đơn: Hiển thị các đơn hàng của cửa hàng.

2. Thông tin đơn: Mỗi đơn hiển thị tối thiểu Mã đơn, Khách hàng, Thời gian đặt, Tổng tiền và Trạng thái.

3. Chi tiết đơn: Quản trị viên có thể chọn một đơn để xem các món, số lượng và thông tin nhận hàng.

4. Nhận biết đơn mới: Các đơn ở trạng thái Chờ xác nhận phải được thể hiện rõ.

### US7.2
Là một quản trị viên, tôi muốn xác nhận đơn hàng mà cửa hàng có thể phục vụ để tôi có thể bắt đầu chuẩn bị món cho khách hàng.

1. Điều kiện xác nhận: Chỉ đơn ở trạng thái Chờ xác nhận mới được phép xác nhận.

2. Cập nhật trạng thái: Sau khi xác nhận thành công, đơn chuyển sang trạng thái Đang chuẩn bị.

3. Hiển thị cho khách hàng: Khách hàng nhìn thấy trạng thái Đang chuẩn bị khi theo dõi đơn.

4. Thông báo lỗi: Không cho phép xác nhận lại đơn đã được xử lý hoặc đã hủy.

### US7.3
Là một quản trị viên, tôi muốn từ chối đơn hàng mà cửa hàng không thể phục vụ để tôi có thể thông báo kết quả cho khách hàng.

1. Điều kiện từ chối: Chỉ đơn ở trạng thái Chờ xác nhận mới được phép từ chối.

2. Lý do từ chối: Quản trị viên phải nhập hoặc chọn lý do trước khi xác nhận từ chối.

3. Lưu trữ dữ liệu: Trạng thái Đã hủy và lý do từ chối được lưu cho đúng đơn hàng.

4. Hiển thị cho khách hàng: Khách hàng nhìn thấy đơn đã bị hủy cùng lý do từ chối.

5. Thông báo lỗi: Không cho phép từ chối đơn đã Hoàn thành.

### US7.4
Là một quản trị viên, tôi muốn cập nhật trạng thái xử lý của đơn hàng để tôi có thể thông báo cho khách hàng về tiến trình thực hiện đơn.

1. Chức năng trạng thái: Quản trị viên có thể chuyển đơn từ Đang chuẩn bị sang Hoàn thành.

2. Điều kiện nghiệp vụ: Không cho phép chuyển ngược trạng thái hoặc cập nhật trạng thái không đúng luồng.

3. Lưu trữ dữ liệu: Trạng thái mới được cập nhật cho đúng đơn hàng.

4. Hiển thị: Khách hàng nhìn thấy trạng thái mới khi theo dõi đơn.

5. Thông báo lỗi: Hiển thị thông báo khi yêu cầu chuyển trạng thái không hợp lệ.

### US8.1
Là một khách hàng, tôi muốn những món ăn mình thường xem được sử dụng để nhận biết sở thích của mình để tôi có thể nhận được các gợi ý phù hợp hơn.

1. Ghi nhận hành vi: Khi khách hàng đã đăng nhập xem chi tiết một món, hệ thống ghi nhận hành vi xem món.

2. Chính xác dữ liệu: Hành vi phải được gắn đúng khách hàng và đúng món được xem.

3. Lưu trữ dữ liệu: Hành vi xem món hợp lệ được lưu để sử dụng cho quá trình cá nhân hóa.

4. Độc lập dữ liệu: Hành vi của khách hàng này không được ghi nhận vào dữ liệu của khách hàng khác.

### US8.2
Là một khách hàng, tôi muốn hành vi thêm món vào giỏ hàng được sử dụng để nhận biết mức độ quan tâm của mình để tôi có thể nhận được các gợi ý phù hợp hơn.

1. Ghi nhận hành vi: Khi khách hàng đã đăng nhập thêm một món vào giỏ, hệ thống ghi nhận hành vi thêm giỏ.

2. Chính xác dữ liệu: Hành vi phải được gắn đúng khách hàng và đúng món được thêm.

3. Ghi nhận phản hồi: Hành vi thêm giỏ được xem là một tín hiệu thể hiện sự quan tâm của khách hàng đối với món đó.

4. Lưu trữ dữ liệu: Tín hiệu được lưu để sử dụng trong những lần gợi ý tiếp theo.

5. Độc lập dữ liệu: Tín hiệu của một khách hàng không được gán cho khách hàng khác.

### US8.3
Là một khách hàng, tôi muốn những món mình đã đặt mua được sử dụng để nhận biết sở thích của mình để các gợi ý phản ánh tốt hơn những món tôi thực sự lựa chọn.

1. Điều kiện ghi nhận: Chỉ món thuộc đơn hàng của khách hàng và đơn đã ở trạng thái Hoàn thành mới được ghi nhận là hành vi mua.

2. Chính xác dữ liệu: Hành vi mua phải được gắn đúng khách hàng và đúng món đã mua.

3. Lưu trữ dữ liệu: Món đã mua được lưu làm một tín hiệu sở thích của khách hàng.

4. Không ghi nhận trùng: Cùng một món trong cùng một đơn hàng không được ghi nhận lặp lại do xử lý cùng một sự kiện nhiều lần.

### US8.4
Là một khách hàng, tôi muốn điểm đánh giá món ăn của mình được sử dụng để nhận biết món tôi thích hoặc không thích để các gợi ý trong tương lai phù hợp hơn.

1. Nguồn dữ liệu: Chỉ sử dụng điểm đánh giá hợp lệ do chính khách hàng tạo.

2. Ghi nhận phản hồi: Điểm đánh giá được ghi nhận là tín hiệu phản hồi về mức độ yêu thích của khách hàng đối với món ăn.

3. Cập nhật dữ liệu sở thích: Điểm đánh giá mới phải được sử dụng trong lần tạo gợi ý tiếp theo của đúng khách hàng.

4. Độc lập dữ liệu: Đánh giá của một khách hàng không được gán vào dữ liệu cá nhân hóa của khách hàng khác.

### US9.1
Là một khách hàng, tôi muốn xem danh sách món ăn được gợi ý dựa trên sở thích của mình để tôi có thể tìm món phù hợp nhanh hơn.

1. Hiển thị gợi ý: Có khu vực hiển thị danh sách món ăn gợi ý cho khách hàng đã đăng nhập.

2. Cá nhân hóa: Khi khách hàng đã có dữ liệu tương tác, danh sách gợi ý phải dựa trên dữ liệu của đúng khách hàng đó.

3. Thông tin món: Mỗi món gợi ý hiển thị tối thiểu Tên món, Hình ảnh và Giá.

4. Điều hướng: Khách hàng có thể chọn món gợi ý để xem thông tin chi tiết.

5. Trường hợp chưa đủ dữ liệu: Nếu chưa đủ dữ liệu cá nhân hóa, hệ thống phải hiển thị danh sách gợi ý ban đầu thay vì để trống hoặc báo lỗi.

### US9.2
Là một khách hàng, tôi muốn những món phù hợp hơn với sở thích của mình được ưu tiên trong danh sách gợi ý để tôi có thể dễ dàng nhận thấy những lựa chọn phù hợp nhất.

1. Xếp hạng: Các món đủ điều kiện được sắp xếp theo mức độ phù hợp với khách hàng.

2. Ưu tiên: Trong cùng một lần gợi ý, món có mức độ phù hợp cao hơn phải được hiển thị trước món có mức độ phù hợp thấp hơn.

3. Cá nhân hóa: Việc xếp hạng phải dựa trên dữ liệu của đúng khách hàng đang đăng nhập.

4. Khả dụng: Chỉ món đang ở trạng thái Còn bán mới được tham gia danh sách xếp hạng.

### US9.3
Là một khách hàng mới, tôi muốn nhận được các gợi ý món ăn ban đầu khi hệ thống chưa có đủ dữ liệu về sở thích của tôi để tôi vẫn có thể tham khảo các món phù hợp.

1. Nhận diện: Hệ thống xác định được trường hợp khách hàng chưa có đủ dữ liệu tương tác để cá nhân hóa.

2. Gợi ý ban đầu: Khách hàng vẫn được hiển thị một danh sách món đang Còn bán theo phương án gợi ý ban đầu đã được nhóm xác định.

3. Khả dụng: Danh sách gợi ý ban đầu không chứa món ở trạng thái Hết món.

4. Chuyển sang cá nhân hóa: Sau khi khách hàng phát sinh dữ liệu tương tác, các lần gợi ý tiếp theo có thể sử dụng dữ liệu đó để cá nhân hóa.

### US9.4
Là một khách hàng, tôi muốn danh sách gợi ý chỉ chứa những món hiện còn bán để tôi không mất thời gian xem những món không thể đặt.

1. Lọc trạng thái: Chỉ món có trạng thái Còn bán được đưa vào danh sách gợi ý.

2. Cập nhật: Khi một món chuyển sang Hết món, món đó không xuất hiện trong những lần tạo danh sách gợi ý tiếp theo.

3. Chính xác dữ liệu: Trạng thái món trong danh sách gợi ý phải khớp với trạng thái hiện tại của món trên hệ thống.

### US9.5
Là một khách hàng, tôi muốn danh sách gợi ý được cập nhật sau những tương tác và phản hồi mới của mình để các đề xuất có thể dần thích nghi với sở thích của tôi.

1. Ghi nhận tương tác mới: Các hành vi xem món, thêm món vào giỏ, mua món và đánh giá hợp lệ của khách hàng được ghi nhận.

2. Cập nhật dữ liệu sở thích: Tương tác mới phải được sử dụng trong lần tạo danh sách gợi ý tiếp theo của đúng khách hàng.

3. Cập nhật danh sách gợi ý: Khi dữ liệu tương tác mới làm thay đổi mức độ phù hợp của các món, thứ tự danh sách gợi ý phải được cập nhật tương ứng.

4. Độc lập dữ liệu: Tương tác của một khách hàng không được làm thay đổi dữ liệu cá nhân hóa của khách hàng khác.
