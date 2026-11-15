"""Acceptance scenarios use an isolated SQLite file, never the user's database."""
import os
from pathlib import Path
import tempfile
import uuid
import asyncio
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
import pytest

test_dir = tempfile.TemporaryDirectory(prefix="foodorder-tests-")
os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///"+(Path(test_dir.name)/"test.db").as_posix()
os.environ["SEED_MENU"] = "1"

from fastapi.testclient import TestClient
from sqlalchemy import select, func
from main import app, password_hash
from database import AsyncSessionLocal, engine
from models import User, UserRole, UserStatus, Dish, Order, OrderStatus, OrderItem
from extended_models import Interaction, Review, Session

PASSWORD="Test-password-2026"

def ok(response,status=200):
    assert response.status_code==status,response.text
    return response.json()

@pytest.fixture(scope="module")
def client():
    with TestClient(app) as c:
        async def setup():
            async with AsyncSessionLocal() as db:
                db.add(User(full_name="Test Admin",email="admin@example.com",phone_number="0901234567",
                    password_hash=password_hash.hash(PASSWORD),role=UserRole.ADMIN,status=UserStatus.ACTIVE))
                await db.commit()
        c.portal.call(setup)
        yield c

def account(c):
    email=uuid.uuid4().hex+"@example.com"
    data=dict(full_name="Khách kiểm thử",email=email,phone_number="0901234567",password=PASSWORD,confirm_password=PASSWORD)
    ok(c.post('/api/auth/register',json=data),201)
    auth=ok(c.post('/api/auth/login',json=dict(email=email,password=PASSWORD)))
    return {'Authorization':'Bearer '+auth['access_token']},auth['user'],data

@pytest.fixture
def customer(client):
    return account(client)

@pytest.fixture
def admin(client):
    auth=ok(client.post('/api/auth/login',json=dict(email='admin@example.com',password=PASSWORD)))
    return {'Authorization':'Bearer '+auth['access_token']}

def dish(c):
    return next(d for d in ok(c.get('/api/dishes')) if d['is_available'] and d['customizable'])

def add(c,h,d=None,**extra):
    return c.post('/api/cart/items',headers=h,json={'dish_id':(d or dish(c))['id'],**extra})

def checkout(c,h,**extra):
    return c.post('/api/orders',headers=h,json=dict(recipient_name='Người nhận',phone_number='0901234567',delivery_address='12 Đường Kiểm Thử, Hà Nội',request_key=uuid.uuid4().hex,**extra))

def completed(c,h,a,d=None):
    d=d or dish(c)
    ok(add(c,h,d));o=ok(checkout(c,h),201)
    ok(c.patch(f"/api/admin/orders/{o['id']}/status",headers=a,json={'status':'preparing'}))
    ok(c.patch(f"/api/admin/orders/{o['id']}/status",headers=a,json={'status':'completed'}))
    return o,d

def new_dish(c,a,**extra):
    return ok(c.post('/api/admin/dishes',headers=a,json=dict(name='Món kiểm thử '+uuid.uuid4().hex[:6],description='Mô tả',base_price=50000,image_url='/images/pho.png',**extra)),201)

def events(c,user_id,kind=None):
    async def fetch():
        async with AsyncSessionLocal() as db:
            stmt=select(Interaction).where(Interaction.user_id==uuid.UUID(user_id))
            if kind:stmt=stmt.where(Interaction.kind==kind)
            return [dict(dish_id=str(e.dish_id),reward=e.reward,quantity=e.quantity) for e in (await db.scalars(stmt)).all()]
    return c.portal.call(fetch)

def test_US1_1_registration(client):
    h,u,data=account(client)
    assert u['role']=='customer'
    assert client.post('/api/auth/register',json=data).status_code==409
    for bad in [{'phone_number':'abc'},{'phone_number':'123'},{'full_name':' '},{'email':'not-email'},{'confirm_password':'different'},{'role':'admin'}]:
        assert client.post('/api/auth/register',json={**data,'email':uuid.uuid4().hex+'@example.com',**bad}).status_code==422

def test_US1_2_login(client,customer):
    h,u,d=customer
    assert ok(client.get('/api/users/me',headers=h))['id']==u['id']
    assert client.get('/api/users/me').status_code==401
    assert client.post('/api/auth/login',json={'email':d['email'],'password':'wrong'}).status_code==401

def test_US1_3_logout_revokes_old_session(client,customer):
    h,_,_=customer
    ok(client.post('/api/auth/logout',headers=h))
    assert client.get('/api/users/me',headers=h).status_code==401
    assert client.get('/api/cart',headers=h).status_code==401

def test_US2_1_catalogue_has_sold_out(client,admin):
    d=new_dish(client,admin,is_available=False)
    rows=ok(client.get('/api/dishes'))
    assert any(r['id']==d['id'] and not r['is_available'] for r in rows)
    assert all('image_url' in r and 'base_price' in r for r in rows)

def test_US2_2_exact_detail_and_unavailable(client,customer,admin):
    h,_,_=customer
    d=new_dish(client,admin,is_available=False)
    assert ok(client.get('/api/dishes/'+d['id']))==d
    assert add(client,h,d).status_code==409
    assert client.get('/api/dishes/'+str(uuid.uuid4())).status_code==404

def test_US2_3_search_name_only(client):
    rows=ok(client.get('/api/dishes',params={'search':'pho'}))
    from services import normalize
    assert rows and all('pho' in normalize(r['name']) for r in rows)
    assert any('Pizza' in r['name'] for r in rows)  # phô and phở both match an unaccented search
    assert ok(client.get('/api/dishes',params={'search':'zzzz-no-match'}))==[]

def test_US3_1_persistent_cart_and_server_prices(client,customer):
    h,u,_=customer;d=dish(client)
    cart=ok(add(client,h,d,quantity=2,size='M'))
    assert cart['total_amount']==(d['base_price']+10000)*2
    assert ok(client.get('/api/cart',headers=h))==cart
    assert add(client,h,d,unit_price=1).status_code==422

