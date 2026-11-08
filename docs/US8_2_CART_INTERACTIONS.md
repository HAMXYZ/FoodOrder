# US8.2 – Ghi nhận hành vi thêm món vào giỏ

## Giỏ hàng hiện tại và định nghĩa thành công

Giỏ hàng vẫn là **React local state**, chưa có API giỏ hàng backend, chưa lưu vào MariaDB
hoặc localStorage. Reload trang làm mất giỏ hiện tại. Đặt hàng, size/topping và các luồng
demo khác giữ phạm vi cũ; US8.2 không biến chúng thành nghiệp vụ backend thật.

Các nút thêm món hiện có dùng chung `AppProvider.addToCart` trong
`FE/components/food/app-state.tsx`. Một thao tác thành công khi callback chấp nhận dữ liệu
và thêm một dòng giỏ, hoặc tăng số lượng của dòng cùng món/size/topping/ghi chú. Sau khi
cập nhật snapshot giỏ và gọi setter React, callback mới phát một sự kiện `add_to_cart`.
Sau khi hoàn thiện US3.1, `addToCart` trả `Promise<boolean>`: kiểm tra món/giá hiện tại
qua API trước khi cập nhật giỏ; modal chờ kết quả và chỉ đóng khi thao tác thành công.
Quy tắc ghi sự kiện giữ nguyên. Xem [US3_1_CART.md](US3_1_CART.md) cho thiết kế và
kết quả kiểm thử mới; số liệu ở phần nghiệm thu US8.2 bên dưới là của lần triển khai US8.2.

- Một lần thêm số lượng nhiều hơn 1 vẫn là **một hành động / một sự kiện**.
- Giữ giới hạn 99 cho một dòng giỏ. Nếu dòng đang có 98 và thêm 2, giữ cách giới hạn cũ:
  chỉ tăng thêm 1, báo đúng lượng thực thêm và ghi một sự kiện.
- Nếu đã có 99 và thêm cùng tùy chọn, không đổi giỏ, báo giới hạn và không phát sự kiện.
- Dữ liệu số lượng không hợp lệ hoặc giá không hợp lệ bị từ chối trước khi cập nhật giỏ.
- Chọn số lượng/size/topping/ghi chú, sửa số lượng trong giỏ, xóa món, mở modal, tìm kiếm,
  lọc, re-render, kiểm tra lại phiên và reload không tự ghi `add_to_cart`.
- Khách chưa đăng nhập vẫn thêm/sửa giỏ local; đăng nhập sau đó không ghi bù các thao tác cũ.
- Các thao tác giỏ chia sẻ một ref cập nhật đồng bộ; telemetry nằm ngoài functional state
  updater để React không lặp side effect khi replay updater.

Backend xác thực chủ sở hữu và món ăn trước khi ghi. Vì chưa có giỏ backend, nó **không thể
chứng minh một thao tác giỏ server đã thành công**; xác nhận hiện đến từ callback local.
Endpoint mới chỉ ghi nhận tương tác, không thêm món lần nữa hoặc tạo đơn hàng.

## Bảng, schema và bảo toàn dữ liệu

Tái sử dụng `foodorder_dev.user_interactions` của US8.1, giữ nguyên:

- BIGINT `id` làm PK; `event_id` UUID v4 với UNIQUE `uq_user_interactions_event_id`.
- FK `user_id` → `users.id`, `dish_id` → `dishes.id`, đều RESTRICT.
- `created_at` UTC, DATETIME(6), cùng bốn index phục vụ truy vấn.

Đã kiểm tra URL kết nối và `SELECT DATABASE(), CURRENT_USER()` đúng `foodorder_dev` và
`foodorder_app`. Cột `event_type` thực tế là VARCHAR(32), không có CHECK chỉ cho phép view;
vì vậy **không cần migration, không chạy DDL và không tạo bảng mới** cho US8.2.
Không cần cấp thêm quyền: API dùng SELECT và INSERT hiện có trên database phát triển.

Trước thay đổi có 17 bản ghi `view`. Đã lưu digest của từng sự kiện và toàn bộ 8 bảng nền
để đối chiếu sau kiểm thử. Chỉ append các sự kiện test mới, không UPDATE/DELETE/DROP/TRUNCATE.

## API và proxy có xác thực

`POST /api/interactions/add-to-cart`, cùng đường dẫn tại Next.js và FastAPI.
Ví dụ body sau khi đăng nhập, không cần sao chép token:

