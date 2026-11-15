"""Presentation-only sample ratings; never create reviews or training events."""
import hashlib
import os
import uuid

# Curated sample volumes: everyday dishes have more votes than shared hotpots.
CSV_RATINGS = {
    1: (4.9, 1186), 2: (4.8, 1034), 3: (4.8, 946), 4: (4.9, 1087),
    5: (4.9, 1158), 6: (4.8, 972), 7: (4.7, 846), 8: (4.8, 1204),
    9: (4.7, 891), 10: (4.7, 742), 11: (4.8, 824), 12: (4.7, 695),
    13: (4.8, 803), 14: (4.6, 637), 15: (4.7, 714), 16: (4.6, 621),
    17: (4.8, 936), 18: (4.5, 768), 19: (4.7, 548), 20: (4.8, 576),
    21: (4.7, 703), 22: (4.6, 652), 23: (4.8, 904), 24: (4.7, 1102),
    25: (4.6, 751),
}
STORE_RATINGS = {
    "com-tam": (4.9, 1268), "bun-bo": (4.9, 1184),
    "tra-sua": (4.8, 1236), "com-chay": (4.7, 718),
    "bun-cha": (4.8, 1056), "pho": (4.9, 1219),
    "banh-mi": (4.8, 1307), "goi-cuon": (4.6, 684),
    "tra-dao": (4.8, 1093),
}
STORE_BY_ID = {uuid.uuid5(uuid.NAMESPACE_URL, "foodorder:"+key): value
               for key, value in STORE_RATINGS.items()}


def sample_rating(dish_id, source_id=None):
    if os.getenv("DEMO_RATINGS", "1") != "1":
        return None, 0
    curated = CSV_RATINGS.get(source_id) or STORE_BY_ID.get(dish_id)
    if curated:
        return curated
    # New admin-created dishes keep the same sample figures after reload/rename.
    seed = hashlib.sha256(str(dish_id).encode()).digest()
    return round(4.5 + seed[0] % 5 / 10, 1), 500 + int.from_bytes(seed[1:3], "big") % 501
