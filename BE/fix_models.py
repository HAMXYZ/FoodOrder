from pathlib import Path

p = Path("models.py")
s = p.read_text(encoding="utf-8-sig")

s = s.replace(
    "from sqlalchemy import Boolean, DateTime, Enum as SAEnum, ForeignKey, Integer, Numeric, String, Text, func",
    "from sqlalchemy import Boolean, CHAR, DateTime, Enum as SAEnum, ForeignKey, Integer, JSON, Numeric, String, Text, func"
)
s = s.replace(
    "from sqlalchemy.dialects.postgresql import JSONB, UUID",
    "from sqlalchemy.types import TypeDecorator"
)
s = s.replace("UUID(as_uuid=True)", "UUIDChar()")
s = s.replace("JSONB", "JSON")

s = s.replace(
    "SAEnum(UserRole)",
    "SAEnum(UserRole, values_callable=lambda enum_cls: [item.value for item in enum_cls])"
)
s = s.replace(
    "SAEnum(UserStatus)",
    "SAEnum(UserStatus, values_callable=lambda enum_cls: [item.value for item in enum_cls])"
)
s = s.replace(
    "SAEnum(OrderStatus)",
    "SAEnum(OrderStatus, values_callable=lambda enum_cls: [item.value for item in enum_cls])"
)
s = s.replace(
    "SAEnum(PaymentStatus)",
    "SAEnum(PaymentStatus, values_callable=lambda enum_cls: [item.value for item in enum_cls])"
)

marker = "from database import Base\n"
uuid_class = '''

class UUIDChar(TypeDecorator):
    """Store UUID values as CHAR(36) for MySQL."""

    impl = CHAR(36)
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        return uuid.UUID(str(value))

'''

if "class UUIDChar(TypeDecorator):" not in s:
    if marker not in s:
        raise SystemExit("Khong tim thay dong import database Base. Da dung de tranh sua sai file.")
    s = s.replace(marker, marker + uuid_class, 1)

if "UUID(as_uuid=True)" in s or "JSONB" in s:
    raise SystemExit("Van con kieu PostgreSQL cu. File chua duoc ghi.")

p.write_text(s, encoding="utf-8")
print("Da sua models.py")
