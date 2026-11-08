# US3.1 – Thêm món ăn vào giỏ hàng

## Phạm vi và hiện trạng đã kiểm tra

Nghiệm thu ngày 2026-11-07 tại `/home/giang/FoodOrder`, nhánh `feature/linucb-restart`.
Đã đọc `AGENTS.md`, `FE/AGENTS.md`, `docs/PROJECT_CONTEXT.md` và code liên quan.
PROJECT_CONTEXT có tên/phạm vi US3.1 nhưng chưa có bộ Acceptance Criteria riêng;
các yêu cầu cụ thể trong nhiệm vụ của người dùng được dùng làm tiêu chí nghiệm thu dưới đây.

Trước lần này đã có nút thêm nhanh trên danh sách, thêm từ modal chi tiết, size/topping,
ghi chú, số lượng, gộp dòng, giới hạn 99/dòng, huy hiệu giỏ, thông báo và US8.2.
`AppProvider` lưu giỏ trong React state, kết hợp ref đồng bộ cho các thao tác.
Thiếu kiểm tra món còn bán/giá hiện tại khi bấm thêm; dữ liệu trên thẻ món có thể đã cũ.
Các object tùy chọn cũng chưa được đối chiếu lại theo ID trong cấu hình hiện có.

Lịch sử Git cục bộ của phần giỏ chỉ tìm thấy `a24bb85` (HuangLong, Initial commit).
Do đó giữ phần giỏ có sẵn của nhóm và chỉ sửa luồng thêm món. Không suy ra công việc
chưa được đưa vào các ref cục bộ của thành viên khác. Các thay đổi chưa commit có từ
trước được giữ nguyên; không stage/commit/push/merge.

## Kiến trúc và luồng thêm

Giỏ tiếp tục lưu trong **React local state/ref**, chưa lưu session, localStorage hay database.
Reload trang sẽ mất giỏ. Các tiêu chí US3.1 lần này không yêu cầu lưu bền vững; không cần
thêm bảng hoặc xây backend giỏ hàng. Giữ nguyên bố cục và các nút hiện có.

1. Nút thêm gọi chung `addToCart`, trả `Promise<boolean>`; chụp số lượng, ID tùy chọn,
   ghi chú và khách hàng tại thời điểm bấm. Chỉ nhận số nguyên 1–99, size hợp lệ,
   topping không trùng và ghi chú tối đa 200 ký tự.
2. Gọi GET `/api/dishes/{id}` qua Next.js rewrite tới FastAPI, `cache: no-store`,
   timeout 5 giây. Backend đọc món trong database, chỉ trả món tồn tại/còn bán.
   Không gửi tên hoặc giá do client tự khai cho backend xử lý.
3. Kiểm tra response đúng ID, còn bán và có tên/giá hợp lệ. Tên và giá gốc lấy từ
   response mới; size/topping được tra theo ID trong `SIZES`/`TOPPINGS` hiện có,
   bỏ qua label/giá tùy chọn truyền vào callback. Topping phải thuộc nhóm món hiện tại.
4. Ghép vào snapshot giỏ mới nhất. Khóa dòng gồm dish_id, size, tập ID topping đã sắp xếp
   và ghi chú đã trim. Khác lựa chọn tạo dòng riêng; cùng lựa chọn tăng số lượng.
   Giữ quy tắc cũ: dòng 98 thêm 2 chỉ tăng 1; dòng đủ 99 bị từ chối.
   Khi thêm lại, tên và giá của dòng được cập nhật theo thực đơn mới, có thông báo nếu giá đổi.
5. Cập nhật ref/state, huy hiệu tổng số lượng và thông báo lượng thực thêm. Sau thành công
   mới gửi US8.2. Modal chỉ đóng nếu thao tác thành công và chính modal đó vẫn đang mở.

Trong khi kiểm tra, nút thêm của món đó bị khóa và có `aria-busy`. Phản hồi hai món về
khác thứ tự không ghi đè giỏ. Lỗi API/mạng/timeout/payload chỉ báo thất bại, giữ các món
đang có và mở lại nút. Unmount/reload hủy request đang chờ; không thêm món vào trang mới.

