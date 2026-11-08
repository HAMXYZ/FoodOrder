"""Test-only review adapter. No review model or fixture is registered in production."""

import models
from sqlalchemy import Column, Integer, MetaData, String, Table, select
from rating_feedback import RatingSourceAdapter, RatingSourceRecord

source_metadata = MetaData()
reviews = Table("isolated_review_sources", source_metadata,
    Column("source_id", String(128), primary_key=True),
    Column("user_id", models.UUIDChar(), nullable=False),
    Column("dish_id", models.UUIDChar(), nullable=False),
    Column("order_item_id", models.UUIDChar(), nullable=False),
    Column("rating", Integer, nullable=False), Column("revision", Integer, nullable=False),
    Column("updated_at", models.UTCDateTime(), nullable=False), Column("status", String(32), nullable=False),
)


class PersistedReviewAdapter(RatingSourceAdapter):
    namespace = "isolated_reviews"

    async def load_for_update(self, db, source_id):
        row = (await db.execute(select(reviews).where(reviews.c.source_id == source_id).with_for_update())).mappings().one_or_none()
        return RatingSourceRecord(**row) if row else None
