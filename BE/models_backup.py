from __future__ import annotations

import uuid
from datetime import datetime
from enum import Enum

from sqlalchemy import Boolean, DateTime, Enum as SAEnum, ForeignKey, Integer, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class UserRole(str, Enum):
    CUSTOMER = "customer"
    SHIPPER = "shipper"
    ADMIN = "admin"


class UserStatus(str, Enum):
    ACTIVE = "active"
    INACTIVE = "inactive"
    BANNED = "banned"


class OrderStatus(str, Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    PREPARING = "preparing"
    DELIVERING = "delivering"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class PaymentMethod(str, Enum):
    COD = "COD"
    VNPAY = "VNPAY"
    MOMO = "MOMO"


class PaymentStatus(str, Enum):
    UNPAID = "unpaid"
    PAID = "paid"
    REFUNDED = "refunded"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    full_name: Mapped[str] = mapped_column(String(100), nullable=False)
    email: Mapped[str] = mapped_column(String(100), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    phone_number: Mapped[str | None] = mapped_column(String(20), nullable=True)
    role: Mapped[UserRole] = mapped_column(SAEnum(UserRole), default=UserRole.CUSTOMER, nullable=False)
    avatar_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[UserStatus] = mapped_column(SAEnum(UserStatus), default=UserStatus.ACTIVE, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        server_onupdate=func.now(),
        nullable=False,
    )

    addresses: Mapped[list["UserAddress"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    orders: Mapped[list["Order"]] = relationship(
        foreign_keys="[Order.customer_id]",
        back_populates="customer",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    shipper_orders: Mapped[list["Order"]] = relationship(
        foreign_keys="[Order.shipper_id]",
        back_populates="shipper",
        passive_deletes=True,
    )


class UserAddress(Base):
    __tablename__ = "user_addresses"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    recipient_name: Mapped[str] = mapped_column(String(100), nullable=False)
    phone_number: Mapped[str] = mapped_column(String(20), nullable=False)
    address_line: Mapped[str] = mapped_column(String(255), nullable=False)
    district: Mapped[str] = mapped_column(String(100), nullable=False)
    city: Mapped[str] = mapped_column(String(100), nullable=False)
    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    user: Mapped[User] = relationship(back_populates="addresses")


class Category(Base):
    __tablename__ = "categories"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False, unique=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    image_url: Mapped[str | None] = mapped_column(String(255), nullable=True)

    dishes: Mapped[list["Dish"]] = relationship(
        back_populates="category",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class Dish(Base):
    __tablename__ = "dishes"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    category_id: Mapped[int] = mapped_column(
        Integer,
        ForeignKey("categories.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(150), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    base_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    calories: Mapped[int] = mapped_column(Integer, nullable=False)
    spiciness_level: Mapped[int] = mapped_column(Integer, nullable=False)
    is_vegetarian: Mapped[bool] = mapped_column(Boolean, nullable=False)
    image_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    is_available: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        server_onupdate=func.now(),
        nullable=False,
    )

    category: Mapped[Category] = relationship(back_populates="dishes")
    dish_options: Mapped[list["DishOption"]] = relationship(
        back_populates="dish",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    order_items: Mapped[list["OrderItem"]] = relationship(back_populates="dish")


class DishOption(Base):
    __tablename__ = "dish_options"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dish_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dishes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(100), nullable=False)
    is_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_multiple: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    dish: Mapped[Dish] = relationship(back_populates="dish_options")
    items: Mapped[list["DishOptionItem"]] = relationship(
        back_populates="option",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class DishOptionItem(Base):
    __tablename__ = "dish_option_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    option_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dish_options.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    item_name: Mapped[str] = mapped_column(String(100), nullable=False)
    extra_price: Mapped[float] = mapped_column(Numeric(10, 2), default=0, nullable=False)

    option: Mapped[DishOption] = relationship(back_populates="items")


class Order(Base):
    __tablename__ = "orders"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_code: Mapped[str] = mapped_column(String(50), unique=True, index=True, nullable=False)
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    shipper_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )
    delivery_address: Mapped[str] = mapped_column(Text, nullable=False)
    total_amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    shipping_fee: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    discount_amount: Mapped[float] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    final_amount: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    order_status: Mapped[OrderStatus] = mapped_column(SAEnum(OrderStatus), default=OrderStatus.PENDING, nullable=False)
    payment_method: Mapped[PaymentMethod] = mapped_column(SAEnum(PaymentMethod), nullable=False)
    payment_status: Mapped[PaymentStatus] = mapped_column(SAEnum(PaymentStatus), default=PaymentStatus.UNPAID, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        server_onupdate=func.now(),
        nullable=False,
    )

    customer: Mapped[User] = relationship(foreign_keys="[Order.customer_id]", back_populates="orders")
    shipper: Mapped[User | None] = relationship(foreign_keys="[Order.shipper_id]", back_populates="shipper_orders")
    items: Mapped[list["OrderItem"]] = relationship(
        back_populates="order",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )


class OrderItem(Base):
    __tablename__ = "order_items"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    order_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("orders.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    dish_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("dishes.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    unit_price: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)
    options_selected: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    subtotal: Mapped[float] = mapped_column(Numeric(10, 2), nullable=False)

    order: Mapped[Order] = relationship(back_populates="items")
    dish: Mapped[Dish] = relationship(back_populates="order_items")


__all__ = [
    "User",
    "UserAddress",
    "Category",
    "Dish",
    "DishOption",
    "DishOptionItem",
    "Order",
    "OrderItem",
    "UserRole",
    "UserStatus",
    "OrderStatus",
    "PaymentMethod",
    "PaymentStatus",
]