Size/topping vẫn là cấu hình giao diện có sẵn; hai bảng tùy chọn món trong database đang
trống. Giá giỏ là giá hiển thị tạm thời phía client. Chưa có API đặt hàng thật để xử lý giá;
khi làm đặt hàng, backend phải tự đọc và tính lại giá món/tùy chọn, không dùng tổng tiền
client gửi. Nhiệm vụ này không triển khai checkout hay lưu giỏ bền vững.

## Đối chiếu Acceptance Criteria

| Tiêu chí | Trước đó | Hoàn thiện và bằng chứng |
|---|---|---|
| Thêm từ danh sách và chi tiết | Đã có | Dùng chung callback async; E2E cả hai đường |
| Chỉ món tồn tại/còn bán | Chưa kiểm tra lại khi thêm | GET chi tiết mới; test 404 và `is_available: false` giữ nguyên giỏ |
| Đúng ID, tên, giá, số lượng và tùy chọn | Dùng object thẻ món/tùy chọn | Tra món mới và tùy chọn theo ID; test đổi tên/giá và giá tùy chọn giả |
| Backend không tin giá client | Chưa có cart/order backend thật | GET chỉ có ID; API tương tác chỉ nhận ID sự kiện/món, không nhận giá |
| Gộp/tách dòng đúng thiết kế | Đã có khóa món/size/topping/ghi chú | Giữ thiết kế; test đảo thứ tự topping, trim ghi chú và tùy chọn khác nhau |
| Huy hiệu giỏ đúng | Đã có tổng số lượng | Test nhiều món, thêm lại và dòng có tùy chọn |
| Thông báo thành công/thất bại | Đã có | Thêm lỗi món hết bán, API, timeout và thông báo cập nhật giá |
| Số lượng hợp lệ/giới hạn | Đã có 1–99 và giới hạn từng dòng | Giữ quy tắc; unit test số âm, 0, lẻ, NaN, chuỗi, >99 và thêm sát giới hạn |
| Không mất món khác | Có ref đồng bộ | Khi async phải ghép vào ref hiện tại; E2E phản hồi về khác thứ tự |
| Giữ giao diện đang hoạt động | Đã có giao diện | Chỉ thêm trạng thái chờ trên nút, giữ layout; toàn bộ E2E hồi quy đạt |
| Bảo toàn US8.2 | Đã có UUID/retry/JWT | Chỉ phát sau commit giỏ; toàn bộ test tương tác cũ và ca mới đạt |

## Bảo toàn US8.1/US8.2

Không sửa service tương tác backend, proxy xác thực, JWT cookie HttpOnly hay SDK retry.
Không nhận `user_id` do browser khai. Một thao tác thêm thành công tạo một UUID; retry
chỉ gửi lại tương tác với UUID đó, không gọi thêm giỏ. UNIQUE database giữ một sự kiện.
Thao tác thất bại, re-render, sửa tùy chọn hoặc reload không tạo sự kiện thêm giỏ.
Khách chưa đăng nhập vẫn thêm được; đăng nhập trong lúc request của khách đang chờ
không gán ngược hành vi cho tài khoản vừa đăng nhập.

## Kiểm thử thực tế

Giữ MariaDB XAMPP Windows và hai server phát triển đang chạy. Chỉ sử dụng `foodorder_dev`.

```bash
cd /home/giang/FoodOrder/BE
./.venv/bin/python -B -m unittest discover -s tests -v
```

```bash
source ~/.nvm/nvm.sh
nvm use 24
cd /home/giang/FoodOrder/FE
pnpm test:unit
pnpm exec tsc --noEmit
pnpm build
LD_LIBRARY_PATH=/tmp/foodorder-us81-browser/libs/usr/lib/x86_64-linux-gnu pnpm test:e2e
```

Đường dẫn thư viện Chromium trong `/tmp` là giải pháp WSL hiện có và có thể mất sau reboot;
cần cài dependencies Chromium theo Playwright nếu chạy trên máy khác. Không cần Chromium
để chạy website hoặc unit tests. E2E dùng fixture tài khoản riêng ngoài repository, không
ghi trace/video/screenshot chứa thông tin xác thực và giữ lại sự kiện thử nghiệm.

