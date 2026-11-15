"""Local food photographs shared by catalogue, detail, cart and chat DTOs."""
import json
from pathlib import Path
from sqlalchemy import select
from models import Dish
from extended_models import CatalogFacts

PHOTO_MANIFEST = json.loads(Path(__file__).with_name('data').joinpath('dish_images.json').read_text(encoding='utf-8'))
PHOTO_URLS = {row['id']: row['image_url'] for row in PHOTO_MANIFEST}
PREVIOUS_SHARED_PHOTOS = {1:'/images/pho.png',3:'/images/bun-cha.png',4:'/images/bun-bo.png',
    5:'/images/com-tam.png',8:'/images/banh-mi.png',23:'/images/tra-dao.png'}


def photo_for(source_id):
    return PHOTO_URLS[source_id]


async def apply_catalog_photos(db):
    """Upgrade only our old placeholder images; preserve administrator photos."""
    rows = (await db.execute(select(Dish, CatalogFacts).join(CatalogFacts, CatalogFacts.dish_id == Dish.id)
        .where(CatalogFacts.source_id.is_not(None)))).all()
    changed = 0
    metadata_changed = False
    for dish, facts in rows:
        placeholder = f'/images/catalog/dish-{facts.source_id}.svg'
        first_upgrade = facts.facts.get('photo_version',0) < 2
        shared_before = first_upgrade and dish.image_url == PREVIOUS_SHARED_PHOTOS.get(facts.source_id)
        if facts.source_id in PHOTO_URLS and (dish.image_url in (None, '', placeholder) or shared_before):
            dish.image_url = photo_for(facts.source_id)
            changed += 1
        if first_upgrade:
            facts.facts = {**facts.facts,'photo_version':2}
            metadata_changed = True
    if changed or metadata_changed:
        await db.commit()
    return changed
