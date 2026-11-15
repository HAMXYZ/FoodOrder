"""Grounded Vietnamese menu intents. This module does not simulate a language model."""
import itertools
import re
from services import normalize
from catalog_config import CATEGORY_LABELS
from conversation_knowledge import is_dish_question

def money(value):
    return f"{value:,.0f}".replace(",", ".")+"đ"

def amount(number,unit):
    if re.search(r"[.,]\d{3}(?:[.,]\d{3})*$",number):number=number.replace(".","").replace(",","")
    else:number=number.replace(",",".")
    return float(number)*(1000000 if unit=="trieu" else 1000 if unit in {"k","nghin","ngan"} else 1)

MONEY=re.compile(r"(?P<number>\d+(?:[.,]\d{1,3})*)\s*(?P<unit>trieu|nghin|ngan|vnd|dong|k|d)(?!\w)")
INGREDIENT_ALIASES={"Bò":["bo"],"Gà":["ga"],"Heo":["heo","thit lon"],"Tôm":["tom"],
    "Hải sản":["hai san"],"Phô mai":["pho mai","cheese"],"Khoai tây":["khoai tay"],
    "Đậu":["dau do","dau hu"],"Sữa chua":["sua chua"],"Cam":["nuoc cam"],"Trà":["lam tu tra"]}

def preferences(messages):
    result={}
    for message in messages:
        q=normalize(message)
        if is_dish_question(q) or any(t in q for t in ["so sanh","cay khong","chay khong","bao nhieu calo","bao nhieu kcal","lam tu gi","nguyen lieu la gi"]):continue
        if any(t in q for t in ["bo loc","tat ca mon","chon lai","lam lai"]):result={}
        if any(t in q for t in ["bo ngan sach","khong gioi han"]):
            result.pop("max_price",None);result.pop("min_price",None)
        prices=list(MONEY.finditer(q))
        if len(prices)>=2 and re.search(r"(den|toi|[-–])",q[prices[0].end():prices[1].start()]):
            result["min_price"]=amount(prices[0]["number"],prices[0]["unit"])
            result["max_price"]=amount(prices[1]["number"],prices[1]["unit"])
        elif prices:
            p=prices[-1];value=amount(p["number"],p["unit"]);prefix=q[max(0,p.start()-14):p.start()]
            if re.search(r"\b(tren|it nhat|tu)\s*$",prefix):result["min_price"]=value+(.01 if "tren" in prefix else 0)
            else:result["max_price"]=value-(.01 if re.search(r"\bduoi\s*$",prefix) else 0)
        else:
            p=re.search(r"(?:ngan sach|toi da|khong qua|duoi)\s+(\d{4,8})(?!\d)",q)
            if p:result["max_price"]=int(p[1])-(.01 if "duoi" in p[0] else 0)
        if re.search(r"\b(khong an chay|khong can chay|bo chay)\b",q):result.pop("vegetarian",None)
        elif re.search(r"\bchay\b",q):result["vegetarian"]=True
        if "khong cay" in q:result["spice_max"]=0;result.pop("spice_min",None)
        elif "it cay" in q:result["spice_max"]=1;result.pop("spice_min",None)
        elif re.search(r"\b(rat cay|mon cay|an cay)\b",q):result["spice_min"]=2;result.pop("spice_max",None)
        if "bo do cay" in q:result.pop("spice_max",None);result.pop("spice_min",None)
        if any(t in q for t in ["it calo","it kcal","nang luong thap"]):result["calories_max"]=500
        if "bo calo" in q:result.pop("calories_max",None)
        category_patterns=[(r"\bcom\b",["com"]),(r"\bbun\b",["bun","mon-nuoc"]),(r"\bpho\b(?! mai)",["bun","mon-nuoc"]),
            (r"\bmon nuoc\b",["mon-nuoc"]),(r"\bbanh mi\b",["banh-mi"]),(r"\bmi (y|xao)\b",["mi"]),
            (r"\bpizza\b",["pizza"]),(r"\bsalad\b",["salad"]),(r"\blau\b",["lau"]),(r"\b(khai vi|goi cuon|nem ran)\b",["khai-vi"]),
            (r"\bbanh xeo\b",["banh"]),(r"\b(do chien|ga ran|khoai tay chien)\b",["do-chien"]),
            (r"\b(trang mieng|che dau|sua chua)\b",["trang-mieng"]),(r"\btra sua\b",["tra-sua"]),
            (r"\btra (dao|chanh|trai cay)\b",["do-uong","tra-trai-cay"]),(r"\b(do uong|nuoc uong|nuoc cam)\b",["do-uong","tra-sua","tra-trai-cay"])]
        for pattern,cats in category_patterns:
            if re.search(pattern,q):result["categories"]=cats
        if any(t in q for t in ["bo danh muc","mon nao cung duoc"]):result.pop("categories",None)
        ingredient_q=q
        for command in ["bo loc","bo ngan sach","bo chay","bo danh muc","bo do cay","bo calo"]:ingredient_q=ingredient_q.replace(command,"")
        exclusions=[];wanted=[]
        for ingredient,aliases in INGREDIENT_ALIASES.items():
            for alias in aliases:
                for match in re.finditer(r"\b"+re.escape(alias)+r"\b",ingredient_q):
                    prefix=ingredient_q[max(0,match.start()-22):match.start()]
                    if re.search(r"(?:khong an|khong thich|khong lay|khong co|tranh|bo)\s*(?:thit\s*)?$",prefix):exclusions.append(ingredient)
                    else:wanted.append(ingredient)
        if exclusions:result["excluded_ingredients"]=list(dict.fromkeys(exclusions));result.pop("ingredients",None)
        elif wanted:result["ingredients"]=list(dict.fromkeys(wanted));result.pop("excluded_ingredients",None)
        if "bo nguyen lieu" in q:result.pop("ingredients",None);result.pop("excluded_ingredients",None)
        if any(t in q for t in ["re nhat","re hon","gia thap","tiet kiem"]):result["sort"]="price_asc"
        elif any(t in q for t in ["dat nhat","gia cao nhat"]):result["sort"]="price_desc"
        elif any(t in q for t in ["danh gia cao","pho bien","yeu thich","ban chay"]):result["sort"]="rating"
    return result

