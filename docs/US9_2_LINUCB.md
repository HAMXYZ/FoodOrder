# US9.2 – Xếp hạng món bằng LinUCB

## Phạm vi và trạng thái

Đã triển khai thuật toán **shared LinUCB thật**, encoder context, interface nội bộ,
checkpoint và kiểm thử độc lập. Đây là phần lõi của US9.2, chưa phải tính năng gợi ý
cá nhân hóa end-to-end trên website. Không có API mới, không thay đổi giao diện,
không đọc sự kiện để tự học và không áp dụng reward production.

Các yêu cầu đối chiếu là mục 6.3 `PROJECT_CONTEXT.md` và yêu cầu US9.2 người dùng
cung cấp. Repository chưa có bộ Acceptance Criteria riêng chi tiết hơn cho US9.2.
Có bản LinUCB 9 chiều trong phần untracked của `stash@{0}`; đã đọc bằng `git show`,
không restore/pop stash hoặc chép đè các module đang có.

US8.1/US8.2 đang có dữ liệu thật. US8.3 có service kiểm chứng completed+paid nhưng
chưa có luồng đơn thật; US8.4 có interface nguồn đánh giá đã xác minh nhưng US5.1
chưa có backend thật. Không sử dụng sao mẫu, purchase giả hoặc rating giả để học.

## Thuật toán và ý nghĩa arm

- Một **arm là một dish_id**. Một cặp lịch sử người dùng–món tạo một vector `x`.
- Shared LinUCB dùng chung `A`, `b`, `theta` cho các arm, thay vì một mô hình riêng
  cho mỗi món. Cách này chia sẻ thông tin thuộc tính giữa các món khi phản hồi ít.
- Mô hình chỉ phân biệt được các món qua đặc trưng đã mã hóa. Hai món có cùng
  thuộc tính và ngữ cảnh sẽ hòa điểm, chưa có tham số riêng để ghi nhớ từng dish_id.
- Xếp hạng dựa trên điểm LinUCB giảm dần; hòa điểm chính xác thì theo chuỗi dish_id
  tăng dần, không phụ thuộc thứ tự database, không làm tròn trước khi so sánh.

Khởi tạo `A = lambda * I`, `b = 0`. Mặc định `alpha = 1`, `lambda = 1`.
Đây là giá trị khởi đầu cấu hình được, chưa được tối ưu bằng dữ liệu thực tế.

```text
theta = solve(A, b)
mean(x) = x.T @ theta
uncertainty(x) = sqrt(x.T @ solve(A, x))
bonus(x) = alpha * uncertainty(x)
score(x) = mean(x) + bonus(x)

A_new = A + outer(x, x)
b_new = b + reward * x
```

Code dùng float64 và Cholesky `A = L L.T`:
`theta = solve(L.T, solve(L, b))`, `uncertainty = ||solve(L, x)||2`.
Không tính nghịch đảo hoặc dùng pseudo-inverse. `alpha >= 0`, `lambda > 0` phải
hữu hạn. Khi `alpha=0`, xếp hạng chỉ theo exploitation. A bất đối xứng, suy biến
hoặc không xác định dương bị từ chối; không tự thêm jitter hoặc đổi thuật toán.
Tính đủ A/b/Cholesky/theta mới trước khi cập nhật, nên lỗi số học giữ nguyên state.

