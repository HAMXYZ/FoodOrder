# FoodOrder hoàn thiện theo Product Backlog

Bản bàn giao bổ sung 31 User Story của tệp `Product backlog & sprint (1).xlsx`, trên nền commit `2ef559f55843377d193c83dae3d56ff83ad77688` của HAMXYZ/FoodOrder. Thay đổi được thực hiện cục bộ, chưa push lên GitHub. Bản tải ban đầu được giữ riêng trong folder `FoodOrder`.

## Chạy trên máy hiện tại

Frontend mới: **http://127.0.0.1:3001**. Backend: **http://127.0.0.1:8001/docs**.

Các cổng 3000/8000 là bản cũ. Hãy dùng cổng 3001 để xem chức năng mới.

Folder hiện tại đã cài môi trường và dựng frontend. Nếu cần mở lại, chạy `CHAY-DU-AN.cmd`. Tài khoản thử cục bộ được ghi trong `BE/.local/TAI-KHOAN-ADMIN-KHACH.txt`; dữ liệu thử và mật khẩu này không nằm trong ZIP source. Bạn có thể tự đăng ký tài khoản khách hàng trên trang web. Tạo quản trị viên riêng bằng `TAO-ADMIN.cmd`.

## Khi giải nén trên máy khác

1. Cần Python 3.12 và Node.js có npm. Môi trường đã kiểm tra: Python 3.12.14, Node 24.15.0, npm 11.12.1.
2. Chạy `CAI-DAT.cmd` trong folder. Script tạo `.venv`, cài thư viện từ bản khóa, cài frontend và dựng bản chạy. Lần cài đầu cần Internet.
3. Chạy `TAO-ADMIN.cmd`, nhập email, họ tên, số điện thoại và mật khẩu mới của bạn. Mật khẩu được nhập kín; không có tài khoản quản trị hoặc mật khẩu mặc định trong source.
4. Chạy `CHAY-DU-AN.cmd`, rồi mở http://127.0.0.1:3001. Giữ hai cửa sổ chạy; dừng bằng Ctrl+C ở mỗi cửa sổ.
5. Đăng ký tài khoản khách để đặt hàng; đăng nhập tài khoản quản trị và vào `/admin` để quản lý.

Nếu cổng đã có chương trình khác sử dụng, dừng phiên FoodOrder cũ trước khi chạy lại. Không xóa cơ sở dữ liệu để xử lý lỗi cổng.

## Cấu trúc và dữ liệu

- `FE/`: Next.js 16.3.8, React 19, TypeScript; hai trang `/` và `/admin`. Giao diện hoạt động nằm trong `components/food/full-app.tsx`, kết nối dùng `lib/api.ts`.
- `BE/main.py`: API tài khoản, món, giỏ, đơn, đánh giá và gợi ý.
- `BE/contracts.py`: kiểm tra dữ liệu; số điện thoại Việt Nam 10–11 số bắt đầu bằng 0, mật khẩu tối thiểu 8 ký tự, sao nguyên 1–5, giá không âm.
- `BE/models.py`: các bảng sẵn có; `extended_models.py`: bảng phiên đăng nhập, metadata món, giỏ, thông tin nhận đơn, đánh giá và tương tác.
- `BE/services.py`: tính tiền, ánh xạ dữ liệu, thực đơn khởi tạo và LinUCB.
- `BE/tests/test_backlog.py`: kiểm thử trên database tạm riêng, không dùng database đang chạy.
- `docs/DOI-CHIEU-BACKLOG.md`: ánh xạ toàn bộ 31 mục với API, giao diện và ca kiểm tra.
- `BE/.local/foodorder.db`: database SQLite được tạo tự động khi chạy lần đầu. Khởi tạo 9 món cũ khi bảng món trống, sau đó nhập thêm 25 món từ CSV theo mã nguồn ổn định. Giữ nguyên tài khoản, đơn, giỏ và các chỉnh sửa quản trị đã có; không tạo đánh giá mua hàng giả.

Các bảng bổ sung được tạo bằng `create_all`, không xóa hay sửa cấu trúc bảng cũ. Sao lưu database trước khi tích hợp dữ liệu nhóm. Bản bàn giao đã kiểm tra với SQLite; kết nối và chuyển đổi dữ liệu MySQL của nhóm chưa được kiểm chứng vì chưa có môi trường đó. Không chạy các script sửa model cũ `fix_models.py` hoặc `models_backup.py` để thiết lập bản này.

