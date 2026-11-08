# FoodOrder trong Ubuntu WSL2

Backend dùng Python 3.12 trong `BE/.venv`. Frontend dùng Node.js 24 và pnpm 12.3.4.
MariaDB chạy bằng XAMPP trên Windows; cấu hình riêng ở `BE/.env`.

## Khởi tạo database phát triển

Chỉ dùng `foodorder_dev` với tài khoản `foodorder_app`. Không đưa `.env` vào Git.

```bash
cd /home/giang/FoodOrder/BE
./.venv/bin/python -B init_database.py --seed
```

Script kiểm tra đích trước kết nối và xác nhận lại bằng `SELECT DATABASE(), CURRENT_USER()`.
Các bảng còn thiếu được tạo bằng SQLAlchemy models hiện có. Script kiểm tra cột, khóa chính,
khóa ngoại và chỉ mục; dừng nếu bảng hiện có khác cấu trúc dự kiến. Không sửa hoặc xóa bảng.
MariaDB có implicit commit cho DDL: các bảng đã tạo có thể còn lại nếu bước sau gặp lỗi.

`--seed` chỉ thêm 6 danh mục và 9 món khi bảng `dishes` chưa có bản ghi nào.
UUID của món nằm cố định trong `BE/data/dev_menu.json`. Chạy lại không ghi đè dữ liệu hoặc tạo trùng.
Không dùng `--seed` nếu chỉ muốn kiểm tra/tạo schema.

## Chạy website

Terminal backend, giữ chạy trong lúc dùng website:

```bash
cd /home/giang/FoodOrder/BE
./.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Startup hiện chỉ ping database, không tự tạo bảng. Lệnh cũ có `--lifespan off` vẫn chạy được;
US8.1 dùng migration tường minh trong [US8_1_VIEW_INTERACTIONS.md](US8_1_VIEW_INTERACTIONS.md).

Terminal frontend:

```bash
source ~/.nvm/nvm.sh
nvm use 24
cd /home/giang/FoodOrder/FE
pnpm install --frozen-lockfile
pnpm dev --hostname 127.0.0.1 --port 3000
```

Những lần sau không cần chạy lại `pnpm install` khi dependencies không đổi.
Mở http://127.0.0.1:3000 hoặc http://localhost:3000. Ctrl+C sẽ dừng server của terminal đó.

Trang chủ lấy thực đơn từ FastAPI mỗi lần tải trang. Modal gọi `/api/dishes/{uuid}` qua
Next.js rewrite. Mặc định backend ở `http://127.0.0.1:8000`; có thể đổi bằng biến server
`FOODORDER_API_URL` trước khi chạy Next.js. Không đưa thông tin database vào biến frontend.
FastAPI chỉ cho phép CORS từ hai origin phát triển nêu trên.

## Kiểm thử

```bash
cd /home/giang/FoodOrder/BE
./.venv/bin/python -B -m unittest discover -s tests -v
```

```bash
source ~/.nvm/nvm.sh
nvm use 24
cd /home/giang/FoodOrder/FE
pnpm exec tsc --noEmit --incremental false
pnpm build
```

```bash
curl -i http://127.0.0.1:8000/api/health
curl -i http://127.0.0.1:8000/api/dishes
curl -i http://127.0.0.1:3000/api/dishes
curl -i -X OPTIONS http://127.0.0.1:8000/api/dishes \
  -H 'Origin: http://localhost:3000' \
  -H 'Access-Control-Request-Method: GET' \
  -H 'Access-Control-Request-Headers: authorization,content-type'
```

API danh sách, danh mục, chi tiết hợp lệ và preflight được phép phải trả 200.
Chi tiết UUID không tồn tại/hết bán trả 404, ID không hợp lệ trả 422.
Origin ngoài danh sách bị từ chối preflight bằng 400.

## Phạm vi hiện tại

