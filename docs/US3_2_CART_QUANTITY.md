# US3.2 – Thay đổi số lượng món ăn trong giỏ hàng

## Phạm vi và căn cứ nghiệm thu

Thực hiện ngày 2026-11-08 trên nhánh `feature/linucb-restart`.
Đã đọc `AGENTS.md`, `FE/AGENTS.md`, `PROJECT_CONTEXT.md`, `US3_1_CART.md`,
kiểm tra trạng thái/diff Git và lưu snapshot các file có sẵn trước khi sửa.
Các thay đổi chưa commit của những công việc trước được giữ lại.

Trong tài liệu dự án hiện có, US3.2 nằm ở backlog nhưng chưa có bộ Acceptance Criteria
chi tiết riêng. Các yêu cầu US3.2 mà người dùng gửi, gồm phần bổ sung, là tiêu chí nghiệm thu.
Giữ kiến trúc React local state/ref và giao diện giỏ hiện tại; không thêm bảng/API giỏ.

## Hiện trạng và phần sửa

Trước đó đã có nút tăng/giảm, callback `updateQuantity`, tính thành tiền từng dòng,
tạm tính, phí giao hàng, voucher, tổng cộng và huy hiệu tổng số lượng.
Hai điểm chưa phù hợp US3.2: giỏ truyền `min=0`, callback xóa dòng khi nhận số lượng <=0;
callback cũng tự ép số >99 về 99. Các nút tính số mới từ prop của lần render trước nên
chưa bảo đảm giữ đủ các lần bấm trong cùng một batch.

Đã bổ sung hai helper thuần trong `FE/lib/cart.ts`:

- `updateCartItemQuantity`: chỉ cập nhật dòng có đúng key với số nguyên an toàn trong 1–99.
  Số âm/0/>99/số lẻ/NaN/chuỗi/null, key không tồn tại hoặc giá trị không đổi giữ nguyên giỏ.
  Không xóa dòng, thêm dòng, đổi giá hay sửa metadata của món.
- `stepCartItemQuantity`: nhận đúng +1/-1, tính từ số lượng trong snapshot hiện tại rồi
  dùng cùng quy tắc kiểm tra. Bảo toàn các dòng khác và dừng tại cả hai giới hạn.

`AppProvider.stepQuantity` đọc `currentCart.current` trên mỗi lần bấm và cập nhật ref
đồng bộ trước setter React. Các lần bấm liên tục không phụ thuộc prop số lượng cũ.
`updateQuantity` vẫn được giữ cho thao tác đặt số lượng tuyệt đối, dùng cùng helper kiểm tra.
Không có side effect trong functional state updater.

Giỏ truyền giới hạn 1/99 cho `QuantityStepper` và callback `onStep` mới. Nút giảm bị khóa
ở 1, nút tăng bị khóa ở 99. Cách sử dụng stepper trong modal chọn món của US3.1 giữ nguyên.
Các hàm tính tổng/huy hiệu đang hoạt động được tái sử dụng, không viết lại voucher/checkout.

Mỗi dòng được phân biệt bằng key món/size/tập topping/ghi chú đã có từ US3.1. Sửa số lượng
chỉ thay quantity và giữ `unitPrice`, tên, size, topping, ghi chú. Thành tiền là đơn giá
của dòng × số lượng; giá giỏ vẫn là giá hiển thị tạm thời. Đặt hàng thật sau này phải
kiểm tra lại món/giá phía backend theo phạm vi story đặt hàng.

Giỏ vẫn không lưu bền vững; reload làm mất giỏ. Đổi số lượng không gọi API món hoặc
API tương tác, nên vẫn hoạt động nếu mạng/API tạm không truy cập được.

## Đối chiếu tiêu chí

| Tiêu chí | Cách đáp ứng / kiểm thử |
|---|---|
| Tăng 1 lên 2, giảm 2 xuống 1 | Unit và E2E xác minh quantity, thành tiền, huy hiệu, tổng |
| Không giảm dưới 1 hoặc tự xóa | Khóa nút tại 1; helper từ chối <=0; test giữ nguyên dòng |
| Không tăng quá 99 | Khóa nút tại 99; helper từ chối >99, không tự ép dữ liệu sai |
| Từ chối số lượng không hợp lệ | Unit kiểm tra số âm, 0, lẻ, quá lớn, NaN/Infinity, chuỗi/null |
| Giao diện cập nhật ngay | State/ref đồng bộ; E2E kiểm tra DOM sau từng thao tác |
| Thành tiền và tổng giỏ chính xác | E2E cả món mặc định/tùy chọn, ngưỡng freeship và voucher có sẵn |
| Huy hiệu tổng số lượng chính xác | E2E đối chiếu nút giỏ và tiêu đề khi tăng/giảm |
| Món A không ảnh hưởng món B | Unit kiểm tra reference/metadata; E2E nhiều món |
| Cùng món khác tùy chọn độc lập | Key riêng; unit/E2E đổi từng dòng, giữ giá tùy chọn |
| Bấm liên tục không mất cập nhật | Burst 30 lần tăng, 10 lần giảm trong một JS task; không chờ từng render |
| Không ghi add_to_cart khi chỉnh | E2E đăng nhập, theo dõi request và đối chiếu digest toàn bộ sự kiện |
| Không hỏng US3.1/US8.1/US8.2 | Chạy lại các unit/E2E và toàn bộ backend tests hiện có |
| Giữ kiến trúc hiện tại | React local state/ref; không DDL, migration, backend cart hoặc lưu bền vững |