Tham khảo công thức UCB và cập nhật sufficient statistics trong
[Li et al. (2010)](https://www.schapire.net/papers/www10.pdf).
Biến thể ở đây dùng tham số chia sẻ cho toàn bộ arm, không phải bản disjoint của
Algorithm 1 trong bài báo. Cách giải hệ sử dụng tài liệu chính thức của
[NumPy solve](https://numpy.org/doc/stable/reference/generated/numpy.linalg.solve.html)
và [Cholesky](https://numpy.org/doc/stable/reference/generated/numpy.linalg.cholesky.html).

## Context v1: 28 chiều

Vocabulary mặc định được cố định theo 6 category hiện có trong `foodorder_dev`:
1 Cơm, 2 Bún & Phở, 3 Bánh mì, 4 Trà sữa, 5 Món chay, 6 Trà trái cây.
Mỗi schema lưu **thứ tự ID**, không mã hóa bằng tên hoặc phép chia dư ID.
Category thiếu hoặc ID mới dùng bucket `unknown`; kích thước không tự tăng.
Thay vocabulary/thứ tự/cap cần schema và mô hình mới hoặc migration chủ động.

Với `C = số category đã biết + 1`, `dimension = 14 + 2*C`.
Mặc định C=7, dimension=28; thứ tự chỉ số bắt đầu từ 0:

| Chỉ số | Đặc trưng | Quy tắc |
|---|---|---|
| 0 | bias | 1 |
| 1–7 | category one-hot | 6 ID và unknown |
| 8–11 | price, calories, spiciness, vegetarian | Chuẩn hóa về [0,1] |
| 12–15 | missing flag cho 4 số trên | Thiếu=1; giá trị mã hóa=0 |
| 16–22 | user–dish category affinity | one-hot × tỷ lệ category trong lịch sử |
| 23–26 | user–dish numeric similarity | `1 - abs(dish_norm - history_mean)`; thiếu=0 |
| 27 | history_present | Có quan sát=1, chưa có=0 |

- Price: `min(base_price / 200000 VND, 1)`, chấp nhận Decimal từ SQLAlchemy.
- Calories: `min(calories / 1000 kcal, 1)`.
- Spiciness: integer 0–3 chia 3. Vegetarian: bool thật thành 0/1.
- `None` là thiếu, không coi là số 0 đã quan sát. Giá/calorie âm, bool thay số,
  chuỗi, độ cay ngoài miền, NaN/Infinity bị từ chối.
- `DishFeatures.from_model(dish)` lấy scalar hiện có của `models.Dish` đã load,
  không lazy-load relationship hoặc truy vấn database.
- `FeatureEncoder.profile(observations)` tóm tắt không trọng số các snapshot món:
  tỷ lệ category và trung bình riêng từng thuộc tính đã quan sát, bỏ qua None.
  Đây là context lịch sử, **không phải reward**, không khẳng định sở thích thật.
- Chưa có history reader production. Caller tương lai phải giới hạn lịch sử đúng
  người dùng lấy từ JWT và cutoff trước quyết định; không nhận profile/user_id
  tùy ý từ client. Schema hiện tại chưa lưu thuộc tính lịch sử của món trong
  `user_interactions`; nếu reader dùng thuộc tính món hiện tại thì phải ghi rõ
  đó là phép dựng lại, không khẳng định là giá/thuộc tính ở thời điểm quá khứ.
- Không có lịch sử: affinity/similarity/history_present bằng 0. Không tự bịa sở
  thích hoặc áp dụng popularity fallback. Chiến lược cold-start đầy đủ thuộc US9.3.

`FeatureSchema.fingerprint` băm version, vocabulary, cap và tên/thứ tự đặc trưng.
Context/profile khác fingerprint bị từ chối, kể cả cùng dimension. Mỗi kết quả
`ScoredArm` giữ `DecisionContext` bất biến (arm_id, schema_id, tuple vector), điểm
mean/uncertainty/bonus/score và model_revision. Update dùng **vector đã chấm điểm**,
không tính lại từ giá món hoặc lịch sử đã thay đổi. Vector này chưa được ghi vào
database hoặc gửi đến frontend.

## Interface, dữ liệu và giới hạn cập nhật

| File | Trách nhiệm |
|---|---|
| `BE/linucb.py` | SharedLinUCB, snapshot context/score, kiểm tra số học và checkpoint JSON |
| `BE/linucb_features.py` | Schema, DTO món, lịch sử và encoder cố định |
| `BE/linucb_service.py` | LinUCBRanker ghép encoder/model; rank, update_simulation, save/load |
| `BE/linucb_demo.py` | Ví dụ fixture trong RAM, không truy cập .env/DB/sự kiện |
| `BE/requirements-ai.txt` | NumPy 2.5.4, Python >=3.12 |
| `BE/requirements-test.txt` | Bao gồm requirements-ai.txt để cài đủ dependency cho test |
| `BE/tests/test_linucb.py` | Kiểm thử công thức, context, simulation guard và checkpoint |
| `docs/US9_2_LINUCB.md` | Thiết kế, nghiệm thu và giới hạn tích hợp |

Ví dụ interface nội bộ cho dữ liệu đã được backend kiểm soát:

```python
from linucb_features import DishFeatures
from linucb_service import LinUCBRanker

ranker = LinUCBRanker()  # purpose="serving", chỉ đọc
candidates = [DishFeatures.from_model(dish) for dish in already_loaded_dishes]
profile = ranker.encoder.profile(verified_history_snapshots)
ranked = ranker.rank(candidates, profile=profile, top_k=6)
# ranked[i].arm_id, .score, .exploitation, .exploration, .context
```

Ứng viên `is_available=False/None` bị bỏ qua. Đây là guard tối thiểu để không trả
món hết bán, chưa triển khai đầy đủ US9.4. Danh sách rỗng/top_k=0 trả []; top_k âm,
không phải integer và dish_id trùng bị từ chối.

`SharedLinUCB.update(context, reward)` là primitive toán học với reward thực hữu
hạn được truyền **tường minh**. Cho phép reward 0/âm trong simulation; chưa đặt
miền hoặc trọng số reward production. `LinUCBRanker.update_simulation(decision,
reward=...)` dùng đúng context cũ. Cả hai chỉ chạy khi `purpose="simulation"`.
Mặc định `serving` chặn mọi update. Không có public train/reward endpoint, không
đọc JWT/user_id ở module này vì chưa có API theo tài khoản.

Không nối view/add_to_cart/purchase/rating vào mô hình. Không ghi/sửa/xóa các event
US8.1–US8.4 và không tạo reward từ sao mẫu. Primitive cập nhật không chống gọi lặp:
gọi lại cùng x/reward sẽ cập nhật lần nữa đúng phép toán. US9.5 tương lai cần
decision/context log, idempotency, policy/reward version, checkpoint tiến độ và
cơ chế xử lý feedback đến muộn. Rating chỉnh sửa phải đọc snapshot mới nhất từ
US8.4 rồi reconcile/rebuild, không cộng lặp mọi revision như reward mới độc lập.

## Lưu/khôi phục

`ranker.save(path)` ghi bundle JSON có version, encoder đầy đủ, schema fingerprint,
dimension, algorithm, alpha/lambda, purpose, A, b, revision. Không dùng pickle hoặc
thực thi mã từ file. Có SHA256 kiểm tra hỏng dữ liệu; checksum **không xác thực
nguồn file**. Chỉ đọc artifact local đáng tin, không nhận checkpoint upload công khai.

Ghi tệp tạm cùng thư mục, mode 0600, flush/fsync rồi publish nguyên tử. Mặc định
create-if-absent, không ghi đè state có sẵn; `overwrite=True` phải được caller chủ
động yêu cầu. Load giới hạn 8 MiB, dimension 1–512, regular file, không symlink;
kiểm tra version, khóa JSON trùng, checksum, kiểu số, shape, finite, symmetry/SPD.

```python
ranker.save("/trusted/model-v1.json")  # thư mục phải tồn tại
restored = LinUCBRanker.load(
    "/trusted/model-v1.json",
    expected_schema=ranker.schema,
    expected_purpose="serving",
)
```

Load buộc caller khai báo schema và purpose mong đợi. Checkpoint simulation không
load thành serving. Không tạo state file tự động trong repo. `RLock` bảo vệ
score/rank/update/snapshot giữa thread trong một process; chưa có khóa nhiều
process hoặc training worker production. US9.5 cần thiết kế single-writer hoặc
coordination trước khi nhiều worker cùng ghi checkpoint.

## Ví dụ số đã chạy

Chạy `./.venv/bin/python -B linucb_demo.py` trong BE. Đây là **fixture 2 chiều** để
tính tay, khác encoder 28 chiều của món. Không đọc DB và không tạo file model.

`alpha=0.5, lambda=1, x_A=(1,0), x_B=(0,1)`. Ban đầu A=I, b=0:

| Món | Mean trước | Bonus trước | Score trước | Mean sau | Bonus sau | Score sau |
|---|---:|---:|---:|---:|---:|---:|
| dish-a | 0 | 0.5 | 0.5 | 0 | 0.5 | 0.5 |
| dish-b | 0 | 0.5 | 0.5 | 0.5 | 0.35355339 | 0.85355339 |

Sau **một reward giả lập 1 cho dish-b**: A=diag(1,2), b=(0,1), theta=(0,0.5).
Thứ tự trước: dish-a, dish-b (tie theo ID); sau: dish-b, dish-a.
Test riêng dùng hệ không chéo A=[[2,1],[1,3]], b=[1,2], x=(1,2):
theta=(0.2,0.6), mean=1.4, variance=1.4, score=1.9916079783099616.
Một test khác huấn luyện bằng fixture với hai lịch sử category khác nhau và chứng
minh cùng hai món có thứ tự ưu tiên khác nhau. Chưa chứng minh cá nhân hóa dữ liệu thật.

## Chạy và nghiệm thu

```bash
cd /home/giang/FoodOrder/BE
uv pip install --python .venv/bin/python -r requirements-ai.txt
# Khi chuẩn bị môi trường kiểm thử: requirements-test.txt gồm cả aiosqlite và NumPy.
uv pip install --python .venv/bin/python -r requirements-test.txt
./.venv/bin/python -B linucb_demo.py
./.venv/bin/python -B -m unittest discover -s tests -v

source /home/giang/.nvm/nvm.sh
nvm use 24
cd /home/giang/FoodOrder/FE
pnpm test:unit
pnpm exec tsc --noEmit --incremental false
pnpm build
LD_LIBRARY_PATH=/tmp/foodorder-us32-browser/libs/usr/lib/x86_64-linux-gnu pnpm test:e2e
```

E2E cần backend 8000, frontend 3000 và XAMPP đang chạy; sử dụng tài khoản thử đã
có trong cache bên ngoài repo, không in thông tin xác thực. Đường dẫn thư viện
browser là workaround của máy WSL hiện tại, không phải dependency ứng dụng.
Các test toán học chỉ dùng RAM/tệp tạm; test backend nghiệp vụ dùng SQLite cô lập.

Kết quả chạy thực tế:

| Nhóm | Kết quả |
|---|---|
| Backend đầy đủ | **228/228 đạt** trong 11.209 giây: 179 ca có sẵn + 49 ca US9.2 |
| Toán LinUCB | 18 ca: nghiệm biết trước, alpha/lambda, update, học nhiều lần, rank, invalid/overflow, thread |
| Context | 11 ca: 28 chiều, model adapter, normalization/missing, history, fingerprint |
| Interface ranker | 6 ca: availability, snapshot cũ, schema mismatch, 2 lịch sử khác nhau, tách event/DB |
| Checkpoint | 14 ca: roundtrip, serving/simulation, corruption/version/shape/SPD, symlink, no-overwrite/atomic |
| Frontend unit | **40/40 đạt**: cart và order client |
| TypeScript | `tsc --noEmit --incremental false`, exit 0 |
| Production build | `pnpm build`, exit 0; không thêm route |
| Browser E2E | **59/59 đạt** trong 3.1 phút: auth, US3.1–3.3, US4.1, US8.1–8.4 và mobile |
| Live HTTP | Trang chủ, health và API 9 món HTTP 200 |
| Live LinUCB chỉ đọc | Load 9 Dish ORM từ foodorder_dev, rank 9 món còn bán, 28 chiều, score hữu hạn, đảo input vẫn cùng kết quả |

Live rank kiểm tra bằng mô hình serving **mới, chưa học**, lịch sử trống,
revision=0; không ghi checkpoint, không gán reward. Đây là kiểm tra kết nối
model/encoder với cấu trúc dữ liệu thực, không phải nghiệm thu cá nhân hóa thật.

Audit chỉ đọc xác minh `SELECT DATABASE()` là foodorder_dev trước truy vấn.
Database vẫn 9 bảng; không có bảng/model AI mới, 0 orders và 0 purchase. Giữ nguyên
từng hàng trong 7 bảng nền ngoài users, cả 2 user gốc và toàn bộ 298 interaction
gốc (đối chiếu hash đủ cột). Không sửa/xóa dữ liệu có sẵn.

Trong lúc làm việc có thêm 1 user và 3 add_to_cart trước phần E2E tương tác; giữ
nguyên các bản ghi này. Auth E2E báo new_accounts=0; bộ E2E bổ sung riêng 37 event
hợp lệ (15 view, 22 add_to_cart). Tổng cuối là 3 users, 338 interactions = 161 view
+ 177 add_to_cart. Chênh lệch toàn phiên 40 event gồm 37 của E2E và 3 có trước E2E,
không quy tất cả cho test. Không tạo purchase/rating giả hoặc đơn completed+paid.

Đã đối chiếu workspace với snapshot trước nhiệm vụ: thay đổi mới chỉ gồm 7 file
tạo và phần include dependency trong requirements-test.txt. Khôi phục riêng thay
đổi đường dẫn generated type do Next build tạo về đúng byte trước nhiệm vụ;
không ghi đè thay đổi cũ. Staging không đổi; không commit/push/merge.

## Đối chiếu yêu cầu và phần tích hợp tiếp theo

| Yêu cầu US9.2 | Bằng chứng |
|---|---|
| LinUCB thật, exploitation/exploration đúng | Test nghiệm hệ chéo/không chéo, alpha, lambda, A/b/theta và học nhiều lần |
| Xếp hạng giảm dần, tie xác định | Test input đảo thứ tự, tie ID, duplicate, top_k, empty |
| Context cố định, thuộc tính thật, thiếu dữ liệu | Test adapter models.Dish, 28 chiều, unknown, clipping, missing, profile |
| Hai lịch sử có thể cho thứ tự khác nhau | Test fixture 2 category, explicit synthetic rewards |
| Context update khớp lúc rank | Snapshot bất biến; test thay giá/lịch sử sau quyết định và mismatch fingerprint |
| Lưu/load nhất quán và an toàn | Roundtrip core/bundle/serving; test corruption, version, shape, NaN/Inf, singular, symlink, atomic/no-overwrite |
| Không train production hoặc làm giả purchase/rating | Guard serving, purpose mismatch, module không import DB/event, audit DB và regression |
| Interface US9.1/US9.5 | LinUCBRanker nội bộ, ScoredArm có context/revision và checkpoint có schema |

**US9.2 phần thuật toán đã đạt các yêu cầu và kiểm thử nêu trên, đủ điều kiện nghiệm
thu; chưa hoàn thành hệ thống gợi ý cá nhân hóa end-to-end.** Không đánh dấu US9.1,
US9.3, US9.4 hoặc US9.5 Done.

US9.3 tái sử dụng encoder xử lý thiếu, prior A=lambda*I, alpha và tie-break nhưng
cần chính sách khởi đầu được quyết định riêng. US9.5 tái sử dụng snapshot context,
primitive update và checkpoint; còn cần reward policy được thống nhất, nguồn phản
hồi thật, dedup/revision reconciliation, lưu quyết định/cutoff và quản lý writer.
US9.1 còn cần API dựa JWT, reader lịch sử đúng tài khoản và UI. US9.4 cần hoàn thiện
quy tắc candidate/filter. Không triển khai các phụ thuộc này trong US9.2.
