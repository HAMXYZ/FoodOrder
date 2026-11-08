# Xác thực khách hàng — US1.2

Luồng hiện tại tái sử dụng FastAPI, SQLAlchemy models, mật khẩu Argon2 và JWT có sẵn.
Không tạo thêm bảng hoặc thay đổi schema.

## Luồng đăng nhập và phiên

1. Form đăng ký/đăng nhập gửi tới Route Handler cùng origin trong Next.js.
2. Next.js gọi API FastAPI hiện có. Sau đăng nhập, Next.js kiểm chứng JWT bằng
   `GET /api/users/me` trước khi lưu cookie.
3. JWT nằm trong cookie `foodorder_session`: HttpOnly, SameSite=Lax, path `/`;
   bật Secure ở production. Token không được trả trong JSON cho JavaScript giao diện,
   không lưu vào localStorage/sessionStorage.
4. Frontend lấy người dùng thật qua `GET /api/users/me`. Next.js lấy JWT từ cookie,
   chuyển thành Bearer header cho backend. Các request này dùng `Cache-Control: no-store`.
5. FastAPI kiểm tra chữ ký HS256, bắt buộc `sub` và `exp`, chuyển `sub` thành UUID,
   rồi đọc tài khoản đang hoạt động trong database. Đây là nguồn xác định `user_id`.
6. FastAPI từ chối payload khai báo thêm `user_id`, `role` hoặc trường ngoài hợp đồng.
   Next.js chỉ chuyển các trường đăng nhập được phép và không dùng danh tính client tự khai.
   API hồ sơ chỉ cung cấp `/me`, không có route đọc hồ sơ tùy ý theo UUID của người khác.

JWT vẫn có thời hạn 30 phút như backend trước đây. Khi chọn ghi nhớ đăng nhập,
cookie có Max-Age đến thời điểm JWT hết hạn; nếu không chọn, cookie thuộc phiên trình duyệt.
Tải lại trang hoặc quay lại tab sẽ kiểm tra phiên qua backend. Frontend có timer hết hạn
và đồng bộ thay đổi phiên giữa các tab cùng origin bằng BroadcastChannel.
Timer kiểm chứng phiên hiện tại với backend trước khi xóa cookie, để tab cũ không
xóa nhầm phiên mới vừa đăng nhập ở tab khác.

Khi token hết hạn/không hợp lệ hoặc tài khoản không hoạt động, cookie được xóa,
thông tin người dùng được bỏ khỏi giao diện và xuất hiện thông báo đăng nhập lại.
Đăng xuất xóa cookie qua Route Handler, xóa trạng thái client và đồng bộ các tab.
Các mutation qua cookie kiểm tra Origin để từ chối nguồn bên ngoài.

Backend bắt buộc cấu hình `FOODORDER_SECRET_KEY`; không còn khóa ký mặc định trong code.
Khóa phát triển được lưu riêng trong `BE/.env` đã được Git bỏ qua, không đưa sang frontend.

## API được tái sử dụng

| FastAPI | Chức năng |
|---|---|
| `POST /api/auth/register` | Tạo tài khoản customer, lưu password hash |
| `POST /api/auth/login` | Xác minh mật khẩu, phát JWT |
| `GET /api/users/me` | Hồ sơ từ danh tính trong JWT |
| `PUT /api/users/me` | Sửa hồ sơ của chính tài khoản đã xác thực |
| `PUT /api/users/me/change-password` | Đổi mật khẩu của chính tài khoản đã xác thực |

Next.js có Route Handler cho các URL trên và `POST /api/auth/logout`.
Menu và danh mục vẫn là API công khai. Giao diện tài khoản hiện hiển thị hồ sơ và đăng xuất;
chưa bổ sung form sửa hồ sơ hoặc đổi mật khẩu.

## Kiểm thử

```bash
cd /home/giang/FoodOrder/BE
./.venv/bin/python -B -m unittest discover -s tests -v
```

Riêng nền tảng/xác thực có 30 bài (18 xác thực và 12 nền tảng). Bộ backend hiện có 122 bài
sau khi bổ sung 26 bài US8.1, 24 bài US8.2 và 42 bài service/migration US8.3. Dữ liệu unit test nằm trong
database SQLite độc lập (bộ nhớ hoặc file tạm), không ghi vào MariaDB. Các trường hợp gồm: đăng ký hợp lệ và
từ chối tự cấp role, đăng nhập đúng/sai, thiếu token, token sai chữ ký/hết hạn/thiếu claim,
tài khoản không hoạt động, cố đọc/sửa hồ sơ B bằng token A và bảo vệ đổi mật khẩu.

E2E cần hai server phát triển đang chạy và Chromium cho Playwright:

```bash
source ~/.nvm/nvm.sh
nvm use 24
cd /home/giang/FoodOrder/FE
pnpm exec playwright install --with-deps chromium
pnpm test:e2e
```