## Ranh giới với các story khác

Không đổi JWT, cookie HttpOnly, proxy xác thực, UUID/retry hoặc cơ chế chống ghi trùng.
`stepQuantity`/`updateQuantity` không gọi bộ ghi tương tác. Thêm món qua US3.1 vẫn phát
một US8.2 sau thành công; retry tương tác không sửa giỏ.

Giảm tại 1 giữ nguyên dòng. Nút xóa riêng và luồng demo checkout có sẵn giữ nguyên,
không triển khai hoặc nghiệm thu US3.3/US4.1 ở đây. Không triển khai thêm US8.3 hay LinUCB.

## Chạy kiểm thử

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

E2E cần hai server đang chạy và MariaDB XAMPP Windows sẵn sàng; xem
[DEVELOPMENT_WSL.md](DEVELOPMENT_WSL.md). Các ca mới dùng lại hai tài khoản thử riêng
ở cache ngoài repository; không in mật khẩu/JWT, không ghi trace/video/screenshot xác thực.
Unit tests không cần browser/server/database. Backend tests dùng SQLite tạm.

Sau khi WSL khởi động lại, thư viện Chromium tạm của lần US3.1 không còn. Đã tải và giải
nén libnss3/libnspr4/libasound2t64 trong `/tmp/foodorder-us32-browser/libs` để chạy E2E,
không thay package hệ thống. Đường dẫn này có thể mất sau reboot; trên máy khác cần
chuẩn bị dependencies Chromium tương ứng theo Playwright.

## File thay đổi

| File | Thay đổi |
|---|---|
| `FE/lib/cart.ts` | Hai helper kiểm tra/cập nhật số lượng và bước tăng/giảm |
| `FE/components/food/app-state.tsx` | Tái sử dụng helper; callback bước đọc snapshot mới nhất |
| `FE/components/food/cart-drawer.tsx` | Giới hạn 1–99, nối callback bước cho từng dòng |
| `FE/components/food/food-detail-modal.tsx` | Stepper dùng chung hỗ trợ max/onStep, giữ mặc định modal cũ |
| `FE/tests/unit/cart-quantity.spec.ts` | 8 ca logic số lượng, boundary, bất biến và burst |
| `FE/tests/e2e/us32-cart.spec.ts` | 8 ca GUI, tổng tiền, tùy chọn, offline, burst, pending add và telemetry |
| `docs/US3_2_CART_QUANTITY.md` | Phạm vi, thiết kế, tiêu chí và bằng chứng nghiệm thu |
| `docs/US3_1_CART.md`, `docs/DEVELOPMENT_WSL.md` | Liên kết trạng thái US3.2, giữ số liệu nghiệm thu cũ |

## Kết quả thực tế

| Kiểm tra | Kết quả |
|---|---|
| Backend đầy đủ | **122/122 đạt**, chỉ dùng SQLite tạm |
| Unit giỏ hàng | **24/24 đạt**: 16 ca US3.1 cũ + 8 ca số lượng mới |
| TypeScript độc lập | `tsc --noEmit --incremental false` đạt |
| Production build | `pnpm build` đạt |
| E2E Chromium đầy đủ | **36/36 đạt**: 28 ca cũ + 8 ca US3.2 mới |
| Hồi quy | Đạt US3.1, US8.1, US8.2, xác thực và ranh giới purchase đã có |
| Chạy E2E riêng bằng grep | Ca tăng 1 → 2 → 1 đạt; audit không đòi các setup của ca bị bỏ qua |
| Database | Đúng `foodorder_dev`; digest 8 bảng nền và 120 sự kiện có trước không đổi |

Next.js vẫn có `ignoreBuildErrors: true` từ trước; kết quả TypeScript ở trên là lệnh
độc lập đã chạy, không suy ra từ build.

Một lượt E2E đầy đủ thêm 30 sự kiện development: 14 view và 16 add_to_cart.
Riêng các ca US3.2 chỉ thêm **một add_to_cart từ thao tác thêm món chuẩn bị giỏ** của
ca có đăng nhập; mọi thao tác tăng/giảm sau đó tạo **0 sự kiện mới**. Ca chạy riêng
bằng grep dùng khách chưa đăng nhập và không thêm sự kiện nào.

Database cuối có 150 sự kiện: 86 view, 64 add_to_cart, 0 purchase; vẫn 2 tài khoản,
6 danh mục, 9 món và 0 đơn hàng. Không DDL, seed, migration, UPDATE/DELETE hoặc xóa dữ liệu
test. Giữ các sự kiện thử nghiệm mới để kiểm chứng; không thay database khác.

US3.2 **đủ điều kiện đánh dấu Done theo các tiêu chí đã nhận**. Bố cục giỏ và kiến trúc
local state/ref được giữ lại. Không commit, push hoặc merge. Phần xóa món riêng vẫn cần
nghiệm thu ở US3.3; không gộp việc giảm tại 1 với hành vi xóa.

US3.3 được thực hiện sau lần nghiệm thu này; xem [US3_3_CART_REMOVAL.md](US3_3_CART_REMOVAL.md)
cho cơ chế xóa/hủy request cũ và kiểm thử mới. Quy tắc giảm tại 1 của US3.2 giữ nguyên.