def test_US3_2_positive_integer_quantity_and_owner(client,customer):
    h,_,_=customer;other,_,_=account(client)
    item=ok(add(client,h))['items'][0]
    path='/api/cart/items/'+item['id']
    for value in [0,-1,1.5,True,100]:
        assert client.put(path,headers=h,json={'quantity':value}).status_code==422
    assert client.put(path,headers=other,json={'quantity':2}).status_code==404
    assert ok(client.put(path,headers=h,json={'quantity':3}))['total_amount']==item['unit_price']*3

def test_US3_3_remove_cart_item(client,customer):
    h,_,_=customer;item=ok(add(client,h))['items'][0]
    assert ok(client.delete('/api/cart/items/'+item['id'],headers=h))['items']==[]

def test_US3_4_recipient_validation(client,customer):
    h,_,_=customer;ok(add(client,h))
    for bad in [{'recipient_name':' '},{'phone_number':'abcd'},{'delivery_address':''}]:
        payload=dict(recipient_name='A',phone_number='0901234567',delivery_address='12 Hà Nội',request_key=uuid.uuid4().hex)
        payload.update(bad)
        assert client.post('/api/orders',headers=h,json=payload).status_code==422
    assert ok(client.get('/api/orders',headers=h))==[]

def test_US3_5_atomic_checkout_and_idempotency(client,customer):
    h,_,_=customer;d=dish(client);ok(add(client,h,d,quantity=2));key=uuid.uuid4().hex
    payload=dict(recipient_name='A',phone_number='0901234567',delivery_address='12 Hà Nội',request_key=key)
    preview=ok(client.post('/api/orders/preview',headers=h,json={k:v for k,v in payload.items() if k!='request_key'}))
    o=ok(client.post('/api/orders',headers=h,json=payload),201)
    assert o['status']=='pending' and o['final_amount']==preview['final_amount']==2*d['base_price']
    assert ok(client.get('/api/cart',headers=h))['items']==[]
    assert ok(client.post('/api/orders',headers=h,json=payload),201)['id']==o['id']
    assert checkout(client,h).status_code==409
    assert len(ok(client.get('/api/orders',headers=h)))==1

def test_US4_1_status_and_ownership(client,customer,admin):
    h,_,_=customer;other,_,_=account(client);ok(add(client,h));o=ok(checkout(client,h),201)
    assert client.get('/api/orders/'+o['id'],headers=other).status_code==404
    ok(client.patch('/api/admin/orders/'+o['id']+'/status',headers=admin,json={'status':'preparing'}))
    assert ok(client.get('/api/orders/'+o['id'],headers=h))['status']=='preparing'

def test_US4_2_history_isolation(client,customer):
    h,_,_=customer;other,_,_=account(client)
    assert ok(client.get('/api/orders',headers=h))==[]
    ok(add(client,h));o=ok(checkout(client,h),201)
    assert ok(client.get('/api/orders',headers=h))[0]['id']==o['id']
    assert ok(client.get('/api/orders',headers=other))==[]

def test_US5_1_reviews_only_owned_completed_purchase(client,customer,admin):
    h,_,_=customer;other,_,_=account(client);d=dish(client);ok(add(client,h,d));o=ok(checkout(client,h),201)
    path='/api/dishes/'+d['id']+'/reviews';payload={'order_id':o['id'],'stars':5,'comment':'Ngon'}
    assert client.put(path,headers=h,json=payload).status_code==403
    ok(client.patch('/api/admin/orders/'+o['id']+'/status',headers=admin,json={'status':'preparing'}))
    ok(client.patch('/api/admin/orders/'+o['id']+'/status',headers=admin,json={'status':'completed'}))
    assert client.put(path,headers=other,json=payload).status_code==403
    for stars in [0,6,2.5,True]:
        assert client.put(path,headers=h,json={**payload,'stars':stars}).status_code==422
    assert client.put(path,headers=h,json={**payload,'comment':'x'*1001}).status_code==422
    ok(client.put(path,headers=h,json=payload))
    assert client.put('/api/dishes/'+str(uuid.uuid4())+'/reviews',headers=h,json=payload).status_code==403

def test_US5_2_review_average_and_isolation(client,customer,admin):
    h,_,_=customer;d=new_dish(client,admin);o,_=completed(client,h,admin,d)
    assert ok(client.get('/api/dishes/'+d['id']+'/reviews'))['count']==0
    path='/api/dishes/'+d['id']+'/reviews';ok(client.put(path,headers=h,json={'order_id':o['id'],'stars':4,'comment':'Ổn'}))
    h2,_,_=account(client);o2,_=completed(client,h2,admin,d)
    ok(client.put(path,headers=h2,json={'order_id':o2['id'],'stars':2}))
    r=ok(client.get(path));assert r['average_rating']==3 and r['count']==2
    assert ok(client.get('/api/dishes/'+dish(client)['id']+'/reviews'))['count']!=2 or dish(client)['id']!=d['id']

def test_US6_1_admin_create_and_zero_price(client,customer,admin):
    h,_,_=customer
    assert client.post('/api/admin/dishes',headers=h,json={}).status_code==403
    d=ok(client.post('/api/admin/dishes',headers=admin,json={'name':'Món tặng','description':'','base_price':0,'image_url':'/images/pho.png'}),201)
    assert ok(client.get('/api/dishes/'+d['id']))['base_price']==0
    for bad in [{'name':' '},{'base_price':-1},{'image_url':'javascript:alert(1)'}]:
        assert client.post('/api/admin/dishes',headers=admin,json={'name':'A','description':'','base_price':1,'image_url':'/images/pho.png',**bad}).status_code==422

def test_US6_2_atomic_edit(client,admin):
    d=new_dish(client,admin);payload={k:d[k] for k in ['name','description','base_price','image_url','is_available']}
    assert client.put('/api/admin/dishes/'+d['id'],headers=admin,json={**payload,'name':'Không được lưu','base_price':-1}).status_code==422
    assert ok(client.get('/api/dishes/'+d['id']))['name']==d['name']
    edited=ok(client.put('/api/admin/dishes/'+d['id'],headers=admin,json={**payload,'name':'Đã sửa','base_price':12345}))
    assert edited['name']=='Đã sửa' and edited['base_price']==12345

def test_US6_3_availability_rechecked_at_checkout(client,customer,admin):
    h,_,_=customer;d=new_dish(client,admin);ok(add(client,h,d))
    ok(client.patch('/api/admin/dishes/'+d['id']+'/availability',headers=admin,json={'is_available':False}))
    assert add(client,h,d).status_code==409 and checkout(client,h).status_code==409
    assert not ok(client.get('/api/cart',headers=h))['can_checkout']
    assert ok(client.get('/api/orders',headers=h))==[]

