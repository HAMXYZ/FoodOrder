import os
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import (
    FastAPI,
    Depends,
    HTTPException,
    Response,
    status,
)
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from jose import jwt, JWTError
from pwdlib import PasswordHash
from pwdlib.exceptions import UnknownHashError

import models
from database import engine, ping_db, get_db
from schemas import (
    CategoryResponse, MenuDishResponse, ViewInteractionRequest, ViewInteractionResponse,
    AddToCartInteractionRequest, AddToCartInteractionResponse, CustomerOrderResponse,
)
from interactions import record_interaction
from orders import get_customer_order


password_hasher = PasswordHash.recommended()

SECRET_KEY = os.getenv("FOODORDER_SECRET_KEY")
if not SECRET_KEY:
    raise RuntimeError("Chua cau hinh FOODORDER_SECRET_KEY trong BE/.env")

ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 30

bearer_scheme = HTTPBearer(auto_error=False)


class RegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    full_name: str = Field(..., min_length=1, max_length=100)
    email: str = Field(..., min_length=3, max_length=100)
    password: str = Field(..., min_length=8, max_length=255)
    phone_number: str | None = Field(default=None, max_length=20)

    @field_validator("full_name")
    @classmethod
    def validate_full_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Ho ten khong duoc de trong")
        return value

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = value.strip().lower()
        if "@" not in value or "." not in value.split("@")[-1]:
            raise ValueError("Email khong hop le")
        return value

    @field_validator("phone_number")
    @classmethod
    def validate_register_phone(
        cls, value: str | None
    ) -> str | None:
        if value is not None:
            value = value.strip()
            return value or None
        return None


class LoginRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(..., min_length=3, max_length=100)
    password: str = Field(..., min_length=1, max_length=255)

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()


class ProfileUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    full_name: str = Field(..., min_length=1, max_length=100)
    phone_number: str | None = Field(default=None, max_length=20)

    @field_validator("full_name")
    @classmethod
    def validate_profile_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("Ho ten khong duoc de trong")
        return value

    @field_validator("phone_number")
    @classmethod
    def normalize_phone(
        cls, value: str | None
    ) -> str | None:
        if value is not None:
            value = value.strip()
            return value or None
        return None


class ChangePasswordRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(
        ..., min_length=1, max_length=255
    )
    new_password: str = Field(
        ..., min_length=8, max_length=128
    )
    confirm_new_password: str = Field(
        ..., min_length=8, max_length=128
    )


def create_access_token(user_id: str) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(
        minutes=ACCESS_TOKEN_EXPIRE_MINUTES
    )

    payload = {
        "sub": user_id,
        "exp": expires_at,
    }

    return jwt.encode(
        payload,
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(
        bearer_scheme
    ),
    db: AsyncSession = Depends(get_db),
):
    if credentials is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Vui long dang nhap",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    try:
        payload = jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
            options={"require_exp": True, "require_sub": True},
        )

        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Token khong hop le",
                headers={"WWW-Authenticate": "Bearer"},
            )

        user_uuid = UUID(user_id)

    except (JWTError, ValueError, TypeError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token khong hop le hoac da het han",
            headers={"WWW-Authenticate": "Bearer"},
        )

    result = await db.execute(
        select(models.User).where(
            models.User.id == user_uuid
        )
    )
    user = result.scalar_one_or_none()

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Khong tim thay tai khoan",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.status != models.UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tai khoan khong hoat dong",
        )

    return user


def user_to_dict(user: models.User) -> dict:
    return {
        "id": str(user.id),
        "full_name": user.full_name,
        "email": user.email,
        "phone_number": user.phone_number,
        "role": user.role.value,
        "status": user.status.value,
    }


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Schema changes are explicit development commands, never an API startup side effect.
    await ping_db()
    print("FoodOrder: Database da san sang!")
    yield
    await engine.dispose()


app = FastAPI(
    title="FoodOrder API",
    description="Backend website dat do an truc tuyen",
    version="1.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/")
async def home():
    return {
        "message": "FoodOrder API dang hoat dong",
        "docs": "/docs",
    }


@app.get("/api/health")
async def health(db: AsyncSession = Depends(get_db)):
    await db.execute(text("SELECT 1"))

    return {
        "status": "ok",
        "database": "connected",
    }

@app.get("/api/dishes", response_model=list[MenuDishResponse])
async def get_dishes(
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(models.Dish).options(selectinload(models.Dish.category)).where(
            models.Dish.is_available.is_(True)
        ).order_by(models.Dish.name)
    )
    dishes = result.scalars().all()

    return [dish_to_dict(dish) for dish in dishes]


