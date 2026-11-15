"""Local conversation and dish Q&A grounded in the live catalogue.

No generated ingredient lists: admin edits to descriptions/prices take effect
on the next question. No customer data is stored by this module.
"""
import re
from services import normalize, MENU


def price(value):
    return f"{value:,.0f}".replace(",", ".") + "đ"


DETAIL_HINTS = (
    "vi the nao", "huong vi", "mo ta", "gioi thieu", "ngon khong",
    "co ngon", "gom gi", "gom nhung gi", "thanh phan", "an kem",
    "con khong", "con ban", "het chua", "size", "topping", "phan lon",
    "bao nhieu phan", "du an", "bao nhieu nguoi", "it duong", "it da",
    "khong hanh", "bo hanh", "nuoc cham", "bao nhieu", "mac khong",
)


def is_dish_question(query):
    q = normalize(query)
    return any(hint in q for hint in DETAIL_HINTS)


def conversation_reply(query, named):
    q = normalize(query).strip(" !.,?~😊")
    # Only match complete social utterances so "chào, phở gà bao nhiêu?"
    # continues into dish Q&A instead of losing the customer's question.
    if re.fullmatch(r"(?:(?:xin |em |minh )?chao(?: ban| shop| ad| quan| buoi sang| buoi trua| buoi toi)?|hello|helo|hi|hey|alo|a lo|shop oi|ban oi|ad oi|co ai khong)(?: nhe| nha| a| ak| oi| nhe a)?", q):
        return "Chào bạn, mình đây! Bạn muốn ăn món gì hôm nay? Nếu chưa chọn được, cứ nói bạn thích cơm, món nước hay đồ ăn nhẹ và muốn chi khoảng bao nhiêu, mình sẽ chọn cùng bạn.", []
    if re.fullmatch(r"(?:cam on(?: ban| shop| nhieu| nhe| nha| a)*|thank you|thanks|thank|tks|ok(?:e|ee|ay)?(?: cam on)?|duoc roi|hay qua|tuyet voi)", q):
        return "Rất vui vì giúp được bạn! Khi cần, bạn cứ hỏi thêm về món vừa chọn, đổi món khác hoặc xem giỏ hàng nhé.", []
    if re.fullmatch(r"(?:tam biet(?: ban)?(?: nhe)?|bye(?: bye)?|hen gap lai|chuc ngu ngon)", q):
        return "Tạm biệt bạn, hẹn gặp lại! Khi muốn chọn món, cứ mở chat gọi mình nhé.", []
    if any(t in q for t in ["ban ten gi", "ten cua ban", "goi ban la gi"]):
        return "Bạn cứ gọi mình là FoodAI nhé! Mình giúp bạn tìm món, xem giá và chọn bữa ăn hợp khẩu vị. Hôm nay bạn muốn ăn gì?", []
    if any(t in q for t in ["ban co phai nguoi", "nguoi that", "ban la robot"]):
        return "Mình là trợ lý tự động của FoodAI. Mình có thể trò chuyện và tra thực đơn để giúp bạn chọn món; nếu cần xác nhận riêng với bếp, bạn vẫn cần liên hệ cửa hàng nhé.", []
    if any(t in q for t in ["khong hieu", "chua hieu", "tra loi sai", "chua dung", "khong phai y", "ban noi sai"]):
        return "Có vẻ mình hiểu chưa đúng ý bạn. Bạn đang muốn hỏi về tên món, giá, thành phần hay cách đặt hàng? Bạn nói rõ một chút, mình sẽ kiểm tra lại theo thực đơn nhé.", []
    if not named and any(t in q for t in ["doi bung", "dang doi", "khong biet an gi", "chua biet an gi", "an gi bay gio", "tu van giup", "buon qua", "met qua"]):
        return "Mình giúp bạn chọn nhé. Bạn muốn một bữa chính hay ăn nhẹ? Cho mình biết ngân sách và có nguyên liệu nào bạn không ăn được; ví dụ ‘cơm dưới 60k’ hoặc ‘bánh mì dưới 30k’.", []
    return None


def dish_answer(query, named):
    """Additional questions; existing price/calorie/review handlers stay available."""
    if not named:
        return None
    q = normalize(query)
    lines = []
    for d in named[:4]:
        facts = []
        if any(t in q for t in ["huong vi", "vi the nao", "mo ta", "gioi thieu", "ngon khong", "co ngon", "gom gi", "gom nhung gi", "thanh phan", "an kem", "nuoc cham"]):
            facts.append("Theo mô tả hiện tại của cửa hàng: " + (d.get("description") or "chưa có mô tả chi tiết") +
                         " Đây chưa phải danh sách đầy đủ các thành phần.")
            if "ngon" in q:
                facts.append("Khẩu vị mỗi người khác nhau; bạn thích vị đậm, thanh hay giòn để mình giúp chọn sát hơn?")
        if any(t in q for t in ["con khong", "con ban", "het chua", "con mon"]):
            facts.append("Hiện " + ("còn bán, bạn có thể chọn trên thực đơn." if d["is_available"] else "đã hết món; mình có thể giúp bạn tìm món khác."))
        if any(t in q for t in ["size", "topping", "phan lon"]):
            if d.get("customizable"):
                toppings = MENU["toppings"].get(d["topping_group"], [])
                facts.append("Có size S (giá gốc), M (+10.000đ), L (+20.000đ). Topping: " +
                             "; ".join(t["name"] + " +" + price(t["price"]) for t in toppings) +
                             ". Mở chi tiết món để chọn và xem tổng giá trước khi thêm giỏ.")
            else:
                facts.append("Hiện chỉ có phần tiêu chuẩn, chưa bật lựa chọn size hoặc topping.")
        if any(t in q for t in ["du an", "bao nhieu nguoi", "bao nhieu phan", "khau phan"]):
            facts.append("Giá niêm yết tính cho một phần tiêu chuẩn; cửa hàng chưa xác nhận khối lượng hoặc số người ăn mỗi phần. Bạn cho biết số người và ngân sách để mình ghép các phần nhé.")
        if any(t in q for t in ["it duong", "it da", "khong hanh", "bo hanh", "bo ot", "them rau"]):
            facts.append("Bạn có thể ghi yêu cầu vào ô Ghi chú khi chọn món. Đây là yêu cầu gửi bếp, mình chưa thể xác nhận bếp đáp ứng được; hãy liên hệ cửa hàng nếu yêu cầu bắt buộc.")
        quantity = re.search(r"\b(\d{1,2})\s*(?:phan|suat|to|ly|cai)\b", q)
        if quantity and any(t in q for t in ["gia", "bao nhieu", "tong", "het may"]):
            n = int(quantity[1])
            if n:
                facts.append(f"{n} phần tiêu chuẩn × {price(d['base_price'])} = {price(n*d['base_price'])}, chưa cộng size/topping. " +
                             ("Món hiện còn bán." if d["is_available"] else "Món hiện hết bán."))
        if facts:
            lines.append(d["name"] + ": " + " ".join(facts))
    if lines:
        return "\n\n".join(lines), [d for d in named[:4] if d["is_available"]]
    return None