def eligible(dish,filters):
    spice=dish["spiciness_level"];calories=dish["calories"]
    ingredient=dish.get("main_ingredient")
    excluded=filters.get("excluded_ingredients",[])
    if "Hải sản" in excluded:excluded=excluded+["Tôm"]
    if "Tôm" in excluded:excluded=excluded+["Hải sản"]
    included=filters.get("ingredients",[])
    if "Hải sản" in included:included=included+["Tôm"]
    return (dish["is_available"] and dish["base_price"]<=filters.get("max_price",float("inf")) and dish["base_price"]>=filters.get("min_price",0)
        and (not filters.get("vegetarian") or dish["is_vegetarian"] is True)
        and ("spice_max" not in filters or spice is not None and spice<=filters["spice_max"])
        and ("spice_min" not in filters or spice is not None and spice>=filters["spice_min"])
        and ("calories_max" not in filters or calories is not None and calories<=filters["calories_max"])
        and (not filters.get("categories") or bool(set(dish["categories"])&set(filters["categories"])))
        and (not included or ingredient in included) and ingredient not in excluded)

def named_dishes(query,menu):
    q=normalize(query);matches=[]
    for dish in sorted(menu,key=lambda d:-len(d["name"])):
        name=normalize(dish["name"])
        for match in re.finditer(r"(?<!\w)"+re.escape(name)+r"(?!\w)",q):
            if not any(match.start()<end and match.end()>start for start,end,_ in matches):matches.append((match.start(),match.end(),dish))
    return [d for _,_,d in sorted(matches,key=lambda m:m[0])]