def dish_to_dict(dish: models.Dish) -> dict:
    return {
        "id": str(dish.id),
        "category_id": dish.category_id,
        "category_name": dish.category.name,
        "name": dish.name,
        "description": dish.description,
        "base_price": float(dish.base_price),
        "calories": dish.calories,
        "spiciness_level": dish.spiciness_level,
        "is_vegetarian": dish.is_vegetarian,
        "image_url": dish.image_url,
        "is_available": dish.is_available,
    }


@app.get("/api/dishes/{dish_id}", response_model=MenuDishResponse)
async def get_dish(dish_id: UUID, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(models.Dish).options(selectinload(models.Dish.category)).where(
            models.Dish.id == dish_id, models.Dish.is_available.is_(True)
        )
    )
    dish = result.scalar_one_or_none()
    if dish is None:
        raise HTTPException(status_code=404, detail="Khong tim thay mon an dang ban")
    return dish_to_dict(dish)


@app.post("/api/interactions/views", response_model=ViewInteractionResponse, status_code=201,
          responses={200: {"description": "Identical event already recorded"},
                     409: {"description": "Event ID conflicts with another event"}})
async def record_dish_view(
    payload: ViewInteractionRequest,
    response: Response,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    return await record_interaction(payload, response, user, db, event_type="view")


@app.post("/api/interactions/add-to-cart", response_model=AddToCartInteractionResponse, status_code=201,
          responses={200: {"description": "Identical event already recorded"},
                     409: {"description": "Event ID conflicts with another event"}})
async def record_dish_add_to_cart(
    payload: AddToCartInteractionRequest,
    response: Response,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    # This records a successful frontend local-cart action; it does not mutate a server cart.
    return await record_interaction(payload, response, user, db, event_type="add_to_cart")


@app.get("/api/orders/{order_id}", response_model=CustomerOrderResponse)
async def read_my_order(
    order_id: UUID,
    response: Response,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    response.headers["Cache-Control"] = "private, no-store"
    return await get_customer_order(db, user, order_id)


@app.get("/api/categories", response_model=list[CategoryResponse])
async def get_categories(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(models.Category).order_by(models.Category.id))
    return result.scalars().all()

@app.post(
    "/api/auth/register",
    status_code=status.HTTP_201_CREATED,
)
async def register(
    payload: RegisterRequest,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(models.User).where(
            models.User.email == payload.email
        )
    )
    existing_user = result.scalar_one_or_none()

    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email da duoc dang ky",
        )

    hashed_password = password_hasher.hash(
        payload.password
    )

    new_user = models.User(
        full_name=payload.full_name,
        email=payload.email,
        password_hash=hashed_password,
        phone_number=payload.phone_number,
        role=models.UserRole.CUSTOMER,
        status=models.UserStatus.ACTIVE,
    )

    try:
        db.add(new_user)
        await db.commit()
        await db.refresh(new_user)

    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email da duoc dang ky",
        )

    return {
        "message": "Dang ky tai khoan thanh cong",
        "user": user_to_dict(new_user),
    }


@app.post("/api/auth/login")
async def login(
    payload: LoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(models.User).where(
            models.User.email == payload.email
        )
    )
    user = result.scalar_one_or_none()

    try:
        valid_password = user is not None and password_hasher.verify(
            payload.password, user.password_hash
        )
    except UnknownHashError:
        valid_password = False
    if not valid_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Email hoac mat khau khong chinh xac",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if user.status != models.UserStatus.ACTIVE:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Tai khoan khong hoat dong",
        )

    access_token = create_access_token(str(user.id))
    response.headers["Cache-Control"] = "no-store"

    return {
        "message": "Dang nhap thanh cong",
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        "user": user_to_dict(user),
    }

@app.get("/api/users/me")
async def get_my_profile(
    response: Response,
    user: models.User = Depends(get_current_user),
):
    response.headers["Cache-Control"] = "no-store"
    return {
        "message": "Lay ho so thanh cong",
        "user": user_to_dict(user),
    }


@app.put("/api/users/me")
async def update_my_profile(
    payload: ProfileUpdateRequest,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user.full_name = payload.full_name
    user.phone_number = payload.phone_number

    try:
        await db.commit()
        await db.refresh(user)

    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Khong the cap nhat ho so",
        )

    return {
        "message": "Cap nhat ho so thanh cong",
        "user": user_to_dict(user),
    }


@app.put("/api/users/me/change-password")
async def change_password(
    payload: ChangePasswordRequest,
    user: models.User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    if payload.new_password != payload.confirm_new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mat khau moi va xac nhan mat khau khong khop",
        )

    if payload.current_password == payload.new_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mat khau moi phai khac mat khau hien tai",
        )

    if not password_hasher.verify(
        payload.current_password,
        user.password_hash,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Mat khau hien tai khong chinh xac",
        )

    user.password_hash = password_hasher.hash(
        payload.new_password
    )

    try:
        await db.commit()

    except SQLAlchemyError:
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Khong the doi mat khau luc nay",
        )

    return {
        "message": "Doi mat khau thanh cong"
    }