## Các luồng đã bổ sung

Đăng ký, đăng nhập và đăng xuất dùng phiên lưu ở máy chủ; token cũ bị từ chối sau đăng xuất. Đổi mật khẩu thu hồi tất cả phiên của tài khoản. Tài khoản đăng ký công khai chỉ có quyền khách hàng. Backend kiểm tra quyền quản trị ở từng API và giới hạn dữ liệu riêng theo chủ tài khoản.

Thực đơn, chi tiết, tìm kiếm tên có/không dấu, giá và trạng thái đều đọc từ database. Món hết vẫn có nhãn trên thực đơn và bị chặn khi thêm giỏ hoặc đặt hàng. Admin thêm/sửa món, giá 0 hợp lệ, nhập URL ảnh hoặc đường dẫn `/images/...`, đổi trạng thái bán và xem đơn với người nhận, địa chỉ, từng món và số lượng.

Giỏ hàng lưu theo tài khoản, có size/topping/ghi chú; máy chủ tự tính giá. Thanh toán cần thông tin người nhận hợp lệ và giỏ không trống. Tạo đơn và dòng món trong cùng giao dịch, lưu tên/đơn giá thời điểm mua và xóa giỏ sau thành công. Khóa yêu cầu chống tạo trùng; đơn giá thay đổi sau màn hình xác nhận sẽ yêu cầu kiểm tra lại. Phí giao hiện bằng 0, giảm giá bằng 0, thanh toán COD.

Trạng thái: **Chờ xác nhận → Đang chế biến → Hoàn thành**, hoặc **Chờ xác nhận → Đã hủy** với lý do bắt buộc. Chuyển sai thứ tự bị từ chối. Khách xem lịch sử riêng và chi tiết; giao diện cập nhật mỗi 10 giây hoặc khi mở lại. Chỉ món trong đơn hoàn thành thuộc chính khách đó được đánh giá. Điểm trung bình được tính từ đánh giá lưu thật.

Mỗi món còn có **điểm và số lượt đánh giá mẫu** để trình bày giao diện: 4,5–4,9/5 và từ 500 lượt trở lên, được gắn nhãn “Đánh giá mẫu”. Đây chỉ là hai trường tổng hợp tạo ổn định theo món, không tạo tài khoản, lời bình, bản ghi `Review` hoặc tương tác giả. Đánh giá thật của khách đã mua vẫn được lưu và hiển thị riêng. Đặt `DEMO_RATINGS=0` trong backend nếu muốn ẩn hoàn toàn số liệu mẫu.

Tương tác xem và thêm giỏ được ghi sau thao tác hợp lệ; mua chỉ ghi khi đơn hoàn thành, gộp số lượng và chống trùng theo đơn/món. Đánh giá được cập nhật thay thế theo khách/đơn/món. LinUCB đọc dữ liệu riêng của người đang đăng nhập mỗi lần tạo gợi ý, dùng 35 đặc trưng giá, năng lượng/cay/chay đã xác nhận, cờ dữ liệu có sẵn, danh mục và nguyên liệu chính; không dùng dữ liệu cá nhân của khách khác. Reward xem 0.1, thêm giỏ 0.4, mua 0.8, đánh giá `(sao−3)/2`. Khởi đầu dùng mức phổ biến có làm trơn từ 366 đánh giá trong ratings_train.csv; sau tương tác chuyển sang xếp hạng cá nhân, chỉ gợi ý món còn bán.

LinUCB đã kiểm tra luồng dữ liệu, phân tách tài khoản và cập nhật thứ tự. Có báo cáo offline riêng trên 108 đánh giá holdout, nhưng chưa có thí nghiệm người dùng thực để kết luận hiệu quả gợi ý online. Thanh toán VNPAY/MoMo và định vị giao hàng chưa tích hợp dịch vụ thật.

## Trợ lý chat chọn món

