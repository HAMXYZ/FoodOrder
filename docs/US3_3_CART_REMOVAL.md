# US3.3 – Xóa món ăn khỏi giỏ hàng

## Phạm vi và hiện trạng

Thực hiện ngày 2026-11-08 tại `/home/giang/FoodOrder`, nhánh `feature/linucb-restart`.
Đã đọc `AGENTS.md`, `FE/AGENTS.md`, `PROJECT_CONTEXT.md`, tài liệu US3.1/US3.2 và code/test
liên quan. Trong repository hiện tại, US3.3 chỉ có mục backlog, chưa có Acceptance Criteria
chi tiết riêng; dùng các tiêu chí người dùng gửi cho nhiệm vụ này để nghiệm thu.
Đã kiểm tra Git status/diff và lưu snapshot trước sửa, không ghi đè công việc có sẵn.

Trước đó đã có nút thùng rác, xóa theo `CartItem.key`, cập nhật ref/state, tổng giỏ/huy hiệu
và trạng thái giỏ trống. Không viết lại các phần này. Thiếu xử lý khi một request thêm lại
cùng dòng đang chờ: sau khi xóa, response cũ có thể tạo lại dòng đó. Nút xóa trước đây chỉ
có vùng chạm bằng icon 16px, và các dòng cùng tên chưa có mô tả tùy chọn cho nút.

Giữ **React local state/ref**; reload vẫn làm mất giỏ. Không tạo backend/bảng giỏ hàng.

## Cơ chế xóa và xử lý bất đồng bộ

1. Nút Xóa gọi `removeItem(item.key)`, không dùng dish_id hoặc vị trí trong mảng để xóa.
   Key hiện có gồm ID món, size, tập ID topping đã sắp xếp và ghi chú đã trim.
2. Đọc snapshot `currentCart.current` mới nhất. Nếu key không còn tồn tại, thao tác không
   thay đổi giỏ hoặc phát thông báo lặp. Helper `removeCartItem` chỉ lọc đúng key, giữ
   nguyên các object còn lại; xóa cả dòng dù số lượng là 1 hay 99.
3. Mỗi request kiểm tra món trước khi thêm được gắn với key lựa chọn đã chụp lúc bấm.
   Khi xóa, hủy tất cả request đang chờ có **đúng key đó**, không hủy theo riêng dish_id.
   Các món khác hoặc bộ tùy chọn khác tiếp tục bình thường.
4. Guard `controller.signal.aborted` đã có trong luồng thêm được kiểm tra trước commit.
   Vì vậy response đến muộn vẫn bị bỏ qua ngay cả khi transport không tuân thủ abort.
   Request bị hủy không cập nhật giỏ, không báo thêm thành công và không phát US8.2.
5. Cập nhật ref đồng bộ trước state; các lần xóa/sửa số lượng liên tục luôn đọc snapshot
   hiện tại. Tổng số lượng, thành tiền, phí/voucher và tổng cộng dùng lại logic đang có.
   Xóa món cuối cùng hiển thị giỏ trống, huy hiệu/tiêu đề về 0 và ẩn phần đặt hàng.
6. Hiển thị thông báo xóa thành công. Nút giữ icon/bố cục hiện tại, có vùng chạm 44×44px,
   focus ring và mô tả size/topping/ghi chú cho các dòng cùng tên.

Lệnh thêm mới sau khi xóa được phép tạo lại dòng bằng một request/ý định mới; không lưu
khóa chặn vĩnh viễn. Chỉ request cũ bị hủy. Thao tác xóa không gọi API hoặc đòi kết nối mạng.

## Bảo toàn US3.2 và các tương tác AI

- Giảm tại 1 vẫn giữ nguyên món; chỉ nút xóa riêng mới xóa dòng.
- Xóa không gọi recorder, không tạo `add_to_cart`, `view` hoặc loại tương tác mới.
- Không xóa/sửa sự kiện đã lưu. Request telemetry của thao tác thêm **đã thành công**
  tiếp tục retry cùng event_id, kể cả khi người dùng xóa món trước khi retry hoàn tất.
  Chỉ hủy request kiểm tra món của thao tác **chưa thêm thành công**.
- Không đổi JWT, cookie HttpOnly, proxy xác thực, UUID/retry hoặc UNIQUE event_id.
- Không triển khai US4.1, reward hay LinUCB; không đổi backend/schema.

## Đối chiếu Acceptance Criteria