def rating_text(dish):
    if dish.get("demo_rating") is not None:
        text=f"Đánh giá mẫu: {dish['demo_rating']}/5 ({dish['demo_review_count']} lượt)."
        if dish["review_count"]:
            text+=f" Đánh giá thật sau mua hàng: {dish['average_rating']}/5 ({dish['review_count']} lượt)."
        return text
    if dish["review_count"]:return f"Đánh giá sau mua hàng: {dish['average_rating']}/5 ({dish['review_count']} lượt)."
    if dish.get("reference_count"):return f"Đánh giá tham khảo trong tập học: {dish['reference_rating']}/5 ({dish['reference_count']} lượt), chưa có đánh giá mua hàng trên web."
    return "Chưa có đánh giá mua hàng hoặc đánh giá tham khảo."

def detail_text(dish):
    info=[f"{dish['name']}: {money(dish['base_price'])}, {'còn bán' if dish['is_available'] else 'đã hết món'}."]
    if dish.get("main_ingredient"):info.append("Nguyên liệu chính: "+dish["main_ingredient"]+".")
    info.append("Năng lượng: "+(f"{dish['calories']} kcal." if dish['calories'] is not None else "chưa có dữ liệu."))
    info.append("Độ cay: "+(f"{dish['spiciness_level']}/3." if dish['spiciness_level'] is not None else "chưa được xác nhận."))
    info.append("Món chay: "+("đã xác nhận." if dish['is_vegetarian'] is True else "không phải món chay." if dish['is_vegetarian'] is False else "chưa được xác nhận."))
    info.append(rating_text(dish))
    return " ".join(info)

def ordered(candidates,filters):
    candidates=list(candidates)
    sort=filters.get("sort")
    if sort in {"price_asc","price_desc"}:candidates.sort(key=lambda d:d["base_price"],reverse=sort=="price_desc")
    if sort=="rating":candidates.sort(key=lambda d:(d.get("demo_rating") or 0,d.get("demo_review_count",0)),reverse=True)
    return candidates

def combo_reply(query,candidates,filters):
    q=normalize(query);match=re.search(r"\b([2-6])\s*(nguoi|suat|phan|mon)\b",q)
    servings=int(match[1]) if match else 2
    if servings>4:return "Mình hiện tính combo tối đa 4 suất. Bạn có thể chia thành hai lượt để dễ kiểm tra ngân sách.",[],[]
    budget=filters.get("max_price")
    if budget is None:return "Bạn cho mình tổng ngân sách cho combo nhé, ví dụ: ‘combo 2 người tối đa 100k’.",[],[]
    meals=[d for d in candidates if not set(d["categories"])&{"do-uong","tra-sua","tra-trai-cay","trang-mieng"}][:12]
    options=[]
    for indices in itertools.combinations_with_replacement(range(len(meals)),servings):
        total=sum(meals[i]["base_price"] for i in indices)
        if total<=budget:options.append((sum(indices),-len(set(indices)),total,indices))
    options.sort(key=lambda value:(value[0],value[1],-value[2]))
    if not options:return f"Chưa ghép được {servings} suất trong ngân sách {money(budget)} với các điều kiện hiện tại. Bạn có thể tăng ngân sách hoặc nhắn ‘bỏ lọc’.",[],[]
    combos=[];shown=set();items=[]
    for _,_,total,indices in options[:3]:
        quantities={i:indices.count(i) for i in dict.fromkeys(indices)}
        combos.append(dict(total=total,servings=servings,items=[dict(dish_id=meals[i]["id"],name=meals[i]["name"],quantity=qty,unit_price=meals[i]["base_price"]) for i,qty in quantities.items()]))
        for i in quantities:
            if meals[i]["id"] not in shown:items.append(meals[i]);shown.add(meals[i]["id"])
    explanation=f"Mình ghép được các phương án {servings} suất, mỗi phương án không vượt {money(budget)}. Giá là phần tiêu chuẩn, chưa cộng size hoặc topping. Bạn tự chọn từng món trong giỏ để xác nhận."
    explanation+="\n"+"\n".join(f"{index+1}. "+" + ".join(f"{item['quantity']} × {item['name']}" for item in combo['items'])+f" = {money(combo['total'])}" for index,combo in enumerate(combos))
    return explanation,items[:6],combos