Cập nhật hội thoại: chào hỏi/cảm ơn/tạm biệt, hỏi lại khi chưa rõ, giới thiệu từng món theo mô tả đang lưu, tình trạng còn bán, size/topping, tính tổng nhiều phần và hướng dẫn ghi chú gửi bếp. Có thể hỏi tiếp “món đó có topping gì?”; khi lượt trước có nhiều món, trợ lý hỏi lại tên món. Câu hỏi chưa hiểu không tự trả một danh sách món không liên quan. Dữ liệu về món đọc lại từ database mỗi lượt nên các chỉnh sửa mô tả/giá/trạng thái của admin được cập nhật ngay. Không có bước huấn luyện mô hình ngôn ngữ hoặc gửi dữ liệu ra ngoài trong chế độ local.

Ví dụ: `Chào shop ơi`, `Mình chưa biết ăn gì`, `Giới thiệu phở bò tái nạm`, `Phở gà gồm những gì?`, `2 phần phở gà bao nhiêu tiền?`, `Món đó còn không?`, `Trà sữa trân châu đường đen có topping gì?`, `Cảm ơn bạn nhiều nhé`. Mô tả không thay thế danh sách thành phần dị ứng đầy đủ; yêu cầu bỏ hành/ít đường chỉ là ghi chú gửi bếp, chưa phải cam kết bếp đáp ứng.

Nút **Hỏi trợ lý chọn món** luôn hiện ở góc phải trang khách, kể cả khi chưa đăng nhập. Có thể hỏi `món chay dưới 50k`, hỏi tiếp `không cay`, chọn món trong trả lời để xem chi tiết hoặc thêm vào giỏ. Sau đăng nhập, thứ tự món kết hợp mô hình LinUCB của chính khách hàng. Chat không tự đặt đơn hoặc thanh toán.

**Hiện không có khóa API:** chat chạy chế độ tư vấn dựa trên các quy tắc lọc và dữ liệu thực đơn. Banner ghi rõ AI hội thoại chưa bật; không giả lập câu trả lời của ChatGPT/Gemini. Trợ lý giữ các điều kiện ngân sách, danh mục, chay/cay qua câu tiếp theo; nhắn `bỏ lọc` để chọn lại. Hội thoại chỉ nằm trong phiên giao diện và được xóa khỏi bộ nhớ khi đổi tài khoản hoặc tải lại.

Đã bổ sung bộ nối OpenAI Responses API và Gemini generateContent, giữ khóa ở backend. Để bật hội thoại bằng mô hình ngôn ngữ, tự điền `AI_PROVIDER=openai` hoặc `gemini`, `AI_MODEL` là model tài khoản của bạn có quyền truy cập, và khóa tương ứng trong `BE/.env`, rồi khởi động lại backend. Không cần sửa frontend, không gửi khóa vào chat hay đưa vào Git. Gọi dịch vụ có thể phát sinh phí theo tài khoản của bạn; bản hiện tại chưa thực hiện yêu cầu tới dịch vụ AI thật.

Khi bật nhà cung cấp, nội dung chat và các thông tin thực đơn công khai cần để trả lời được gửi tới nhà cung cấp đó; không gửi hồ sơ, địa chỉ, đơn hàng, token hoặc các bản ghi tương tác của người dùng. Kết nối OpenAI đặt `store=false`. Món trong thẻ trả lời được kiểm tra lại trên database, giá không lấy từ lời trả lời của mô hình. Lỗi nhà cung cấp trả thông báo lỗi, không chuyển sang câu trả lời AI giả. Bộ nối nhà cung cấp mới được kiểm tra bằng HTTP giả lập; cần kiểm tra kết nối thật sau khi bạn cấu hình khóa và model.

