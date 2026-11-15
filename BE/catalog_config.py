"""Stable category IDs; CSV labels preserved in catalog_facts.source_category."""
CATEGORY_INFO = [
    ("com", "Cơm", "rice"), ("bun", "Bún và phở", "noodle"),
    ("banh-mi", "Bánh mì", "bread"), ("mon-nuoc", "Món nước", "noodle"),
    ("mi", "Mì", "noodle"), ("khai-vi", "Khai vị", "rice"),
    ("banh", "Bánh", "rice"), ("pizza", "Pizza", "bread"),
    ("salad", "Salad", "veg"), ("do-chien", "Đồ chiên", "rice"),
    ("lau", "Lẩu", "noodle"), ("trang-mieng", "Tráng miệng", "drink"),
    ("do-uong", "Đồ uống", "drink"), ("tra-sua", "Trà sữa", "drink"),
    ("chay", "Món chay", "veg"), ("tra-trai-cay", "Trà trái cây", "drink"),
]
CATEGORIES = [item[0] for item in CATEGORY_INFO]
GROUPS = {item[0]:item[2] for item in CATEGORY_INFO}
CATEGORY_LABELS = {item[0]:item[1] for item in CATEGORY_INFO}
SOURCE_CATEGORIES = dict(zip(
    ["Cơm","Bún","Bánh mì","Món nước","Mì","Khai vị","Bánh","Pizza","Salad","Đồ chiên","Lẩu","Tráng miệng","Đồ uống"],
    ["com","bun","banh-mi","mon-nuoc","mi","khai-vi","banh","pizza","salad","do-chien","lau","trang-mieng","do-uong"]))
INGREDIENTS = ["Bò","Gà","Heo","Tôm","Phô mai","Khoai tây","Hải sản","Đậu","Sữa chua","Trà","Cam"]

def category_options():
    return [dict(id=key,name=name,image=f"/images/catalog/category-{key}.svg") for key,name,_ in CATEGORY_INFO]