def test_US7_1_admin_orders_and_details(client,customer,admin):
    h,_,_=customer;ok(add(client,h,quantity=2));o=ok(checkout(client,h),201)
    assert client.get('/api/admin/orders',headers=h).status_code==403
    row=next(x for x in ok(client.get('/api/admin/orders',headers=admin)) if x['id']==o['id'])
    assert row['recipient_name']=='Người nhận' and row['phone_number']=='0901234567' and row['items'][0]['quantity']==2
    assert ok(client.get('/api/admin/orders/'+o['id'],headers=admin))==row
    assert client.get('/api/admin/orders/'+o['id'],headers=h).status_code==403

def test_US7_2_confirm_pending_only(client,customer,admin):
    h,_,_=customer;ok(add(client,h));o=ok(checkout(client,h),201);path='/api/admin/orders/'+o['id']+'/status'
    assert client.patch(path,headers=h,json={'status':'preparing'}).status_code==403
    ok(client.patch(path,headers=admin,json={'status':'preparing'}))
    assert client.patch(path,headers=admin,json={'status':'preparing'}).status_code==409

def test_US7_3_reject_with_reason(client,customer,admin):
    h,u,_=customer;ok(add(client,h));o=ok(checkout(client,h),201);path='/api/admin/orders/'+o['id']+'/status'
    assert client.patch(path,headers=admin,json={'status':'cancelled','reason':' '}).status_code==422
    ok(client.patch(path,headers=admin,json={'status':'cancelled','reason':'Hết nguyên liệu'}))
    assert ok(client.get('/api/orders/'+o['id'],headers=h))['rejection_reason']=='Hết nguyên liệu'
    assert client.patch(path,headers=admin,json={'status':'preparing'}).status_code==409
    assert events(client,u['id'],'purchase')==[]

def test_US7_4_complete_only_preparing(client,customer,admin):
    h,_,_=customer;ok(add(client,h));o=ok(checkout(client,h),201);path='/api/admin/orders/'+o['id']+'/status'
    assert client.patch(path,headers=admin,json={'status':'completed'}).status_code==409
    ok(client.patch(path,headers=admin,json={'status':'preparing'}));ok(client.patch(path,headers=admin,json={'status':'completed'}))
    for target in ['completed','preparing','cancelled']:
        assert client.patch(path,headers=admin,json={'status':target,'reason':'abc'}).status_code==409

def test_US8_1_view_record_and_dedup(client,customer):
    h,u,_=customer;other,v,_=account(client);d=dish(client);path='/api/dishes/'+d['id']+'/views';payload={'request_key':uuid.uuid4().hex}
    ok(client.post(path,headers=h,json=payload));ok(client.post(path,headers=h,json=payload))
    assert len(events(client,u['id'],'view'))==1 and events(client,v['id'])==[]
    assert events(client,u['id'])[0]['dish_id']==d['id']

def test_US8_2_cart_event_valid_only(client,customer,admin):
    h,u,_=customer;d=new_dish(client,admin,is_available=False)
    assert add(client,h,d).status_code==409
    assert events(client,u['id'])==[]
    ok(add(client,h,quantity=3));assert events(client,u['id'],'cart')[0]['quantity']==3

def test_US8_3_purchase_completed_only_no_duplicates(client,customer,admin):
    h,u,_=customer;d=dish(client);ok(add(client,h,d));ok(add(client,h,d,size='M',quantity=2));o=ok(checkout(client,h),201)
    assert events(client,u['id'],'purchase')==[]
    path='/api/admin/orders/'+o['id']+'/status'
    ok(client.patch(path,headers=admin,json={'status':'preparing'}));ok(client.patch(path,headers=admin,json={'status':'completed'}))
    assert client.patch(path,headers=admin,json={'status':'completed'}).status_code==409
    assert events(client,u['id'],'purchase')==[{'dish_id':d['id'],'reward':.8,'quantity':3}]

def test_US8_4_rating_feedback_updates_not_duplicates(client,customer,admin):
    h,u,_=customer;other,v,_=account(client);o,d=completed(client,h,admin);path='/api/dishes/'+d['id']+'/reviews'
    ok(client.put(path,headers=h,json={'order_id':o['id'],'stars':1}));assert events(client,u['id'],'rating')[0]['reward']==-1
    before=ok(client.get('/api/recommendations',headers=h))
    ok(client.put(path,headers=h,json={'order_id':o['id'],'stars':5}));after=ok(client.get('/api/recommendations',headers=h))
    assert before['revision']!=after['revision'] and len(events(client,u['id'],'rating'))==1
    assert events(client,v['id'])==[]

def test_US9_1_personalized_recommendation_cards(client,customer):
    h,_,_=customer;d=dish(client);ok(client.post('/api/dishes/'+d['id']+'/views',headers=h,json={'request_key':uuid.uuid4().hex}))
    r=ok(client.get('/api/recommendations',headers=h));assert r['mode']=='personalized' and r['items']
    assert all('name' in x and 'image_url' in x and 'base_price' in x for x in r['items'])

def test_US9_2_scores_sorted_and_user_isolation(client,customer):
    h,_,_=customer;other,_,_=account(client);baseline=ok(client.get('/api/recommendations',headers=other));ok(add(client,h))
    r=ok(client.get('/api/recommendations',headers=h));scores=[x['score'] for x in r['items']]
    assert scores==sorted(scores,reverse=True) and baseline==ok(client.get('/api/recommendations',headers=other))

def test_US9_3_cold_start_and_transition(client,customer):
    h,_,_=customer;r=ok(client.get('/api/recommendations',headers=h));assert r['mode']=='cold_start' and r['items']
    ok(add(client,h));assert ok(client.get('/api/recommendations',headers=h))['mode']=='personalized'

def test_US9_4_no_unavailable_recommendations(client,customer,admin):
    h,_,_=customer;d=new_dish(client,admin);ok(client.patch('/api/admin/dishes/'+d['id']+'/availability',headers=admin,json={'is_available':False}))
    r=ok(client.get('/api/recommendations?limit=50',headers=h));assert all(x['is_available'] and x['id']!=d['id'] for x in r['items'])

