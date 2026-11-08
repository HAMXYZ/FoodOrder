# US8.1 – Ghi nhận hành vi xem món

## Luồng và định nghĩa một lượt xem

Khách hàng đã đăng nhập chủ động mở một món, và API chi tiết trả về thành công
trong khi modal vẫn mở: ghi một sự kiện `view`. UUID được tạo trong callback `openFood`,
trước khi tải chi tiết, rồi gửi sau khi tải thành công. Các nơi mở món hiện có dùng chung
callback này. Không ghi từ effect theo render.

Re-render, đổi size, topping, số lượng, ghi chú, tìm kiếm, lọc danh mục, kiểm tra lại phiên
hoặc fetch lại dữ liệu không tạo lượt xem. Đóng và mở lại tạo UUID mới. Nếu đóng trước khi
tải chi tiết thành công hoặc API chi tiết lỗi, không ghi. Mở lúc chưa đăng nhập không
được gắn tài khoản kể cả nếu đăng nhập sau đó.

Frontend chỉ gửi `event_id` và `dish_id` đến Route Handler cùng origin. Next.js đọc cookie
HttpOnly và chuyển thành Bearer header ở server. FastAPI xác minh JWT bằng
`get_current_user`, kiểm tra tài khoản còn hoạt động và role `customer`, rồi lấy `user.id`.
Không có JWT trong JavaScript, localStorage hoặc body trả về từ API sự kiện.

Request ghi sự kiện lỗi không chặn chi tiết món hoặc giỏ hàng. Lỗi mạng/timeout/5xx được
thử lại tối đa một lần, cách 250 ms, cùng UUID và payload; mỗi lần chờ tối đa 5 giây.
Không retry lỗi 4xx. Với 401/403, proxy xóa cookie không hợp lệ và UI kiểm tra lại phiên.
Pending retry bị hủy khi đổi tài khoản hoặc unmount. Lượt đã tải thành công có thể tiếp tục
ghi sau khi đóng modal; lượt mở tiếp theo có UUID riêng.

## Bảng mới

`foodorder_dev.user_interactions`, InnoDB, utf8mb4_unicode_ci:

| Cột | Kiểu / ràng buộc |
|---|---|
| `id` | BIGINT, PRIMARY KEY, AUTO_INCREMENT, chỉ dùng nội bộ |
| `event_id` | CHAR(36), NOT NULL, UNIQUE `uq_user_interactions_event_id` |
| `user_id` | CHAR(36), NOT NULL, FK → `users.id`, ON DELETE RESTRICT |
| `dish_id` | CHAR(36), NOT NULL, FK → `dishes.id`, ON DELETE RESTRICT |
| `event_type` | VARCHAR(32), NOT NULL; endpoint hiện chỉ nhận `view` |
| `created_at` | DATETIME(6), NOT NULL, lưu UTC; ORM trả datetime có UTC |

Các index bổ sung:

- `ix_user_interactions_user_type_time (user_id, event_type, created_at)`.
- `ix_user_interactions_dish_type_time (dish_id, event_type, created_at)`.
- `ix_user_interactions_type_time (event_type, created_at)`.
- `ix_user_interactions_created_at (created_at)`.

Thời gian do server tạo; request không được cung cấp `created_at`. Python chuẩn hóa UTC,
database có default `UTC_TIMESTAMP(6)` để không phụ thuộc timezone Windows/MariaDB.
Giá trị trả về có hậu tố `Z`. UUID request phải hợp lệ; `event_id` là UUID v4.

UNIQUE trong database là cơ chế quyết định khi hai request đồng thời. Backend có thể
kiểm tra trước để trả replay nhanh, nhưng vẫn xử lý IntegrityError, rollback rồi đọc lại
bản ghi đã thắng. Trùng UUID nhưng khác tài khoản, món hoặc loại sự kiện trả cùng lỗi
409 chung; không trả chủ sở hữu/nội dung sự kiện cũ. Không có API đọc, sửa hoặc xóa sự kiện.
Không dùng UPDATE/upsert để giải quyết xung đột.

## Migration và quyền

```bash
cd /home/giang/FoodOrder/BE
./.venv/bin/python -B migrate_interactions.py
./.venv/bin/python -B migrate_interactions.py --apply
```

