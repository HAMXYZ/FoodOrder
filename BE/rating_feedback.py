"""US8.4 internal integration contract. No public endpoint or startup migration.

The future US5.1 adapter must read a persisted review under lock. Call in the same
outer transaction as the verified review write, after flushing that source.
Only raw 1..5 stars are retained; reward policy and model updates belong to US9.2.
"""

import json
import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID, uuid5

from sqlalchemy import (CheckConstraint, Column, ForeignKey, Index, Integer, MetaData,
                        String, Table, UniqueConstraint, and_, func, insert, select)
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

import models
from purchases import retryable_database_error


# Independent blueprint, deliberately absent from Base.metadata/init_database.
# Do not create in development until the genuine review adapter and migration exist.
feedback_metadata = MetaData()
source_id_type = String(128).with_variant(String(128, collation="utf8mb4_bin"), "mysql").with_variant(
    String(128, collation="utf8mb4_bin"), "mariadb")
rating_feedback_versions = Table(
    "rating_feedback_versions", feedback_metadata,
    Column("feedback_id", models.UUIDChar(), primary_key=True),
    Column("source_namespace", String(32), nullable=False),
    Column("source_id", source_id_type, nullable=False),
    Column("source_revision", Integer, nullable=False),
    Column("user_id", models.UUIDChar(), ForeignKey(models.User.__table__.c.id, ondelete="RESTRICT"), nullable=False),
    Column("dish_id", models.UUIDChar(), ForeignKey(models.Dish.__table__.c.id, ondelete="RESTRICT"), nullable=False),
    Column("order_item_id", models.UUIDChar(), ForeignKey(models.OrderItem.__table__.c.id, ondelete="RESTRICT"), nullable=False),
    Column("rating", Integer, nullable=False),
    Column("source_updated_at", models.UTCDateTime(), nullable=False),
    Column("recorded_at", models.UTCDateTime(), nullable=False),
    Column("schema_version", Integer, nullable=False),
    Column("supersedes_id", models.UUIDChar(), ForeignKey("rating_feedback_versions.feedback_id", ondelete="RESTRICT")),
    UniqueConstraint("source_namespace", "source_id", "source_revision", name="uq_rating_feedback_source_revision"),
    CheckConstraint("rating BETWEEN 1 AND 5", name="ck_rating_feedback_stars"),
    CheckConstraint("source_revision >= 1", name="ck_rating_feedback_revision"),
    CheckConstraint("schema_version = 1", name="ck_rating_feedback_schema"),
    Index("ix_rating_feedback_user_dish", "user_id", "dish_id"),
    mysql_engine="InnoDB", mysql_charset="utf8mb4", mysql_collate="utf8mb4_unicode_ci",
)
FEEDBACK_NAMESPACE = UUID("c9426a35-9dfb-43c1-a393-e08f0ac001d8")


class RatingFeedbackError(RuntimeError):
    """Safe domain error; never contains SQL, connection details or credentials."""


class RatingSourceUnavailable(RatingFeedbackError):
    pass


class InvalidRatingSource(RatingFeedbackError):
    pass


class RatingAuthorizationError(RatingFeedbackError):
    pass


class RatingRevisionConflict(RatingFeedbackError):
    pass


class RatingTransactionRequired(RatingFeedbackError):
    pass


class RatingPersistenceError(RatingFeedbackError):
    def __init__(self, retryable: bool):
        super().__init__("Chưa thể lưu phản hồi đánh giá; rollback giao dịch trước khi thử lại.")
        self.retryable = retryable


@dataclass(frozen=True)
class RatingSourceRecord:
    source_id: str
    user_id: UUID
    dish_id: UUID
    order_item_id: UUID
    rating: int
    revision: int
    updated_at: datetime
    status: str  # Authoritative backend source state; only 'published' is eligible.


class RatingSourceAdapter(ABC):
    """Trusted backend integration only, never constructed from HTTP payloads.

    Load by source ID from persisted US5.1 data in THIS session, using FOR UPDATE.
    IDs/authorship/purchase reference/revision must come from that database row.
    No production implementation exists while the genuine US5.1 source is absent.
    """

    namespace: str

    @abstractmethod
    async def load_for_update(self, db: AsyncSession, source_id: str) -> RatingSourceRecord | None:
        raise NotImplementedError


