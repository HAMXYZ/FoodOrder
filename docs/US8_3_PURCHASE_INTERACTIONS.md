# US8.3 – Ghi nhận mua món khi đơn hoàn thành

## Trạng thái triển khai thực tế

**Đã triển khai schema, service purchase độc lập và kiểm thử. Chưa tích hợp vào luồng
hoàn thành đơn thật vì module đặt hàng/admin backend chưa tồn tại.**

Hiện có models `Order`, `OrderItem`, enum `COMPLETED` và `PaymentStatus.PAID`, nhưng:

- `BE/main.py` đã có GET xem đơn của chủ sở hữu (US4.1); chưa có API tạo đơn hoặc quản trị/cập nhật trạng thái đơn.
- Checkout tại `cart-drawer.tsx` tạo mã `HD-...`, thông tin theo dõi và xóa giỏ trong local
  state; không INSERT vào `orders` hoặc `order_items`.
- Admin tại `FE/app/admin/page.tsx` dùng `INITIAL_ORDERS` và `setOrders`. `advanceOrder`
  chỉ chuyển Mới → Đang nấu → Đang giao và dừng ở Đang giao, không ghi database.
- Các bước trong modal theo dõi là trạng thái giao diện demo, không chứng minh đơn đã hoàn thành.

Do đó không nối purchase vào nút checkout, không tạo endpoint để khách tự gửi purchase,
không dựng đơn hoàn thành giả trong `foodorder_dev`, và không tuyên bố đã đạt purchase E2E thật.
Frontend sản phẩm được giữ nguyên; chỉ thêm hai bài E2E kiểm tra ranh giới này.

## Schema bổ sung

Tái sử dụng `user_interactions`, không thêm bảng tương tác khác. Bổ sung:

| Cột | Định nghĩa |
|---|---|
| `order_id` | CHAR(36), nullable, FK → `orders.id`, RESTRICT |
| `order_item_id` | CHAR(36), nullable, FK → `order_items.id`, RESTRICT |
| `quantity` | INTEGER, nullable |

Các cột nullable để toàn bộ view/add_to_cart hiện có tiếp tục hợp lệ. CHECK
`ck_user_interactions_purchase_source` yêu cầu mọi dòng `purchase` có đủ hai nguồn tham chiếu
và quantity NOT NULL, lớn hơn 0. Trạng thái hoàn thành/thanh toán và quan hệ chủ đơn được
service đọc từ bảng nguồn; CHECK không thay thế kiểm tra nghiệp vụ giữa các bảng.

Giữ UNIQUE `event_id`; thêm UNIQUE `(event_type, order_item_id)` tên
`uq_user_interactions_purchase_item`. Mỗi order_item có tối đa một purchase dù dùng UUID khác.
View/add_to_cart có order_item_id NULL nên vẫn có nhiều thao tác độc lập. Khóa theo loại
cũng để lại khả năng tham chiếu dòng hàng cho phản hồi loại khác trong US8.4 sau này.

Thêm index `ix_user_interactions_order_time (order_id, created_at)` và
`ix_user_interactions_order_item (order_item_id)`. Các PK, index cũ và UTC DATETIME(6) giữ nguyên.
FK RESTRICT bảo vệ dấu vết nguồn; module đơn hàng sau này không được xóa dòng đã được tham chiếu.

## Service nội bộ và điểm tích hợp

```python
from purchases import record_completed_order_purchase

# Bên trong transaction của module đơn hàng thật, sau khi module đó đã kiểm tra
# quyền, chuyển trạng thái hoàn thành và xác nhận thanh toán thực tế:
await db.flush()
result = await record_completed_order_purchase(db, order_id)
# Chỉ báo thành công sau khi outer transaction commit.
```

`record_completed_order_purchase(db, order_id)` chỉ nhận session và mã đơn. Nó không nhận
user_id, dish_id, quantity hoặc trạng thái từ frontend/admin. Các bước:

1. Yêu cầu đang có outer transaction; service không tự commit.
2. Mở savepoint, đọc/khóa dòng Order bằng `FOR UPDATE`, dùng giá trị trong database.
3. Chỉ đủ điều kiện khi `order_status == COMPLETED` **và** `payment_status == PAID`.
   Điều kiện paid áp dụng yêu cầu không ghi khi thanh toán chưa hoàn tất, kể cả COD.
   Pending/confirmed/preparing/delivering/cancelled, unpaid/refunded đều không tạo tín hiệu mới.
4. Đọc/khóa các OrderItem thuộc đúng đơn. Không có dòng hoặc có quantity không dương thì
   từ chối toàn bộ batch; không âm thầm ghi một phần đơn lỗi.
5. Lấy user_id từ `Order.customer_id`, dish_id và quantity từ từng dòng thực tế.
   Không lọc `is_available`: một món từng mua vẫn hợp lệ nếu hiện đã ngừng bán.