Lệnh đầu chỉ kiểm tra; `--apply` mới tạo duy nhất bảng còn thiếu bằng
`UserInteraction.__table__.create(checkfirst=True)`. Script kiểm tra URL trước khi kết nối,
sau đó xác nhận `SELECT DATABASE(), CURRENT_USER()` đúng `foodorder_dev` và `foodorder_app`.
Nếu 8 bảng nền chưa đủ/khác models, có view trùng tên hoặc bảng tương tác đã có nhưng sai
cấu trúc, script dừng; không ALTER bảng. Chạy lại không tạo trùng hoặc ghi thêm sự kiện.
DDL MariaDB có implicit commit; nếu kiểm chứng sau tạo thất bại, không tự xóa bảng để rollback.

`init_database.py` cũng nhận biết metadata 9 bảng, kiểm tra unique constraint và các cột
NOT NULL của bảng tương tác. Không cần chạy lại seed. Startup FastAPI chỉ ping database,
không tự gọi create_all; chạy có hoặc không có `--lifespan off` đều không thay migration.

Đã kiểm tra tài khoản ứng dụng có ALL PRIVILEGES trên `foodorder_dev` nên không cần cấp thêm.
API sự kiện cần SELECT trên `users`, `dishes`, `user_interactions` và INSERT trên
`user_interactions`. Migration cần CREATE và quyền tạo index/FK trên `foodorder_dev`;
không cần DROP/ALTER/DELETE để thực hiện US8.1. Quyền của các API tài khoản hiện có vẫn áp dụng.
Không thay đổi quyền hoặc truy cập database nhóm trong lần triển khai này.

## Hợp đồng API

`POST /api/interactions/views` tại FastAPI; cùng đường dẫn trên Next.js để trình duyệt
tự gửi cookie. Ví dụ request sau khi đăng nhập (không tự điền user_id hoặc token):

```json
{
  "event_id": "33d40741-3c13-4c57-876d-e63a6a44a940",
  "dish_id": "694606b5-7fe6-4f9d-a37a-86ad4e187325"
}
```

Response mẫu HTTP 201:

```json
{
  "event_id": "33d40741-3c13-4c57-876d-e63a6a44a940",
  "dish_id": "694606b5-7fe6-4f9d-a37a-86ad4e187325",
  "event_type": "view",
  "created_at": "2026-11-07T08:00:00.123456Z",
  "duplicate": false
}
```

Gửi lại cùng UUID, tài khoản và nội dung: HTTP 200, `duplicate: true`, giữ nguyên thời gian.
Request có thể ghi rõ `event_type: "view"`; giá trị khác hoặc trường thừa trả 422.
Thiếu/sai/hết hạn JWT trả 401; tài khoản không hoạt động/không phải customer trả 403;
món không tồn tại/hết bán trả 404; UUID xung đột trả 409; dữ liệu sai trả 422;
lỗi lưu tạm thời trả 503. Proxy kiểm tra Origin trước các request ghi.

## Chạy website và kiểm thử

Backend, XAMPP MySQL trên Windows cần đang chạy:

```bash
cd /home/giang/FoodOrder/BE
./.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Frontend trong terminal khác:

```bash
source ~/.nvm/nvm.sh
nvm use 24
cd /home/giang/FoodOrder/FE
pnpm dev --hostname 127.0.0.1 --port 3000
```

Các lệnh kiểm thử:

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
pnpm test:e2e
```

E2E cần Chromium và thư viện hệ điều hành. Lần đầu có thể dùng
`pnpm exec playwright install --with-deps chromium`. Trong phiên WSL2 này, thư viện thiếu
được giải nén riêng, không sửa package hệ thống; lệnh E2E dùng:

```bash
LD_LIBRARY_PATH=/tmp/foodorder-us81-browser/libs/usr/lib/x86_64-linux-gnu pnpm test:e2e
```

Thư mục `/tmp` không bền sau khởi động lại; việc cài Playwright chỉ phục vụ kiểm thử,
không cần để chạy website. Trace, video và screenshot xác thực đều tắt. E2E xác nhận
database trước khi ghi, tái sử dụng hai tài khoản test trong cache riêng bên ngoài repo,
và không tự xóa dữ liệu test. Các lần chạy sẽ thêm lượt xem development mới.

## Tự kiểm tra với hai tài khoản

