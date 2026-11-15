import hashlib
import json
import unicodedata
import uuid
from decimal import Decimal
from pathlib import Path
import numpy as np
from fastapi import HTTPException
from sqlalchemy import select, func
from models import Category, Dish, Order, OrderItem, OrderStatus, User
from extended_models import CartItem, DishMetadata, Interaction, OrderDetails, Review, CatalogFacts
from catalog_config import CATEGORIES, GROUPS, category_options
from dataset_loader import training_statistics
from recommendation_model import vector, FEATURE_SIZE
from demo_ratings import sample_rating

MENU = json.loads(Path(__file__).with_name("menu_seed.json").read_text(encoding="utf-8"))

def normalize(value):
    return "".join(c for c in unicodedata.normalize("NFD", value.lower().replace("đ", "d")) if unicodedata.category(c) != "Mn")

async def seed_menu(db):
    # Seed only an empty catalogue; never overwrite team data at startup.
    if await db.scalar(select(func.count()).select_from(Dish)):
        return
    for category in MENU["categories"]:
        row = await db.scalar(select(Category).where(Category.name == category["name"]))
        if not row:
            row = Category(name=category["name"], image_url=category["image"])
            db.add(row)
            await db.flush()
        for food in MENU["foods"]:
            if food["categories"][0] != category["id"]:
                continue
            dish = Dish(id=uuid.uuid5(uuid.NAMESPACE_URL, "foodorder:"+food["id"]), category_id=row.id,
                name=food["name"], description=food["description"], base_price=food["price"],
                image_url=food["image"], calories=food["calories"], spiciness_level=food["spiciness"],
                is_vegetarian=food.get("vegetarian", False), is_available=True)
            db.add(dish)
            await db.flush()
            db.add(DishMetadata(dish_id=dish.id, categories=food["categories"], topping_group=food["toppingGroup"]))
    await db.commit()

async def required_dish(db, dish_id, lock=False):
    stmt = select(Dish).where(Dish.id == dish_id)
    if lock:
        stmt = stmt.with_for_update()
    dish = await db.scalar(stmt)
    if not dish:
        raise HTTPException(404, "Không tìm thấy món ăn")
    return dish

async def dish_dict(db, dish):
    meta = await db.get(DishMetadata, dish.id)
    facts = await db.get(CatalogFacts, dish.id)
    flags = facts.facts if facts else {}
    source_id = facts.source_id if facts else None
    demo_rating, demo_review_count = sample_rating(dish.id, source_id)
    stats,_ = training_statistics()
    reference = stats.get(source_id)
    average, count = (await db.execute(select(func.avg(Review.stars), func.count(Review.id)).where(Review.dish_id == dish.id))).one()
    return dict(id=str(dish.id), name=dish.name, description=dish.description,
        base_price=float(dish.base_price), image_url=dish.image_url or "/images/com-tam.png",
        is_available=dish.is_available, calories=dish.calories if flags.get("calories_known",True) else None,
        spiciness_level=dish.spiciness_level if flags.get("spiciness_known",True) else None,
        is_vegetarian=dish.is_vegetarian if flags.get("vegetarian_known",True) else None, categories=meta.categories if meta else ["com"],
        topping_group=meta.topping_group if meta else "rice", average_rating=round(float(average),2) if average else None,
        review_count=count, demo_rating=demo_rating, demo_review_count=demo_review_count,
        demo_rating_source="sample" if demo_rating is not None else None,
        main_ingredient=facts.main_ingredient if facts else None,
        source_category=facts.source_category if facts else None, source_dish_id=source_id,
        source="dishes.csv" if source_id else "store", customizable=flags.get("customizable",True),
        image_is_illustration=(dish.image_url or "").lower().endswith(".svg"),
        reference_rating=round(reference["average"],2) if reference else None,
        reference_count=reference["count"] if reference else 0, reference_source="ratings_train.csv" if reference else None)

async def priced_options(db, dish, options):
    facts = await db.get(CatalogFacts, dish.id)
    if facts and not facts.facts.get("customizable",True) and (options.get("size","S")!="S" or options.get("toppings")):
        raise HTTPException(422,"Món này hiện chỉ có phần tiêu chuẩn, chưa cấu hình size và topping")
    meta = await db.get(DishMetadata, dish.id)
    group = meta.topping_group if meta else "rice"
    toppings = {t["id"]: t for t in MENU["toppings"][group]}
    chosen = sorted(set(options.get("toppings", [])))
    if any(t not in toppings for t in chosen):
        raise HTTPException(422, "Topping không phù hợp với món")
    size = options.get("size", "S")
    if size not in ("S", "M", "L"):
        raise HTTPException(422, "Kích cỡ không hợp lệ")
    price = Decimal(dish.base_price) + {"S":0, "M":10000, "L":20000}[size] + sum(toppings[t]["price"] for t in chosen)
    return price, dict(size=size, toppings=chosen, topping_names=[toppings[t]["name"] for t in chosen], note=options.get("note", ""))