6. Kiểm tra purchase đã có theo nguồn bền vững; nội dung khác chủ đơn/món/số lượng/nguồn
   gây `PurchaseSourceConflict`, không ghi đè.
7. Ghi các dòng còn thiếu trong cùng savepoint, `flush` một batch rồi trả kết quả.

**Quantity = 3 tạo một sự kiện có quantity = 3**, không tạo ba sự kiện và không tính reward.
Hai dòng cùng món nhưng khác order_item vẫn có hai sự kiện riêng để giữ nguồn/tùy chọn.

UUID mới là UUID v5 từ namespace cố định và order_item_id. Tuy nhiên cơ chế idempotency
chính vẫn là unique nguồn: service nhận diện một purchase cũ hợp lệ kể cả nếu writer cũ
dùng UUID khác. Replay giữ nguyên event_id, quantity và created_at của dòng cũ.

Kết quả `PurchaseResult` có order_id, eligible, created_count, duplicate_count, event_ids,
skipped_reason. Đây là kết quả đã stage trong transaction, chưa phải cam kết đã commit.
Đơn chưa hoàn thành trả eligible false / `order_not_completed`; thanh toán chưa paid trả
`payment_not_paid`. Không có HTTP purchase endpoint hoặc request purchase từ trình duyệt.

Ví dụ xử lý lại một đơn **đã hoàn thành thật**, trong backend tin cậy:

```python
from database import AsyncSessionLocal
from purchases import record_completed_order_purchase

async with AsyncSessionLocal.begin() as db:
    result = await record_completed_order_purchase(db, existing_order_id)
```

Đoạn này không tạo đơn hoặc chuyển trạng thái; thiếu đơn thì báo `PurchaseOrderNotFound`.
Khi module đơn hàng thật được xây dựng, ưu tiên gọi service trong cùng transaction cập
nhật trạng thái/thanh toán thay vì tách thành hai commit. Module đó phải kiểm tra quyền
admin/nhân viên và chuyển trạng thái hợp lệ trước khi ghi; khách không được tự đánh dấu hoàn thành.

## Atomicity, concurrency và phục hồi

- Service không commit/rollback outer transaction. Savepoint bảo đảm lỗi một dòng không
  để lại một phần batch purchase; lỗi được phát ra để caller rollback cả chuyển trạng thái.
- Nếu outer commit thất bại hoặc caller rollback sau khi service trả về, purchase cũng rollback.
- Trong MariaDB, khóa Order và các current read `FOR UPDATE` tuần tự hóa các worker cùng đơn.
  UNIQUE nguồn và UNIQUE event_id là lớp bảo vệ database, không chỉ SELECT trước INSERT.
- `PurchasePersistenceError` chỉ chứa thông báo an toàn và cờ `retryable`; không đưa SQL,
  thông tin kết nối hoặc mật khẩu vào lỗi. Caller có thể retry toàn bộ transaction mới khi
  gặp deadlock/lock timeout/duplicate race. Không retry vô hạn hoặc chỉ retry một INSERT bị lỗi.
- Sau khi xác nhận lại nguồn đã completed + paid, gọi lại service chỉ bổ sung dòng thiếu.
  Đã commit nhưng mất response sẽ trả duplicate, không tạo tín hiệu lần hai.
- Lỗi dữ liệu nguồn/conflict cần kiểm tra thủ công. Không tự sửa sự kiện cũ hoặc backfill
  dữ liệu đoán. Nếu completed nhưng unpaid, có thể xử lý lại sau khi thanh toán thực sự được xác nhận.

Chưa thêm job scheduler/outbox hoặc API recovery. Điểm recovery hiện là chính service nội bộ.
Các OrderItem đã hoàn thành cần được module đơn hàng bảo vệ khỏi sửa nguồn/số lượng;
service phát hiện sai khác trên replay và từ chối thay vì thay đổi lịch sử.

## Migration đã áp dụng

```bash
cd /home/giang/FoodOrder/BE
./.venv/bin/python -B migrate_purchase_sources.py
./.venv/bin/python -B migrate_purchase_sources.py --apply
```

Mặc định chỉ đọc. Script kiểm tra URL trước kết nối, rồi `SELECT DATABASE(), CURRENT_USER()`
đúng `foodorder_dev` / `foodorder_app` trước mọi thay đổi. Tài khoản hiện có đủ quyền.
Chỉ một ALTER bổ sung cột/constraint/index vào `foodorder_dev.user_interactions`, được biên
dịch từ metadata SQLAlchemy. Không CREATE đơn, không DML/backfill, không DROP/TRUNCATE/ghi đè.

