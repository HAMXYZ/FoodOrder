from __future__ import annotations

from datetime import datetime
from decimal import Decimal
from typing import Any, Literal
from uuid import UUID

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


class MenuDishResponse(BaseModel):
    id: UUID
    category_id: int
    category_name: str
    name: str
    description: str
    base_price: float
    calories: int
    spiciness_level: int
    is_vegetarian: bool
    image_url: str | None
    is_available: bool


class CategoryResponse(BaseModel):
    id: int
    name: str
    description: str | None
    image_url: str | None

    model_config = ConfigDict(from_attributes=True)


class InteractionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: UUID4
    dish_id: UUID


class ViewInteractionRequest(InteractionRequest):
    event_type: Literal["view"] = "view"


class AddToCartInteractionRequest(InteractionRequest):
    event_type: Literal["add_to_cart"] = "add_to_cart"


class InteractionResponse(BaseModel):
    event_id: UUID4
    dish_id: UUID
    event_type: Literal["view", "add_to_cart"]
    created_at: datetime
    duplicate: bool


class ViewInteractionResponse(InteractionResponse):
    event_type: Literal["view"]


class AddToCartInteractionResponse(InteractionResponse):
    event_type: Literal["add_to_cart"]


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


class CustomerOrderItemResponse(BaseModel):
    id: UUID
    dish_id: UUID
    dish_name: str
    quantity: int = Field(..., ge=1)
    unit_price: Decimal = Field(..., ge=0)
    subtotal: Decimal = Field(..., ge=0)
    options_selected: dict[str, Any]


class CustomerOrderResponse(BaseModel):
    id: UUID
    order_code: str
    order_status: OrderStatus
    delivery_address: str
    created_at: datetime
    updated_at: datetime
    total_amount: Decimal
    shipping_fee: Decimal
    discount_amount: Decimal
    final_amount: Decimal
    payment_method: PaymentMethod
    payment_status: PaymentStatus
    cancellation_reason: str | None = None
    items: list[CustomerOrderItemResponse]


__all__ = [
    "UserBase",
    "UserCreate",
    "UserResponse",
    "DishBase",
    "DishCreate",
    "DishResponse",
    "MenuDishResponse",
    "CategoryResponse",
    "InteractionRequest",
    "InteractionResponse",
    "AddToCartInteractionRequest",
    "AddToCartInteractionResponse",
    "ViewInteractionRequest",
    "ViewInteractionResponse",
    "CustomerOrderResponse",
    "CustomerOrderItemResponse",
    "OrderBase",
    "OrderCreate",
    "OrderResponse",
    "OrderItemBase",
    "OrderItemCreate",
    "OrderItemResponse",
]
