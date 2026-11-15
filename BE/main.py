from contextlib import asynccontextmanager
from datetime import datetime, timedelta
import hashlib
import json
import os
import secrets
import uuid
from decimal import Decimal
from uuid import UUID
from fastapi import FastAPI, Depends, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy import select, delete, update, func
from sqlalchemy.exc import IntegrityError
from pwdlib import PasswordHash
from database import AsyncSessionLocal, engine, get_db, init_db, ping_db
from models import User, UserRole, UserStatus, Category, Dish, Order, OrderItem, OrderStatus, PaymentMethod, PaymentStatus
from extended_models import Session, CartItem, DishMetadata, OrderDetails, Review, Interaction
from contracts import Register, Login, Profile, Password, DishInput, Availability, AdminUserUpdate, CartAdd, Quantity, Checkout, Recipient, StatusChange, Rating, View
from services import seed_menu, required_dish, dish_dict, cart_dict, order_dict, priced_options, record_event, recommendations, normalize, MENU, GROUPS
from time_utils import utcnow
from contracts import ChatRequest
from chat_service import chat as answer_chat, capabilities as chat_capabilities
from catalog_config import category_options, CATEGORY_LABELS
from dataset_loader import import_dataset
from extended_models import CatalogFacts, DatasetImport
from catalog_photos import apply_catalog_photos

password_hash = PasswordHash.recommended()
bearer = HTTPBearer(auto_error=False)
DB = Depends(get_db)

def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()

def user_dict(u):
    return dict(id=str(u.id), full_name=u.full_name, email=u.email, phone_number=u.phone_number, role=u.role.value, status=u.status.value)