1. Mở `http://127.0.0.1:3000`, đăng nhập tài khoản A.
2. Mở DevTools → Network, lọc `interactions/views`; mở một món và đợi chi tiết tải xong:
   một POST 201. Đổi số lượng/size/ghi chú không thêm POST.
3. Đóng modal rồi mở lại: UUID khác và thêm một POST 201.
4. Dùng cửa sổ ẩn danh/trình duyệt khác đăng nhập B, mở cùng món. Mỗi phiên dùng cookie riêng.
   Hai tab thông thường cùng origin chia sẻ phiên nên không dùng làm hai tài khoản độc lập.
5. Đăng xuất rồi xem món: chi tiết vẫn hiện, không POST sự kiện.
6. Với tài khoản quản trị database phát triển, có thể chạy truy vấn chỉ đọc:

```sql
SELECT user_id, dish_id, event_type, COUNT(*) AS views,
       MIN(created_at) AS first_view_utc, MAX(created_at) AS last_view_utc
FROM foodorder_dev.user_interactions
GROUP BY user_id, dish_id, event_type
ORDER BY last_view_utc DESC;
```

Phân biệt các lượt test có sẵn với các lượt vừa thao tác bằng thời gian UTC.
Không cần sao chép hoặc hiển thị JWT/mật khẩu để kiểm tra.

## File của US8.1

| File | Thay đổi |
|---|---|
| `BE/models.py` | UserInteraction, unique/FK/index, thời gian UTC |
| `BE/schemas.py` | Request chặt chẽ và response lượt xem |
| `BE/main.py` | API có xác thực, idempotency/concurrency; startup chỉ ping |
| `BE/init_database.py` | Metadata 9 bảng và kiểm chứng unique/NOT NULL |
| `BE/migrate_interactions.py` | Migration bổ sung có kiểm tra đúng database |
| `BE/tests/test_interactions.py` | API, ràng buộc thật, request đồng thời và guard migration |
| `FE/lib/auth-server.ts` | Tái sử dụng proxy có xác thực cho hồ sơ và tương tác |
| `FE/app/api/interactions/views/route.ts` | Route Handler chuyển JWT ở server |
| `FE/lib/interactions-api.ts` | Gửi sự kiện và retry cùng UUID |
| `FE/components/food/app-state.tsx` | Gắn sự kiện với thao tác mở chi tiết thành công |
| `FE/tests/e2e/interactions.spec.ts` | Giao diện → proxy → FastAPI → MariaDB, hai tài khoản |
| `docs/US8_1_VIEW_INTERACTIONS.md` | Thiết kế, vận hành, kiểm thử và báo cáo |
| `docs/DEVELOPMENT_WSL.md`, `docs/AUTHENTICATION.md` | Cập nhật trạng thái sau US8.1 |

## Kết quả thực tế và Acceptance Criteria

Lần chạy cuối ngày 2026-11-07:

| Kiểm tra | Kết quả |
|---|---|
| Backend `unittest discover` | 56/56 đạt: 30 bài cũ + 26 bài US8.1 |
| TypeScript độc lập `tsc --noEmit --incremental false` | Đạt |
| Production `pnpm build` | Đạt, có route `/api/interactions/views` |
| Chromium `pnpm test:e2e` | 8/8 đạt trong 43 giây: 1 xác thực + 7 US8.1 |
| Migration lần đầu | Chỉ tạo `user_interactions` |
| Migration chạy lại | 0 bảng tạo, 0 dòng dữ liệu thay đổi |
| Đối chiếu schema MariaDB | 9 bảng đúng models; bảng mới có PK, UNIQUE, 2 FK và 4 index truy vấn |
| Bảo toàn dữ liệu nền | Đối chiếu số dòng và digest toàn bộ nội dung của cả 8 bảng trong E2E: không đổi |

Cấu hình Next.js cũ vẫn có `ignoreBuildErrors: true`; vì vậy kết quả TypeScript ở trên
là lệnh độc lập đã chạy thành công, không suy ra từ thông báo build.

Dữ liệu tạo trong kiểm thử:

- Lần chạy backend cuối tạo 15 sự kiện trong các database SQLite tạm, sau đó hủy database.
  Tổng ba lần chạy bộ US8.1 trong lúc phát triển tạo 45 sự kiện cô lập, không lưu vào MariaDB.