@dataclass(frozen=True)
class RatingSignal:
    feedback_id: UUID
    source_namespace: str
    source_id: str
    source_revision: int
    user_id: UUID
    dish_id: UUID
    order_item_id: UUID
    rating: int
    source_updated_at: datetime
    recorded_at: datetime
    schema_version: int
    supersedes_id: UUID | None

    @property
    def source_key(self) -> tuple[str, str]:
        return self.source_namespace, self.source_id

    @property
    def rating_scale(self) -> tuple[int, int]:
        return 1, 5


@dataclass(frozen=True)
class RatingRecordResult:
    signal: RatingSignal
    duplicate: bool


def normalize_stars(value: int) -> int:
    # Do not silently accept booleans, floats or numeric strings as validated stars.
    if type(value) is not int or not 1 <= value <= 5:
        raise InvalidRatingSource("Điểm đánh giá phải là số nguyên từ 1 đến 5.")
    return value


def _utc(value: datetime) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise InvalidRatingSource("Nguồn đánh giá cần thời gian có timezone.")
    return value.astimezone(timezone.utc)


def _adapter(source: RatingSourceAdapter | None) -> RatingSourceAdapter:
    if not isinstance(source, RatingSourceAdapter):
        raise RatingSourceUnavailable("Chưa có adapter nguồn đánh giá backend đã xác minh.")
    namespace = getattr(source, "namespace", None)
    if not isinstance(namespace, str) or not re.fullmatch(r"[a-z][a-z0-9_]{0,31}", namespace):
        raise InvalidRatingSource("Namespace nguồn đánh giá chưa hợp lệ.")
    return source


def _key(value: str) -> str:
    if not isinstance(value, str) or not value or value != value.strip() or len(value) > 128:
        raise InvalidRatingSource("Định danh nguồn đánh giá chưa hợp lệ.")
    return value


def rating_feedback_id(namespace: str, source_id: str, revision: int) -> UUID:
    return uuid5(FEEDBACK_NAMESPACE, json.dumps([namespace, source_id, revision], ensure_ascii=True))


async def _verified_source(db: AsyncSession, source: RatingSourceAdapter, source_id: str,
                           actor_id: UUID | None = None) -> RatingSourceRecord:
    record = await source.load_for_update(db, source_id)
    if not isinstance(record, RatingSourceRecord) or record.source_id != source_id or record.status != "published":
        raise InvalidRatingSource("Không có đánh giá nguồn đã được backend chấp nhận.")
    if not all(isinstance(value, UUID) for value in (record.user_id, record.dish_id, record.order_item_id)):
        raise InvalidRatingSource("Nguồn đánh giá cần định danh người dùng, món và dòng mua hợp lệ.")
    normalize_stars(record.rating)
    if type(record.revision) is not int or record.revision < 1:
        raise InvalidRatingSource("Phiên bản đánh giá phải là số nguyên dương.")
    _utc(record.updated_at)
    if actor_id is not None and record.user_id != actor_id:
        raise RatingAuthorizationError("Tài khoản không sở hữu đánh giá nguồn.")
    user = (await db.execute(select(models.User.role, models.User.status).where(
        models.User.id == record.user_id).with_for_update())).one_or_none()
    if user is None or user.role != models.UserRole.CUSTOMER or user.status != models.UserStatus.ACTIVE:
        raise RatingAuthorizationError("Nguồn đánh giá phải thuộc khách hàng đang hoạt động.")
    purchase = (await db.execute(select(
        models.Order.customer_id, models.Order.order_status, models.Order.payment_status,
        models.OrderItem.dish_id, models.OrderItem.quantity,
    ).join(models.OrderItem, models.OrderItem.order_id == models.Order.id).where(
        models.OrderItem.id == record.order_item_id).with_for_update())).one_or_none()
    if (purchase is None or purchase.customer_id != record.user_id or purchase.dish_id != record.dish_id
            or purchase.order_status != models.OrderStatus.COMPLETED
            or purchase.payment_status != models.PaymentStatus.PAID
            or type(purchase.quantity) is not int or purchase.quantity <= 0):
        raise InvalidRatingSource("Đánh giá chưa có nguồn mua hàng hợp lệ của chính khách hàng.")
    return record