Schema trước phải khớp US8.2 hoặc đã khớp US8.3. Schema lạ/partial, hoặc purchase cũ thiếu
nguồn, làm script dừng. Advisory lock tránh hai migration chạy cùng lúc. MariaDB có implicit
commit DDL; script không tự xóa/thu hẹp schema để rollback nếu kiểm chứng sau ALTER thất bại.

Đã chạy apply lần đầu: thêm ba cột, hai FK, unique nguồn, CHECK và hai index. Chạy lại:
0 bảng altered, 0 purchase tạo. Đối chiếu digest sáu trường tương tác ban đầu và toàn bộ
8 bảng nền xác nhận không đổi dữ liệu cũ. Không cần chạy lại init/seed cho migration này.

`init_database.py` được cập nhật để kiểm chứng nullable theo models và các CHECK mới;
khởi động FastAPI vẫn chỉ ping, không tự thay schema.

## Kiểm thử đã chạy

Backend cần dependency test riêng cho Async SQLite, production vẫn dùng asyncmy:

```bash
cd /home/giang/FoodOrder/BE
uv pip install --python .venv/bin/python -r requirements-test.txt
./.venv/bin/python -B -m unittest discover -s tests -v
```

```bash
source ~/.nvm/nvm.sh
nvm use 24
cd /home/giang/FoodOrder/FE
pnpm exec tsc --noEmit --incremental false
pnpm build
LD_LIBRARY_PATH=/tmp/foodorder-us81-browser/libs/usr/lib/x86_64-linux-gnu pnpm test:e2e
```

Thư viện Chromium riêng trong /tmp chỉ phục vụ kiểm thử và có thể mất sau reboot. Khi cần,
cài Chromium/OS dependencies theo Playwright. Không cần chúng để chạy website.

| Kiểm tra | Kết quả thực tế |
|---|---|
| Backend toàn bộ | **122/122 đạt**: 80 cũ + 34 service purchase + 8 migration |
| TypeScript độc lập | Đạt |
| Production build | Đạt; không có route purchase/order mới |
| Chromium E2E | **19/19 đạt**: 17 cũ + 2 kiểm tra ranh giới purchase |
| Migration apply/chạy lại | Thành công / noop, bảo toàn dữ liệu |
| Source FK/unique/CHECK MariaDB | Đã phản chiếu và đối chiếu đúng metadata |

Next.js giữ cấu hình ignoreBuildErrors cũ, nên kết quả TypeScript là lệnh độc lập đã chạy,
không suy ra từ build. Các test purchase dùng **AsyncSession/aiosqlite thật trong file
SQLite tạm**, có FK, CHECK, unique, explicit BEGIN và WAL. Hai worker được đồng bộ trước
INSERT; khóa/busy của SQLite được retry bằng transaction mới. Không giả vờ đây là phép thử
purchase live/concurrency trên MariaDB khi database chưa có đơn thật.

Hai E2E mới chứng minh: checkout demo không gửi purchase/không tạo đơn database; khách đã
đăng nhập không thể gửi purchase qua API hiện có hoặc gọi đường dẫn hoàn thành đơn.
Đây là kiểm thử phủ định ranh giới, **không phải positive E2E hoàn thành đơn thật**.

## Dữ liệu kiểm thử và bảo toàn

- Purchase mới trong `foodorder_dev`: **0**. `orders` và `order_items` vẫn 0 dòng.
- 65 sự kiện trước nhiệm vụ giữ nguyên toàn bộ giá trị; ba cột mới của chúng đều NULL.
- E2E regression thêm 26 sự kiện view/add_to_cart hợp lệ: 14 view + 12 add_to_cart.
- Database sau kiểm tra có 91 sự kiện: **58 view, 33 add_to_cart, 0 purchase**.
- Giữ nguyên nội dung 9 món, 6 danh mục, 2 tài khoản và mọi bảng nền. Không tạo tài khoản mới.
- Lượt backend cuối có 24 purchase fixture còn lại trước teardown, rồi hủy file SQLite.
  Những fixture này gồm cả các ca lỗi/conflict có chủ đích; không phải giao dịch mua thật.
  Không ghi bất kỳ fixture đơn hoàn thành/purchase nào vào MariaDB để báo hoàn thành US.

## Đối chiếu 14 yêu cầu kiểm thử