async def optional_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer), db=DB):
    if not credentials:
        return None
    session = await db.get(Session, digest(credentials.credentials))
    if not session or session.expires_at <= utcnow():
        raise HTTPException(401, 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.')
    user = await db.get(User, session.user_id)
    if not user or user.status != UserStatus.ACTIVE:
        raise HTTPException(401, 'Tài khoản không hoạt động')
    return user

async def current_user(user=Depends(optional_user)):
    if not user:
        raise HTTPException(401, 'Vui lòng đăng nhập')
    return user

async def admin_user(user=Depends(current_user)):
    if user.role != UserRole.ADMIN:
        raise HTTPException(403, 'Chỉ quản trị viên được thực hiện thao tác này')
    return user

USER = Depends(current_user)
ADMIN = Depends(admin_user)

@asynccontextmanager
async def lifespan(app):
    await init_db()
    async with AsyncSessionLocal() as db:
        if os.getenv('SEED_MENU', '1') == '1':
            await seed_menu(db)
            await import_dataset(db)
            await apply_catalog_photos(db)
    yield
    await engine.dispose()

app = FastAPI(title='FoodOrder API', version='2.0.0', lifespan=lifespan)
app.add_middleware(CORSMiddleware,
    allow_origins=os.getenv('CORS_ORIGINS','http://127.0.0.1:3000,http://localhost:3000,http://127.0.0.1:3001,http://localhost:3001').split(','),
    allow_methods=['GET','POST','PUT','PATCH','DELETE','OPTIONS'], allow_headers=['Authorization','Content-Type'])

@app.get('/')
async def root():
    return {'message':'FoodOrder API', 'docs':'/docs'}

@app.get('/api/health')
async def health():
    await ping_db()
    return {'status':'ok', 'version':'2.0.0'}

@app.post('/api/auth/register', status_code=201)
async def register(data: Register, db=DB):
    email = str(data.email).lower()
    if await db.scalar(select(User).where(User.email == email)):
        raise HTTPException(409, 'Email đã được sử dụng')
    user = User(full_name=data.full_name, email=email, phone_number=data.phone_number,
        password_hash=password_hash.hash(data.password), role=UserRole.CUSTOMER, status=UserStatus.ACTIVE)
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(409, 'Email đã được sử dụng')
    return {'message':'Đăng ký thành công. Bạn có thể đăng nhập.', 'user':user_dict(user)}

async def issue_login(data: Login, db, admin_only=False):
    user = await db.scalar(select(User).where(User.email == str(data.email).lower()))
    valid = False
    if user:
        try:
            valid = password_hash.verify(data.password, user.password_hash)
        except Exception:
            valid = False
    if not valid or user.status != UserStatus.ACTIVE:
        raise HTTPException(401, 'Email hoặc mật khẩu không đúng')
    if admin_only and user.role != UserRole.ADMIN:
        raise HTTPException(403, 'Đây là tài khoản khách hàng. Vui lòng đăng nhập ở trang khách hàng.')
    token = secrets.token_urlsafe(32)
    expiry = utcnow()+timedelta(hours=24)
    db.add(Session(token_hash=digest(token), user_id=user.id, expires_at=expiry))
    await db.commit()
    return dict(access_token=token, token_type='bearer', expires_at=expiry.isoformat(), user=user_dict(user))

@app.post('/api/auth/login')
async def login(data: Login, db=DB):
    return await issue_login(data,db)

@app.post('/api/admin/auth/login')
async def login_admin(data: Login, db=DB):
    return await issue_login(data,db,admin_only=True)

@app.post('/api/auth/logout')
async def logout(user=USER, credentials: HTTPAuthorizationCredentials=Depends(bearer), db=DB):
    await db.execute(delete(Session).where(Session.token_hash == digest(credentials.credentials)))
    await db.commit()
    return {'message':'Đã đăng xuất'}

@app.get('/api/users/me')
async def me(user=USER):
    return user_dict(user)

@app.put('/api/users/me')
async def profile(data: Profile, user=USER, db=DB):
    user.full_name, user.phone_number = data.full_name, data.phone_number
    await db.commit()
    return user_dict(user)

@app.put('/api/users/me/change-password')
async def change_password(data: Password, user=USER, db=DB):
    if not password_hash.verify(data.current_password, user.password_hash):
        raise HTTPException(400, 'Mật khẩu hiện tại không đúng')
    user.password_hash = password_hash.hash(data.new_password)
    await db.execute(delete(Session).where(Session.user_id == user.id))
    await db.commit()
    return {'message':'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.'}

@app.get('/api/categories')
async def categories():
    return category_options()

@app.get('/api/dishes')
async def dishes(search: str=Query(default='', max_length=150), category: str='',
    ingredient: str=Query(default='',max_length=100),min_price: float|None=Query(default=None,ge=0),
    max_price: float|None=Query(default=None,ge=0),available_only: bool=False,
    sort: str=Query(default='name',pattern='^(name|price_asc|price_desc|rating|popular|demo_rating)$'),db=DB):
    rows = (await db.scalars(select(Dish).order_by(Dish.name))).all()
    result = []
    for dish in rows:
        if normalize(search.strip()) not in normalize(dish.name):
            continue
        item = await dish_dict(db,dish)
        if category and category not in item['categories'] and not (category=='bun' and 'mon-nuoc' in item['categories']):
            continue
        if ingredient and normalize(ingredient) not in normalize(item['main_ingredient'] or ''):continue
        if min_price is not None and item['base_price']<min_price:continue
        if max_price is not None and item['base_price']>max_price:continue
        if available_only and not item['is_available']:continue
        result.append(item)
    if sort in {'price_asc','price_desc'}:result.sort(key=lambda i:i['base_price'],reverse=sort=='price_desc')
    if sort in {'rating','popular'}:result.sort(key=lambda i:((i['average_rating'] if i['average_rating'] is not None else i['reference_rating']) or 0,i['review_count']+i['reference_count']),reverse=True)
    if sort=='demo_rating':result.sort(key=lambda i:(i['demo_rating'] or 0,i['demo_review_count']),reverse=True)
    return result

@app.get('/api/catalog/summary')
async def catalog_summary(db=DB):
    rows=(await db.scalars(select(CatalogFacts))).all()
    imported=await db.get(DatasetImport,'food-ratings-csv')
    return dict(ingredients=sorted({r.main_ingredient for r in rows if r.main_ingredient}),
        dataset=imported.summary if imported else None,
        provenance='Điểm tham khảo lấy từ tập học; đánh giá mua hàng trên web được tính riêng.')

@app.get('/api/dishes/{dish_id}')
async def detail(dish_id: UUID, db=DB):
    return await dish_dict(db, await required_dish(db,dish_id))

@app.post('/api/dishes/{dish_id}/views')
async def view(dish_id: UUID, data: View, user=USER, db=DB):
    await required_dish(db, dish_id)
    await record_event(db,user.id,dish_id,'view','view:'+data.request_key,.1)
    await db.commit()
    return {'message':'Đã ghi nhận lượt xem'}

async def save_dish(db, data, dish=None):
    category = next(c for c in category_options() if c['id'] == data.category)
    cat = await db.scalar(select(Category).where(Category.name == category['name']))
    if not cat:
        cat = Category(name=category['name'], image_url=category['image'])
        db.add(cat)
        await db.flush()
    values = data.model_dump(exclude={'category','main_ingredient','customizable'})
    values.update(calories=data.calories or 0,spiciness_level=data.spiciness_level or 0,is_vegetarian=data.is_vegetarian is True)
    values['category_id'] = cat.id
    if dish is None:
        dish = Dish(**values)
        db.add(dish)
        await db.flush()
    else:
        for key,value in values.items():
            setattr(dish,key,value)
    meta = await db.get(DishMetadata, dish.id)
    cats = [data.category]
    if data.is_vegetarian and 'chay' not in cats:
        cats.append('chay')
    if not meta:
        db.add(DishMetadata(dish_id=dish.id, categories=cats, topping_group=GROUPS[data.category]))
    else:
        meta.categories, meta.topping_group = cats, GROUPS[data.category]
    facts=await db.get(CatalogFacts,dish.id)
    flags={'calories_known':data.calories is not None,'spiciness_known':data.spiciness_level is not None,
        'vegetarian_known':data.is_vegetarian is not None,'customizable':data.customizable}
    if facts:
        facts.main_ingredient=data.main_ingredient;facts.facts={**facts.facts,**flags}
    else:db.add(CatalogFacts(dish_id=dish.id,main_ingredient=data.main_ingredient,facts=flags))
    await db.commit()
    return await dish_dict(db,dish)

@app.post('/api/admin/dishes', status_code=201)
async def create_dish(data: DishInput, user=ADMIN, db=DB):
    return await save_dish(db,data)

@app.put('/api/admin/dishes/{dish_id}')
async def edit_dish(dish_id: UUID, data: DishInput, user=ADMIN, db=DB):
    return await save_dish(db,data,await required_dish(db,dish_id,True))

@app.patch('/api/admin/dishes/{dish_id}/availability')
async def availability(dish_id: UUID, data: Availability, user=ADMIN, db=DB):
    dish = await required_dish(db,dish_id,True)
    dish.is_available = data.is_available
    await db.commit()
    return await dish_dict(db,dish)

@app.get('/api/admin/overview')
async def admin_overview(user=ADMIN, db=DB):
    user_count = await db.scalar(select(func.count()).select_from(User))
    dish_count = await db.scalar(select(func.count()).select_from(Dish))
    available_count = await db.scalar(select(func.count()).select_from(Dish).where(Dish.is_available.is_(True)))
    category_count = await db.scalar(select(func.count()).select_from(Category))
    order_count = await db.scalar(select(func.count()).select_from(Order))
    completed_count = await db.scalar(select(func.count()).select_from(Order).where(Order.order_status == OrderStatus.COMPLETED))
    revenue = await db.scalar(select(func.coalesce(func.sum(Order.final_amount),0)).where(Order.order_status == OrderStatus.COMPLETED))
    status_rows = (await db.execute(select(Order.order_status,func.count()).group_by(Order.order_status))).all()
    top_rows = (await db.execute(
        select(Dish.name,func.sum(OrderItem.quantity).label('quantity'),func.sum(OrderItem.subtotal).label('amount'))
        .join(OrderItem,OrderItem.dish_id == Dish.id).join(Order,Order.id == OrderItem.order_id)
        .where(Order.order_status == OrderStatus.COMPLETED)
        .group_by(Dish.id,Dish.name).order_by(func.sum(OrderItem.quantity).desc(),Dish.name).limit(8)
    )).all()
    return dict(users=user_count,dishes=dish_count,available_dishes=available_count,categories=category_count,
        total_orders=order_count,completed_orders=completed_count,revenue=float(revenue or 0),
        status_counts={status.value:count for status,count in status_rows},
        top_dishes=[dict(name=name,quantity=quantity,amount=float(amount or 0)) for name,quantity,amount in top_rows])

@app.get('/api/admin/users')
async def admin_users(user=ADMIN, db=DB):
    rows = (await db.execute(
        select(User,func.count(Order.id)).outerjoin(Order,Order.customer_id == User.id)
        .group_by(User.id).order_by(User.created_at.desc(),User.email)
    )).all()
    return [dict(**user_dict(row),order_count=count,created_at=row.created_at.isoformat()) for row,count in rows]

@app.patch('/api/admin/users/{user_id}')
async def admin_update_user(user_id: UUID,data: AdminUserUpdate,user=ADMIN,db=DB):
    target = await db.scalar(select(User).where(User.id == user_id).with_for_update())
    if not target:
        raise HTTPException(404,'Không tìm thấy tài khoản')
    if target.id == user.id:
        raise HTTPException(409,'Không thể đổi quyền hoặc khóa chính tài khoản đang đăng nhập')
    target.role = UserRole(data.role)
    target.status = UserStatus(data.status)
    if target.status != UserStatus.ACTIVE:
        await db.execute(delete(Session).where(Session.user_id == target.id))
    await db.commit()
    return user_dict(target)

@app.get('/api/admin/categories')
async def admin_categories(user=ADMIN,db=DB):
    rows = (await db.execute(
        select(Category,func.count(Dish.id)).outerjoin(Dish,Dish.category_id == Category.id)
        .group_by(Category.id).order_by(Category.name)
    )).all()
    return [dict(id=category.id,name=category.name,image_url=category.image_url,dish_count=count) for category,count in rows]

@app.get('/api/cart')
async def cart(user=USER, db=DB):
    return await cart_dict(db,user.id)

async def lock_customer(db, user_id):
    # Row lock on databases that implement it; SQLite is locked in get_db.
    await db.scalar(select(User).where(User.id == user_id).with_for_update())

@app.post('/api/cart/items')
async def add_cart(data: CartAdd, user=USER, db=DB):
    await lock_customer(db,user.id)
    dish = await required_dish(db,data.dish_id,True)
    if not dish.is_available:
        raise HTTPException(409,'Món đã hết, không thể thêm vào giỏ')
    _, options = await priced_options(db,dish,data.model_dump())
    signature = digest(json.dumps([str(dish.id),options],sort_keys=True,ensure_ascii=False))
    item = await db.scalar(select(CartItem).where(CartItem.user_id == user.id,CartItem.signature == signature))
    if item:
        if item.quantity + data.quantity > 99:
            raise HTTPException(422,'Số lượng tối đa là 99')
        item.quantity += data.quantity
    else:
        db.add(CartItem(user_id=user.id,dish_id=dish.id,signature=signature,quantity=data.quantity,options=options))
    await record_event(db,user.id,dish.id,'cart','cart:'+str(uuid.uuid4()),.4,data.quantity)
    await db.commit()
    return await cart_dict(db,user.id)

async def owned_cart_item(db,user_id,item_id):
    await lock_customer(db,user_id)
    item = await db.scalar(select(CartItem).where(CartItem.id == item_id,CartItem.user_id == user_id).with_for_update())
    if not item:
        raise HTTPException(404,'Không tìm thấy món trong giỏ')
    return item

@app.put('/api/cart/items/{item_id}')
async def quantity(item_id: UUID, data: Quantity, user=USER, db=DB):
    item = await owned_cart_item(db,user.id,item_id)
    dish = await required_dish(db,item.dish_id,True)
    if not dish.is_available:
        raise HTTPException(409,'Món đã hết, vui lòng xóa khỏi giỏ')
    item.quantity = data.quantity
    await db.commit()
    return await cart_dict(db,user.id)

@app.delete('/api/cart/items/{item_id}')
async def remove_cart(item_id: UUID, user=USER, db=DB):
    await db.delete(await owned_cart_item(db,user.id,item_id))
    await db.commit()
    return await cart_dict(db,user.id)

@app.post('/api/orders/preview')
async def preview(data: Recipient, user=USER, db=DB):
    result = await cart_dict(db,user.id)
    if not result['can_checkout']:
        raise HTTPException(409,'Giỏ trống hoặc có món đã hết. Vui lòng kiểm tra giỏ hàng.')
    return dict(**result,recipient=data.model_dump())

@app.post('/api/orders',status_code=201)
async def checkout(data: Checkout,user=USER,db=DB):
    await lock_customer(db,user.id)
    previous = await db.scalar(select(OrderDetails).where(OrderDetails.user_id == user.id,OrderDetails.request_key == data.request_key))
    if previous:
        return await order_dict(db,await db.get(Order,previous.order_id))
    cart = await cart_dict(db,user.id,True)
    if not cart['can_checkout']:
        raise HTTPException(409,'Giỏ trống hoặc có món đã hết. Chưa tạo đơn hàng.')
    if data.expected_total is not None and data.expected_total != Decimal(str(cart['final_amount'])):
        raise HTTPException(409,'Giá món đã thay đổi. Vui lòng kiểm tra lại thông tin đặt hàng.')
    order = Order(order_code='FD'+utcnow().strftime('%y%m%d')+secrets.token_hex(5).upper(), customer_id=user.id,
        delivery_address=data.delivery_address, total_amount=cart['total_amount'], shipping_fee=0,discount_amount=0,
        final_amount=cart['final_amount'],order_status=OrderStatus.PENDING,payment_method=PaymentMethod.COD,
        payment_status=PaymentStatus.UNPAID,note=data.note)
    db.add(order)
    await db.flush()
    db.add(OrderDetails(order_id=order.id,user_id=user.id,request_key=data.request_key,
        recipient_name=data.recipient_name,phone_number=data.phone_number))
    for item in cart['items']:
        db.add(OrderItem(order_id=order.id,dish_id=UUID(item['dish']['id']),quantity=item['quantity'],
            unit_price=item['unit_price'],subtotal=item['subtotal'],options_selected={**item['options'],'dish_name':item['dish']['name']}))
    await db.execute(delete(CartItem).where(CartItem.user_id == user.id))
    await db.commit()
    return await order_dict(db,order)

@app.get('/api/orders')
async def orders(user=USER,db=DB):
    rows = (await db.scalars(select(Order).where(Order.customer_id == user.id).order_by(Order.created_at.desc(),Order.id.desc()))).all()
    return [await order_dict(db,o) for o in rows]

@app.get('/api/orders/{order_id}')
async def own_order(order_id: UUID,user=USER,db=DB):
    order = await db.scalar(select(Order).where(Order.id == order_id,Order.customer_id == user.id))
    if not order:
        raise HTTPException(404,'Không tìm thấy đơn hàng')
    return await order_dict(db,order)

@app.get('/api/admin/orders')
async def admin_orders(user=ADMIN,db=DB):
    rows = (await db.scalars(select(Order).order_by(Order.created_at.desc(),Order.id.desc()))).all()
    return [await order_dict(db,o) for o in rows]

@app.patch('/api/admin/orders/{order_id}/status')
async def change_status(order_id: UUID,data: StatusChange,user=ADMIN,db=DB):
    order = await db.scalar(select(Order).where(Order.id == order_id).with_for_update())
    if not order:
        raise HTTPException(404,'Không tìm thấy đơn hàng')
    previous = order.order_status
    allowed = {OrderStatus.PENDING:{'preparing','cancelled'},OrderStatus.PREPARING:{'completed'}}
    if data.status not in allowed.get(previous,set()):
        raise HTTPException(409,'Không thể chuyển trạng thái đơn theo yêu cầu')
    if data.status == 'cancelled' and not data.reason:
        raise HTTPException(422,'Vui lòng nhập lý do từ chối')
    result = await db.execute(update(Order).where(Order.id == order_id,Order.order_status == previous).values(order_status=OrderStatus(data.status)))
    if result.rowcount != 1:
        raise HTTPException(409,'Đơn đã được xử lý bởi phiên khác')
    details = await db.get(OrderDetails,order_id)
    if data.status == 'cancelled':
        if not details:
            details = OrderDetails(order_id=order_id,user_id=order.customer_id,request_key='legacy:'+str(order_id),recipient_name='',phone_number='')
            db.add(details)
        details.rejection_reason = data.reason
    if data.status == 'completed':
        items = (await db.scalars(select(OrderItem).where(OrderItem.order_id == order.id))).all()
        quantities = {}
        for item in items:
            quantities[item.dish_id] = quantities.get(item.dish_id,0)+item.quantity
        for dish_id,qty in quantities.items():
            await record_event(db,order.customer_id,dish_id,'purchase',f'purchase:{order.id}:{dish_id}',.8,qty)
    await db.commit()
    await db.refresh(order)
    return await order_dict(db,order)

@app.get('/api/admin/orders/{order_id}')
async def admin_order_detail(order_id: UUID,user=ADMIN,db=DB):
    order = await db.get(Order,order_id)
    if not order:
        raise HTTPException(404,'Không tìm thấy đơn hàng')
    return await order_dict(db,order)

@app.get('/api/dishes/{dish_id}/reviews')
async def reviews(dish_id: UUID,db=DB):
    await required_dish(db,dish_id)
    rows = (await db.execute(select(Review,User.full_name).join(User,Review.user_id == User.id).where(Review.dish_id == dish_id).order_by(Review.updated_at.desc()))).all()
    return {'average_rating':round(sum(r.stars for r,_ in rows)/len(rows),2) if rows else None,
        'count':len(rows),'items':[dict(id=str(r.id),author=name,stars=r.stars,comment=r.comment,updated_at=r.updated_at.isoformat()) for r,name in rows]}

@app.put('/api/dishes/{dish_id}/reviews')
async def rate(dish_id: UUID,data: Rating,user=USER,db=DB):
    await lock_customer(db,user.id)
    order = await db.scalar(select(Order).where(Order.id == data.order_id,Order.customer_id == user.id))
    purchased = await db.scalar(select(OrderItem).where(OrderItem.order_id == data.order_id,OrderItem.dish_id == dish_id))
    if not order or order.order_status != OrderStatus.COMPLETED or not purchased:
        raise HTTPException(403,'Chỉ được đánh giá món thuộc đơn của bạn đã hoàn thành')
    review = await db.scalar(select(Review).where(Review.user_id == user.id,Review.order_id == order.id,Review.dish_id == dish_id))
    if not review:
        review = Review(user_id=user.id,order_id=order.id,dish_id=dish_id,stars=data.stars,comment=data.comment)
        db.add(review)
        await db.flush()
    review.stars,review.comment,review.updated_at = data.stars,data.comment,utcnow()
    await record_event(db,user.id,dish_id,'rating','rating:'+str(review.id),(data.stars-3)/2)
    await db.commit()
    return {'message':'Đã lưu đánh giá và cập nhật sở thích của bạn'}

@app.get('/api/recommendations')
async def suggest(limit: int=Query(default=6,ge=1,le=50),user=USER,db=DB):
    return await recommendations(db,user.id,limit)

@app.get('/api/assistant/status')
async def assistant_status():
    return chat_capabilities()

@app.post('/api/assistant/chat')
async def assistant_chat(data: ChatRequest,user=Depends(optional_user),db=DB):
    # This endpoint reads only. It never creates cart items, orders or ratings.
    user_id = user.id if user else None
    await db.rollback()
    return await answer_chat(db,user_id,data)
