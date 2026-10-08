from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, UUID4, field_validator

from models import OrderStatus, PaymentMethod, PaymentStatus, UserRole, UserStatus


class UserBase(BaseModel):
    full_name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., max_length=100)
    phone_number: str | None = Field(default=None, max_length=20)
    role: UserRole = UserRole.CUSTOMER
    avatar_url: str | None = Field(default=None, max_length=255)
    status: UserStatus = UserStatus.ACTIVE

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        if "@" not in value or "." not in value.split("@")[-1]:
            raise ValueError("email must be a valid email address")
        return value.strip().lower()

    model_config = ConfigDict(from_attributes=True)


class UserCreate(UserBase):
    password: str = Field(..., min_length=8, max_length=255)


class UserResponse(UserBase):
    id: UUID4
    created_at: datetime
    updated_at: datetime


class DishBase(BaseModel):
    category_id: int
    name: str = Field(..., min_length=1, max_length=150)
    description: str
    base_price: Decimal = Field(..., ge=0)
    calories: int = Field(..., ge=0)
    spiciness_level: int = Field(..., ge=0, le=3)
    is_vegetarian: bool = False
    image_url: str | None = Field(default=None, max_length=255)
    is_available: bool = True

    model_config = ConfigDict(from_attributes=True)


class DishCreate(DishBase):
    pass


class DishResponse(DishBase):
    id: UUID4
    created_at: datetime
    updated_at: datetime


class OrderBase(BaseModel):
    customer_id: UUID4
    shipper_id: UUID4 | None = None
    delivery_address: str
    total_amount: Decimal = Field(..., ge=0)
    shipping_fee: Decimal = Field(..., ge=0)
    discount_amount: Decimal = Field(default=Decimal("0.00"), ge=0)
    final_amount: Decimal = Field(..., ge=0)
    order_status: OrderStatus = OrderStatus.PENDING
    payment_method: PaymentMethod
    payment_status: PaymentStatus = PaymentStatus.UNPAID
    note: str | None = None

    model_config = ConfigDict(from_attributes=True)


class OrderCreate(OrderBase):
    order_code: str = Field(..., min_length=1, max_length=50)


class OrderResponse(OrderBase):
    id: UUID4
    order_code: str
    created_at: datetime
    updated_at: datetime


class OrderItemBase(BaseModel):
    dish_id: UUID4
    quantity: int = Field(..., ge=1)
    unit_price: Decimal = Field(..., ge=0)
    options_selected: dict[str, Any] = Field(default_factory=dict)
    subtotal: Decimal = Field(..., ge=0)


class OrderItemCreate(OrderItemBase):
    pass


class OrderItemResponse(OrderItemBase):
    id: UUID4


__all__ = [
    "UserBase",
    "UserCreate",
    "UserResponse",
    "DishBase",
    "DishCreate",
    "DishResponse",
    "OrderBase",
    "OrderCreate",
    "OrderResponse",
    "OrderItemBase",
    "OrderItemCreate",
    "OrderItemResponse",
]