def test_US9_5_fresh_interactions_update_ranking(client,customer):
    h,_,_=customer;before=ok(client.get('/api/recommendations?limit=50',headers=h));target=before['items'][-1]
    for _ in range(5):ok(client.post('/api/dishes/'+target['id']+'/views',headers=h,json={'request_key':uuid.uuid4().hex}))
    after=ok(client.get('/api/recommendations?limit=50',headers=h))
    assert before['revision']!=after['revision']
    assert [d['id'] for d in before['items']] != [d['id'] for d in after['items']]

def test_checkout_price_changes_require_confirmation(client,customer,admin):
    h,_,_=customer;d=new_dish(client,admin);cart=ok(add(client,h,d))
    payload=dict(name=d['name'],description=d['description'],base_price=d['base_price']+10000,image_url=d['image_url'])
    ok(client.put('/api/admin/dishes/'+d['id'],headers=admin,json=payload))
    assert checkout(client,h,expected_total=cart['final_amount']).status_code==409
    assert ok(client.get('/api/orders',headers=h))==[]
    fresh=ok(client.get('/api/cart',headers=h));o=ok(checkout(client,h,expected_total=fresh['final_amount']),201)
    assert o['items'][0]['unit_price']==d['base_price']+10000

def test_parallel_checkout_cannot_spend_same_cart_twice(client,customer):
    h,_,_=customer;ok(add(client,h))
    with ThreadPoolExecutor(max_workers=2) as pool:
        results=list(pool.map(lambda _:checkout(client,h),range(2)))
    assert sorted(r.status_code for r in results)==[201,409]
    assert len(ok(client.get('/api/orders',headers=h)))==1

def test_profile_password_revokes_all_sessions(client,customer):
    h,u,data=customer
    assert client.put('/api/users/me',headers=h,json={'full_name':'A','phone_number':'abc'}).status_code==422
    updated=ok(client.put('/api/users/me',headers=h,json={'full_name':'Đã cập nhật','phone_number':'0912345678'}));assert updated['full_name']=='Đã cập nhật'
    h2={'Authorization':'Bearer '+ok(client.post('/api/auth/login',json={'email':data['email'],'password':PASSWORD}))['access_token']}
    ok(client.put('/api/users/me/change-password',headers=h,json={'current_password':PASSWORD,'new_password':'Another-pass-2026','confirm_new_password':'Another-pass-2026'}))
    assert client.get('/api/users/me',headers=h).status_code==401 and client.get('/api/users/me',headers=h2).status_code==401
    ok(client.post('/api/auth/login',json={'email':data['email'],'password':'Another-pass-2026'}))

def test_cors_preflight(client):
    response=client.options('/api/cart',headers={'Origin':'http://127.0.0.1:3001','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'})
    assert response.status_code==200 and response.headers['access-control-allow-origin']=='http://127.0.0.1:3001'

def test_data_survives_application_restart(client,customer):
    h,_,_=customer;cart=ok(add(client,h))
    with TestClient(app) as restarted:
        assert ok(restarted.get('/api/cart',headers=h))==cart

def test_empty_catalogue_is_valid_response(tmp_path):
    env={**os.environ,'DATABASE_URL':'sqlite+aiosqlite:///'+(tmp_path/'empty.db').as_posix(),'SEED_MENU':'0'}
    source="from fastapi.testclient import TestClient; from main import app\nwith TestClient(app) as c:\n r=c.get('/api/dishes'); assert r.status_code==200 and r.json()==[]"
    result=subprocess.run([sys.executable,'-c',source],env=env,capture_output=True,text=True,timeout=30)
    assert result.returncode==0,result.stderr

def test_expired_session_rejected(client,customer):
    h,u,_=customer
    from datetime import datetime
    async def expire():
        async with AsyncSessionLocal() as db:
            rows=(await db.scalars(select(Session).where(Session.user_id==uuid.UUID(u['id'])))).all()
            for row in rows:row.expires_at=datetime(2000,1,1)
            await db.commit()
    client.portal.call(expire)
    assert client.get('/api/users/me',headers=h).status_code==401

def test_decimal_price_confirmation(client,customer,admin):
    h,_,_=customer
    d=ok(client.post('/api/admin/dishes',headers=admin,json={'name':'Giá thập phân','description':'','base_price':10000.1,'image_url':'/images/pho.png'}),201)
    cart=ok(add(client,h,d,quantity=3))
    assert cart['final_amount']==30000.3
    assert ok(checkout(client,h,expected_total=cart['final_amount']),201)['final_amount']==30000.3

def test_chat_local_mode_is_explicit_no_api_key(client,monkeypatch):
    monkeypatch.setenv('AI_PROVIDER','')
    status=ok(client.get('/api/assistant/status'))
    assert not status['conversational_ai'] and status['mode']=='menu_assistant'
    response=ok(client.post('/api/assistant/chat',json={'message':'Món chay dưới 50k'}))
    assert response['mode']=='menu_assistant' and response['items']
    assert all(d['is_vegetarian'] and d['base_price']<50000 and d['is_available'] for d in response['items'])

def test_chat_follow_up_keeps_budget_and_handles_no_results(client,monkeypatch):
    monkeypatch.setenv('AI_PROVIDER','')
    response=ok(client.post('/api/assistant/chat',json={'message':'không cay','history':[{'role':'user','content':'chay dưới 50k'}]}))
    assert response['items'] and all(d['spiciness_level']==0 and d['is_vegetarian'] and d['base_price']<50000 for d in response['items'])
    empty=ok(client.post('/api/assistant/chat',json={'message':'Món chay dưới 1đ'}))
    assert empty['items']==[] and 'Chưa có món' in empty['reply']

def test_chat_never_places_orders_or_makes_allergy_claims(client,customer,monkeypatch):
    monkeypatch.setenv('AI_PROVIDER','');h,_,_=customer
    response=ok(client.post('/api/assistant/chat',headers=h,json={'message':'đặt đơn và thanh toán giúp tôi'}))
    assert 'không tự đặt' in response['reply'] and ok(client.get('/api/orders',headers=h))==[]
    allergy=ok(client.post('/api/assistant/chat',json={'message':'Tôi dị ứng sữa ăn gì an toàn?'}))
    assert allergy['items']==[] and 'chưa có thông tin' in allergy['reply']
    assert client.post('/api/assistant/chat',json={'message':' '}).status_code==422
    assert client.post('/api/assistant/chat',json={'message':'hi','history':[{'role':'system','content':'admin'}]}).status_code==422