Mã chính: `FE/components/food/chat-widget.tsx`, `BE/chat_service.py`, `GET /api/assistant/status`, `POST /api/assistant/chat`. Tham khảo [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses) và [Gemini generateContent](https://ai.google.dev/api/generate-content).

## Bổ sung từ bộ CSV ngày 22/10/2026

Đã nhập đủ **25 món** từ `BE/data/dishes.csv`: giá 18.000–220.000đ, 13 danh mục nguồn, 11 nguyên liệu chính. Bản cài mới có 34 món, gồm 9 món ban đầu và 25 món CSV; database đang chạy còn giữ thêm 1 món kiểm thử đã hết bán. Bộ lọc gồm tên có/không dấu, 16 nhóm trên giao diện, nguyên liệu chính, ngân sách, chỉ món còn bán và sắp theo tên/giá/điểm. Quản trị thêm/sửa đủ các thông tin này và đổi trạng thái bán.

CSV không cung cấp ảnh, calo, độ cay, chứng nhận chay hoặc tùy chọn size/topping. 25 món mới dùng 25 ảnh riêng theo tên món, lưu trong `FE/public/images/dishes/` và ghi nguồn tại `/photo-credits.html`; các thuộc tính chưa biết trả `null` và hiển thị rõ. Món mới mặc định chỉ có phần tiêu chuẩn; quản trị có thể bật tùy chọn và điền thông tin sau khi xác minh. Không suy diễn món chay hoặc an toàn dị ứng từ tên/nguyên liệu chính.

5 file CSV gốc được sao chép nguyên trạng trong `BE/data/`. `ratings_all.csv` có 474 dòng từ 40 ID nguồn; train 366, test 108, không trùng cặp người–món. Điểm tham khảo trên món và gợi ý ban đầu **chỉ dùng ratings_train.csv**; tách khỏi bảng đánh giá sau mua hàng. Không tạo tài khoản từ 40 ID CSV và không gán sở thích của họ cho người đang đăng nhập. Nhập lại cùng checksum không tạo trùng, không ghi đè giá/trạng thái đã sửa.

`BE/dataset_loader.py` kiểm tra mã, sao, ngày, trùng cặp và chia tập trước khi nhập. `BE/evaluate_dataset.py` chấm content ridge với cùng đặc trưng trên holdout; chạy từ BE bằng `..\.venv\Scripts\python.exe evaluate_dataset.py`. Xem `docs/DANH-GIA-DU-LIEU.md` và JSON. Content ridge hiện MAE 0,7933/RMSE 1,0142 sao, kém baseline phổ biến (0,7200/0,9139); kết quả được giữ nguyên để nhóm đánh giá, không tuyên bố mô hình tốt hơn baseline. Gợi ý khách mới dùng chính mức phổ biến từ train.

Chat bổ sung giá/nguyên liệu, so sánh món, món rẻ/đánh giá cao, khoảng giá, loại trừ nguyên liệu chính, combo 2–4 suất trong tổng ngân sách, hỏi tiếp về món vừa nhắc, hướng dẫn đặt/đánh giá/thanh toán và tra trạng thái đơn của chính tài khoản đang đăng nhập. Các câu hỏi không có dữ liệu được trả lời rõ giới hạn. Chat không sửa đơn hoặc giỏ. Dữ liệu đơn cá nhân được xử lý tại backend, không đưa vào mô hình bên ngoài.

Ví dụ thử: `Phở gà giá bao nhiêu?`, `So sánh phở bò với phở gà`, `Món gà từ 30k đến 60k`, `Combo 2 người tối đa 100k`, `Món đánh giá cao`, `Đơn của tôi`, `Bạn làm được gì?`. Các điều kiện chọn món được giữ cho lượt tiếp theo; dùng `bỏ lọc` để bắt đầu lại. Vì chưa có khóa API, phần hội thoại đang là trợ lý theo dữ liệu/quy tắc kết hợp LinUCB, không phải mô hình ngôn ngữ tự do.

## Admin và khách hàng

Trang khách: **http://127.0.0.1:3001/**. Trang admin: **http://127.0.0.1:3001/admin**. Nút Quản trị cửa hàng luôn hiện trong điều hướng.

Khu quản trị được tổ chức theo cách tham khảo từ BookNest nhưng dùng đúng nghiệp vụ FoodOrder: **Tổng quan, Đơn hàng, Món ăn, Tài khoản, Danh mục, Báo cáo**. Admin có thể thêm/sửa món, giá, ảnh, mô tả, danh mục, nguyên liệu, thông tin dinh dưỡng/khẩu vị đã xác minh; đổi Còn bán/Hết món; xem và xử lý đơn; phân quyền hoặc khóa tài khoản khác; xem số món theo danh mục, doanh thu và món bán chạy. Admin không thể tự hạ quyền hoặc tự khóa tài khoản đang đăng nhập. Ảnh nhận qua đường dẫn cục bộ hoặc URL, chưa có luồng upload file. Khách có giỏ, đơn, đánh giá và gợi ý riêng; không có quyền sửa thực đơn, quản lý tài khoản hoặc đọc đơn của người khác.

Admin có đầy đủ chức năng mua hàng: xem/tìm món, giỏ riêng, đặt hàng, đơn cá nhân, đánh giá món đã mua trong đơn hoàn thành, chat và gợi ý cá nhân. Nút và tiêu đề đăng nhập trên trang thực đơn ghi **Đăng nhập**. Đăng nhập bằng admin ở trang này vẫn ở lại thực đơn; vào **Quản trị cửa hàng** khi cần quản lý. Từ trang quản trị, bấm **Đặt món** hoặc logo để mua hàng bằng chính tài khoản admin. **Đơn của tôi** trên thực đơn chỉ hiển thị đơn của tài khoản đang mua hàng; **Đơn hàng** ở trang quản trị hiển thị toàn bộ đơn theo quyền admin.

Giống cách dùng của BookNest, `/` và `/admin` dùng **một tài khoản đang đăng nhập** trên cùng trình duyệt. Vì vậy admin chuyển qua lại giữa cửa hàng và khu quản trị mà không mất quyền; đăng xuất ở một trang sẽ đăng xuất cả hai. Muốn dùng đồng thời admin và khách, hãy mở một tài khoản trong cửa sổ trình duyệt riêng/tạm ẩn danh. Trang admin không cho đăng ký công khai; API `/api/admin/auth/login` từ chối tài khoản khách trước khi cấp phiên. API đăng ký công khai chỉ tạo khách hàng. Admin mua hàng vẫn chỉ được đánh giá món thuộc đơn đã hoàn thành của chính mình.

Trên máy hiện tại đã tạo hai tài khoản thử riêng; email/mật khẩu nằm trong `BE/.local/TAI-KHOAN-ADMIN-KHACH.txt`. File thông tin này, database và token không nằm trong ZIP. Sau khi giải nén trên máy khác: cài và khởi chạy backend để tạo database, rồi chạy `TAO-TAI-KHOAN-THU.cmd` nếu muốn tạo hai tài khoản thử với mật khẩu ngẫu nhiên. Script không chạy tự động, không đổi quyền/mật khẩu tài khoản cũ. Để tạo tài khoản admin của riêng bạn dùng `TAO-ADMIN.cmd`.

## Ảnh món ăn

25 món CSV có 25 ảnh riêng; 9 món ban đầu giữ nguyên tài nguyên ảnh. Kiểm tra 34 món thật không trùng đường dẫn hoặc nội dung ảnh. Bản ghi thử nghiệm đã hết bán có ảnh giữ chỗ riêng. Ảnh lưu cùng source nên thực đơn, chi tiết, giỏ và chat dùng chung đường dẫn, không phụ thuộc hotlink. `BE/catalog_photos.py` chỉ nâng cấp ảnh giữ chỗ và nhóm ảnh dùng chung cũ; không ghi đè ảnh quản trị tự thay sau nâng cấp. Nguồn/tác giả/giấy phép được ghi trong `docs/NGUON-ANH-MON-AN.md` và trang Nguồn ảnh món ăn.

Bản dựng frontend dùng Webpack (`npm run build`) để ổn định trên Windows; không bỏ qua kiểm tra TypeScript.

## Cấu hình

Chạy local không cần tạo `.env`. Sao chép `BE/.env.example` thành `BE/.env` để đổi database/CORS; `FE/.env.example` thành `FE/.env.local` để đổi địa chỉ API. Sau khi đổi `NEXT_PUBLIC_API_URL`, dựng lại frontend. Database, `.env`, token, mật khẩu, `.venv`, `node_modules` và `.next` được loại khỏi ZIP source.

## Kiểm tra lại

Trong `BE`: `..\.venv\Scripts\python.exe -m pytest tests -q`.

Trong `FE`: `npm run check`, `npm run build`, `npm audit`.

Kết quả lần bàn giao được ghi trong `docs/KET-QUA-KIEM-TRA.md`. Các kiểm tra tự động không thay thế nghiệm thu của nhóm trên môi trường triển khai thực tế.
