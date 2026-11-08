# US4.1 – Theo dõi trạng thái đơn hàng

## Phạm vi và trạng thái nghiệm thu

Thực hiện ngày 2026-11-08 trên nhánh `feature/linucb-restart`. Đã đọc AGENTS, PROJECT_CONTEXT,
models/schemas, auth, checkout/admin/tracking và kiểm tra Git status/diff; lưu snapshot
trước sửa và giữ các thay đổi chưa commit có sẵn.

PROJECT_CONTEXT có backlog và quy trình nghiệp vụ nhưng chưa có Acceptance Criteria US4.1
chi tiết riêng; dùng các yêu cầu của nhiệm vụ này làm tiêu chí. Đã triển khai phần đọc
an toàn. **Chưa đánh dấu US4.1 Done end-to-end với đơn thật**: development hiện không có
Order/OrderItem và chưa có API tạo đơn hoặc cập nhật trạng thái của cửa hàng.

Checkout/admin vẫn giữ luồng local hiện có, không xây lại. Tracking không dùng receipt demo
làm đơn thật: sau checkout demo, thông báo rõ chưa lưu đơn và chưa có trạng thái thật.
Đã bỏ SAMPLE_ORDER, tiến trình cố định, ETA/tài xế/số điện thoại mẫu khỏi tracking.

## API chỉ đọc và bảo vệ chủ đơn

`GET /api/orders/{order_id}` ở FastAPI; `order_id` là UUID từ `Order.id`.

- Dùng `Depends(get_current_user)`: JWT hợp lệ, tài khoản hoạt động, role customer.
- WHERE gồm cả `Order.id` và `Order.customer_id == user.id` trước khi tải các dòng món.
  Không dùng user_id/customer_id từ query/body để chọn chủ sở hữu.
- Đơn không tồn tại và đơn của người khác có cùng response 404, không tiết lộ dữ liệu.
- GET chỉ SELECT; không flush/commit, đổi status/payment, gọi purchase service hay recorder.
- Chỉ trả DTO dành cho khách: mã đơn, trạng thái, địa chỉ nhận, created_at/updated_at,
  các số tiền/phương thức và trạng thái thanh toán, danh sách dòng món với ID/tên/số lượng/
  đơn giá/thành tiền/options. Không trả tài khoản/shipper/password/token/note nội bộ.
- Đơn giá/thành tiền lấy từ Order/OrderItem đã lưu; không dùng giá menu hoặc giá client.
  Tên món dùng quan hệ Dish đang có; model hiện chưa có snapshot tên món lúc đặt.
- Có `Cache-Control: private, no-store` trên dữ liệu đọc. SQL lỗi trả 503 với thông báo chung.

| Trường hợp | HTTP |
|---|---|
| Chủ đơn là customer hoạt động, JWT hợp lệ | 200 |
| Thiếu/sai/hết hạn JWT hoặc subject không tồn tại | 401 |
| Tài khoản inactive hoặc role khác customer | 403 |
| Không tồn tại/không thuộc tài khoản | 404 chung |
| UUID sai | 422 |
| POST/PUT/PATCH/DELETE trên endpoint đọc | 405 |
| Lỗi truy vấn database | 503 |

Tái sử dụng models/bảng hiện có, không DDL/migration. Quyền mới cần cho đọc chỉ là SELECT
trên users/orders/order_items/dishes; không cần cấp CREATE/UPDATE cho chức năng này.

## Trạng thái và lý do hủy

| Enum hiện có | Nhãn giao diện |
|---|---|
| pending | Chờ xác nhận |
| confirmed | Đã xác nhận |
| preparing | Đang chuẩn bị |
| delivering | Đang giao |
| completed | Hoàn thành |
| cancelled | Đã hủy |

Giữ đủ sáu enum đang có, không sửa workflow/trạng thái lưu trong database. Tiến trình được
tính từ status response mới; đơn hủy không hiển thị tiến trình như đã hoàn thành.

Model Order chưa có cột lý do hủy. Response hiện trả `cancellation_reason: null`;
không gán `Order.note` (ghi chú khách/bếp) thành lý do hủy. UI đã xử lý được reason thật
nếu API cung cấp trong tương lai, và hiển thị chưa có lý do khi null. Kiểm thử UI dùng
reason từ mock có kiểm soát; chưa xác minh lý do hủy thật trong MariaDB.

`updated_at` trả theo giá trị Orders đang lưu, không tự gắn UTC vào datetime không có
offset. UI hiển thị theo thời gian local của trình duyệt. Luồng tạo/cập nhật đơn cần
thống nhất quy ước timezone khi được triển khai; US4.1 không thay dữ liệu thời gian cũ.

## Frontend và cookie HttpOnly

Nút **Theo dõi đơn hàng** trên header mở modal; đăng nhập rồi nhập mã tra cứu. Hiện mã
tra cứu là UUID của đơn, không phải mã HD do checkout demo tạo. Chưa có lịch sử đơn hàng
hoặc cơ chế tự chọn đơn gần nhất (ngoài phạm vi US4.1). Khi US3.5 có response ID thật,
có thể truyền vào `initialOrderId` của modal để tự tải mà không yêu cầu nhập tay.