| Yêu cầu | Bằng chứng | Trạng thái |
|---|---|---|
| 1. Chuyển hoàn thành tạo purchase | Cập nhật completed + paid, flush, service và commit trong cùng transaction | Đạt cô lập; chưa có workflow thật |
| 2. Chờ xác nhận không ghi | Pending + các trạng thái chưa hoàn thành | Đạt |
| 3. Đang chuẩn bị không ghi | Preparing | Đạt |
| 4. Đã hủy không ghi | Cancelled | Đạt |
| 5. Nhiều dòng món | Đúng nguồn, món và số sự kiện | Đạt |
| 6. Quantity lớn hơn 1 | Quantity 3 → một dòng quantity 3 | Đạt |
| 7. Gọi lại không trùng | Cùng/khác outer transaction, ID và timestamp giữ nguyên | Đạt |
| 8. Xử lý đồng thời | Hai worker AsyncSession, unique nguồn và retry transaction | Đạt trên SQLite cô lập |
| 9. Hai tài khoản độc lập | Hai đơn, owner lấy từ nguồn database | Đạt |
| 10. Khách không giả mạo | API purchase không có, schema cũ từ chối, E2E HTTP | Đạt |
| 11. Lỗi chuyển trạng thái | Flush lỗi và outer rollback sau ghi đều không để purchase | Đạt |
| 12. Lỗi ghi/phục hồi | Trigger lỗi dòng sau, rollback cả batch/status; sửa lỗi và retry | Đạt cô lập |
| 13. US8.1/US8.2 còn đạt | 80 backend và 17 E2E cũ | Đạt |
| 14. Dữ liệu phát triển nguyên vẹn | So sánh digest cũ, count, nguồn NULL và 9 món | Đạt trên MariaDB |

## File sửa hoặc tạo

| File | Nội dung |
|---|---|
| `BE/models.py` | Cột/FK nguồn purchase, unique, CHECK và index |
| `BE/init_database.py` | Kiểm chứng nullable/CHECK, hỗ trợ kiểm tra metadata legacy |
| `BE/migrate_purchase_sources.py` | Migration bổ sung duy nhất trong foodorder_dev |
| `BE/purchases.py` | Service nội bộ, nguồn DB, idempotency, savepoint/transaction |
| `BE/requirements-test.txt` | Pin aiosqlite cho test AsyncSession cô lập |
| `BE/tests/test_interactions.py` | Tạo thêm bảng cha nguồn trong fixture, giữ nguyên assertions US8.1/US8.2 |
| `BE/tests/test_purchases.py` | 34 kiểm thử service/source/transaction/constraints |
| `BE/tests/test_purchase_migration.py` | 8 kiểm thử guard/noop/DDL/không sửa metadata |
| `FE/tests/e2e/purchase-boundary.spec.ts` | Hai E2E phủ định, không sửa UI sản phẩm |
| `docs/US8_3_PURCHASE_INTERACTIONS.md` | Thiết kế, vận hành, kiểm thử và phần chờ tích hợp |
| `docs/DEVELOPMENT_WSL.md`, `docs/AUTHENTICATION.md`, `docs/US8_1_VIEW_INTERACTIONS.md`, `docs/US8_2_CART_INTERACTIONS.md` | Liên kết trạng thái/schema/kiểm thử mới |

## Phần còn chờ và khả năng tái sử dụng

US8.3 **chưa hoàn thành tích hợp nghiệp vụ thật**. Còn cần module đặt đơn lưu Orders/Items,
API admin có phân quyền và quy tắc chuyển trạng thái/thanh toán thật; sau đó gọi service
cùng transaction và kiểm thử positive E2E bằng đơn được tạo theo nghiệp vụ thật.
Không tự viết các module đó trong phạm vi này và không tạo dữ liệu mua giả để vượt phụ thuộc.

US8.4 có thể tái sử dụng nguồn order/order_item, owner từ DB, UTC, unique theo loại/nguồn
và mẫu xử lý transaction. LinUCB có thể đọc loại sự kiện, user/dish, nguồn và quantity;
chưa xác định trọng số reward, chưa huấn luyện/cập nhật mô hình, chưa triển khai rating.

Không commit, push hoặc merge. Các thay đổi chưa commit từ trước được giữ nguyên.

## Cập nhật phụ thuộc US4.1

US4.1 hiện bổ sung GET đơn của chính khách hàng và tracking từ API, chưa tạo/cập nhật
đơn hoặc thanh toán. GET không gọi purchase service. Xem [US4_1_ORDER_TRACKING.md](US4_1_ORDER_TRACKING.md)
cho kết quả kiểm thử và phụ thuộc US3.4/US3.5, US7.1–US7.4 còn thiếu. Không tạo purchase
trong foodorder_dev để nghiệm thu tracking.

## Cập nhật phụ thuộc US8.4

US8.4 đã có service phản hồi rating độc lập, kiểm tra nguồn mua completed+paid và version
review; chưa có backend US5.1 hoặc adapter production. Không tạo order/rating/purchase giả,
không sửa user_interactions và chưa tính reward. Xem [US8_4_RATING_FEEDBACK.md](US8_4_RATING_FEEDBACK.md)
cho schema blueprint chưa deploy, cách chống trùng/thay thế phiên bản và điều kiện US9.2.

