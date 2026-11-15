"""Explicit local setup of separate demo admin/customer accounts, never at startup."""
import json
from pathlib import Path
import secrets
import sqlite3
import uuid
from datetime import datetime
from pwdlib import PasswordHash
from database import DATABASE_URL


def main():
    folder = Path(__file__).with_name('.local')
    saved = folder / 'DEMO-ACCOUNTS.json'
    instructions = folder / 'TAI-KHOAN-ADMIN-KHACH.txt'
    if saved.exists() and instructions.exists():
        print('Demo accounts already configured. See BE/.local/TAI-KHOAN-ADMIN-KHACH.txt')
        return
    if not DATABASE_URL.startswith('sqlite+aiosqlite:///'):
        raise SystemExit('This local demo setup requires SQLite. Use create_admin.py for your database.')
    db_path = Path(DATABASE_URL.removeprefix('sqlite+aiosqlite:///'))
    if not db_path.exists():
        raise SystemExit('Start the backend once to initialize the database before running this setup.')
    accounts = [
        dict(email='admin.foodorder@example.com', name='Quản trị FoodAI', role='admin'),
        dict(email='khach.foodorder@example.com', name='Khách hàng thử FoodAI', role='customer'),
    ]
    password_hash = PasswordHash.recommended()
    with sqlite3.connect(db_path) as db:
        for account in accounts:
            if db.execute('SELECT id FROM users WHERE email=?', (account['email'],)).fetchone():
                raise SystemExit('Demo email already exists; no password or role has been changed.')
        backups = folder / 'backups'
        backups.mkdir(exist_ok=True)
        with sqlite3.connect(backups / ('before-demo-accounts-' + datetime.now().strftime('%Y%m%d-%H%M%S') + '.db')) as backup:
            db.backup(backup)
        for account in accounts:
            account['password'] = 'FO-' + secrets.token_urlsafe(12)
            db.execute('INSERT INTO users (id,full_name,email,password_hash,phone_number,role,status,created_at,updated_at) '
                'VALUES (?,?,?,?,?,?,?,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)',
                (str(uuid.uuid4()),account['name'],account['email'],password_hash.hash(account['password']),None,account['role'],'active'))
        db.commit()
    saved.write_text(json.dumps(accounts,ensure_ascii=False,indent=2),encoding='utf-8')
    lines=['TÀI KHOẢN THỬ FOODAI TRÊN MÁY NÀY', '']
    for account in accounts:
        lines += [account['name'], 'Trang: http://127.0.0.1:3001' + ('/admin' if account['role']=='admin' else '/'),
            'Email: '+account['email'], 'Mật khẩu: '+account['password'], '']
    lines += ['Admin: thêm/sửa món, giá, ảnh, danh mục; mở/hết bán; xem và xử lý đơn.',
        'Khách: đặt món, giỏ riêng, đơn riêng, đánh giá và gợi ý cá nhân.',
        'Hai trang lưu phiên đăng nhập riêng. Đăng xuất ở một trang không đăng xuất trang còn lại.',
        'Thông tin này chỉ áp dụng cho database cục bộ, không nằm trong ZIP source.']
    instructions.write_text('\n'.join(lines)+'\n',encoding='utf-8')
    print('Created two separate local demo accounts. See BE/.local/TAI-KHOAN-ADMIN-KHACH.txt')


if __name__=='__main__':
    main()