| Tiêu chí | Hiện trạng/hoàn thiện và kiểm thử |
|---|---|
| 1. Bấm Xóa loại bỏ một dòng | Có sẵn; tái sử dụng nút/callback, thêm unit và E2E |
| 2. Xóa đúng định danh ổn định | Dùng full key, không index/dish_id; unit kiểm tra dòng đầu/giữa/cuối |
| 3. Cùng món khác tùy chọn độc lập | Unit/E2E xóa size L/topping/ghi chú, giữ S và M |
| 4. Không ảnh hưởng dòng khác | Giữ reference/metadata trong unit; E2E nhiều món và xen kẽ sửa số lượng |
| 5. Tổng tiền/số lượng/huy hiệu cập nhật ngay | E2E đối chiếu dòng còn lại, tạm tính, phí, tổng cộng và huy hiệu |
| 6. Xóa cuối cùng hiển thị trống | E2E xóa dòng 99, tiêu đề/huy hiệu 0, không còn nút đặt hàng |
| 7. Xóa được số lượng 1–99 | Unit các mốc 1, 2, 42, 99; E2E số lượng 1, 2, 3 và 99 |
| 8. Bấm xóa liên tục an toàn | Unit 100 lần lặp; E2E burst xóa hai dòng xen kẽ tăng dòng khác |
| 9. Không khôi phục nhầm do request cũ | Hủy theo key; E2E response trễ, transport bỏ qua abort, request khác vẫn chạy, thêm mới hợp lệ |
| 10. Giữ giao diện, dùng được trên điện thoại | E2E Chromium 390×844, có touch, hitbox 44px, tap/offline và kiểm tra không tràn ngang |
| Giữ quy tắc US3.2 | Toàn bộ ca số lượng cũ; kiểm tra nút giảm khóa ở 1 sau khi thêm lại |
| Không phát view/add khi xóa | E2E có đăng nhập theo dõi request và digest sự kiện trước/sau |
| Không xóa lịch sử, giữ retry US8.2 | E2E hủy giỏ sau INSERT thành công nhưng response lỗi; retry cùng UUID trả replay, giỏ vẫn trống |
| Hồi quy US3.1/US3.2/US8.1/US8.2 | Chạy toàn bộ unit, backend và E2E hiện có |

## File sửa/tạo

| File | Nội dung |
|---|---|
| `FE/lib/cart.ts` | Helper xóa theo key, không đổi giỏ khi key đã mất |
| `FE/components/food/app-state.tsx` | Gắn request thêm với key, hủy request cũ khi xóa, thông báo thành công |
| `FE/components/food/cart-drawer.tsx` | Vùng chạm/focus và mô tả tùy chọn, giữ nút xóa hiện có |
| `FE/tests/unit/cart-removal.spec.ts` | 8 ca xóa/bất biến/giới hạn/lặp/xen kẽ/thêm mới |
| `FE/tests/e2e/us33-cart.spec.ts` | 10 ca GUI, race, telemetry, retry và mobile |
| `docs/US3_3_CART_REMOVAL.md` | Thiết kế, tiêu chí và nghiệm thu |
| `docs/US3_2_CART_QUANTITY.md`, `docs/DEVELOPMENT_WSL.md` | Liên kết kết quả mới, giữ số liệu nghiệm thu trước |

## Chạy kiểm thử

Giữ MariaDB XAMPP Windows và hai server đang chạy theo
[DEVELOPMENT_WSL.md](DEVELOPMENT_WSL.md). Chỉ dùng database `foodorder_dev`.

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

Các ca mới tái sử dụng tài khoản test ở cache riêng ngoài repository và kiểm tra database
thực tế trước thao tác có xác thực. Không in mật khẩu/token, không ghi trace/video hoặc
screenshot xác thực. Test mobile dùng guest; Chromium mô phỏng touch, không phải thiết bị thật.
Backend dùng SQLite tạm; unit giỏ không cần browser/database. Thư viện Chromium trong `/tmp`
là thiết lập WSL có sẵn từ US3.2, có thể mất sau reboot; cần chuẩn bị OS dependencies
Playwright tương ứng nếu không còn thư mục này.

## Kết quả nghiệm thu