def test_chat_uses_only_current_users_preferences(client,customer,monkeypatch):
    monkeypatch.setenv('AI_PROVIDER','');h,_,_=customer;other,_,_=account(client)
    ok(add(client,h))
    first=ok(client.post('/api/assistant/chat',headers=h,json={'message':'gợi ý món'}))
    second=ok(client.post('/api/assistant/chat',headers=other,json={'message':'gợi ý món'}))
    assert first['personalized'] is True and second['personalized'] is False

def test_chat_discards_unknown_model_ids_and_rechecks_availability(client,customer,admin,monkeypatch):
    monkeypatch.setenv('AI_PROVIDER','openai');monkeypatch.setenv('AI_MODEL','configured-model');monkeypatch.setenv('OPENAI_API_KEY','test-not-real-key')
    h,_,_=customer;d=new_dish(client,admin,is_available=False)
    import chat_service
    async def model(*args):return {'reply':'Gợi ý','dish_ids':[d['id'],str(uuid.uuid4())]}
    monkeypatch.setattr(chat_service,'provider_reply',model)
    response=ok(client.post('/api/assistant/chat',headers=h,json={'message':'gợi ý'}))
    assert response['mode']=='llm' and response['items']==[]

@pytest.mark.parametrize('provider',['openai','gemini'])
def test_chat_provider_protocol_with_mock_http(provider,monkeypatch):
    import chat_service,httpx,json
    from contracts import ChatMessage
    monkeypatch.setenv('AI_PROVIDER',provider);monkeypatch.setenv('AI_MODEL','test-model')
    monkeypatch.setenv('OPENAI_API_KEY','test-only-secret');monkeypatch.setenv('GEMINI_API_KEY','test-only-secret')
    captured=[]
    def handler(request):
        body=json.loads(request.content);captured.append(body)
        content=json.dumps({'reply':'Tư vấn theo thực đơn','dish_ids':[]})
        assert 'test-only-secret' not in str(request.url)
        return httpx.Response(200,json={'output':[{'type':'message','content':[{'type':'output_text','text':content}]}]} if provider=='openai' else {'candidates':[{'content':{'parts':[{'text':content}]}}]})
    original=httpx.AsyncClient
    monkeypatch.setattr(chat_service.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(handler),**kwargs))
    response=asyncio.run(chat_service.provider_reply('món chay',[ChatMessage(role='user',content='50k')],[],False))
    assert response['dish_ids']==[]
    if provider=='openai':assert captured[0]['store'] is False and captured[0]['text']['format']['type']=='json_schema'
    else:assert captured[0]['generationConfig']['responseMimeType']=='application/json'

def test_chat_provider_failure_does_not_fake_success(client,monkeypatch):
    import chat_service,httpx
    monkeypatch.setenv('AI_PROVIDER','openai');monkeypatch.setenv('AI_MODEL','test-model');monkeypatch.setenv('OPENAI_API_KEY','test-only-secret')
    original=httpx.AsyncClient
    monkeypatch.setattr(chat_service.httpx,'AsyncClient',lambda **kwargs:original(transport=httpx.MockTransport(lambda _:httpx.Response(401,json={'error':'test-only-secret'})),**kwargs))
    response=client.post('/api/assistant/chat',json={'message':'gợi ý món'})
    assert response.status_code==503 and 'test-only-secret' not in response.text

# CSV-backed catalogue and grounded assistant acceptance scenarios.
def test_csv_validation_split_and_provenance():
    from dataset_loader import check_dataset, training_statistics
    data,report=check_dataset()
    assert report['errors']==[] and report['dishes']==25 and report['train']==366 and report['test']==108 and report['overlap']==0
    stats,_=training_statistics()
    assert sum(s['count'] for s in stats.values())==366
    assert len(data['test_cases'])==10


def test_csv_all_25_items_exact_prices_unknown_facts(client):
    from dataset_loader import check_dataset
    data,_=check_dataset();menu=ok(client.get('/api/dishes'));by_source={d['source_dish_id']:d for d in menu if d['source_dish_id']}
    assert len(by_source)==25
    for row in data['dishes']:
        item=by_source[int(row['dish_id'])]
        assert item['name']==row['dish_name'] and item['base_price']==int(row['price_vnd'])
        assert item['main_ingredient']==row['main_ingredient'] and item['reference_count']>0
        assert item['calories'] is None and item['spiciness_level'] is None and item['is_vegetarian'] is None
        assert item['customizable'] is False


def test_csv_filters_and_sort(client):
    items=ok(client.get('/api/dishes?ingredient=Gà&max_price=50000&sort=price_asc&available_only=true'))
    assert len(items)>=3 and all(d['main_ingredient']=='Gà' and d['base_price']<=50000 for d in items)
    assert [d['base_price'] for d in items]==sorted(d['base_price'] for d in items)
    assert len(ok(client.get('/api/dishes?category=pizza')))==1
    assert len(ok(client.get('/api/categories')))>=16


def test_csv_standard_portion_and_checkout(client,customer):
    h,_,_=customer;d=next(d for d in ok(client.get('/api/dishes')) if d['source_dish_id']==2)
    assert add(client,h,d,size='M').status_code==422
    assert add(client,h,d,toppings=['egg']).status_code==422
    cart=ok(add(client,h,d,quantity=2));assert cart['total_amount']==80000
    order=ok(checkout(client,h,expected_total=80000),201)
    assert order['final_amount']==80000 and order['items'][0]['quantity']==2


def test_csv_import_idempotent_preserves_edits(client,admin):
    from dataset_loader import import_dataset
    from extended_models import CatalogFacts,DatasetRating
    d=next(d for d in ok(client.get('/api/dishes')) if d['source_dish_id']==25)
    ok(client.patch('/api/admin/dishes/'+d['id']+'/availability',headers=admin,json={'is_available':False}))
    async def again():
        async with AsyncSessionLocal() as db:
            before=await db.scalar(select(func.count()).select_from(Dish))
            await import_dataset(db)
            return before,await db.scalar(select(func.count()).select_from(Dish)),await db.scalar(select(func.count()).select_from(DatasetRating))
    before,after,ratings=client.portal.call(again)
    assert before==after and ratings==474
    assert not ok(client.get('/api/dishes/'+d['id']))['is_available']
    ok(client.patch('/api/admin/dishes/'+d['id']+'/availability',headers=admin,json={'is_available':True}))