```json
{
  "event_id": "24ce0c02-661b-42dd-b535-e114742ce153",
  "dish_id": "694606b5-7fe6-4f9d-a37a-86ad4e187325"
}
```

Response mẫu HTTP 201:

```json
{
  "event_id": "24ce0c02-661b-42dd-b535-e114742ce153",
  "dish_id": "694606b5-7fe6-4f9d-a37a-86ad4e187325",
  "event_type": "add_to_cart",
  "created_at": "2026-11-07T10:00:00.123456Z",
  "duplicate": false
}
```

Body có thể ghi rõ `event_type: "add_to_cart"`; mọi giá trị khác bị từ chối bằng 422.
`user_id`, `created_at`, quantity và các trường thừa không được chấp nhận. `user_id` luôn
lấy từ `Depends(get_current_user)`; query string do client tự khai không đổi danh tính.
Chỉ customer đang hoạt động được ghi. Món phải tồn tại và còn bán, theo cách kiểm tra US8.1.

| Tình huống | HTTP |
|---|---|
| Sự kiện mới hợp lệ | 201, duplicate false |
| Cùng UUID, tài khoản, món và event_type | 200, duplicate true; thời gian giữ nguyên |
| UUID đã thuộc tài khoản/món/event_type khác | 409 chung, không trả dữ liệu cũ |
| Thiếu/sai/hết hạn JWT | 401 |
| Tài khoản không hoạt động hoặc không phải customer | 403 |
| Món không tồn tại/hết bán | 404 |
| UUID sai, trường thừa hoặc loại sự kiện sai | 422 |
| Lỗi lưu tạm thời | 503 |

`BE/interactions.py` chia sẻ logic append/idempotency giữa hai endpoint. UNIQUE trong
MariaDB quyết định khi hai request cùng UUID; nếu INSERT thua, rollback và đọc lại để
trả replay hoặc 409. Không dùng upsert hoặc UPDATE. Xung đột `view` ↔ `add_to_cart` áp dụng
hai chiều và khi gửi đồng thời. Không có API đọc/sửa/xóa sự kiện của người dùng khác.

Route Handler Next.js dùng `authenticatedRequest` hiện có: JWT được đọc từ cookie
HttpOnly và gửi qua Bearer header tại server. Origin được kiểm tra cho POST; không chuyển
Authorization tự khai từ browser thành danh tính. Không đưa JWT vào JavaScript/localStorage.
Nếu 401/403, cookie không hợp lệ được xóa và giao diện kiểm tra lại phiên; giỏ local vẫn còn.

## Retry và xử lý lỗi

Sau một lần thêm giỏ thành công, tạo một UUID riêng. Nếu ghi sự kiện lỗi mạng/5xx,
helper thử lại tối đa một lần, giữ nguyên UUID/body, chờ 250 ms; mỗi request timeout 5 giây.
Không retry lỗi 4xx. Đổi tài khoản/unmount hủy các request sự kiện đang chờ.

Retry chỉ gọi API tương tác, **không gọi `addToCart` lại**. Dù backend đã commit nhưng
response bị mất, giỏ tăng đúng một lần và UNIQUE bảo đảm database chỉ có một sự kiện.
API sự kiện tạm hỏng không hoàn tác giỏ, không khóa giỏ và không tạo thông báo thành công
giả cho thao tác bị giới hạn. Không có queue offline hoặc cơ chế ghi bù sau lần retry cuối.

## Chạy và tự kiểm tra

Giữ MySQL XAMPP Windows và hai server đang chạy:

```bash
cd /home/giang/FoodOrder/BE
./.venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

```bash
source ~/.nvm/nvm.sh
nvm use 24
cd /home/giang/FoodOrder/FE
pnpm dev --hostname 127.0.0.1 --port 3000
```

Không chạy lại init/seed/migration cho US8.2 khi đã có schema US8.1.

1. Đăng nhập A tại `http://127.0.0.1:3000`; mở Network và lọc `interactions/add-to-cart`.
2. Bấm nút cộng trên thẻ món: giỏ tăng, một POST 201. Sửa số lượng trong giỏ không thêm POST.
3. Mở chi tiết: chỉ ghi `view`. Chọn số lượng/size không ghi thêm giỏ; bấm xác nhận mới có
   một `add_to_cart`, UUID khác với view.
4. Dùng cửa sổ ẩn danh/trình duyệt khác đăng nhập B, thêm cùng món. Hai phiên có dữ liệu riêng.
5. Đăng xuất và thêm món: giỏ vẫn hoạt động, không có sự kiện gắn tài khoản.
6. Đối chiếu bằng truy vấn chỉ đọc trong database phát triển:

```sql
SELECT user_id, dish_id, event_type, COUNT(*) AS actions, MAX(created_at) AS last_event_utc
FROM foodorder_dev.user_interactions
GROUP BY user_id, dish_id, event_type
ORDER BY last_event_utc DESC;
```

Hai tab bình thường cùng origin chia sẻ cookie nên không dùng làm hai phiên độc lập.
Không cần hiển thị mật khẩu hoặc JWT để kiểm tra.

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
pnpm test:e2e
```

WSL2 hiện dùng thư viện Chromium giải nén riêng, không thay package hệ thống:

```bash
LD_LIBRARY_PATH=/tmp/foodorder-us81-browser/libs/usr/lib/x86_64-linux-gnu pnpm test:e2e
```

Đường dẫn `/tmp` có thể mất sau reboot; cài Chromium/OS dependencies bằng Playwright
nếu cần. Trình duyệt chỉ phục vụ E2E, không cần để chạy website.
E2E chỉ ghi sau khi kiểm tra đúng database phát triển; tài khoản thử được tái sử dụng từ
cache riêng có quyền 600, không nằm trong repository. Trace/video/screenshot xác thực tắt.
Test ghi sự kiện development thật và giữ lại dữ liệu sau mỗi lần chạy.

## File sửa hoặc tạo

| File | Nội dung |
|---|---|
| `BE/interactions.py` | Logic ghi sự kiện và chống trùng dùng chung |
| `BE/main.py` | Thêm endpoint add-to-cart; view dùng cùng service |
| `BE/schemas.py` | Schema chung và request/response chỉ nhận add_to_cart |
| `BE/tests/test_interactions.py` | Tách fixture dùng chung; giữ các kiểm tra US8.1 |
| `BE/tests/test_cart_interactions.py` | 24 kiểm thử US8.2, gồm barrier trước INSERT |
| `FE/app/api/interactions/add-to-cart/route.ts` | Proxy HttpOnly đến endpoint cố định |
| `FE/lib/auth-server.ts` | Thông báo lỗi phù hợp với từng API tương tác |
| `FE/lib/interactions-api.ts` | Tái sử dụng retry và UUID cho hai loại sự kiện |
| `FE/components/food/app-state.tsx` | Chỉ phát sự kiện sau local add thành công; giữ snapshot giỏ đồng bộ |
| `FE/components/food/food-detail-modal.tsx` | Giữ modal nếu thêm thất bại |
| `FE/tests/e2e/cart-interactions.spec.ts` | GUI/proxy/MariaDB, giỏ local, lỗi/retry, hai tài khoản và concurrency |
| `docs/US8_2_CART_INTERACTIONS.md` | Thiết kế, vận hành và kết quả US8.2 |
| `docs/DEVELOPMENT_WSL.md`, `docs/AUTHENTICATION.md`, `docs/US8_1_VIEW_INTERACTIONS.md` | Liên kết trạng thái mới |

## Kết quả thực tế và Acceptance Criteria

Lần chạy cuối ngày 2026-11-07:

| Kiểm tra | Kết quả |
|---|---|
| Backend | **80/80 đạt**: 56 bài cũ + 24 bài US8.2 |
| TypeScript độc lập | `tsc --noEmit --incremental false` đạt |
| Production build | `pnpm build` đạt, có cả hai Route Handler tương tác |
| Chromium E2E | **17/17 đạt**: 8 bài cũ + 9 bài US8.2 |
| Database | Vẫn 9 bảng khớp models; không chạy DDL |
| Bảo toàn dữ liệu | 17 sự kiện ban đầu và toàn bộ nội dung 8 bảng nền không đổi |

Next.js vẫn giữ cấu hình `ignoreBuildErrors: true` đã có; TypeScript ở trên là lệnh
độc lập đã chạy thành công, không suy ra từ thông báo build.

Lượt E2E đầu có 16/17 bài đạt: test giới hạn của US8.2 cố chọn 100 trong khi UI đã chặn 99.
Đã sửa test để dùng đúng thao tác thực tế: chọn 99, thêm thành công một lần, rồi kiểm tra
thêm tiếp thất bại ở cả thẻ món và modal. Không cần đổi giới hạn UI; lượt chạy lại 17/17 đạt.

Dữ liệu kiểm thử được giữ minh bạch:

- Backend cuối tạo 34 bản ghi tương tác trong SQLite tạm (19 từ các ca US8.2, 15 từ US8.1).
  Tổng hai lần chạy backend trong nhiệm vụ này tạo 49 dòng cô lập; tất cả database tạm đã hủy.
- Bộ E2E cuối thêm 25 dòng development: 14 view và 11 add_to_cart. Riêng 9 ca US8.2 thêm
  5 view + 10 add_to_cart; các ca cũ thêm 9 view và 1 add_to_cart vì có thao tác thêm giỏ thật.
- Hai lượt E2E trong nhiệm vụ thêm tổng **48 dòng** (27 view, 21 add_to_cart), không xóa sau test.
- Database cuối có **65 sự kiện: 44 view và 21 add_to_cart**. 17 view có từ trước giữ nguyên
  toàn bộ nội dung/thời gian; không chỉ đối chiếu số dòng.
- Vẫn 2 tài khoản, 6 danh mục, 9 món; dữ liệu các bảng nền không đổi. Không tạo tài khoản mới.

| Tiêu chí bắt buộc | Bằng chứng đã chạy | Kết quả |
|---|---|---|
| 1. Khách đăng nhập thêm thành công | API 201 và GUI thẻ món/modal → MariaDB | Đạt |
| 2. Thiếu JWT | API/proxy 401, không ghi dòng | Đạt |
| 3. JWT sai/hết hạn | API 401; E2E xác thực hết hạn và thêm giỏ với phiên sai | Đạt |
| 4. Món không tồn tại | API và proxy 404 | Đạt |
| 5. Retry cùng UUID không tạo trùng | 201 rồi 200; timestamp/dòng giữ nguyên | Đạt |
| 6. Hai thao tác độc lập | Hai UUID và hai dòng cho cùng user/món | Đạt |
| 7. Hai tài khoản cùng món | Hai browser context, đối chiếu user_id từ SQL | Đạt |
| 8. Không giả mạo user_id | Body 422; query không đổi chủ sở hữu JWT | Đạt |
| 9. Thao tác local thất bại không ghi | Dòng đã đủ 99: thẻ món/modal không đổi giỏ, không thêm POST | Đạt |
| 10. Một lần bấm không ghi hai lần vì render | Thay đổi state/search/focus không thêm POST | Đạt |
| 11. Sửa số lượng không tự ghi | Nút tăng/giảm trong giỏ không phát sinh UUID/sự kiện | Đạt |
| 12. API sự kiện lỗi không làm hỏng giỏ | 503, retry cùng UUID; giỏ tăng đúng một lần, vẫn sửa/xóa được | Đạt |
| 13. Xung đột view/add_to_cart | 409 cả hai chiều; giữ nguyên dữ liệu cũ | Đạt |
| 14. Request đồng thời cùng UUID | Barrier trước INSERT trong unit và Promise.all qua MariaDB: một dòng | Đạt |
| 15. Kiểm thử US8.1 còn đạt | Toàn bộ 26 bài US8.1 backend và 7 E2E view vẫn đạt | Đạt |

Cũng đã chạy concurrency khác tài khoản, khác món và khác loại sự kiện. UUID xung đột
trả một 201 và một 409, không ghi đè. Khách chưa đăng nhập, detail API lỗi và token sai đều
được kiểm tra qua giao diện/proxy. Không phát hiện lỗi chặn US8.2 theo phạm vi giỏ local này.

## Giới hạn và phần tiếp theo

Chỉ ghi `view` và `add_to_cart`. Chưa triển khai purchase, rating, reward hoặc LinUCB.
Chưa có cart backend, chống gian lận hành vi, queue offline hoặc rate limiting riêng.
Một client đã xác thực vẫn có thể tự gọi API bằng UUID mới; cơ chế hiện xác minh danh tính,
món và chống trùng, không chứng minh thao tác nhìn/bấm từ trình duyệt đáng tin cậy.
Các phần này cần yêu cầu riêng nếu muốn nâng mức bảo đảm dữ liệu.

US8.3 cần gắn tín hiệu mua vào trạng thái đơn hoàn thành thật tại backend, với khóa chống
trùng theo nguồn đơn hàng; không dùng checkout demo hoặc callback thêm giỏ để tính mua.

US8.3 hiện đã có service/schema purchase độc lập, dùng nguồn Order/OrderItem và transaction;
chưa có workflow hoàn thành đơn thật để tích hợp. Giỏ local và API add-to-cart không được dùng
để tự ghi purchase. Xem [US8_3_PURCHASE_INTERACTIONS.md](US8_3_PURCHASE_INTERACTIONS.md)
cho kết quả/migration mới và các phụ thuộc còn thiếu.