def faq(query,menu,named,personal,interaction_count):
    q=normalize(query)
    if any(t in q for t in ["di ung","an toan cho","chua benh","tieu duong"]):return "Dữ liệu hiện chỉ có nguyên liệu chính, chưa có thông tin về toàn bộ thành phần; chưa phải danh sách thành phần hoặc chất gây dị ứng đầy đủ. Hãy hỏi cửa hàng trước khi ăn; mình không thể xác nhận một món an toàn cho tình trạng sức khỏe của bạn.",[]
    if any(t in q for t in ["bao nhieu mon","tong so mon","co nhung danh muc","co nhom mon","thuc don gom"]):
        available=[d for d in menu if d['is_available']];cats=sorted({d.get('source_category') or ', '.join(CATEGORY_LABELS.get(c,c) for c in d['categories']) for d in available})
        return f"Thực đơn hiện có {len(menu)} món, trong đó {len(available)} món còn bán. Có thêm {sum(bool(d.get('source_dish_id')) for d in menu)} món từ dữ liệu CSV. Các nhóm gồm: {', '.join(cats)}. Bạn có thể chọn bộ lọc danh mục, nguyên liệu và ngân sách trên trang.",[]
    if any(t in q for t in ["vi sao goi y","sao goi y","dua vao dau","ai hoat dong","so thich cua toi"]):return (f"Gợi ý hiện dùng {interaction_count} tương tác của riêng tài khoản bạn: xem món, thêm giỏ, mua thành công và đánh giá. LinUCB xếp hạng từ giá, danh mục, nguyên liệu và các thông tin đã được xác nhận; chỉ chọn món còn bán." if personal else "Bạn chưa có đủ tương tác cá nhân. Mình dùng mức phổ biến từ 366 đánh giá trong tập học làm gợi ý ban đầu. Sau khi bạn đăng nhập và tương tác, LinUCB sẽ học thêm sở thích riêng; không gán người dùng trong CSV vào tài khoản của bạn."),[]
    if any(t in q for t in ["phi ship","phi giao","tien ship","giao hang mat","bao lau","gio mo cua","dia chi cua hang"]):return "Bản web hiện tính phí giao hàng 0đ tại bước xác nhận đơn. Chưa có dữ liệu xác minh về giờ mở cửa, địa chỉ cửa hàng hoặc thời gian giao dự kiến, nên mình chưa thể cung cấp các thông tin đó.",[]
    if any(t in q for t in ["thanh toan","dat don","dat hang nhu","cach dat","xac nhan don","vnpay","momo"]):return "Bạn chọn món → Thêm vào giỏ → nhập người nhận, số điện thoại và địa chỉ → Kiểm tra thông tin đặt hàng → Xác nhận đặt hàng. Hiện hỗ trợ COD, trả tiền khi nhận hàng; chưa kết nối VNPAY/MoMo. Chat chỉ tư vấn, không tự đặt đơn hoặc thanh toán.",[]
    if any(t in q for t in ["huy don","doi don","sua don"]):return "Bạn xem mã đơn trong ‘Đơn của tôi’ rồi liên hệ quản trị để xử lý. Chat không có quyền hủy hoặc sửa đơn. Quản trị chỉ từ chối đơn đang Chờ xác nhận và phải nhập lý do.",[]
    if any(t in q for t in ["ma giam gia","voucher","khuyen mai"]):return "Hiện chưa có mã giảm giá được cấu hình. Giá và tổng tiền trong giỏ là số liệu để bạn kiểm tra trước khi đặt; mình không tự tạo ưu đãi.",[]
    if any(t in q for t in ["cach danh gia","danh gia nhu","cho sao nhu","sua danh gia"]):return "Bạn vào ‘Đơn của tôi’, mở đơn đã Hoàn thành và đánh giá từng món từ 1 đến 5 sao. Chỉ chủ đơn được đánh giá món đã mua. Gửi lại sẽ cập nhật đánh giá cũ, không tính hai lần; điểm mới được dùng trong lần gợi ý tiếp theo.",[]
    if any(t in q for t in ["dang ky","dang nhap","quen mat khau","doi mat khau"]):return "Bạn bấm ‘Đăng nhập’ ở đầu trang; chọn ‘Đăng ký’ nếu chưa có tài khoản. Sau đăng nhập, bấm tên tài khoản để sửa hồ sơ hoặc đổi mật khẩu. Chưa có luồng khôi phục mật khẩu qua email. Không nhập mật khẩu vào chat.",[]
    if any(t in q for t in ["cach nau","cach lam","cong thuc"]):return "Dữ liệu cửa hàng chưa có công thức hoặc định lượng chế biến. Mình có thể cung cấp nguyên liệu chính, giá và các thông tin món đã được xác nhận, hoặc giúp bạn chọn món tương tự.",named[:2]
    if named and (len(named)>=2 and any(t in q for t in ["so sanh","khac","voi"]) or any(t in q for t in ["gia","bao nhieu","nguyen lieu","lam tu","co gi","calo","kcal","cay khong","chay khong","danh gia","chi tiet"])):
        selected=named[:4]
        if len(selected)>=2 and any(t in q for t in ["so sanh","khac","voi"]):
            lines=[f"{d['name']}: {money(d['base_price'])}; nguyên liệu chính: {d.get('main_ingredient') or 'chưa có dữ liệu'}; {'còn bán' if d['is_available'] else 'hết món'}." for d in selected]
            if len(selected)==2:
                first,second=sorted(selected,key=lambda d:d['base_price'])
                gap=second['base_price']-first['base_price']
                lines.append(f"{first['name']} rẻ hơn {second['name']} {money(gap)}." if gap else "Hai món có cùng giá phần tiêu chuẩn.")
            lines.append("Độ cay, calo hoặc xác nhận món chay còn thiếu trong dữ liệu CSV; mình chưa thể so sánh các thuộc tính này.")
            reply="\n".join(lines)
        elif "chi tiet" in q:reply="\n\n".join(detail_text(d) for d in selected)
        else:
            lines=[]
            for d in selected:
                facts=[]
                if any(t in q for t in ["gia","bao nhieu tien","bao nhieu?"]):facts.append(money(d['base_price'])+", "+("còn bán" if d['is_available'] else "hết món")+" (phần tiêu chuẩn)")
                if any(t in q for t in ["nguyen lieu","lam tu","co gi"]):facts.append("Nguyên liệu chính: "+(d.get('main_ingredient') or "chưa có dữ liệu")+"; đây chưa phải danh sách thành phần đầy đủ")
                if any(t in q for t in ["calo","kcal"]):facts.append("Năng lượng: "+(f"{d['calories']} kcal" if d['calories'] is not None else "chưa có dữ liệu"))
                if "cay" in q:facts.append("Độ cay: "+(f"{d['spiciness_level']}/3" if d['spiciness_level'] is not None else "chưa được xác nhận"))
                if "chay" in q:facts.append("Món chay: "+("đã xác nhận" if d['is_vegetarian'] is True else "không phải món chay" if d['is_vegetarian'] is False else "chưa được xác nhận"))
                if "danh gia" in q:facts.append(rating_text(d))
                lines.append(d['name']+": "+". ".join(facts)+"." if facts else detail_text(d))
            reply="\n".join(lines)
        return reply,[d for d in selected if d['is_available']]
    if re.fullmatch(r"\s*(chao|xin chao|hello|hi|cam on|thanks|tam biet)[!,.\s]*",q):return "Chào bạn! Mình có thể tìm món theo giá, nguyên liệu, danh mục và khẩu vị; so sánh món, ghép combo theo ngân sách, giải thích đánh giá và hướng dẫn đặt hàng. Ví dụ: ‘Phở gà giá bao nhiêu?’ hoặc ‘combo 2 người tối đa 100k’.",[]
    if any(t in q for t in ["ban la ai","ban lam duoc gi","giup duoc gi","chatgpt","thoi tiet","viet code","lap trinh"]):return "Mình là trợ lý chọn món FoodAI, hỗ trợ câu hỏi về thực đơn và quy trình của cửa hàng. Hiện chạy tư vấn từ dữ liệu kết hợp gợi ý LinUCB; chưa bật mô hình hội thoại tự do. Bạn có thể hỏi giá, nguyên liệu, so sánh món, combo hoặc cách đặt hàng.",[]
    return None