| Kiểm tra | Kết quả |
|---|---|
| Backend đầy đủ | **122/122 đạt**, database SQLite tạm, không thay đổi code BE |
| Unit cart/catalog mới | **16/16 đạt**, không cần browser hoặc MariaDB |
| TypeScript độc lập | `pnpm exec tsc --noEmit` đạt |
| Production build | `pnpm build` đạt |
| E2E Chromium đầy đủ | **28/28 đạt**: 19 ca cũ + 9 ca US3.1 mới |
| Hồi quy tương tác | Đạt cả US8.1, US8.2 và ranh giới purchase đã có |
| Database | Xác minh `SELECT DATABASE()` là `foodorder_dev`; không DDL/seed/update/delete |
| Bảo toàn dữ liệu | Digest toàn bộ 8 bảng nền và toàn bộ 91 sự kiện cũ không đổi |

Next.js đang có `ignoreBuildErrors: true` từ trước. Kết quả TypeScript là kiểm tra độc lập,
không suy ra từ production build.

Bộ E2E thêm 29 sự kiện development: 14 view và 15 add_to_cart. Riêng 9 ca mới ghi 3
add_to_cart cho các thao tác đăng nhập thành công. Database cuối có 120 sự kiện
(72 view, 48 add_to_cart), 2 tài khoản, 6 danh mục, 9 món, 0 đơn hàng và 0 purchase.
Không xóa sự kiện test sau khi chạy. Không tạo bảng, tài khoản, món hay đơn mới trong lần này.

## Các file thay đổi

- `FE/lib/cart.ts`: tách quy tắc thêm/gộp dòng, kiểm tra lựa chọn và giới hạn.
- `FE/lib/menu-api.ts`: kiểm tra response món mới và lỗi an toàn.
- `FE/components/food/app-state.tsx`: kiểm tra async trước thêm, bảo toàn giỏ/US8.2.
- `FE/components/food/food-detail-modal.tsx`: chờ kết quả, giữ modal khi thất bại,
  không đóng nhầm modal khác.
- `FE/components/food/food-card.tsx`, `reorder-row.tsx`, `ai-chat-widget.tsx`: các nút thêm
  có sẵn dùng trạng thái chờ chung; không phát triển chatbot hay luồng đặt lại mới.
- `FE/package.json`, `FE/playwright-unit.config.ts`, `FE/tests/unit/cart.spec.ts`:
  dùng Playwright runner đã có để chạy 16 unit tests, không thêm dependency.
- `FE/tests/e2e/us31-cart.spec.ts`: 9 ca thêm món, lỗi, bất đồng bộ và audit database.
- Tài liệu này, `docs/US8_2_CART_INTERACTIONS.md`, `docs/DEVELOPMENT_WSL.md`:
  cập nhật luồng và bằng chứng nghiệm thu.

## Kết luận và phần tái sử dụng

US3.1 đủ điều kiện đánh dấu **Done theo các tiêu chí của nhiệm vụ này**, với kiến trúc
giỏ local đã được yêu cầu giữ lại. Không thêm yêu cầu lưu giỏ qua reload/đa thiết bị.

US3.2 có thể tái sử dụng `CartItem`, `CART_LINE_LIMIT`, snapshot/ref và callback
`updateQuantity` hiện có, cách tính tổng/huy hiệu, unit fixtures và helpers E2E.
Giá trị số lượng và quy tắc khi món/giá thay đổi trong lúc chỉnh giỏ cần nghiệm thu riêng.
Không sửa callback thay đổi số lượng, xóa món hoặc triển khai US3.2/US3.3/US4.1 trong lần này.
Không triển khai thêm US8.3, reward hoặc LinUCB.

US3.2 được thực hiện sau lần nghiệm thu trên: xem [US3_2_CART_QUANTITY.md](US3_2_CART_QUANTITY.md)
cho thay đổi callback số lượng, giới hạn 1–99 và kết quả kiểm thử mới. Các số liệu US3.1
trong tài liệu này giữ nguyên theo lần nghiệm thu US3.1.