Route Handler `GET /api/orders/[orderId]` lấy JWT từ cookie HttpOnly qua authenticatedRequest
hiện có. Chỉ UUID hợp lệ được nối vào endpoint cố định; không chuyển query/user_id hay
Authorization do browser khai sang backend. Response/error của proxy đều no-store;
401/403 dùng cùng cơ chế xóa cookie/kiểm tra lại phiên đang có.

Đã sửa proxy chung trong next.config.mjs sang **fallback**: rewrites dạng array được áp
dụng trước dynamic routes nên ban đầu bypass Route Handler động và làm FastAPI thiếu Bearer.
Fallback cho Route Handler chạy trước; menu/category/detail chưa có handler vẫn proxy như cũ.
Đã kiểm tra theo docs Next.js cài tại node_modules và request thật, không thay framework.

Modal có trạng thái kiểm tra phiên, chưa chọn đơn, tải, 404, lỗi API, hết phiên và nút
làm mới. Mỗi lookup/refresh xóa kết quả cũ trước khi đọc; request trước bị abort và response
muộn bị bỏ qua. Đóng modal/đăng xuất/đổi tài khoản hủy request và không giữ dữ liệu chủ đơn
cũ trong DOM. Không lưu order/token vào localStorage và không đưa JWT cho JavaScript.
Không lấy dữ liệu mẫu khi lỗi. Giao diện có hỗ trợ touch/mobile 390×844.

## Đối chiếu tiêu chí và phần phụ thuộc

| Tiêu chí | Bằng chứng / trạng thái |
|---|---|
| Khách xem đơn của mình | API + truy vấn/auth thật trên SQLite cô lập; UI từ API mock |
| Không xem đơn người khác/không tin user_id | Backend fixture hai khách, foreign/missing cùng 404; query spoof không đổi chủ đơn |
| Thiếu/sai/hết hạn JWT | Backend JWT thật; proxy thật chặn cookie thiếu/sai, không nhận Bearer tự khai |
| Dữ liệu thực tế từ DB | Backend trả giá/status/items/timestamps fixture, không dùng demo |
| Đủ trạng thái và cập nhật khi làm mới | Cả sáu enum trong backend; UI mock đổi status/updated_at và refresh |
| Hủy đơn và lý do | Hiển thị cancelled; reason null đúng model hiện tại; UI mock kiểm tra reason có/không |
| Không có đơn/API lỗi | Empty-selection, real DB 404, mock 404/503/malformed data; không thay bằng sample |
| Responsive | Chromium touch 390×844, tra cứu/làm mới/đóng, không tràn ngang |
| API đọc không thay trạng thái/purchase | Fixture completed+paid chỉ SELECT, không có tương tác; mutating methods bị chặn |
| Không hỏng giỏ/auth/tương tác | Chạy lại toàn bộ backend, unit và E2E có sẵn |
| End-to-end với đơn thật | **Chưa đạt/chờ nguồn đơn thật**; không tạo fixture đơn trong foodorder_dev để giả lập đạt |

Để US4.1 và US8.3 hoạt động end-to-end, nhóm cần hoàn thiện:

1. **US3.4–US3.5**: nhận thông tin giao hàng, backend tạo Order/OrderItem thật, chủ đơn lấy
   từ JWT và giá/tùy chọn tính ở server; trả ID/mã đơn để mở tracking.
2. **US7.1–US7.4**: đọc/quản lý đơn có phân quyền, xác nhận/từ chối/cập nhật trạng thái thật.
   US7.3 cần nguồn lý do hủy có cấu trúc; sau đó map cột thật vào cancellation_reason.
3. **Tích hợp US8.3**: workflow hoàn thành đơn/thanh toán thật gọi service purchase đã có
   trong transaction thích hợp. GET tracking không gọi service này. Không tự đặt COMPLETED/PAID.
4. Chạy nghiệm thu từ checkout thật → admin cập nhật → customer refresh → kiểm tra nguồn
   purchase/chống trùng; cập nhật các boundary tests theo workflow thật khi được phép.

## File thay đổi

