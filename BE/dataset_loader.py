import csv
from collections import Counter, defaultdict
from datetime import date
from functools import lru_cache
import hashlib
from pathlib import Path
import uuid
from sqlalchemy import select, delete
from models import Category, Dish
from extended_models import CatalogFacts, DatasetRating, DatasetImport, DishMetadata
from catalog_config import SOURCE_CATEGORIES, GROUPS, CATEGORY_LABELS
from catalog_photos import photo_for

DATA_DIR = Path(__file__).with_name("data")
FILES = ["dishes.csv","ratings_all.csv","ratings_train.csv","ratings_test.csv","test_cases.csv"]

def read_csv(path):
    with Path(path).open(encoding="utf-8-sig",newline="") as stream:
        return list(csv.DictReader(stream))

def check_dataset(directory=DATA_DIR):
    directory=Path(directory)
    data={Path(name).stem:read_csv(directory/name) for name in FILES}
    errors=[];ids=set()
    for line,row in enumerate(data["dishes"],2):
        try:
            source_id=int(row["dish_id"]);price=int(row["price_vnd"])
            if source_id<=0 or source_id in ids or price<0 or not row["dish_name"].strip() or not row["main_ingredient"].strip() or row["category"] not in SOURCE_CATEGORIES:raise ValueError()
            ids.add(source_id)
        except (ValueError,KeyError,TypeError):errors.append({"file":"dishes.csv","line":line,"error":"Mã món, tên, danh mục, nguyên liệu hoặc giá không hợp lệ"})
    for name in ["ratings_all","ratings_train","ratings_test"]:
        pairs=set()
        for line,row in enumerate(data[name],2):
            try:
                source_user=row["user_id"].strip();dish_id=int(row["dish_id"]);stars=int(row["rating"])
                date.fromisoformat(row["rated_at"])
                pair=(source_user,dish_id)
                if not source_user or not source_user.isdigit() or int(source_user)<=0 or dish_id not in ids or not 1<=stars<=5 or len(row["review_text"])>1000 or pair in pairs:raise ValueError()
                pairs.add(pair)
            except (ValueError,KeyError,TypeError):errors.append({"file":name+".csv","line":line,"error":"ID/điểm/ngày/nhận xét thiếu, sai hoặc cặp người-món trùng"})
    def keys(rows):return {tuple(row.get(k) for k in ["user_id","dish_id","rating","review_text","rated_at"]) for row in rows}
    train,test,all_rows=keys(data["ratings_train"]),keys(data["ratings_test"]),keys(data["ratings_all"])
    overlap={(r[0],r[1]) for r in train}&{(r[0],r[1]) for r in test}
    if overlap:errors.append({"file":"split","error":"Tập học và kiểm tra có cặp người-món trùng"})
    if train|test != all_rows:errors.append({"file":"split","error":"Hợp train/test không khớp ratings_all"})
    summary=dict(dishes=len(data["dishes"]),ratings_all=len(data["ratings_all"]),train=len(train),test=len(test),
        source_users=len({r.get("user_id") for r in data["ratings_all"]}),overlap=len(overlap),invalid_rows=len(errors),errors=errors)
    return data,summary

def checksum(directory=DATA_DIR):
    return hashlib.sha256(b"".join((Path(directory)/name).read_bytes() for name in FILES)).hexdigest()

@lru_cache(maxsize=1)
def training_statistics():
    rows=read_csv(DATA_DIR/"ratings_train.csv")
    stars=defaultdict(list)
    for row in rows:stars[int(row["dish_id"])].append(int(row["rating"]))
    mean=sum(int(row["rating"]) for row in rows)/len(rows) if rows else 3.
    return {key:dict(count=len(values),average=sum(values)/len(values),weighted=(sum(values)+5*mean)/(len(values)+5)) for key,values in stars.items()},mean

async def import_dataset(db):
    data,summary=check_dataset()
    if summary["errors"]:raise ValueError("Bộ CSV có dữ liệu không hợp lệ: "+str(summary["errors"][:3]))
    digest=checksum()
    previous=await db.get(DatasetImport,"food-ratings-csv")
    if previous and previous.checksum==digest:return previous.summary
    created=0
    for row in data["dishes"]:
        source_id=int(row["dish_id"])
        linked=await db.scalar(select(CatalogFacts).where(CatalogFacts.source_id==source_id))
        if linked:continue  # Preserve subsequent admin edits and availability.
        category_key=SOURCE_CATEGORIES[row["category"]]
        category=await db.scalar(select(Category).where(Category.name==CATEGORY_LABELS[category_key]))
        if not category:
            category=Category(name=CATEGORY_LABELS[category_key],image_url=f"/images/catalog/category-{category_key}.svg")
            db.add(category);await db.flush()
        dish=Dish(id=uuid.uuid5(uuid.NAMESPACE_URL,f"foodorder:provided-dishes:{source_id}"),category_id=category.id,
            name=row["dish_name"].strip(),description=f"{row['dish_name']}. Nhóm: {row['category']}. Nguyên liệu chính theo dữ liệu cung cấp: {row['main_ingredient']}.",
            base_price=int(row["price_vnd"]),image_url=photo_for(source_id),
            calories=0,spiciness_level=0,is_vegetarian=False,is_available=True)
        db.add(dish);await db.flush()
        db.add(DishMetadata(dish_id=dish.id,categories=[category_key],topping_group=GROUPS[category_key]))
        db.add(CatalogFacts(dish_id=dish.id,source_id=source_id,source_category=row["category"],main_ingredient=row["main_ingredient"],
            facts={"calories_known":False,"spiciness_known":False,"vegetarian_known":False,"customizable":False,"source":"dishes.csv"}))
        created+=1
    # Dataset people are anonymous source IDs, never application login accounts.
    await db.execute(delete(DatasetRating))
    for name,split in [("ratings_train","train"),("ratings_test","test")]:
        for row in data[name]:
            db.add(DatasetRating(split=split,source_user_id=row["user_id"],source_dish_id=int(row["dish_id"]),stars=int(row["rating"]),comment=row["review_text"],rated_at=row["rated_at"]))
    summary={**summary,"new_dishes":created,"training_source":"ratings_train.csv","holdout_source":"ratings_test.csv"}
    if previous:previous.checksum=digest;previous.summary=summary
    else:db.add(DatasetImport(name="food-ratings-csv",checksum=digest,summary=summary))
    await db.commit()
    training_statistics.cache_clear()
    return summary
