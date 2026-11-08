# US8.4 – Sử dụng điểm đánh giá làm phản hồi

## Hiện trạng và phạm vi thực tế

Thực hiện ngày 2026-11-08 trên nhánh `feature/linucb-restart`. Đã đọc AGENTS, PROJECT_CONTEXT,
tài liệu US8.1–US8.3, models/services/API/frontend liên quan, kiểm tra Git status/diff và lưu
snapshot trước sửa. Các thay đổi chưa commit của công việc trước được giữ nguyên.

**US5.1 chưa có backend thật**: không có model/bảng Review/Rating hay API ghi đánh giá.
Đã xác minh database `foodorder_dev` có đúng 9 bảng, không có bảng/cột rating/review/feedback.
Điểm 4.x trong FOODS/admin là dữ liệu mẫu tổng hợp; menu từ API ánh xạ rating = 0 và hiển thị
chưa có đánh giá. Không có nguồn đánh giá cá nhân đã xác minh để làm phản hồi AI thực tế.

Do đó chỉ triển khai service nội bộ, hợp đồng adapter, schema blueprint và kiểm thử cô lập.
Không xây US5.1, không thêm endpoint rating, không tạo review/đơn hoàn thành trong development.
**Chưa Done end-to-end và chưa có dữ liệu rating thật cho US9.2.**

## Luồng xác minh nguồn

`BE/rating_feedback.py` cung cấp:

- `RatingSourceAdapter`: abstract adapter backend, chưa có implementation production.
  Nó phải đọc review đã lưu bằng cùng AsyncSession và `FOR UPDATE`, lấy ID/chủ sở hữu/
  món/dòng mua/điểm/revision/thời gian/trạng thái từ dòng nguồn thật. Không tạo adapter từ JSON.
- `record_verified_rating(db, source_id, authenticated_user, *, source=adapter)`:
  chỉ nhận ID nguồn và principal do backend xác thực, không nhận stars/dish_id/user_id hoặc
  cờ verified từ request. Principal phải lấy qua JWT `get_current_user` ở module US5.1 tương lai.
- `current_rating_signals(db, *, source=adapter)`: snapshot nội bộ của các nguồn hiện hành
  còn hợp lệ, dành cho module cá nhân hóa tương lai. Không có HTTP reader công khai.

Không có adapter thật hoặc truyền dict `{verified: true}` đều bị từ chối trước khi truy vấn
bảng feedback chưa triển khai. Không có fallback lấy sao từ menu, client hay user_interactions.

Service kiểm tra lại nguồn, không chỉ tin trạng thái published:

1. Review tồn tại, đúng ID, đã published theo backend; revision nguyên dương, thời gian có timezone.
2. Điểm là **int từ 1 đến 5**; không ép bool, float hoặc chuỗi số thành sao hợp lệ.
3. Chủ review trùng principal xác thực; chủ đó còn active và có role customer trong database.
4. OrderItem tồn tại, đúng món và thuộc Order của chính chủ review, quantity dương.
5. Order đã **COMPLETED và PAID**, nhất quán điều kiện mua đã dùng trong US8.3.
   Pending/cancelled/unpaid/refunded không tạo phản hồi. Không tự chuyển trạng thái/thanh toán.
6. Không lọc món đã ngừng bán khỏi lịch sử mua hợp lệ. US9.4 vẫn phải lọc ứng viên gợi ý sau này.

Quy tắc eligibility này cần được đối chiếu với US5.1 khi tích hợp. Module đánh giá của nhóm
vẫn phải chịu trách nhiệm xác thực JWT, quyền sửa và tính duy nhất của review theo quy tắc
nghiệp vụ; không tạo ID review mới cho mỗi lần gửi lại/sửa cùng một đánh giá.

## Cấu trúc dữ liệu

Giữ **điểm gốc 1–5** đã kiểm tra, `rating_scale = (1, 5)` và `schema_version = 1`.
Chưa chọn phép biến đổi sang reward 0–1, trọng số giữa view/cart/purchase/rating hoặc cập nhật
mô hình. US9.2 sẽ quyết định chính sách reward riêng sau khi thống nhất yêu cầu.

Blueprint `rating_feedback_versions` dùng SQLAlchemy MetaData **tách khỏi Base.metadata**:

| Trường | Ý nghĩa/ràng buộc |
|---|---|
| feedback_id | UUID v5 xác định từ namespace + source_id + revision; PK |
| source_namespace | Namespace adapter backend cố định, tối đa 32 ký tự |
| source_id | ID review nguồn canonical, tối đa 128 ký tự; có thể ánh xạ UUID/ID số của US5.1 |
| source_revision | Số nguyên dương; UNIQUE cùng namespace/source_id |
| user_id, dish_id | FK tới users/dishes, RESTRICT |
| order_item_id | FK tới dòng mua thật, RESTRICT |
| rating | CHECK 1–5; service yêu cầu đúng kiểu int |
| source_updated_at | Timestamp nguồn, chuẩn hóa UTC |
| recorded_at | UTC do service tạo khi ghi phiên bản mới |
| schema_version | CHECK = 1, phiên bản hợp đồng dữ liệu |
| supersedes_id | FK tới feedback phiên bản trước, RESTRICT; nullable cho lần đầu |

Không thêm cột/loại rating vào `user_interactions`; toàn bộ view/cart/purchase giữ cấu trúc
và dữ liệu cũ. Registry riêng phù hợp lịch sử nhiều phiên bản và snapshot thay thế, thay vì
biến mỗi lần sửa sao thành một tín hiệu cộng dồn trong event stream cũ.

**Blueprint chưa được tạo trong foodorder_dev. Không có migration được chạy hoặc CLI apply
mới.** Nó chỉ được tạo trong SQLite cô lập. Không thêm vào metadata startup/init_database.
Khi schema nguồn US5.1 đã rõ, cần migration không phá hủy dữ liệu: kiểm tra target foodorder_dev,
đối chiếu FK/kiểu ID nguồn và tạo bảng mới có kiểm chứng. Hiện chưa thể FK trực tiếp tới review
vì bảng nguồn chưa tồn tại; adapter/source validation là điểm tích hợp được kiểm thử.

## Retry, sửa đánh giá và tính nguyên tử

- Cùng nguồn/revision/nội dung trả `duplicate=True`, giữ ID và recorded_at cũ; không INSERT lại.
- Sửa điểm phải tăng revision từ backend. Service append phiên bản mới, đặt supersedes_id,
  không UPDATE/DELETE phiên bản cũ. Cho phép bỏ qua revision trung gian khi đồng bộ lại nguồn.
- Cùng revision nhưng điểm/timestamp khác hoặc revision lùi gây `RatingRevisionConflict`.
  Không ghi đè. Chủ sở hữu, món và dòng mua của cùng source_id không được thay sang nguồn khác.
- UNIQUE source/revision và PK UUID bảo vệ cả request đồng thời. Adapter/source và purchase
  dùng current read/khóa MariaDB; lỗi race/deadlock được trả bằng `RatingPersistenceError`
  an toàn, có cờ retryable. Caller rollback và thử lại toàn bộ bằng transaction mới có giới hạn.
- Cần outer transaction và source đã flush, không còn db.new/dirty/deleted. Service dùng savepoint,
  không tự commit/rollback outer transaction hoặc tự lưu review. Caller phải propagate lỗi và
  rollback **cả chỉnh review lẫn feedback**; chỉ báo thành công sau outer commit.

Điểm tích hợp tương lai, sau khi US5.1 đã xác thực và lưu review thật trong transaction của nó:

```python
await db.flush()
result = await record_verified_rating(
    db, str(review.id), current_user, source=verified_reviews_adapter,
)
# US5.1 quản lý commit/rollback của toàn bộ transaction; chưa có adapter thật để chạy đoạn này.
```

Nếu caller bỏ lỡ đồng bộ một review vừa sửa/thu hồi, reader không tiếp tục trả feedback cũ:
nó kiểm tra lại nguồn và purchase, bỏ qua bản ghi mất nguồn, unpublished/removed, user inactive,
khác revision/điểm/timestamp hoặc không còn eligible. Lịch sử feedback vẫn được giữ nguyên.

## Hợp đồng tiêu thụ cho US9.2

`current_rating_signals` trả tối đa **một phiên bản hiện hành trên mỗi review nguồn**.
Mỗi signal có source_key `(namespace, source_id)`, revision, user/dish, điểm, thang điểm và lineage.

Learner tương lai phải reconcile **toàn bộ namespace snapshot**: thay đóng góp theo source_key/
revision và loại bỏ đóng góp của key vắng mặt. Có thể rebuild từ snapshot nếu chưa hỗ trợ
đảo đóng góp. Không quét mọi phiên bản rồi cộng như các reward độc lập, hoặc cộng lại cùng
snapshot mỗi lần đọc. US8.4 chưa triển khai checkpoint, phép đảo, training hoặc reward policy.