async def cart_dict(db, user_id, lock=False):
    stmt = select(CartItem).where(CartItem.user_id == user_id).order_by(CartItem.id)
    if lock:
        stmt = stmt.with_for_update()
    rows = list((await db.scalars(stmt)).all())
    items, total = [], Decimal(0)
    for item in rows:
        dish = await required_dish(db, item.dish_id, lock)
        price, options = await priced_options(db, dish, item.options)
        subtotal = price * item.quantity
        total += subtotal
        items.append(dict(id=str(item.id), dish=await dish_dict(db, dish), quantity=item.quantity,
            options=options, unit_price=float(price), subtotal=float(subtotal)))
    return dict(items=items, total_amount=float(total), shipping_fee=0, discount_amount=0,
        final_amount=float(total), can_checkout=bool(items) and all(i["dish"]["is_available"] for i in items))

async def record_event(db, user_id, dish_id, kind, source_key, reward, quantity=1):
    old = await db.scalar(select(Interaction).where(Interaction.user_id == user_id, Interaction.source_key == source_key))
    if old:
        if old.dish_id != dish_id or old.kind != kind:
            raise HTTPException(409, "Mã yêu cầu đã được dùng cho tương tác khác")
        old.reward, old.quantity = reward, quantity
    else:
        db.add(Interaction(user_id=user_id, dish_id=dish_id, kind=kind, source_key=source_key, reward=reward, quantity=quantity))

async def order_dict(db, order):
    details = await db.get(OrderDetails, order.id)
    customer = await db.get(User, order.customer_id)
    items = (await db.scalars(select(OrderItem).where(OrderItem.order_id == order.id))).all()
    return dict(id=str(order.id), order_code=order.order_code, customer_name=customer.full_name,
        recipient_name=details.recipient_name if details else customer.full_name,
        phone_number=details.phone_number if details else (customer.phone_number or ""),
        delivery_address=order.delivery_address, note=order.note, status=order.order_status.value,
        rejection_reason=details.rejection_reason if details else None,
        total_amount=float(order.total_amount), shipping_fee=float(order.shipping_fee),
        discount_amount=float(order.discount_amount), final_amount=float(order.final_amount),
        payment_method=order.payment_method.value, created_at=order.created_at.isoformat(),
        items=[dict(id=str(i.id), dish_id=str(i.dish_id), name=i.options_selected.get("dish_name", "Món ăn"),
            quantity=i.quantity, unit_price=float(i.unit_price), subtotal=float(i.subtotal), options=i.options_selected) for i in items])

def features(dish, meta, facts=None):
    categories = meta.categories if meta else ["com"]
    flags=facts.facts if facts else {}
    return vector(dict(base_price=dish.base_price,categories=categories,
        calories=dish.calories if flags.get("calories_known",True) else None,
        spiciness_level=dish.spiciness_level if flags.get("spiciness_known",True) else None,
        is_vegetarian=dish.is_vegetarian if flags.get("vegetarian_known",True) else None,
        main_ingredient=facts.main_ingredient if facts else None))

async def recommendations(db, user_id, limit):
    dishes = list((await db.scalars(select(Dish))).all())
    metas = {m.dish_id:m for m in (await db.scalars(select(DishMetadata))).all()}
    facts = {m.dish_id:m for m in (await db.scalars(select(CatalogFacts))).all()}
    stats,global_mean = training_statistics()
    by_id = {d.id:d for d in dishes}
    events = list((await db.scalars(select(Interaction).where(Interaction.user_id == user_id).order_by(Interaction.created_at, Interaction.id))).all())
    size = FEATURE_SIZE
    a, b = np.eye(size), np.zeros(size)
    for event in events:
        dish = by_id.get(event.dish_id)
        if dish:
            x = features(dish, metas.get(dish.id),facts.get(dish.id))
            a += np.outer(x,x)
            b += event.reward * x
    inverse = np.linalg.inv(a)
    theta = inverse @ b
    scored = []
    for dish in dishes:
        if not dish.is_available:
            continue
        x = features(dish, metas.get(dish.id),facts.get(dish.id))
        reference=stats.get(facts[dish.id].source_id) if dish.id in facts else None
        prior=((reference["weighted"] if reference else global_mean)-1)/4
        # Public training aggregates supply cold start. Private live events remain isolated.
        score = float(theta @ x + .25*np.sqrt(x @ inverse @ x)+.1*prior) if events else prior
        scored.append((score, dish))
    scored.sort(key=lambda item: (-item[0], normalize(item[1].name), str(item[1].id)))
    return dict(mode="personalized" if events else "cold_start", algorithm="LinUCB", interaction_count=len(events),
        cold_start_source="Mức phổ biến từ ratings_train.csv",training_ratings=sum(s['count'] for s in stats.values()),
        revision=hashlib.sha256(json.dumps([(str(e.id), e.reward, e.quantity) for e in events]).encode()).hexdigest()[:16],
        items=[dict(**(await dish_dict(db,d)), score=round(score,8)) for score,d in scored[:limit]])