Thực đơn, chi tiết món và xác thực khách hàng lấy từ backend/database.
Luồng đăng ký, đăng nhập, hồ sơ và đăng xuất được mô tả trong [AUTHENTICATION.md](AUTHENTICATION.md).
Giỏ hàng hiện là React local state; US8.2 ghi nhận thao tác thêm giỏ thành công bằng API
tương tác nhưng chưa có cart backend. Đặt hàng, lịch sử đặt lại và trang admin vẫn có
các luồng demo; chưa xác nhận lưu đơn hàng thật.
Size/topping vẫn theo cấu hình giao diện, chưa đồng bộ bảng tùy chọn món.
US3.1 đã bổ sung kiểm tra món còn bán và giá mới qua API trước khi thêm giỏ, cùng
kiểm thử giới hạn, tùy chọn, lỗi mạng và bảo toàn sự kiện. Xem [US3_1_CART.md](US3_1_CART.md)
để đối chiếu Acceptance Criteria và chạy bộ kiểm thử mới (`pnpm test:unit`).
US3.2 giới hạn thay đổi số lượng ở 1–99 và giữ đủ các lần bấm tăng/giảm liên tục;
không tự xóa món và không phát thêm sự kiện US8.2. Xem
[US3_2_CART_QUANTITY.md](US3_2_CART_QUANTITY.md) để đối chiếu tiêu chí và kết quả kiểm thử.
US3.3 xóa theo key dòng, hủy request thêm cũ đúng dòng và giữ lịch sử tương tác.
Xem [US3_3_CART_REMOVAL.md](US3_3_CART_REMOVAL.md) cho kiểm thử race condition/mobile
và các điều kiện còn thiếu của US4.1.
US4.1 hiện có GET đơn theo chủ sở hữu và tracking qua cookie HttpOnly; chưa có API tạo/
cập nhật đơn thật. Checkout demo được ghi rõ và không cung cấp trạng thái giả cho tracking.
Xem [US4_1_ORDER_TRACKING.md](US4_1_ORDER_TRACKING.md) cho kết quả và phần chưa thể nghiệm thu end-to-end.
US8.4 có service phản hồi rating theo nguồn/phiên bản và reader snapshot độc lập; chưa có
US5.1 backend hay adapter production, chưa tạo registry trong MariaDB hoặc tính reward.
Xem [US8_4_RATING_FEEDBACK.md](US8_4_RATING_FEEDBACK.md) cho hợp đồng tích hợp và kiểm thử.
US8.1 đã bổ sung bảng `user_interactions`, API xem món có JWT và chống trùng tại database,
cùng luồng ghi khi mở chi tiết thành công. Xem [US8_1_VIEW_INTERACTIONS.md](US8_1_VIEW_INTERACTIONS.md)
để chạy migration, kiểm thử và tự đối chiếu hai tài khoản.
US8.2 đã ghi `add_to_cart` dùng chung bảng, JWT/proxy và cơ chế chống trùng với US8.1;
xem [US8_2_CART_INTERACTIONS.md](US8_2_CART_INTERACTIONS.md) để biết định nghĩa local add thành công.
US8.3 đã có service purchase nội bộ, cột nguồn đơn/dòng và cơ chế transaction/idempotency.
Chưa nối hoàn thành đơn thật vì checkout/admin vẫn demo; không phát purchase từ trình duyệt.
Xem [US8_3_PURCHASE_INTERACTIONS.md](US8_3_PURCHASE_INTERACTIONS.md) cho migration mới và giới hạn tích hợp.
Bộ backend hiện có 122 kiểm thử đạt; E2E 19 bài gồm regression và hai ca phủ định purchase.
Chưa triển khai US8.4, reward hoặc LinUCB; context, cold-start và lưu trạng thái cần thiết kế riêng.

## Kết quả nền tảng và xác thực trước US8.1

- Đã tạo đủ `users`, `user_addresses`, `categories`, `dishes`, `dish_options`,
  `dish_option_items`, `orders`, `order_items` trong `foodorder_dev`.
