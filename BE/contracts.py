import re
from decimal import Decimal
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from catalog_config import CATEGORIES

class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True, allow_inf_nan=False)

def phone(value):
    if not re.fullmatch(r"0[0-9]{9,10}", value):
        raise ValueError("Số điện thoại gồm 10–11 chữ số và bắt đầu bằng 0")
    return value

class Register(Input):
    full_name: str = Field(min_length=1, max_length=100)
    email: EmailStr = Field(max_length=100)
    phone_number: str
    password: str = Field(min_length=8, max_length=128)
    confirm_password: str
    _phone = field_validator("phone_number")(phone)
    @model_validator(mode="after")
    def matching(self):
        if self.password != self.confirm_password:
            raise ValueError("Mật khẩu xác nhận không khớp")
        return self

class Login(Input):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)

class Profile(Input):
    full_name: str = Field(min_length=1, max_length=100)
    phone_number: str
    _phone = field_validator("phone_number")(phone)

class Password(Input):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)
    confirm_new_password: str
    @model_validator(mode="after")
    def matching(self):
        if self.new_password != self.confirm_new_password:
            raise ValueError("Mật khẩu xác nhận không khớp")
        if self.current_password == self.new_password:
            raise ValueError("Mật khẩu mới phải khác mật khẩu cũ")
        return self

class DishInput(Input):
    name: str = Field(min_length=1, max_length=150)
    description: str = Field(max_length=5000)
    base_price: Decimal = Field(ge=0, le=99999999, decimal_places=2)
    image_url: str = Field(min_length=1, max_length=255)
    is_available: bool = True
    calories: int | None = Field(default=None, ge=0, le=10000, strict=True)
    spiciness_level: int | None = Field(default=None, ge=0, le=3, strict=True)
    is_vegetarian: bool | None = None
    main_ingredient: str | None = Field(default=None, max_length=100)
    customizable: bool = True
    category: str = "com"
    @field_validator("category")
    @classmethod
    def valid_category(cls, value):
        if value not in CATEGORIES:raise ValueError("Danh mục không hợp lệ")
        return value
    @field_validator("image_url")
    @classmethod
    def valid_image(cls, value):
        if not re.match(r"^(https?://[^\s]+|/images/[\w.\-/]+)$", value):
            raise ValueError("Ảnh phải là URL http(s) hoặc đường dẫn /images/...")
        return value

class Availability(Input):
    is_available: bool

class AdminUserUpdate(Input):
    role: Literal["customer", "admin"]
    status: Literal["active", "inactive", "banned"]

class Options(Input):
    size: Literal["S", "M", "L"] = "S"
    toppings: list[str] = Field(default_factory=list, max_length=10)
    note: str = Field(default="", max_length=500)

class CartAdd(Options):
    dish_id: UUID
    quantity: int = Field(default=1, ge=1, le=99, strict=True)

class Quantity(Input):
    quantity: int = Field(ge=1, le=99, strict=True)

class Recipient(Input):
    recipient_name: str = Field(min_length=1, max_length=100)
    phone_number: str
    delivery_address: str = Field(min_length=5, max_length=1000)
    note: str = Field(default="", max_length=500)
    _phone = field_validator("phone_number")(phone)

class Checkout(Recipient):
    request_key: str = Field(min_length=8, max_length=80)
    payment_method: Literal["COD"] = "COD"
    expected_total: Decimal | None = Field(default=None, ge=0)

class StatusChange(Input):
    status: Literal["preparing", "completed", "cancelled"]
    reason: str = Field(default="", max_length=1000)

class Rating(Input):
    order_id: UUID
    stars: int = Field(ge=1, le=5, strict=True)
    comment: str = Field(default="", max_length=1000)

class View(Input):
    request_key: str = Field(min_length=8, max_length=80)

class ChatMessage(Input):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=1500)

class ChatRequest(Input):
    message: str = Field(min_length=1, max_length=1500)
    history: list[ChatMessage] = Field(default_factory=list, max_length=12)