Lệnh `pnpm test:e2e` chạy US8.1/US8.2 và hai ca phủ định purchase US8.3; chỉ tạo sự kiện
xem/thêm giỏ trong development. Không tạo đơn hoàn thành hoặc purchase giả. Xem
[US8_3_PURCHASE_INTERACTIONS.md](US8_3_PURCHASE_INTERACTIONS.md) cho kết quả và dữ liệu mới nhất.

Lệnh cài phụ thuộc trình duyệt có thể cần sudo; không cần bước đó để chạy website.
Trong môi trường chỉ có thư viện trình duyệt cài riêng, có thể cung cấp thư mục thư viện
qua `LD_LIBRARY_PATH` khi chạy E2E.

E2E kiểm tra đích `foodorder_dev` và `foodorder_app` trước khi tạo tài khoản thử.
Lần đầu thêm hai tài khoản customer với email riêng và mật khẩu ngẫu nhiên; thông tin thử
được lưu trong thư mục cache riêng của người dùng, quyền 600, ngoài repository.
Chạy lại tái sử dụng tài khoản đó, không ghi đè hay xóa dữ liệu có sẵn.
Trace/video/screenshot bị tắt cho bài kiểm thử xác thực để tránh ghi thông tin đăng nhập.

Đã kiểm tra giao diện trên cả localhost và 127.0.0.1: đăng ký, đăng nhập, đọc hồ sơ,
tải lại trang, ghi nhớ phiên, đăng xuất đồng bộ tab, sai mật khẩu, dịch vụ tạm lỗi,
cookie HttpOnly, bảo vệ hồ sơ người khác và token hết hạn/timer hết phiên.
Kiểm thử cũng bao gồm trường hợp một tab cũ đến hạn trong khi cookie đã được thay
bằng phiên đăng nhập hợp lệ mới của tab khác.

## File của thay đổi xác thực

- `BE/main.py`: khóa ký riêng, JWT bắt buộc claim, request schema chặt chẽ, cache headers.
- `BE/tests/test_development.py`: mở rộng helper HTTP cho JSON body/query string.
- `BE/tests/test_authentication.py`: kiểm thử đăng ký/đăng nhập, token và quyền sở hữu.
- `BE/.env`: cấu hình khóa ký riêng; file không được theo dõi trong Git.
- `FE/lib/auth-types.ts`: kiểu tài khoản và dữ liệu phiên.
- `FE/lib/auth-server.ts`: gọi FastAPI, kiểm tra Origin, quản lý cookie HttpOnly.
- `FE/app/api/auth/{login,register,logout}/route.ts`: các Route Handler xác thực.
- `FE/app/api/users/me/route.ts`: đọc/sửa hồ sơ với JWT từ cookie.
- `FE/app/api/users/me/change-password/route.ts`: chuyển tiếp đổi mật khẩu có xác thực.
- `FE/components/food/auth-state.tsx`: phục hồi phiên, hết hạn, đồng bộ tab.
- `FE/components/food/account-modal.tsx`: thông tin tài khoản và đăng xuất.
- `FE/components/food/AuthModal.tsx`: form đăng ký/đăng nhập thật và lỗi từ API.
- `FE/components/food/food-app.tsx`, `site-header.tsx`: hiển thị danh tính backend.
- `FE/package.json`, `FE/pnpm-lock.yaml`: dependency/lệnh kiểm thử Playwright.
- `FE/playwright.config.ts`, `FE/tests/e2e/auth.spec.ts`: kiểm thử trình duyệt.
- `docs/AUTHENTICATION.md`, `docs/DEVELOPMENT_WSL.md`: tài liệu cập nhật.

## Nền tảng xác thực đã dùng cho US8.1 và US8.2

US8.1 hiện có bảng/API sự kiện, lấy danh tính từ `get_current_user`, proxy HttpOnly,
UUID cho từng lần mở chi tiết thành công, và chống trùng cả request đồng thời ở database.
Khách chưa đăng nhập vẫn xem chi tiết nhưng không gửi sự kiện tài khoản.
Xem [US8_1_VIEW_INTERACTIONS.md](US8_1_VIEW_INTERACTIONS.md) để biết thiết kế,
migration, kiểm thử hai tài khoản và giới hạn. Không đưa token ra JavaScript để gọi API mới.
US8.2 dùng cùng proxy có xác thực cho `/api/interactions/add-to-cart`; xem
[US8_2_CART_INTERACTIONS.md](US8_2_CART_INTERACTIONS.md) về giỏ local và xác nhận thao tác thành công.

Chưa có refresh token hoặc thu hồi JWT chủ động: đăng xuất xóa phiên phía client,
JWT đã phát hành tự hết hạn trong 30 phút. Quên mật khẩu, đăng nhập mạng xã hội,
đơn hàng thật và trang admin hoàn chỉnh vẫn nằm ngoài thay đổi này.

US8.3 không thêm API purchase công khai. Service nội bộ lấy owner từ Order, không lấy admin/caller
làm người mua; module hoàn thành đơn thật sau này phải kiểm tra quyền trước khi gọi service.