- Đối chiếu thành công 8 khóa chính, 8 khóa ngoại và 10 chỉ mục khai báo trong models.
  Tất cả bảng dùng InnoDB và `utf8mb4_unicode_ci`.
- Thêm 6 danh mục và 9 món từ fixture. Sau kiểm thử xác thực có 2 tài khoản thử; đơn hàng và tùy chọn vẫn trống.
- Chạy lại khởi tạo với `--seed`: không thêm danh mục/món, không ghi đè dữ liệu.
- Phần nền tảng/xác thực có 30 kiểm thử; bộ backend sau US8.1 có 56 kiểm thử đạt.
  Kết quả build và E2E US8.1 được ghi riêng trong tài liệu US8.1.
  Kiểm thử E2E xác thực được bổ sung, xem [AUTHENTICATION.md](AUTHENTICATION.md).
- API danh sách, danh mục và chi tiết cả 9 món trả 200; UUID không tồn tại trả 404,
  ID không hợp lệ trả 422. CORS cho phép đúng hai origin phát triển.
- Kiểm thử Chromium: đủ 9 món, tìm kiếm không dấu, lọc cả 6 danh mục,
  mở cả 9 modal từ API thật, hiển thị lỗi khi API chi tiết trả 503,
  kiểm tra màn hình rộng 390px không tràn ngang; không có lỗi JavaScript.

## File được thay đổi trong lần triển khai này

| File | Thay đổi |
|---|---|
| `BE/init_database.py` | Kiểm tra đích, khởi tạo có kiểm chứng, seed chỉ khi chưa có món; import không tự chạy |
| `BE/main.py` | CORS, API danh mục/chi tiết, dữ liệu món có danh mục và lọc món còn bán |
| `BE/schemas.py` | Hợp đồng response cho thực đơn và danh mục |
| `BE/data/dev_menu.json` | Fixture 6 danh mục, 9 món với UUID cố định |
| `BE/tests/test_development.py` | 12 bài kiểm thử bảo vệ database, CORS và API món |
| `FE/app/page.tsx` | Tải thực đơn thật từ backend khi render trang |
| `FE/lib/menu-api.ts` | Kiểu dữ liệu API, ánh xạ món và tải chi tiết |
| `FE/lib/menu-data.ts` | Cho phép ID danh mục từ database |
| `FE/next.config.mjs` | Proxy `/api/...` tới FastAPI |
| `FE/components/food/app-state.tsx` | Cung cấp thực đơn thật, tải/hủy request chi tiết |
| `FE/components/food/food-app.tsx` | Nhận dữ liệu backend và hiển thị lỗi tải thực đơn |
| `FE/components/food/popular-dishes.tsx` | Tìm kiếm/lọc món từ database |
| `FE/components/food/category-grid.tsx` | Hiển thị danh mục từ API |
| `FE/components/food/food-card.tsx` | Không hiển thị điểm đánh giá giả cho món chưa được đánh giá |
| `FE/components/food/food-detail-modal.tsx` | Hiển thị trạng thái tải/lỗi, khóa thêm giỏ khi chi tiết chưa sẵn sàng |
| `FE/components/food/reorder-row.tsx` | Các món trong lịch sử demo tham chiếu thực đơn hiện tại |
| `FE/components/food/ai-chat-widget.tsx` | Dùng thực đơn hiện tại; không triển khai AI mới |
| `FE/app/admin/page.tsx` | Giá trị mặc định cho loại danh mục chưa biết |
| `FE/next-env.d.ts` | Next.js tự cập nhật tham chiếu kiểu khi build |
| `docs/DEVELOPMENT_WSL.md` | Hướng dẫn chạy, kiểm thử, phạm vi và kết quả |

Các thay đổi có sẵn trước lần triển khai (bao gồm gitlink `FoodOrder` bị đánh dấu xóa)
được giữ nguyên. Không commit, push, merge hoặc thay đổi cấu hình bí mật.