| Kiểm tra | Kết quả |
|---|---|
| Backend đầy đủ | **122/122 đạt**, SQLite tạm, không đổi code BE |
| Unit giỏ hàng | **32/32 đạt**: 24 ca cũ + 8 ca xóa mới |
| TypeScript độc lập | `tsc --noEmit --incremental false` đạt |
| Production build | `pnpm build` đạt |
| E2E Chromium cuối | **46/46 đạt**: 36 ca cũ + 10 ca US3.3 |
| Mobile | 390×844, touch, hitbox 44×44, viewport/scrollWidth 390px, xóa offline và trạng thái trống đạt |
| Hồi quy | Đạt US3.1, US3.2, US8.1, US8.2, auth và ranh giới purchase có sẵn |
| Database | Đúng `foodorder_dev`; digest 8 bảng nền và toàn bộ 150 sự kiện trước nhiệm vụ không đổi |

Lượt E2E đầu đạt 45/46: test mobile đo bounding box khi drawer còn slide-in (tọa độ
nút còn nằm ngoài viewport, dù scrollWidth vẫn 390). Đã sửa test chờ actionability/stability
bằng `tap({ trial: true })` trước đo; không sửa animation/layout để xử lý sai lệch phép đo.
Đã kiểm tra render thực tế bằng Chromium và ảnh guest; lượt chạy đầy đủ tiếp theo đạt 46/46.

Hai lượt E2E thêm tổng **74 sự kiện development**: 30 view và 44 add_to_cart, giữ lại sau
test. Mỗi lượt đầy đủ thêm 37 sự kiện. Riêng 10 ca US3.3 thêm 1 view và 6 add_to_cart
từ các thao tác xem/thêm hợp lệ để chuẩn bị hoặc thử thêm mới; mọi thao tác xóa tạo
**0 sự kiện mới**. Retry dùng cùng UUID và không thêm dòng trùng, giỏ đã xóa vẫn trống.

Database cuối có **224 sự kiện: 116 view, 108 add_to_cart, 0 purchase**. Vẫn 2 tài khoản,
6 danh mục, 9 món, 0 đơn hàng; không tạo bảng/tài khoản/món/đơn mới, không xóa sự kiện,
không DDL, seed, migration hoặc thao tác trên database khác. Cả 150 sự kiện cũ giữ nguyên
nội dung và timestamp, không chỉ đối chiếu số dòng.

Next.js có `ignoreBuildErrors: true` từ trước; TypeScript ở trên được chạy độc lập,
không suy ra từ thông báo build.

US3.3 **đủ điều kiện đánh dấu Done theo các tiêu chí của nhiệm vụ này**. Giữ kiến trúc
local state/ref và quy tắc US3.2. Các thay đổi có sẵn trước nhiệm vụ được giữ nguyên;
không stage, commit, push, merge, reset hard hoặc git clean.

## Điều kiện còn thiếu cho US4.1

Đã kiểm tra code hiện tại: có models/bảng `orders` và `order_items`, nhưng FastAPI chưa
có API tạo/đọc/cập nhật đơn. Checkout tạo mã HD từ Date.now và giữ thông tin local;
tracking dùng SAMPLE_ORDER/tiến trình cố định, admin dùng INITIAL_ORDERS/local state.

Trước khi nối US4.1 với dữ liệu thật cần:

1. Nguồn đơn thật từ luồng đặt hàng: lưu Order/OrderItem, mã đơn ổn định và chủ đơn từ JWT;
   backend kiểm tra món/tùy chọn và tự tính giá. Phối hợp story đặt hàng của nhóm.
2. API đọc đơn/trạng thái giới hạn đúng chủ sở hữu, xử lý thiếu/hết hạn token, không tìm
   được đơn và truy cập đơn của người khác; không dùng user_id do client khai.
3. Workflow cập nhật trạng thái thật cho vai trò được phép. Thống nhất mapping giữa
   quy trình nghiệp vụ và enum `pending/confirmed/preparing/delivering/completed/cancelled`;
   tracking hiện có các bước cố định, chưa phản ánh trạng thái lưu ở backend.
4. Frontend lấy trạng thái thật và có cơ chế refresh/phản hồi lỗi; thêm fixture đơn hợp lệ,
   test ownership và từng trạng thái. Cập nhật test ranh giới vốn đang xác nhận API đơn
   chưa tồn tại khi triển khai API mới, đồng thời giữ cấm khách tự ghi purchase/hoàn thành đơn.

Các phần trên chỉ được xác định làm điều kiện tiếp theo; không triển khai US4.1 trong lần này.

Sau lần nghiệm thu US3.3, phần đọc của US4.1 đã được triển khai riêng; xem
[US4_1_ORDER_TRACKING.md](US4_1_ORDER_TRACKING.md). Chưa có luồng tạo/cập nhật đơn thật;
các số liệu và giới hạn US3.3 ở trên giữ theo lần nghiệm thu US3.3.