- Lần chạy E2E cuối tạo 9 sự kiện development. Lần chạy kiểm tra đầu tạo 8 sự kiện trước
  khi sửa hai vấn đề của test harness (click trực tiếp input radio ẩn và đọc response body
  đã được trình duyệt giải phóng). Sau sửa, cả 8 E2E đều đạt.
- Tổng cộng **17 dòng `view` trong `foodorder_dev.user_interactions`**, giữ lại theo quy tắc
  không xóa dữ liệu. Không tạo thêm tài khoản: tái sử dụng 2 tài khoản test hiện có.
- 6 danh mục, 9 món và 2 tài khoản giữ nguyên nội dung. Đơn hàng và các bảng tùy chọn vẫn 0 dòng.

| Tiêu chí bắt buộc | Bằng chứng đã chạy | Kết quả |
|---|---|---|
| 1. Đăng nhập xem món hợp lệ | API fixture + GUI/proxy/MariaDB | Đạt |
| 2. Thiếu JWT | API 401 và proxy không cookie 401 | Đạt |
| 3. JWT sai/hết hạn | API 401; E2E phiên sai và E2E xác thực hết hạn | Đạt |
| 4. Món không tồn tại | API và proxy trả 404, không thêm dòng | Đạt |
| 5. Gửi lại cùng UUID | 201 rồi 200; giữ nguyên dòng và thời gian | Đạt |
| 6. Hai UUID cùng người/món | Hai dòng độc lập qua API và mở lại modal | Đạt |
| 7. Hai tài khoản cùng xem một món | Hai cửa sổ browser và SQL đối chiếu user_id | Đạt |
| 8. Giả mạo user_id | Body 422; query không thay danh tính JWT | Đạt |
| 9. Một lần mở chỉ ghi một sự kiện | Đổi state, fetch lại chi tiết, focus/kiểm tra phiên không thêm POST | Đạt |
| 10. Đóng rồi mở lại tạo sự kiện mới | Hai UUID, hai dòng MariaDB | Đạt |
| 11. API ghi lỗi, chi tiết vẫn hoạt động | Intercept 503; modal, đổi số lượng và thêm giỏ hoạt động | Đạt |
| 12. Request đồng thời cùng UUID | Hai ASGI request có barrier trước INSERT và Promise.all qua MariaDB: 201 + 200, một dòng | Đạt |
| 13. Không sửa sự kiện của người khác | 409 chung, dòng cũ không đổi; không có route đọc/sửa/xóa | Đạt |

Ngoài ra đã chạy xung đột đồng thời khác tài khoản và khác món: một request 201, request
còn lại 409, chỉ giữ nội dung của request thắng. Không có lỗi chặn US8.1 theo 13 tiêu chí này.
Các giới hạn ngoài phạm vi được nêu bên dưới. Không commit, push hoặc merge.

## Phạm vi US8.1 và cập nhật US8.2

Phần US8.1 trong báo cáo này chỉ triển khai `view`; endpoint views vẫn từ chối loại khác.
US8.2 nay đã tái sử dụng bảng, UUID chống trùng, UTC, JWT/proxy và kiểm thử; bổ sung endpoint
`add-to-cart` riêng mà không đổi schema hoặc sửa các lượt view cũ. Xem
[US8_2_CART_INTERACTIONS.md](US8_2_CART_INTERACTIONS.md) cho giỏ local, kết quả kiểm thử mới
và số sự kiện hiện tại. Không ghi purchase/rating, không tính reward hoặc cập nhật LinUCB.

Ghi sự kiện hiện là best effort: mất mạng kéo dài sau lần retry cuối có thể mất lượt xem.
Chưa có hàng đợi offline/outbox, báo cáo quản trị, rate limiting riêng cho sự kiện hoặc
chống khách đã đăng nhập tự gửi nhiều UUID hợp lệ. Đây không phải cơ chế chứng minh người
dùng đã thật sự nhìn màn hình. Các tính năng đó cần phạm vi riêng nếu được yêu cầu.

Cập nhật schema US8.3: đã bổ sung các cột nguồn order/order_item/quantity nullable và guard purchase.
Các lượt view giữ nguồn NULL; endpoint views không thay hợp đồng hoặc nhận purchase. Xem
[US8_3_PURCHASE_INTERACTIONS.md](US8_3_PURCHASE_INTERACTIONS.md) cho migration, số liệu mới
và phần tích hợp đơn hàng còn chờ.