def _same_source(signal: RatingSignal, record: RatingSourceRecord) -> bool:
    return (signal.user_id == record.user_id and signal.dish_id == record.dish_id
            and signal.order_item_id == record.order_item_id and signal.rating == record.rating
            and signal.source_revision == record.revision and signal.source_updated_at == _utc(record.updated_at)
            and signal.schema_version == 1)


async def record_verified_rating(db: AsyncSession, source_id: str, authenticated_user: models.User | None,
                                 *, source: RatingSourceAdapter | None = None) -> RatingRecordResult:
    """Stage one immutable source revision. Caller must commit/rollback the outer transaction.

    Future US5.1 calls after JWT/ownership/purchase validation and flush of its genuine
    review write. No score, dish_id, user_id or 'verified' flag is accepted from a client.
    Retry persistence races in a NEW outer transaction; never swallow an error and commit.
    """
    if authenticated_user is None:
        raise RatingAuthorizationError("Cần khách hàng đã được backend xác thực.")
    source = _adapter(source)
    source_id = _key(source_id)
    if not db.in_transaction() or db.new or db.dirty or db.deleted:
        raise RatingTransactionRequired("Cần outer transaction và nguồn đã flush trước khi ghi phản hồi.")
    actor_id = authenticated_user.id
    table = rating_feedback_versions
    try:
        async with db.begin_nested():
            record = await _verified_source(db, source, source_id, actor_id)
            row = (await db.execute(select(table).where(
                table.c.source_namespace == source.namespace, table.c.source_id == source_id,
            ).order_by(table.c.source_revision.desc()).limit(1).with_for_update())).mappings().one_or_none()
            previous = RatingSignal(**row) if row else None
            if previous:
                if (previous.user_id, previous.dish_id, previous.order_item_id) != (
                        record.user_id, record.dish_id, record.order_item_id):
                    raise RatingRevisionConflict("Nguồn đánh giá không được thay chủ sở hữu, món hoặc dòng mua.")
                if record.revision < previous.source_revision:
                    raise RatingRevisionConflict("Không dùng phiên bản nguồn cũ để thay phản hồi mới.")
                if record.revision == previous.source_revision:
                    if not _same_source(previous, record):
                        raise RatingRevisionConflict("Cùng phiên bản nhưng nội dung nguồn khác; không ghi đè.")
                    return RatingRecordResult(previous, True)
            signal = RatingSignal(
                feedback_id=rating_feedback_id(source.namespace, source_id, record.revision),
                source_namespace=source.namespace, source_id=source_id, source_revision=record.revision,
                user_id=record.user_id, dish_id=record.dish_id, order_item_id=record.order_item_id,
                rating=record.rating, source_updated_at=_utc(record.updated_at),
                recorded_at=datetime.now(timezone.utc), schema_version=1,
                supersedes_id=previous.feedback_id if previous else None,
            )
            await db.execute(insert(table).values(**signal.__dict__))
            return RatingRecordResult(signal, False)
    except SQLAlchemyError as error:
        raise RatingPersistenceError(retryable_database_error(error)) from None


async def current_rating_signals(db: AsyncSession, *, source: RatingSourceAdapter | None = None) -> tuple[RatingSignal, ...]:
    """Verified CURRENT snapshot, one signal per review source, with no model side effects.

    A future learner must reconcile the WHOLE namespace, replacing contributions
    by source_key/revision and removing absent keys (or rebuilding this snapshot).
    It must NOT add every version as a new independent reward.
    Missing/edited/unpublished/ineligible sources are omitted until genuine synchronization.
    """
    source = _adapter(source)
    table = rating_feedback_versions
    latest = select(table.c.source_id, func.max(table.c.source_revision).label("revision")).where(
        table.c.source_namespace == source.namespace).group_by(table.c.source_id).subquery()
    try:
        rows = (await db.execute(select(table).join(latest, and_(
            table.c.source_id == latest.c.source_id, table.c.source_revision == latest.c.revision,
        )).where(table.c.source_namespace == source.namespace).order_by(table.c.source_id))).mappings().all()
        signals = []
        for row in rows:
            signal = RatingSignal(**row)
            try:
                record = await _verified_source(db, source, signal.source_id)
                if _same_source(signal, record):
                    signals.append(signal)
            except (InvalidRatingSource, RatingAuthorizationError):
                continue
        return tuple(signals)
    except SQLAlchemyError as error:
        raise RatingPersistenceError(retryable_database_error(error)) from None