@pytest.mark.parametrize('message,expect',[
    ('Phở gà giá bao nhiêu?','40.000đ'),
    ('Phở bò làm từ gì?','Bò'),
    ('So sánh phở bò với phở gà','40.000đ'),
    ('Pizza phô mai có cay không?','chưa được xác nhận'),
    ('Salad ức gà bao nhiêu calo?','chưa có dữ liệu'),
    ('Thực đơn có bao nhiêu món?','25 món từ dữ liệu'),
    ('Cách đặt hàng?','COD'),
    ('Có mã giảm giá không?','chưa có mã'),
    ('Cách đánh giá món ăn?','1 đến 5'),
    ('Bạn làm được gì?','chưa bật mô hình'),
    ('Phí ship bao nhiêu?','0đ'),
    ('Đơn của tôi đang ở đâu?','đăng nhập'),
])
def test_chat_catalog_questions(client,monkeypatch,message,expect):
    monkeypatch.setenv('AI_PROVIDER','')
    response=ok(client.post('/api/assistant/chat',json={'message':message}))
    assert expect in response['reply'],response['reply']
    assert all(d['is_available'] for d in response['items'])


def test_chat_combo_budget_range_and_ingredient(client,monkeypatch):
    monkeypatch.setenv('AI_PROVIDER','')
    response=ok(client.post('/api/assistant/chat',json={'message':'Combo 2 người tối đa 100k'}))
    assert response['combos'] and all(c['total']<=100000 and sum(i['quantity'] for i in c['items'])==2 for c in response['combos'])
    for combo in response['combos']:assert combo['total']==sum(i['quantity']*i['unit_price'] for i in combo['items'])
    filtered=ok(client.post('/api/assistant/chat',json={'message':'Món gà từ 30k đến 60k'}))
    assert filtered['items'] and all(d['main_ingredient']=='Gà' and 30000<=d['base_price']<=60000 for d in filtered['items'])
    unknown=ok(client.post('/api/assistant/chat',json={'message':'pizza không cay'}))
    assert unknown['items']==[] and 'chưa xác nhận' in unknown['reply']


def test_chat_orders_only_belong_to_current_user(client,customer):
    h,_,_=customer;other,_,_=account(client);ok(add(client,h));order=ok(checkout(client,h),201)
    mine=ok(client.post('/api/assistant/chat',headers=h,json={'message':'Đơn của tôi'}))
    assert order['order_code'] in mine['reply'] and '12 Đường' not in mine['reply']
    foreign=ok(client.post('/api/assistant/chat',headers=other,json={'message':'Kiểm tra đơn '+order['order_code']}))
    assert order['order_code'] not in foreign['reply'] and 'Chưa tìm thấy' in foreign['reply']


def test_csv_validator_rejects_invalid_input_before_import(tmp_path):
    from dataset_loader import DATA_DIR,FILES,check_dataset
    import shutil,csv
    for name in FILES:shutil.copy2(DATA_DIR/name,tmp_path/name)
    path=tmp_path/'ratings_train.csv'
    with path.open(encoding='utf-8-sig',newline='') as f:reader=csv.DictReader(f);fields=reader.fieldnames;rows=list(reader)
    rows[0]['rating']='6';rows[1]['dish_id']='999';rows[2]['user_id']='';rows.append(rows[3].copy())
    with path.open('w',encoding='utf-8-sig',newline='') as f:writer=csv.DictWriter(f,fieldnames=fields);writer.writeheader();writer.writerows(rows)
    _,report=check_dataset(tmp_path)
    assert report['invalid_rows']>=4


def test_training_reactions_low_high_and_content_similarity():
    import numpy as np
    from recommendation_model import fit,vector
    dishes={1:dict(base_price=40000,categories=['mon-nuoc'],main_ingredient='Bò'),2:dict(base_price=45000,categories=['mon-nuoc'],main_ingredient='Gà'),3:dict(base_price=40000,categories=['com'],main_ingredient='Heo')}
    a,b=fit([{'dish_id':'1','rating':'1'}],dishes);assert b@vector(dishes[1])<0
    a,b=fit([{'dish_id':'1','rating':'5'}],dishes);theta=np.linalg.solve(a,b)
    assert theta@vector(dishes[2])>theta@vector(dishes[3])


def test_training_statistics_never_reads_holdout(monkeypatch):
    import dataset_loader
    original=dataset_loader.read_csv;opened=[]
    def audited(path):
        opened.append(Path(path).name)
        return original(path)
    monkeypatch.setattr(dataset_loader,'read_csv',audited)
    dataset_loader.training_statistics.cache_clear()
    stats,mean=dataset_loader.training_statistics()
    assert opened==['ratings_train.csv'] and sum(s['count'] for s in stats.values())==366
    dataset_loader.training_statistics.cache_clear()


def test_all_valid_stars_update_single_purchase_review(client,customer,admin):
    h,_,_=customer;order,d=completed(client,h,admin)
    path='/api/dishes/'+d['id']+'/reviews'
    for stars in range(1,6):
        ok(client.put(path,headers=h,json={'order_id':order['id'],'stars':stars}))
    for stars in [0,6]:assert client.put(path,headers=h,json={'order_id':order['id'],'stars':stars}).status_code==422
    assert len(events(client,customer[1]['id'],'rating'))==1


def test_new_dish_without_source_ratings_uses_cold_start_fallback(client,customer,admin):
    d=new_dish(client,admin,main_ingredient='Gà')
    result=ok(client.get('/api/recommendations?limit=50',headers=customer[0]))
    item=next(i for i in result['items'] if i['id']==d['id'])
    assert result['mode']=='cold_start' and item['reference_count']==0 and isinstance(item['score'],float)
    water=ok(client.get('/api/dishes?category=bun'))
    assert any(d['name']=='Phở gà' for d in water)


