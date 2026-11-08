"""Authenticated, append-only interaction recording shared by US8.1 and US8.2."""

from typing import Literal

from fastapi import HTTPException, Response
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

import models
from schemas import InteractionRequest

InteractionType = Literal["view", "add_to_cart"]


def interaction_response(event: models.UserInteraction, duplicate: bool) -> dict:
    return {
        "event_id": event.event_id, "dish_id": event.dish_id,
        "event_type": event.event_type, "created_at": event.created_at,
        "duplicate": duplicate,
    }


def verify_replay(event, user_id, dish_id, event_type):
    if event.user_id != user_id or event.dish_id != dish_id or event.event_type != event_type:
        # Do not reveal the original owner, dish or event type on any collision.
        raise HTTPException(status_code=409, detail="Ma su kien da duoc su dung cho noi dung khac")


async def record_interaction(
    payload: InteractionRequest, response: Response, user: models.User,
    db: AsyncSession, event_type: InteractionType,
) -> dict:
    if user.role != models.UserRole.CUSTOMER:
        raise HTTPException(status_code=403, detail="Chi ghi nhan tuong tac cua khach hang")
    response.headers["Cache-Control"] = "no-store"
    # A rollback can expire ORM attributes, so retain the authenticated identity.
    user_id = user.id
    query = select(models.UserInteraction).where(models.UserInteraction.event_id == payload.event_id)
    try:
        existing = (await db.execute(query)).scalar_one_or_none()
        if existing is not None:
            verify_replay(existing, user_id, payload.dish_id, event_type)
            response.status_code = 200
            return interaction_response(existing, duplicate=True)
        dish = (await db.execute(select(models.Dish.id).where(
            models.Dish.id == payload.dish_id, models.Dish.is_available.is_(True),
        ))).scalar_one_or_none()
        if dish is None:
            raise HTTPException(status_code=404, detail="Khong tim thay mon an dang ban")
        event = models.UserInteraction(
            event_id=payload.event_id, user_id=user_id, dish_id=payload.dish_id,
            event_type=event_type,  # Fixed by the endpoint, never selected by client input.
        )
        try:
            db.add(event)
            await db.commit()
            await db.refresh(event)
            return interaction_response(event, duplicate=False)
        except IntegrityError:
            # UNIQUE(event_id) decides concurrent INSERTs. A fresh transaction
            # after rollback also sees the winning row with MariaDB's isolation.
            await db.rollback()
            existing = (await db.execute(query)).scalar_one_or_none()
            if existing is None:
                raise HTTPException(status_code=503, detail="Chua the ghi nhan tuong tac. Vui long thu lai")
            verify_replay(existing, user_id, payload.dish_id, event_type)
            response.status_code = 200
            return interaction_response(existing, duplicate=True)
    except SQLAlchemyError:
        await db.rollback()
        raise HTTPException(status_code=503, detail="Chua the ghi nhan tuong tac. Vui long thu lai")
