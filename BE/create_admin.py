"""Explicit local setup; public registration can never assign admin permissions."""
import asyncio
import getpass
from sqlalchemy import select
from database import AsyncSessionLocal, init_db, engine
from main import password_hash
from contracts import Register
from models import User, UserRole, UserStatus

async def main():
    email = input("Email quản trị viên: ").strip()
    name = input("Họ tên: ").strip()
    phone = input("Số điện thoại (10–11 số, bắt đầu 0): ").strip()
    password = getpass.getpass("Mật khẩu (ít nhất 8 ký tự): ")
    confirm = getpass.getpass("Nhập lại mật khẩu: ")
    data = Register(email=email, full_name=name, phone_number=phone, password=password, confirm_password=confirm)
    await init_db()
    async with AsyncSessionLocal() as db:
        if await db.scalar(select(User).where(User.email == str(data.email).lower())):
            raise SystemExit("Email đã tồn tại. Không tự động thay đổi quyền tài khoản cũ.")
        db.add(User(email=str(data.email).lower(),full_name=data.full_name,phone_number=data.phone_number,
            password_hash=password_hash.hash(data.password),role=UserRole.ADMIN,status=UserStatus.ACTIVE))
        await db.commit()
    await engine.dispose()
    print("Đã tạo quản trị viên. Hãy đăng nhập ở giao diện và mở /admin.")

if __name__ == "__main__":
    asyncio.run(main())
