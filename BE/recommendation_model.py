"""Shared feature definition for live LinUCB and the isolated CSV evaluation."""
import numpy as np
from catalog_config import CATEGORIES, INGREDIENTS

FEATURE_SIZE = 8 + len(CATEGORIES) + len(INGREDIENTS)

def vector(dish):
    calories,spice,vegetarian=(dish.get(k) for k in ["calories","spiciness_level","is_vegetarian"])
    return np.array([1.,min(float(dish["base_price"])/250000,1.),min(float(calories or 0)/1000,1.),
        float(spice or 0)/3,float(vegetarian is True),float(calories is not None),float(spice is not None),float(vegetarian is not None)]
        + [float(c in dish.get("categories",[])) for c in CATEGORIES]
        + [float(c==dish.get("main_ingredient")) for c in INGREDIENTS])

def fit(rows, dishes):
    a,b=np.eye(FEATURE_SIZE),np.zeros(FEATURE_SIZE)
    for row in rows:
        x=vector(dishes[int(row["dish_id"])])
        a+=np.outer(x,x);b+=((int(row["rating"])-3)/2)*x
    return a,b