def test_chat_follow_up_dish_reference_and_price_comparison(client,monkeypatch):
    monkeypatch.setenv('AI_PROVIDER','')
    follow=ok(client.post('/api/assistant/chat',json={'message':'Món đó có cay không?','history':[{'role':'user','content':'Phở gà giá bao nhiêu?'}]}))
    assert 'Phở gà' in follow['reply'] and 'chưa được xác nhận' in follow['reply']
    comparison=ok(client.post('/api/assistant/chat',json={'message':'So sánh phở bò với phở gà'}))
    assert 'rẻ hơn' in comparison['reply'] and '5.000đ' in comparison['reply']


def test_all_csv_dishes_have_local_food_photos(client):
    from catalog_photos import PHOTO_MANIFEST
    import hashlib
    public=Path(__file__).resolve().parents[2]/'FE/public'
    menu={d['source_dish_id']:d for d in ok(client.get('/api/dishes')) if d['source_dish_id']}
    assert set(menu)==set(range(1,26))
    for photo in PHOTO_MANIFEST:
        item=menu[photo['id']];asset=public/photo['image_url'].lstrip('/')
        assert item['image_url']==photo['image_url'] and item['image_is_illustration'] is False
        assert asset.is_file() and asset.stat().st_size>10000
        assert hashlib.sha256(asset.read_bytes()).hexdigest()==photo['sha256']


def test_photo_upgrade_preserves_admin_images_and_prices(client):
    from catalog_photos import apply_catalog_photos,photo_for
    from extended_models import CatalogFacts
    async def exercise():
        async with AsyncSessionLocal() as db:
            facts=await db.scalar(select(CatalogFacts).where(CatalogFacts.source_id==5))
            row=await db.get(Dish,facts.dish_id);before=row.base_price;original_image=row.image_url
            row.image_url='/images/catalog/dish-5.svg';row.base_price=76543;await db.commit()
            assert await apply_catalog_photos(db)==1 and row.image_url==photo_for(5) and row.base_price==76543
            assert await apply_catalog_photos(db)==0
            row.image_url='/images/admin-custom-photo.jpg';await db.commit()
            assert await apply_catalog_photos(db)==0 and row.image_url=='/images/admin-custom-photo.jpg'
            row.image_url=original_image;row.base_price=before;await db.commit()
    client.portal.call(exercise)


def test_admin_login_rejects_customer_without_issuing_session(client,customer):
    h,user,data=customer
    async def count():
        async with AsyncSessionLocal() as db:
            return await db.scalar(select(func.count()).select_from(Session).where(Session.user_id==uuid.UUID(user['id'])))
    before=client.portal.call(count)
    response=client.post('/api/admin/auth/login',json={'email':data['email'],'password':PASSWORD})
    assert response.status_code==403 and 'khách hàng' in response.json()['detail']
    assert client.portal.call(count)==before
    assert ok(client.get('/api/users/me',headers=h))['role']=='customer'


def test_admin_portal_login_and_customer_edit_permissions(client,customer):
    auth=ok(client.post('/api/admin/auth/login',json={'email':'admin@example.com','password':PASSWORD}))
    assert auth['user']['role']=='admin'
    admin_headers={'Authorization':'Bearer '+auth['access_token']}
    assert client.get('/api/admin/orders',headers=admin_headers).status_code==200
    d=dish(client);h=customer[0]
    payload=dict(name=d['name'],description=d['description'],base_price=d['base_price'],image_url=d['image_url'])
    assert client.put('/api/admin/dishes/'+d['id'],headers=h,json=payload).status_code==403
    assert client.patch('/api/admin/dishes/'+d['id']+'/availability',headers=h,json={'is_available':False}).status_code==403
    assert client.get('/api/admin/orders',headers=h).status_code==403


def test_admin_can_shop_and_review_only_own_completed_orders(client,customer):
    email=uuid.uuid4().hex+'@example.com'
    async def setup():
        async with AsyncSessionLocal() as db:
            db.add(User(full_name='Admin mua hàng',email=email,phone_number='0901234567',
                password_hash=password_hash.hash(PASSWORD),role=UserRole.ADMIN,status=UserStatus.ACTIVE))
            await db.commit()
    client.portal.call(setup)
    auth=ok(client.post('/api/auth/login',json={'email':email,'password':PASSWORD}))
    h={'Authorization':'Bearer '+auth['access_token']}
    other=customer[0]
    assert auth['user']['role']=='admin'
    d=dish(client)
    cart=ok(add(client,h,d,quantity=2))
    item=cart['items'][0]
    assert client.put('/api/cart/items/'+item['id'],headers=other,json={'quantity':1}).status_code==404
    assert ok(client.get('/api/cart',headers=other))['items']==[]
    ok(client.put('/api/cart/items/'+item['id'],headers=h,json={'quantity':1}))
    order=ok(checkout(client,h),201)
    path='/api/dishes/'+d['id']+'/reviews'
    rating={'order_id':order['id'],'stars':5,'comment':'Admin cũng đặt món được'}
    assert client.put(path,headers=h,json=rating).status_code==403
    ok(client.patch('/api/admin/orders/'+order['id']+'/status',headers=h,json={'status':'preparing'}))
    ok(client.patch('/api/admin/orders/'+order['id']+'/status',headers=h,json={'status':'completed'}))
    ok(client.put(path,headers=h,json=rating))
    assert [o['id'] for o in ok(client.get('/api/orders',headers=h))]==[order['id']]
    assert client.get('/api/orders/'+order['id'],headers=other).status_code==404
    assert client.put(path,headers=other,json=rating).status_code==403
    ok(add(client,other,d))
    foreign=ok(checkout(client,other),201)
    assert client.get('/api/orders/'+foreign['id'],headers=h).status_code==404
    assert client.get('/api/admin/orders/'+foreign['id'],headers=h).status_code==200
    assert client.get('/api/recommendations',headers=h).status_code==200