**Đã sẵn sàng làm interface tích hợp/test cho US9.2, chưa đủ điều kiện dùng production.**
Cần US5.1 persistence + adapter xác minh nguồn thật, source revision/uniqueness, migration
registry được kiểm chứng, luồng đơn/thanh toán thật (US3.5/US7), rồi kiểm thử end-to-end.
Chính sách reward và cách xử lý revision trong learner phải được chốt trước khi huấn luyện.

## Kiểm thử và file thay đổi

| File | Nội dung |
|---|---|
| `BE/rating_feedback.py` | Blueprint tách metadata, source contract, kiểm tra mua/chủ sở hữu, ghi revision và reader snapshot |
| `BE/tests/rating_fixtures.py` | Adapter đọc review từ bảng riêng, chỉ tạo trong SQLite test |
| `BE/tests/test_rating_feedback.py` | 36 ca dữ liệu nguồn, sao, auth, phiên bản, concurrency/rollback và bảo toàn dữ liệu |
| `FE/tests/e2e/rating-boundary.spec.ts` | 2 ca chặn giả rating qua HTTP với/không có cookie, audit dữ liệu không đổi |
| `docs/US8_4_RATING_FEEDBACK.md` | Thiết kế, giới hạn, kết quả và điểm tích hợp |
| `docs/US8_3_PURCHASE_INTERACTIONS.md`, `docs/DEVELOPMENT_WSL.md` | Liên kết trạng thái mới, giữ kết quả lịch sử |

Không sửa models/schema/API/auth/giỏ/tracking hoặc chức năng đánh giá của thành viên khác.
Fixtures completed/paid/review chỉ có trong database test cô lập; không ghi vào MariaDB.

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

E2E cần hai server và XAMPP chạy; dùng tài khoản thử riêng ở cache ngoài repo, không in token/
mật khẩu hoặc ghi trace/video/screenshot xác thực. Thư viện Chromium /tmp có thể mất sau reboot.

## Kết quả thực tế

| Kiểm tra | Kết quả |
|---|---|
| Backend đầy đủ | **179/179 đạt**: 143 ca cũ + 36 ca US8.4 |
| Frontend unit hiện có | **40/40 đạt**, gồm giỏ hàng và API tracking |
| TypeScript độc lập | `tsc --noEmit --incremental false` đạt |
| Production build | `pnpm build` đạt |
| E2E đầy đủ | **59/59 đạt**: 57 ca cũ + 2 boundary tests US8.4 |
| US8.4 qua HTTP | Không có rating/review/feedback endpoint; thiếu/sai JWT bị chặn ở endpoint tương tác, JWT hợp lệ vẫn không ghi được rating/giả user_id |
| Tính nguyên tử/chống trùng | Replay, chỉnh điểm, cùng revision khác nội dung, request đồng thời + retry mới, outer rollback và ràng buộc SQL đều đạt |
| Dữ liệu cũ | Digest toàn bộ 8 bảng nền và 261 sự kiện cũ giữ nguyên, gồm nội dung/timestamp |
| Schema thực tế | Vẫn đúng 9 bảng; không có Review/Rating hoặc rating_feedback_versions; không chạy DDL/migration |

Next.js vẫn có `ignoreBuildErrors: true` từ trước; TypeScript được chạy độc lập, không suy
ra từ build. Không thay cấu hình hoặc source frontend sản phẩm trong nhiệm vụ này.

Database cuối có **298 sự kiện: 146 view, 152 add_to_cart, 0 purchase**. Bộ hồi quy cũ thêm
37 tương tác hợp lệ (15 view, 22 add_to_cart); hai boundary tests US8.4 không thay đổi bản ghi
nào. Vẫn 2 tài khoản, 6 danh mục, 9 món, 0 orders/order_items; không tạo điểm đánh giá hoặc
đơn hoàn thành giả trong foodorder_dev, không xóa dữ liệu test.

Các bảng nguồn/feedback và trạng thái completed+paid phục vụ US8.4 chỉ được tạo trong SQLite
cô lập rồi hủy cùng fixture. Registry thực tế, adapter US5.1 và nghiệm thu luồng đánh giá
thật chưa tồn tại; không suy diễn kết quả fixture thành Done end-to-end.

## Kết luận trạng thái

Phần US8.4 độc lập đã được triển khai để tích hợp nguồn US5.1 tương lai. **Chưa Done end-to-end**,
chưa có rating thật trong development, chưa đưa reward vào mô hình. Không tạo API công khai
ghi feedback, không tự xây US5.1 hoặc LinUCB. Không commit/push/merge và giữ thay đổi chưa commit cũ.