| File | Nội dung |
|---|---|
| `BE/orders.py` | Service đọc theo chủ sở hữu, không side effect |
| `BE/main.py`, `BE/schemas.py` | Endpoint JWT GET và DTO dành cho khách |
| `BE/tests/test_orders.py` | 21 kiểm thử với AsyncSession/SQLite và JWT thật |
| `FE/app/api/orders/[orderId]/route.ts` | Proxy HttpOnly, chuẩn hóa UUID và lỗi an toàn |
| `FE/lib/orders-api.ts` | DTO/trạng thái, kiểm tra payload, đọc no-store |
| `FE/components/food/order-tracking-modal.tsx` | Thay tracking cố định bằng API, lookup/refresh/error/privacy |
| `FE/components/food/site-header.tsx`, `food-app.tsx` | Điểm mở tracking, đăng nhập và tách receipt demo |
| `FE/components/food/cart-drawer.tsx` | Ghi rõ trạng thái demo ở fallback receipt; không đổi logic checkout |
| `FE/next.config.mjs` | Fallback proxy để không bỏ qua dynamic authenticated handler |
| `FE/tests/fixtures/orders.ts` | DTO mock dùng riêng trong tests, không import vào production |
| `FE/tests/unit/orders-api.spec.ts` | 8 ca client API validation/money/status/error |
| `FE/tests/e2e/us41-orders.spec.ts` | 11 ca UI/mock, proxy thật, phiên, privacy, mobile |
| `FE/tests/e2e/purchase-boundary.spec.ts` | Cho phép duy nhất GET mới, giữ cấm tạo/cập nhật/purchase và demo tracking |
| Tài liệu này, DEVELOPMENT_WSL, US3.3, US8.3 | Trạng thái nghiệm thu/phụ thuộc mới, giữ kết quả lịch sử |

## Chạy và kiểm thử

Giữ XAMPP Windows và hai server chạy theo [DEVELOPMENT_WSL.md](DEVELOPMENT_WSL.md).
Không cần init/seed/migration cho nhiệm vụ này.

```bash
cd /home/giang/FoodOrder/BE
./.venv/bin/python -B -m unittest discover -s tests -v
```

```bash
source ~/.nvm/nvm.sh
nvm use 24
cd /home/giang/FoodOrder/FE
pnpm test:unit
pnpm exec tsc --noEmit --incremental false
pnpm build
LD_LIBRARY_PATH=/tmp/foodorder-us32-browser/libs/usr/lib/x86_64-linux-gnu pnpm test:e2e
```

E2E kiểm tra database phát triển trước truy vấn/thao tác có xác thực. Tài khoản test tái sử
dụng từ cache riêng ngoài repository; không in mật khẩu/JWT, không lưu trace/video/screenshot
xác thực. Các trạng thái/đơn hoàn thành chỉ được tạo trong SQLite cô lập hoặc mock UI.
Thư viện Chromium trong `/tmp` có thể mất sau reboot; xem hướng dẫn WSL nếu cần chuẩn bị lại.

## Kết quả thực tế

| Kiểm tra | Kết quả |
|---|---|
| Backend đầy đủ | **143/143 đạt**: 122 ca cũ + 21 ca đọc đơn |
| Unit frontend | **40/40 đạt**: 32 ca giỏ + 8 ca client API đơn |
| TypeScript độc lập | `tsc --noEmit --incremental false` đạt |
| Production build | `pnpm build` đạt, có route động `/api/orders/[orderId]` |
| E2E US4.1 riêng | **11/11 đạt**, không đổi bất kỳ bản ghi MariaDB nào |
| E2E đầy đủ cuối | **57/57 đạt**: 46 ca cũ + 11 ca US4.1 |
| Purchase boundary | Chỉ có GET mới; vẫn không API hoàn thành/thanh toán/purchase; không tạo đơn/purchase trong development |
| Audit dữ liệu | Toàn bộ 8 bảng nền và 224 sự kiện ban đầu giữ nguyên digest/nội dung/timestamp |

Lượt E2E riêng đầu đạt 9/11: proxy dạng array chạy trước dynamic Route Handler nên GET
thực nhận 401 dù phiên hợp lệ. Sau khi đổi sang fallback, cả 11 ca riêng và toàn bộ 57
ca đạt. Hai ca này kiểm tra proxy/404 thật, không thay bằng mock để bỏ qua lỗi định tuyến.

Next.js vẫn có `ignoreBuildErrors: true` từ trước; TypeScript được chạy độc lập, không
suy ra từ build. Backend đã được khởi động lại để nạp endpoint mới; startup chỉ ping DB.

Trong `foodorder_dev` vẫn có **0 orders, 0 order_items, 0 purchase**, 2 tài khoản, 6 danh mục,
9 món. Full regression append 37 tương tác thử nghiệm hợp lệ từ các ca cũ (15 view,
22 add_to_cart); các ca US4.1 không tạo tương tác. Tổng cuối **261 sự kiện: 131 view,
130 add_to_cart**. Không xóa dữ liệu test; không DDL/seed/migration hoặc sửa database khác.

**Chưa kiểm thử được với đơn hàng thật.** Backend positive-path/ownership/status được
xác minh bằng fixture có quan hệ thật trong SQLite cô lập; UI positive-path dùng DTO mock.
Các kiểm tra cookie/proxy/401/404/methods có đi qua Next.js và FastAPI thật. Không suy diễn
các kết quả này thành nghiệm thu checkout → admin → customer → purchase end-to-end.

Đã hoàn tất phần US4.1 được phép làm an toàn; **US4.1 chưa Done end-to-end**, chờ các
phụ thuộc nêu trên. Không commit, push, merge, reset hard hoặc git clean; giữ thay đổi
chưa commit của các nhiệm vụ trước.