def test_food_photographs_are_unique_across_available_menu(client):
    import hashlib
    public=Path(__file__).resolve().parents[2]/'FE/public'
    dishes=[d for d in ok(client.get('/api/dishes')) if d['is_available'] and not d['name'].startswith(('Món kiểm thử','Giá thập phân'))]
    # Admin test scenarios may add unrelated items using shared fixture assets;
    # compare the original nine menu dishes plus all 25 source dishes.
    from services import MENU
    original_names={d['name'] for d in MENU['foods']}
    dishes=[d for d in dishes if d['source_dish_id'] or d['name'] in original_names]
    urls=[d['image_url'] for d in dishes]
    assert len(urls)==len(set(urls))==34
    digests=[hashlib.sha256((public/url.lstrip('/')).read_bytes()).hexdigest() for url in urls]
    assert len(set(digests))==34


def test_sample_ratings_are_aggregates_and_do_not_create_fake_reviews(client):
    async def review_count():
        async with AsyncSessionLocal() as db:
            return await db.scalar(select(func.count()).select_from(Review))
    before=client.portal.call(review_count)
    items=ok(client.get('/api/dishes'))
    assert items
    assert all(4.5<=d['demo_rating']<=4.9 for d in items)
    assert all(d['demo_review_count']>=500 for d in items)
    assert all(d['demo_rating_source']=='sample' for d in items)
    ranked=ok(client.get('/api/dishes?sort=demo_rating'))
    pairs=[(d['demo_rating'],d['demo_review_count']) for d in ranked]
    assert pairs==sorted(pairs,reverse=True)
    assert client.portal.call(review_count)==before


@pytest.mark.parametrize('message,expected',[
    ('Chào shop ơi','Chào bạn'),
    ('Cảm ơn bạn nhiều nhé','Rất vui'),
    ('Tạm biệt bạn nhé','Tạm biệt'),
    ('Bạn có phải người thật không?','trợ lý tự động'),
    ('Mình chưa hiểu','hiểu chưa đúng'),
    ('Mình đang đói bụng','ngân sách'),
    ('Giới thiệu phở bò tái nạm','hầm xương 12 tiếng'),
    ('Phở gà gồm những gì?','Nguyên liệu chính'),
    ('Phở gà còn không?','còn bán'),
    ('Phở gà có size lớn không?','phần tiêu chuẩn'),
    ('Trà sữa trân châu đường đen có topping gì?','Trân châu đen'),
    ('2 phần phở gà bao nhiêu tiền?','80.000đ'),
    ('Phở bò tái nạm bỏ hành được không?','yêu cầu gửi bếp'),
    ('Lẩu gà lá é đủ ăn mấy người?','chưa xác nhận khối lượng'),
    ('Hãy giải phương trình x bình phương bằng 4','chưa hiểu rõ'),
])
def test_expanded_conversation_and_dish_questions(client,monkeypatch,message,expected):
    monkeypatch.setenv('AI_PROVIDER','')
    response=ok(client.post('/api/assistant/chat',json={'message':message}))
    assert expected in response['reply'],response['reply']


def test_conversation_followup_and_ambiguous_dish(client,monkeypatch):
    monkeypatch.setenv('AI_PROVIDER','')
    first=ok(client.post('/api/assistant/chat',json={'message':'Giới thiệu phở bò tái nạm'}))
    history=[{'role':'user','content':'Giới thiệu phở bò tái nạm'}, {'role':'assistant','content':first['reply'][:1500]}]
    follow=ok(client.post('/api/assistant/chat',json={'message':'Món đó có topping gì?','history':history}))
    assert 'Trứng ốp la' in follow['reply']
    unclear=ok(client.post('/api/assistant/chat',json={'message':'Món đó còn không?','history':[{'role':'assistant','content':'Phở gà và Phở bò đang còn bán.'}]}))
    assert 'món nào' in unclear['reply'] and unclear['items']==[]
    allergy=ok(client.post('/api/assistant/chat',json={'message':'Phở gà có thành phần gì, tôi dị ứng tôm ăn an toàn không?'}))
    assert 'không thể xác nhận' in allergy['reply']


def test_chat_knowledge_follows_admin_edits_and_covers_entire_menu(client,admin,monkeypatch):
    monkeypatch.setenv('AI_PROVIDER','')
    items=ok(client.get('/api/dishes'))
    for d in items:
        reply=ok(client.post('/api/assistant/chat',json={'message':'Giới thiệu '+d['name']}))
        assert d['description'] in reply['reply']
        assert all(i['is_available'] for i in reply['items'])
    d=ok(client.post('/api/admin/dishes',headers=admin,json={'name':'Món hỏi đáp mới','description':'Rau củ theo mô tả mới của bếp','base_price':33000,'image_url':'/images/pho.png'}),201)
    payload={k:d[k] for k in ['name','description','base_price','image_url','is_available']}
    ok(client.put('/api/admin/dishes/'+d['id'],headers=admin,json={**payload,'description':'Đậu hũ và nấm mới cập nhật','base_price':37000}))
    response=ok(client.post('/api/assistant/chat',json={'message':'Món hỏi đáp mới có thành phần gì, 2 phần giá bao nhiêu?'}))
    assert 'Đậu hũ và nấm mới cập nhật' in response['reply'] and '74.000đ' in response['reply']


def test_admin_overview_accounts_categories_and_customer_access(client,customer,admin):
    customer_headers,customer_user,_=customer
    for path in ['/api/admin/overview','/api/admin/users','/api/admin/categories']:
        assert client.get(path,headers=customer_headers).status_code==403
    overview=ok(client.get('/api/admin/overview',headers=admin))
    assert overview['users']>=2 and overview['dishes']>=34
    assert overview['available_dishes']<=overview['dishes']
    assert overview['revenue']>=0 and isinstance(overview['status_counts'],dict)
    users=ok(client.get('/api/admin/users',headers=admin))
    target=next(u for u in users if u['id']==customer_user['id'])
    assert target['role']=='customer' and target['order_count']>=0
    changed=ok(client.patch('/api/admin/users/'+target['id'],headers=admin,json={'role':'admin','status':'active'}))
    assert changed['role']=='admin'
    restored=ok(client.patch('/api/admin/users/'+target['id'],headers=admin,json={'role':'customer','status':'active'}))
    assert restored['role']=='customer'
    current=next(u for u in users if u['email']=='admin@example.com')
    assert client.patch('/api/admin/users/'+current['id'],headers=admin,json={'role':'customer','status':'active'}).status_code==409
    categories=ok(client.get('/api/admin/categories',headers=admin))
    assert categories and all(c['dish_count']>=0 for c in categories)
