"""Additive schema: existing tables and records are preserved by create_all."""
import uuid
from datetime import datetime
from sqlalchemy import ForeignKey, String, Text, Integer, Float, DateTime, JSON, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from database import Base
from models import UUIDChar
from time_utils import utcnow

class Session(Base):
    __tablename__ = "auth_sessions"
    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUIDChar(), ForeignKey("users.id"), index=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime)

class DishMetadata(Base):
    __tablename__ = "dish_metadata"
    dish_id: Mapped[uuid.UUID] = mapped_column(UUIDChar(), ForeignKey("dishes.id"), primary_key=True)
    categories: Mapped[list] = mapped_column(JSON, default=list)
    topping_group: Mapped[str] = mapped_column(String(20), default="rice")

class CartItem(Base):
    __tablename__ = "cart_items"
    __table_args__ = (UniqueConstraint("user_id", "signature"),)
    id: Mapped[uuid.UUID] = mapped_column(UUIDChar(), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUIDChar(), ForeignKey("users.id"), index=True)
    dish_id: Mapped[uuid.UUID] = mapped_column(UUIDChar(), ForeignKey("dishes.id"))
    signature: Mapped[str] = mapped_column(String(64))
    quantity: Mapped[int] = mapped_column(Integer)
    options: Mapped[dict] = mapped_column(JSON, default=dict)

class OrderDetails(Base):
    __tablename__ = "order_details"
    __table_args__ = (UniqueConstraint("user_id", "request_key"),)
    order_id: Mapped[uuid.UUID] = mapped_column(UUIDChar(), ForeignKey("orders.id"), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(UUIDChar(), ForeignKey("users.id"), index=True)
    request_key: Mapped[str] = mapped_column(String(80))
    recipient_name: Mapped[str] = mapped_column(String(100))
    phone_number: Mapped[str] = mapped_column(String(20))
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)

class Review(Base):
    __tablename__ = "reviews"
    __table_args__ = (UniqueConstraint("user_id", "order_id", "dish_id"),)
    id: Mapped[uuid.UUID] = mapped_column(UUIDChar(), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUIDChar(), ForeignKey("users.id"), index=True)
    order_id: Mapped[uuid.UUID] = mapped_column(UUIDChar(), ForeignKey("orders.id"))
    dish_id: Mapped[uuid.UUID] = mapped_column(UUIDChar(), ForeignKey("dishes.id"), index=True)
    stars: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str] = mapped_column(String(1000), default="")
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)

class Interaction(Base):
    __tablename__ = "interactions"
    __table_args__ = (UniqueConstraint("user_id", "source_key"),)
    id: Mapped[uuid.UUID] = mapped_column(UUIDChar(), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(UUIDChar(), ForeignKey("users.id"), index=True)
    dish_id: Mapped[uuid.UUID] = mapped_column(UUIDChar(), ForeignKey("dishes.id"), index=True)
    kind: Mapped[str] = mapped_column(String(20))
    source_key: Mapped[str] = mapped_column(String(100))
    reward: Mapped[float] = mapped_column(Float)
    quantity: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

class CatalogFacts(Base):
    __tablename__ = "catalog_facts"
    dish_id: Mapped[uuid.UUID] = mapped_column(UUIDChar(), ForeignKey("dishes.id"), primary_key=True)
    source_id: Mapped[int | None] = mapped_column(Integer, unique=True, nullable=True)
    source_category: Mapped[str | None] = mapped_column(String(100), nullable=True)
    main_ingredient: Mapped[str | None] = mapped_column(String(100), nullable=True)
    facts: Mapped[dict] = mapped_column(JSON, default=dict)

class DatasetRating(Base):
    __tablename__ = "dataset_ratings"
    __table_args__ = (UniqueConstraint("split", "source_user_id", "source_dish_id"),)
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    split: Mapped[str] = mapped_column(String(10), index=True)
    source_user_id: Mapped[str] = mapped_column(String(60))
    source_dish_id: Mapped[int] = mapped_column(Integer, index=True)
    stars: Mapped[int] = mapped_column(Integer)
    comment: Mapped[str] = mapped_column(String(1000))
    rated_at: Mapped[str] = mapped_column(String(10))

class DatasetImport(Base):
    __tablename__ = "dataset_imports"
    name: Mapped[str] = mapped_column(String(100), primary_key=True)
    checksum: Mapped[str] = mapped_column(String(64))
    summary: Mapped[dict] = mapped_column(JSON)
    imported_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
