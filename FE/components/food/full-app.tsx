"use client";

import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  ArrowRight,
  Check,
  ChefHat,
  Clock,
  LogOut,
  Search,
  ShoppingBag,
  Sparkles,
  Star,
  UtensilsCrossed,
  X,
} from "lucide-react";
import {
  CATEGORIES,
  TOPPINGS,
  SIZES,
  type ToppingGroup,
} from "@/lib/menu-data";
import {
  request,
  money,
  statuses,
  emptyCart,
  type User,
  type Dish,
  type Cart,
  type Order,
  type Suggestions,
  type Reviews,
  type AdminOverview,
  type AdminUser,
  type AdminCategory,
} from "@/lib/api";
import { ChatWidget } from "@/components/food/chat-widget";

const legacyStorageKey = "foodorder.session.v2";
const customerStorageKey = "foodorder.customer.session.v3";
const adminStorageKey = "foodorder.admin.session.v3";
const sharedStorageKey = "foodorder.session.v4";
function clearSession(token: string) {
  for (const key of [
    sharedStorageKey,
    customerStorageKey,
    adminStorageKey,
    legacyStorageKey,
  ]) {
    if (localStorage.getItem(key) === token) localStorage.removeItem(key);
  }
}
const Feedback = createContext({ error: "", notice: "" });
const text = (form: HTMLFormElement, key: string) =>
  String(new FormData(form).get(key) || "").trim();
const date = (value: string) =>
  new Date(value.endsWith("Z") ? value : value + "Z").toLocaleString("vi-VN");

function Modal({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const feedback = useContext(Feedback);
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog?.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <dialog
      ref={ref}
      className="fo-dialog"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="fo-dialog-head">
        <h2>{title}</h2>
        <button
          type="button"
          className="fo-icon"
          aria-label="Đóng"
          onClick={close}
        >
          <X size={22} />
        </button>
      </div>
      {feedback.error && (
        <div className="fo-error" role="alert">
          {feedback.error}
        </div>
      )}
      {feedback.notice && (
        <div className="fo-success" role="status">
          {feedback.notice}
        </div>
      )}
      {children}
    </dialog>
  );
}
function Field({
  label,
  name,
  type = "text",
  defaultValue = "",
  ...props
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | number;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number;
  pattern?: string;
  autoComplete?: string;
}) {
  return (
    <label className="fo-field">
      <span>{label}</span>
      <input name={name} type={type} defaultValue={defaultValue} {...props} />
    </label>
  );
}

function DishRating({ dish }: { dish: Dish }) {
  const hasSample =
    dish.demo_rating_source === "sample" && dish.demo_rating != null;
  return (
    <>
      <div className="fo-rating">
        <Star size={14} />
        {hasSample ? (
          <>
            <strong>{dish.demo_rating!.toFixed(1)}/5</strong>
            <span>({dish.demo_review_count} lượt)</span>
          </>
        ) : (
          <>
            {dish.average_rating ?? "Chưa có đánh giá mua hàng"}
            {dish.review_count > 0 && ` (${dish.review_count})`}
          </>
        )}
        {dish.is_vegetarian && <span> · Món chay</span>}
      </div>
      {hasSample && <div className="fo-reference">Đánh giá mẫu</div>}
      {hasSample && dish.review_count > 0 && (
        <div className="fo-reference">
          Khách đã mua: {dish.average_rating}/5 ({dish.review_count} lượt)
        </div>
      )}
      {!hasSample && (dish.reference_count || 0) > 0 && (
        <div className="fo-reference">
          Tham khảo dữ liệu: {dish.reference_rating}/5 ({dish.reference_count})
        </div>
      )}
    </>
  );
}

function DishCard({
  dish,
  open,
  add,
}: {
  dish: Dish;
  open: (d: Dish) => void;
  add: (d: Dish) => void;
}) {
  return (
    <article
      className={`fo-card ${!dish.is_available ? "fo-unavailable" : ""}`}
    >
      <button
        className="fo-photo"
        onClick={() => open(dish)}
        aria-label={`Xem ${dish.name}`}
      >
        <img src={dish.image_url} alt={dish.name} />
        {dish.image_is_illustration && (
          <span className="fo-illustration">Hình minh họa</span>
        )}
        <span className={`fo-badge ${dish.is_available ? "" : "fo-sold"}`}>
          {dish.is_available ? "Còn bán" : "Hết món"}
        </span>
      </button>
      <div className="fo-card-body">
        <button className="fo-title-button" onClick={() => open(dish)}>
          <h3>{dish.name}</h3>
        </button>
        <p>{dish.description}</p>
        <DishRating dish={dish} />
        <div className="fo-between">
          <strong>{money(dish.base_price)}</strong>
          <button
            className="fo-add"
            disabled={!dish.is_available}
            onClick={() => add(dish)}
            aria-label={`Thêm ${dish.name} vào giỏ`}
          >
            +
          </button>
        </div>
      </div>
    </article>
  );
}

export function FoodOrderApp({ admin = false }: { admin?: boolean }) {
  const storageKey = sharedStorageKey;
  const [token, setToken] = useState("");
  const [ready, setReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);
  const [dishes, setDishes] = useState<Dish[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [categories, setCategories] = useState(CATEGORIES);
  const [ingredients, setIngredients] = useState<string[]>([]);
  const [ingredient, setIngredient] = useState("");
  const [priceLimit, setPriceLimit] = useState("");
  const [sort, setSort] = useState("name");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [catalogError, setCatalogError] = useState("");
  const catalogSequence = useRef(0);
  const activeToken = useRef(token);
  activeToken.current = token;
  const [cart, setCart] = useState<Cart>(emptyCart);
  const [orders, setOrders] = useState<Order[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [selected, setSelected] = useState<Dish | null>(null);
  const [reviews, setReviews] = useState<Reviews | null>(null);
  const [panel, setPanel] = useState<
    "auth" | "cart" | "history" | "profile" | null
  >(null);
  const [authMode, setAuthMode] = useState("login");
  const [orderDetail, setOrderDetail] = useState<Order | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [size, setSize] = useState("S");
  const [toppings, setToppings] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [itemNote, setItemNote] = useState("");
  const [preview, setPreview] = useState<Cart | null>(null);
  const [recipient, setRecipient] = useState({
    recipient_name: "",
    phone_number: "",
    delivery_address: "",
    note: "",
  });
  const checkoutKey = useRef("");
  const [editor, setEditor] = useState<Dish | "new" | null>(null);
  const [adminSection, setAdminSection] = useState("overview");
  const [adminOverview, setAdminOverview] = useState<AdminOverview | null>(null);
  const [adminUsers, setAdminUsers] = useState<AdminUser[]>([]);
  const [adminCategories, setAdminCategories] = useState<AdminCategory[]>([]);

  const run = async (action: () => Promise<void>) => {
    setError("");
    setNotice("");
    setBusy(true);
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Không thể kết nối máy chủ. Kiểm tra backend đang chạy.",
      );
    } finally {
      setBusy(false);
    }
  };
  const loadDishes = useCallback(async () => {
    const sequence = ++catalogSequence.current;
    try {
      const rows = await request<Dish[]>(
        `/api/dishes?search=${encodeURIComponent(search)}&category=${encodeURIComponent(category)}&ingredient=${encodeURIComponent(ingredient)}&sort=${sort}&available_only=${onlyAvailable}${priceLimit ? `&max_price=${priceLimit}` : ""}`,
        "",
      );
      if (sequence === catalogSequence.current) {
        setDishes(rows);
        setCatalogError("");
      }
    } catch (e) {
      if (sequence === catalogSequence.current)
        setCatalogError(
          "Không tải được thực đơn. Kiểm tra backend và thử lại.",
        );
      throw e;
    }
  }, [search, category, ingredient, sort, priceLimit, onlyAvailable]);
  const loadPrivate = useCallback(
    async (t: string, u: User) => {
      const [c, o, r] = await Promise.all([
        request<Cart>("/api/cart", t),
        request<Order[]>(
          admin && u.role === "admin" ? "/api/admin/orders" : "/api/orders",
          t,
        ),
        request<Suggestions>("/api/recommendations", t),
      ]);
      if (t !== activeToken.current) return;
      setCart(c);
      setOrders(o);
      setSuggestions(r);
      setOrderDetail((old) =>
        old ? o.find((item) => item.id === old.id) || old : null,
      );
    },
    [admin],
  );
  const loadAdmin = useCallback(async (t: string) => {
    const [overview, users, categories] = await Promise.all([
      request<AdminOverview>("/api/admin/overview", t),
      request<AdminUser[]>("/api/admin/users", t),
      request<AdminCategory[]>("/api/admin/categories", t),
    ]);
    if (t !== activeToken.current) return;
    setAdminOverview(overview);
    setAdminUsers(users);
    setAdminCategories(categories);
  }, []);
  useEffect(() => {
    setToken(
      localStorage.getItem(storageKey) ||
        localStorage.getItem(adminStorageKey) ||
        localStorage.getItem(customerStorageKey) ||
        localStorage.getItem(legacyStorageKey) ||
        "",
    );
    setReady(true);
    request<typeof CATEGORIES>("/api/categories", "")
      .then(setCategories)
      .catch(() => {});
    request<{ ingredients: string[] }>("/api/catalog/summary", "")
      .then((data) => setIngredients(data.ingredients))
      .catch(() => {});
    const syncSession = (event: StorageEvent) => {
      if (event.key !== storageKey) return;
      setToken(event.newValue || "");
      setUser(null);
      setCart(emptyCart);
      setOrders([]);
      setSuggestions(null);
      setOrderDetail(null);
      setPanel(null);
      setPreview(null);
    };
    window.addEventListener("storage", syncSession);
    return () => window.removeEventListener("storage", syncSession);
  }, [storageKey]);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      loadDishes()
        .catch((e) => {
          if (!cancelled) setError(e.message);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
      catalogSequence.current++;
    };
  }, [loadDishes]);
  useEffect(() => {
    if (!ready || !token) return;
    let cancelled = false;
    request<User>("/api/users/me", token)
      .then(async (u) => {
        if (cancelled) return;
        if (localStorage.getItem(legacyStorageKey) === token)
          localStorage.removeItem(legacyStorageKey);
        if (admin && u.role !== "admin") {
          setUser(u);
          return;
        }
        localStorage.setItem(storageKey, token);
        localStorage.removeItem(adminStorageKey);
        localStorage.removeItem(customerStorageKey);
        setUser(u);
        setRecipient((old) => ({
          ...old,
          recipient_name: u.full_name,
          phone_number: u.phone_number || "",
        }));
        await loadPrivate(token, u);
        if (admin && u.role === "admin") await loadAdmin(token);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e.message);
        clearSession(token);
        setToken("");
        setUser(null);
        setCart(emptyCart);
        setOrders([]);
        setSuggestions(null);
      });
    return () => {
      cancelled = true;
    };
  }, [ready, token, loadPrivate, loadAdmin, storageKey, admin]);
  useEffect(() => {
    const timer = setInterval(() => {
      loadDishes().catch(() => {});
      if (token && user)
        Promise.all([
          loadPrivate(token, user),
          ...(admin && user.role === "admin" ? [loadAdmin(token)] : []),
        ]).catch((e) => setError(e.message));
    }, 10000);
    return () => clearInterval(timer);
  }, [loadDishes, loadPrivate, loadAdmin, token, user, admin]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 5000);
    return () => clearTimeout(timer);
  }, [notice]);

  const openDish = (dish: Dish) => {
    void run(async () => {
      const [fresh, r] = await Promise.all([
        request<Dish>(`/api/dishes/${dish.id}`, ""),
        request<Reviews>(`/api/dishes/${dish.id}/reviews`, ""),
      ]);
      setSelected(fresh);
      setReviews(r);
      setSize("S");
      setToppings([]);
      setQuantity(1);
      setItemNote("");
      if (user) {
        await request(`/api/dishes/${dish.id}/views`, token, "POST", {
          request_key: crypto.randomUUID(),
        });
        setSuggestions(
          await request<Suggestions>("/api/recommendations", token),
        );
      }
    });
  };
  const add = (dish: Dish, withOptions = false) => {
    if (!user) {
      setPanel("auth");
      return;
    }
    void run(async () => {
      setCart(
        await request<Cart>("/api/cart/items", token, "POST", {
          dish_id: dish.id,
          quantity: withOptions ? quantity : 1,
          size: withOptions ? size : "S",
          toppings: withOptions ? toppings : [],
          note: withOptions ? itemNote : "",
        }),
      );
      setPreview(null);
      setNotice(`Đã thêm ${dish.name} vào giỏ`);
      if (withOptions) setSelected(null);
      setSuggestions(await request<Suggestions>("/api/recommendations", token));
    });
  };
  const auth = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = event.currentTarget;
    void run(async () => {
      const email = text(f, "email"),
        password = text(f, "password");
      if (authMode === "register") {
        await request("/api/auth/register", "", "POST", {
          email,
          password,
          full_name: text(f, "full_name"),
          phone_number: text(f, "phone_number"),
          confirm_password: text(f, "confirm_password"),
        });
        setNotice("Đăng ký thành công. Hãy đăng nhập bằng tài khoản vừa tạo.");
        setAuthMode("login");
        return;
      }
      const session = await request<{ access_token: string; user: User }>(
        admin ? "/api/admin/auth/login" : "/api/auth/login",
        "",
        "POST",
        { email, password },
      );
      localStorage.setItem(storageKey, session.access_token);
      setToken(session.access_token);
      setUser(session.user);
      setPanel(null);
      setNotice("Đăng nhập thành công");
    });
  };
  const logout = () => {
    void run(async () => {
      await request("/api/auth/logout", token, "POST");
      clearSession(token);
      setToken("");
      setUser(null);
      setCart(emptyCart);
      setOrders([]);
      setSuggestions(null);
      setPanel(null);
      setOrderDetail(null);
      setNotice("Đã đăng xuất");
    });
  };
  const changeQuantity = (id: string, value: number) => {
    void run(async () => {
      setCart(
        await request<Cart>(`/api/cart/items/${id}`, token, "PUT", {
          quantity: value,
        }),
      );
      setPreview(null);
    });
  };
  const removeItem = (id: string) => {
    void run(async () => {
      setCart(await request<Cart>(`/api/cart/items/${id}`, token, "DELETE"));
      setPreview(null);
    });
  };
  const placeOrder = () => {
    void run(async () => {
      if (!checkoutKey.current) checkoutKey.current = crypto.randomUUID();
      const o = await request<Order>("/api/orders", token, "POST", {
        ...recipient,
        request_key: checkoutKey.current,
        payment_method: "COD",
        expected_total: preview?.final_amount,
      });
      checkoutKey.current = "";
      setPreview(null);
      setPanel(null);
      setOrderDetail(o);
      setNotice("Đặt hàng thành công. Cửa hàng sẽ xác nhận đơn của bạn.");
      if (user) await loadPrivate(token, user);
    });
  };
  const updateStatus = (order: Order, status: string, reason = "") => {
    void run(async () => {
      const o = await request<Order>(
        `/api/admin/orders/${order.id}/status`,
        token,
        "PATCH",
        { status, reason },
      );
      setOrderDetail(o);
      if (user) await loadPrivate(token, user);
      setNotice("Đã cập nhật đơn hàng");
    });
  };
  const rating = (
    event: FormEvent<HTMLFormElement>,
    dishId: string,
    orderId: string,
  ) => {
    event.preventDefault();
    const f = event.currentTarget;
    void run(async () => {
      await request(`/api/dishes/${dishId}/reviews`, token, "PUT", {
        order_id: orderId,
        stars: Number(text(f, "stars")),
        comment: text(f, "comment"),
      });
      setNotice("Đã lưu đánh giá. Gợi ý của bạn đã được cập nhật.");
      await loadDishes();
      if (user) await loadPrivate(token, user);
    });
  };
  const saveDish = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const f = event.currentTarget;
    void run(async () => {
      const value = {
        name: text(f, "name"),
        description: text(f, "description"),
        base_price: Number(text(f, "base_price")),
        image_url: text(f, "image_url"),
        category: text(f, "category"),
        is_available: text(f, "is_available") === "true",
        calories:
          text(f, "calories") === "" ? null : Number(text(f, "calories")),
        spiciness_level:
          text(f, "spiciness_level") === ""
            ? null
            : Number(text(f, "spiciness_level")),
        is_vegetarian:
          text(f, "is_vegetarian") === ""
            ? null
            : text(f, "is_vegetarian") === "true",
        main_ingredient: text(f, "main_ingredient") || null,
        customizable: new FormData(f).get("customizable") === "on",
      };
      await request(
        editor === "new"
          ? "/api/admin/dishes"
          : `/api/admin/dishes/${(editor as Dish).id}`,
        token,
        editor === "new" ? "POST" : "PUT",
        value,
      );
      setEditor(null);
      await loadDishes();
      if (user) await loadPrivate(token, user);
      setNotice("Đã lưu món ăn vào hệ thống");
    });
  };
  const toggleDish = (dish: Dish) => {
    void run(async () => {
      await request(
        `/api/admin/dishes/${dish.id}/availability`,
        token,
        "PATCH",
        { is_available: !dish.is_available },
      );
      await loadDishes();
      if (user) await loadPrivate(token, user);
      setNotice("Đã cập nhật trạng thái bán");
    });
  };
  const updateAdminUser = (
    account: AdminUser,
    role: "customer" | "admin",
    status: "active" | "inactive" | "banned",
  ) => {
    void run(async () => {
      await request(`/api/admin/users/${account.id}`, token, "PATCH", {
        role,
        status,
      });
      await loadAdmin(token);
      setNotice("Đã cập nhật tài khoản");
    });
  };
  const selectedToppings = selected
    ? TOPPINGS[selected.topping_group as ToppingGroup] || TOPPINGS.rice
    : [];
  const detailPrice = selected
    ? selected.base_price +
      (SIZES.find((s) => s.id === size)?.extra || 0) +
      selectedToppings
        .filter((t) => toppings.includes(t.id))
        .reduce((sum, t) => sum + t.price, 0)
    : 0;

  return (
    <Feedback.Provider value={{ error, notice }}>
      <div className="fo-app">
        <header className="fo-header">
          <div className="fo-shell fo-header-inner">
            <a href="/" className="fo-brand">
              <span>
                <UtensilsCrossed size={24} />
              </span>
              <div>
                Food<span>AI</span>
                <small>Ăn ngon theo cách của bạn</small>
              </div>
            </a>
            <nav aria-label="Điều hướng chính">
              <a href="/">
                {admin && user?.role === "admin" ? "Đặt món" : "Thực đơn"}
              </a>
              {user?.role === "admin" && (
                <a href="/admin" aria-current={admin ? "page" : undefined}>
                  Quản trị cửa hàng
                </a>
              )}
              {user && !admin && (
                <button onClick={() => setPanel("history")}>Đơn của tôi</button>
              )}
            </nav>
            <div className="fo-account">
              {!admin && user?.role === "admin" && (
                <a className="fo-admin-shortcut" href="/admin">
                  Quản trị
                </a>
              )}
              {user ? (
                <>
                  <button onClick={() => setPanel("profile")}>
                    {user.full_name} · {user.role === "admin" ? "Admin" : "Khách hàng"}
                  </button>
                  <button
                    className="fo-icon"
                    aria-label="Đăng xuất"
                    onClick={logout}
                    disabled={busy}
                  >
                    <LogOut size={19} />
                  </button>
                </>
              ) : (
                <button
                  className="fo-primary"
                  onClick={() => {
                    setAuthMode("login");
                    setPanel("auth");
                  }}
                >
                  {admin ? "Đăng nhập admin" : "Đăng nhập"}
                </button>
              )}
              {!admin && (
                <button
                  className="fo-cart-button"
                  onClick={() => {
                    setPreview(null);
                    setPanel(user ? "cart" : "auth");
                  }}
                >
                  <ShoppingBag size={19} />
                  <span>Giỏ hàng</span>
                  <b>{cart.items.reduce((s, i) => s + i.quantity, 0)}</b>
                </button>
              )}
            </div>
          </div>
        </header>
        <div aria-live="polite" className="fo-alerts">
          {notice && (
            <div className="fo-success">
              <Check size={18} />
              {notice}
              <button aria-label="Ẩn thông báo" onClick={() => setNotice("")}>
                ×
              </button>
            </div>
          )}
          {error && (
            <div className="fo-error" role="alert">
              {error}
              <button aria-label="Ẩn lỗi" onClick={() => setError("")}>
                ×
              </button>
            </div>
          )}
        </div>
        {admin ? (
          <main className="fo-shell fo-main">
            <div className="fo-section-heading">
              <div>
                <span className="fo-eyebrow">FOODAI / QUẢN TRỊ</span>
                <h1>Quản lý cửa hàng</h1>
              </div>
              <ChefHat size={40} />
            </div>
            {!ready || (!user && token) ? (
              <p>Đang kiểm tra tài khoản…</p>
            ) : user?.role !== "admin" ? (
              <div className="fo-empty">
                <h2>Cần tài khoản quản trị viên</h2>
                <p>
                  Dùng tài khoản admin của cửa hàng để quản lý món ăn, giá bán,
                  hình ảnh và đơn hàng. Tài khoản khách không có quyền chỉnh
                  sửa.
                </p>
                <button
                  className="fo-primary"
                  onClick={() => {
                    setAuthMode("login");
                    setPanel("auth");
                  }}
                >
                  Đăng nhập admin
                </button>
                <p>
                  <a href="/">Về trang khách hàng</a>
                </p>
              </div>
            ) : (
              <>
                <div className="fo-stats">
                  <div>
                    <small>Chờ xác nhận</small>
                    <b>{orders.filter((o) => o.status === "pending").length}</b>
                  </div>
                  <div>
                    <small>Đang chế biến</small>
                    <b>
                      {orders.filter((o) => o.status === "preparing").length}
                    </b>
                  </div>
                  <div>
                    <small>Đã hoàn thành</small>
                    <b>
                      {orders.filter((o) => o.status === "completed").length}
                    </b>
                  </div>
                  <div>
                    <small>Doanh thu đơn hoàn thành</small>
                    <b>
                      {money(
                        orders
                          .filter((o) => o.status === "completed")
                          .reduce((s, o) => s + o.final_amount, 0),
                      )}
                    </b>
                  </div>
                </div>
                <div className="fo-tabs">
                  <button
                    className={adminSection === "overview" ? "active" : ""}
                    onClick={() => setAdminSection("overview")}
                  >
                    Tổng quan
                  </button>
                  <button
                    className={adminSection === "orders" ? "active" : ""}
                    onClick={() => setAdminSection("orders")}
                  >
                    Đơn hàng
                  </button>
                  <button
                    className={adminSection === "menu" ? "active" : ""}
                    onClick={() => setAdminSection("menu")}
                  >
                    Món ăn
                  </button>
                  <button
                    className={adminSection === "users" ? "active" : ""}
                    onClick={() => setAdminSection("users")}
                  >
                    Tài khoản
                  </button>
                  <button
                    className={adminSection === "categories" ? "active" : ""}
                    onClick={() => setAdminSection("categories")}
                  >
                    Danh mục
                  </button>
                  <button
                    className={adminSection === "reports" ? "active" : ""}
                    onClick={() => setAdminSection("reports")}
                  >
                    Báo cáo
                  </button>
                  <button
                    onClick={() =>
                      void run(async () => {
                        await loadDishes();
                        await loadPrivate(token, user);
                        await loadAdmin(token);
                        setNotice("Đã tải dữ liệu mới");
                      })
                    }
                  >
                    Làm mới
                  </button>
                </div>
                {adminSection === "overview" ? (
                  <>
                    <div className="fo-between">
                      <div>
                        <h2>Tổng quan cửa hàng</h2>
                        <p className="fo-muted">
                          Theo dõi nhanh hoạt động bán hàng và dữ liệu hệ thống.
                        </p>
                      </div>
                      <a className="fo-primary" href="/">
                        Đặt món như khách hàng
                      </a>
                    </div>
                    <div className="fo-stats">
                      <div>
                        <small>Tài khoản</small>
                        <b>{adminOverview?.users ?? adminUsers.length}</b>
                      </div>
                      <div>
                        <small>Món đang bán</small>
                        <b>
                          {adminOverview?.available_dishes ??
                            dishes.filter((d) => d.is_available).length}
                          /{adminOverview?.dishes ?? dishes.length}
                        </b>
                      </div>
                      <div>
                        <small>Tổng đơn hàng</small>
                        <b>{adminOverview?.total_orders ?? orders.length}</b>
                      </div>
                      <div>
                        <small>Doanh thu hoàn thành</small>
                        <b>{money(adminOverview?.revenue ?? 0)}</b>
                      </div>
                    </div>
                    <div className="fo-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Trạng thái đơn</th>
                            <th>Số lượng</th>
                            <th>Mô tả</th>
                          </tr>
                        </thead>
                        <tbody>
                          {["pending", "preparing", "completed", "cancelled"].map(
                            (status) => (
                              <tr key={status}>
                                <td>
                                  <span className={`fo-status ${status}`}>
                                    {statuses[status]}
                                  </span>
                                </td>
                                <td>
                                  {adminOverview?.status_counts?.[status] ?? 0}
                                </td>
                                <td>
                                  {status === "pending"
                                    ? "Đơn mới đang chờ cửa hàng xác nhận"
                                    : status === "preparing"
                                      ? "Đơn đang được chế biến"
                                      : status === "completed"
                                        ? "Đơn đã hoàn thành và được tính doanh thu"
                                        : "Đơn đã bị từ chối hoặc hủy"}
                                </td>
                              </tr>
                            ),
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : adminSection === "orders" ? (
                  <>
                    <h2>Tất cả đơn hàng</h2>
                    <p className="fo-muted">
                      Chọn đơn để xem món, số lượng và thông tin người nhận. Tự
                      cập nhật mỗi 10 giây.
                    </p>
                    {orders.length === 0 ? (
                      <div className="fo-empty">Chưa có đơn hàng.</div>
                    ) : (
                      <div className="fo-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Mã đơn</th>
                              <th>Khách hàng</th>
                              <th>Thời gian</th>
                              <th>Tổng tiền</th>
                              <th>Trạng thái</th>
                              <th>Chi tiết</th>
                            </tr>
                          </thead>
                          <tbody>
                            {orders.map((o) => (
                              <tr key={o.id}>
                                <td>
                                  <strong>{o.order_code}</strong>
                                </td>
                                <td>{o.customer_name}</td>
                                <td>{date(o.created_at)}</td>
                                <td>{money(o.final_amount)}</td>
                                <td>
                                  <span className={`fo-status ${o.status}`}>
                                    {statuses[o.status]}
                                  </span>
                                </td>
                                <td>
                                  <button
                                    className="fo-secondary"
                                    onClick={() =>
                                      void run(async () =>
                                        setOrderDetail(
                                          await request<Order>(
                                            `/api/admin/orders/${o.id}`,
                                            token,
                                          ),
                                        ),
                                      )
                                    }
                                  >
                                    Xem đơn
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                ) : adminSection === "menu" ? (
                  <>
                    <div className="fo-between">
                      <h2>Thực đơn cửa hàng</h2>
                      <button
                        className="fo-primary"
                        onClick={() => setEditor("new")}
                      >
                        + Thêm món
                      </button>
                    </div>
                    <label className="fo-search fo-admin-search">
                      <Search size={18} />
                      <input
                        aria-label="Tìm món để chỉnh sửa"
                        placeholder="Tìm món để chỉnh sửa…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <p className="fo-muted">
                      {dishes.length} món · Chọn Sửa để cập nhật tên, giá, ảnh,
                      danh mục và thông tin món.
                    </p>
                    <div className="fo-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Món ăn</th>
                            <th>Giá</th>
                            <th>Trạng thái</th>
                            <th>Thao tác</th>
                          </tr>
                        </thead>
                        <tbody>
                          {dishes.map((d) => (
                            <tr key={d.id}>
                              <td>
                                <div className="fo-table-dish">
                                  <img src={d.image_url} alt="" />
                                  <span>{d.name}</span>
                                </div>
                              </td>
                              <td>{money(d.base_price)}</td>
                              <td>
                                <span
                                  className={`fo-status ${d.is_available ? "completed" : "cancelled"}`}
                                >
                                  {d.is_available ? "Còn bán" : "Hết món"}
                                </span>
                              </td>
                              <td>
                                <div className="fo-actions">
                                  <button
                                    className="fo-secondary"
                                    aria-label={`Sửa món ${d.name}`}
                                    onClick={() => setEditor(d)}
                                  >
                                    Sửa
                                  </button>
                                  <button
                                    className="fo-secondary"
                                    disabled={busy}
                                    onClick={() => toggleDish(d)}
                                  >
                                    {d.is_available ? "Đánh dấu hết" : "Mở bán"}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : adminSection === "users" ? (
                  <>
                    <h2>Quản lý tài khoản</h2>
                    <p className="fo-muted">
                      Phân quyền khách hàng/quản trị viên và khóa tài khoản khi
                      cần. Không thể tự hạ quyền hoặc tự khóa tài khoản đang dùng.
                    </p>
                    <div className="fo-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Họ tên</th>
                            <th>Liên hệ</th>
                            <th>Số đơn</th>
                            <th>Quyền</th>
                            <th>Trạng thái</th>
                            <th>Ngày tạo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminUsers.map((account) => {
                            const isSelf = account.id === user.id;
                            return (
                              <tr key={account.id}>
                                <td>
                                  <strong>{account.full_name}</strong>
                                  {isSelf && <small> · Đang đăng nhập</small>}
                                </td>
                                <td>
                                  {account.email}
                                  <br />
                                  <small>{account.phone_number || "Chưa có SĐT"}</small>
                                </td>
                                <td>{account.order_count}</td>
                                <td>
                                  <select
                                    aria-label={`Quyền của ${account.full_name}`}
                                    value={account.role}
                                    disabled={busy || isSelf}
                                    onChange={(event) =>
                                      updateAdminUser(
                                        account,
                                        event.target.value as "customer" | "admin",
                                        account.status,
                                      )
                                    }
                                  >
                                    <option value="customer">Khách hàng</option>
                                    <option value="admin">Quản trị viên</option>
                                  </select>
                                </td>
                                <td>
                                  <select
                                    aria-label={`Trạng thái của ${account.full_name}`}
                                    value={account.status}
                                    disabled={busy || isSelf}
                                    onChange={(event) =>
                                      updateAdminUser(
                                        account,
                                        account.role as "customer" | "admin",
                                        event.target.value as
                                          | "active"
                                          | "inactive"
                                          | "banned",
                                      )
                                    }
                                  >
                                    <option value="active">Đang hoạt động</option>
                                    <option value="inactive">Tạm khóa</option>
                                    <option value="banned">Đã chặn</option>
                                  </select>
                                </td>
                                <td>{date(account.created_at)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : adminSection === "categories" ? (
                  <>
                    <h2>Danh mục món ăn</h2>
                    <p className="fo-muted">
                      Danh mục được đồng bộ từ thực đơn. Muốn chuyển danh mục,
                      hãy mở mục Món ăn và chọn Sửa ở món tương ứng.
                    </p>
                    <div className="fo-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Danh mục</th>
                            <th>Số món</th>
                            <th>Trạng thái</th>
                          </tr>
                        </thead>
                        <tbody>
                          {adminCategories.map((item) => (
                            <tr key={item.id}>
                              <td><strong>{item.name}</strong></td>
                              <td>{item.dish_count}</td>
                              <td>
                                <span className="fo-status completed">
                                  Đang sử dụng
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                ) : (
                  <>
                    <h2>Báo cáo bán hàng</h2>
                    <p className="fo-muted">
                      Chỉ tính doanh thu và số lượng từ các đơn đã hoàn thành.
                    </p>
                    <div className="fo-stats">
                      <div>
                        <small>Đơn hoàn thành</small>
                        <b>{adminOverview?.completed_orders ?? 0}</b>
                      </div>
                      <div>
                        <small>Doanh thu</small>
                        <b>{money(adminOverview?.revenue ?? 0)}</b>
                      </div>
                      <div>
                        <small>Danh mục</small>
                        <b>{adminOverview?.categories ?? adminCategories.length}</b>
                      </div>
                      <div>
                        <small>Món trong thực đơn</small>
                        <b>{adminOverview?.dishes ?? dishes.length}</b>
                      </div>
                    </div>
                    <div className="fo-table-wrap">
                      <table>
                        <thead>
                          <tr>
                            <th>Món bán chạy</th>
                            <th>Số phần đã bán</th>
                            <th>Doanh thu</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(adminOverview?.top_dishes ?? []).length ? (
                            adminOverview!.top_dishes.map((item) => (
                              <tr key={item.name}>
                                <td><strong>{item.name}</strong></td>
                                <td>{item.quantity}</td>
                                <td>{money(item.amount)}</td>
                              </tr>
                            ))
                          ) : (
                            <tr>
                              <td colSpan={3} className="fo-muted">
                                Chưa có đơn hoàn thành để lập báo cáo món bán chạy.
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </main>
        ) : (
          <main>
            <section className="fo-shell fo-hero">
              <div>
                <span className="fo-eyebrow">MỖI NGÀY MỘT MÓN NGON</span>
                <h1>
                  Đói rồi?
                  <br />
                  <span>Chọn món yêu thích.</span>
                </h1>
                <p>
                  Cơm nóng, bún đậm đà hay một ly trà mát lạnh.
                  <br />
                  Thực đơn tươi mới, đặt món thật dễ dàng.
                </p>
                <a className="fo-primary" href="#thuc-don">
                  Khám phá thực đơn <ArrowRight size={18} />
                </a>
                <div className="fo-hero-note">
                  <Check size={16} /> Giá rõ ràng <span>·</span> Nấu sau khi xác
                  nhận
                </div>
              </div>
              <div className="fo-hero-image">
                <img src="/images/com-tam.png" alt="Cơm tấm sườn bì chả" />
                <div>
                  <ChefHat size={25} />
                  <span>
                    Món ngon mỗi ngày<strong>Được chuẩn bị cho bạn</strong>
                  </span>
                </div>
              </div>
            </section>
            {user && suggestions && (
              <section className="fo-shell fo-recommendations">
                <div className="fo-section-heading">
                  <div>
                    <span className="fo-eyebrow">
                      <Sparkles size={15} /> DÀNH RIÊNG CHO BẠN
                    </span>
                    <h2>Hôm nay ăn gì?</h2>
                    <p>
                      {suggestions.mode === "cold_start"
                        ? "Khám phá các món đang còn bán. Gợi ý sẽ thích nghi khi bạn xem, đặt món và đánh giá."
                        : "Được sắp xếp theo những món bạn đã xem, thêm giỏ, mua và đánh giá."}
                    </p>
                  </div>
                  <button
                    className="fo-secondary"
                    onClick={() =>
                      void run(async () =>
                        setSuggestions(
                          await request<Suggestions>(
                            "/api/recommendations",
                            token,
                          ),
                        ),
                      )
                    }
                  >
                    Làm mới gợi ý
                  </button>
                </div>
                {suggestions.items.length ? (
                  <div className="fo-grid fo-rec-grid">
                    {suggestions.items.map((d) => (
                      <DishCard key={d.id} dish={d} open={openDish} add={add} />
                    ))}
                  </div>
                ) : (
                  <div className="fo-empty">
                    Hiện chưa có món đang bán để gợi ý.
                  </div>
                )}
              </section>
            )}
            <section id="thuc-don" className="fo-shell fo-menu">
              <div className="fo-section-heading">
                <div>
                  <span className="fo-eyebrow">THỰC ĐƠN FOODAI</span>
                  <h2>Bữa ngon bắt đầu từ đây</h2>
                </div>
                <label className="fo-search">
                  <Search size={20} />
                  <input
                    aria-label="Tìm món theo tên"
                    placeholder="Tìm món theo tên…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  {search && (
                    <button
                      aria-label="Xóa tìm kiếm"
                      onClick={() => setSearch("")}
                    >
                      ×
                    </button>
                  )}
                </label>
              </div>
              <div className="fo-categories">
                <button
                  className={!category ? "active" : ""}
                  onClick={() => setCategory("")}
                >
                  Tất cả món
                </button>
                {categories.map((c) => (
                  <button
                    key={c.id}
                    className={category === c.id ? "active" : ""}
                    onClick={() => setCategory(c.id)}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
              <div className="fo-menu-filters">
                <label>
                  Nguyên liệu chính
                  <select
                    aria-label="Lọc nguyên liệu chính"
                    value={ingredient}
                    onChange={(e) => setIngredient(e.target.value)}
                  >
                    <option value="">Tất cả nguyên liệu</option>
                    {ingredients.map((i) => (
                      <option key={i} value={i}>
                        {i}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Ngân sách
                  <select
                    aria-label="Lọc ngân sách"
                    value={priceLimit}
                    onChange={(e) => setPriceLimit(e.target.value)}
                  >
                    <option value="">Mọi mức giá</option>
                    <option value="30000">Tối đa 30.000đ</option>
                    <option value="50000">Tối đa 50.000đ</option>
                    <option value="100000">Tối đa 100.000đ</option>
                  </select>
                </label>
                <label>
                  Sắp xếp
                  <select
                    aria-label="Sắp xếp món ăn"
                    value={sort}
                    onChange={(e) => setSort(e.target.value)}
                  >
                    <option value="name">Theo tên</option>
                    <option value="price_asc">Giá tăng dần</option>
                    <option value="price_desc">Giá giảm dần</option>
                    <option value="demo_rating">Điểm mẫu cao</option>
                  </select>
                </label>
                <label className="fo-filter-check">
                  <input
                    type="checkbox"
                    checked={onlyAvailable}
                    onChange={(e) => setOnlyAvailable(e.target.checked)}
                  />{" "}
                  Chỉ món còn bán
                </label>
                <span>
                  {loading ? "Đang tải…" : `${dishes.length} món phù hợp`}
                </span>
              </div>
              {loading ? (
                <div className="fo-empty">Đang tải thực đơn…</div>
              ) : catalogError ? (
                <div className="fo-empty">
                  <h3>Không tải được thực đơn</h3>
                  <p>{catalogError}</p>
                  <button
                    className="fo-secondary"
                    onClick={() => void run(loadDishes)}
                  >
                    Thử lại
                  </button>
                </div>
              ) : dishes.length ? (
                <div className="fo-grid">
                  {dishes.map((d) => (
                    <DishCard key={d.id} dish={d} open={openDish} add={add} />
                  ))}
                </div>
              ) : (
                <div className="fo-empty">
                  <Search size={32} />
                  <h3>
                    {search || category
                      ? "Không tìm thấy món phù hợp"
                      : "Thực đơn đang được cập nhật"}
                  </h3>
                  <p>
                    {search
                      ? `Không có tên món chứa “${search}”. Hãy thử từ khóa khác.`
                      : "Vui lòng quay lại sau."}
                  </p>
                </div>
              )}
            </section>
          </main>
        )}
        {!admin && (
          <ChatWidget
            key={user?.id || "guest"}
            token={token}
            openDish={openDish}
            add={add}
          />
        )}
        <footer className="fo-shell fo-footer">
          <strong>FoodAI Order</strong>
          <span>Chọn món · Đặt hàng · Thưởng thức</span>
          <a href="/">Về thực đơn</a>
          <a href="/photo-credits.html">Nguồn ảnh món ăn</a>
        </footer>

        {panel === "auth" && (
          <Modal
            title={
              admin
                ? "Đăng nhập quản trị"
                : authMode === "login"
                  ? "Đăng nhập"
                  : "Tạo tài khoản khách hàng"
            }
            close={() => setPanel(null)}
          >
            <div className="fo-tabs">
              <button
                className={authMode === "login" ? "active" : ""}
                onClick={() => setAuthMode("login")}
              >
                Đăng nhập
              </button>
              {!admin && (
                <button
                  className={authMode === "register" ? "active" : ""}
                  onClick={() => setAuthMode("register")}
                >
                  Đăng ký
                </button>
              )}
            </div>
            <p className="fo-muted">
              {admin
                ? "Chỉ tài khoản admin được quản lý món và đơn hàng."
                : "Đăng nhập để đặt món, đánh giá và xem đơn riêng. Admin cũng có thể mua hàng và mở trang quản trị."}
            </p>
            <form key={authMode} onSubmit={auth} className="fo-form">
              {authMode === "register" && (
                <>
                  <Field
                    label="Họ tên"
                    name="full_name"
                    required
                    maxLength={100}
                    autoComplete="name"
                  />
                  <Field
                    label="Số điện thoại"
                    name="phone_number"
                    type="tel"
                    required
                    pattern="0[0-9]{9,10}"
                    autoComplete="tel"
                  />
                </>
              )}
              <Field
                label="Email"
                name="email"
                type="email"
                required
                autoComplete="email"
              />
              <Field
                label="Mật khẩu"
                name="password"
                type="password"
                required
                minLength={8}
                maxLength={128}
                autoComplete={
                  authMode === "login" ? "current-password" : "new-password"
                }
              />
              {authMode === "register" && (
                <Field
                  label="Xác nhận mật khẩu"
                  name="confirm_password"
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                />
              )}
              <button disabled={busy} className="fo-primary">
                {busy
                  ? "Đang xử lý…"
                  : authMode === "login"
                    ? "Đăng nhập"
                    : "Đăng ký tài khoản"}
              </button>
            </form>
          </Modal>
        )}
        {selected && (
          <Modal title="Chi tiết món ăn" close={() => setSelected(null)}>
            <div className="fo-detail">
              <img
                className="fo-detail-image"
                src={selected.image_url}
                alt={selected.name}
              />
              <span
                className={`fo-status ${selected.is_available ? "completed" : "cancelled"}`}
              >
                {selected.is_available ? "Còn bán" : "Hết món"}
              </span>
              <h2>{selected.name}</h2>
              <DishRating dish={selected} />
              <p>{selected.description}</p>
              <strong className="fo-price">{money(selected.base_price)}</strong>
              <p className="fo-muted">
                {selected.calories === null
                  ? "Chưa có thông tin calo"
                  : `${selected.calories} kcal`}{" "}
                ·{" "}
                {selected.spiciness_level === null
                  ? "Chưa xác nhận độ cay"
                  : `Mức cay ${selected.spiciness_level}/3`}{" "}
                {selected.is_vegetarian && "· Món chay"}
              </p>
              {selected.main_ingredient && (
                <p>
                  <strong>Nguyên liệu chính:</strong> {selected.main_ingredient}
                </p>
              )}
              {selected.source_dish_id && (
                <p className="fo-muted">
                  Thông tin tên món, danh mục, nguyên liệu chính và giá từ bộ dữ
                  liệu bạn cung cấp.{" "}
                  {selected.is_vegetarian === null &&
                    "Chưa có xác nhận món chay."}
                </p>
              )}
              {selected.customizable === false && (
                <p>
                  Phần tiêu chuẩn. Hiện chưa cấu hình size và topping cho món
                  này.
                </p>
              )}
              {selected.customizable !== false && (
                <>
                  <fieldset>
                    <legend>Kích cỡ</legend>
                    <div className="fo-options">
                      {SIZES.map((s) => (
                        <label key={s.id}>
                          <input
                            type="radio"
                            name="size"
                            value={s.id}
                            checked={size === s.id}
                            onChange={() => setSize(s.id)}
                          />
                          {s.label} {s.extra > 0 ? `+${money(s.extra)}` : ""}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset>
                    <legend>Thêm topping</legend>
                    <div className="fo-options">
                      {selectedToppings.map((t) => (
                        <label key={t.id}>
                          <input
                            type="checkbox"
                            checked={toppings.includes(t.id)}
                            onChange={(e) =>
                              setToppings((old) =>
                                e.target.checked
                                  ? [...old, t.id]
                                  : old.filter((id) => id !== t.id),
                              )
                            }
                          />
                          {t.name} +{money(t.price)}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                </>
              )}
              <label className="fo-field">
                <span>Ghi chú cho món</span>
                <input
                  value={itemNote}
                  maxLength={500}
                  onChange={(e) => setItemNote(e.target.value)}
                  placeholder="Ví dụ: ít cay"
                />
              </label>
              <div className="fo-between">
                <label className="fo-field">
                  <span>Số lượng</span>
                  <input
                    type="number"
                    min={1}
                    max={99}
                    step={1}
                    value={quantity}
                    onChange={(e) => setQuantity(Number(e.target.value))}
                  />
                </label>
                <button
                  className="fo-primary"
                  disabled={
                    busy ||
                    !selected.is_available ||
                    !Number.isInteger(quantity) ||
                    quantity < 1 ||
                    quantity > 99
                  }
                  onClick={() => add(selected, true)}
                >
                  Thêm giỏ · {money(detailPrice * quantity)}
                </button>
              </div>
              {(selected.reference_count || 0) > 0 && (
                <section className="fo-dataset-reference">
                  <h3>Đánh giá tham khảo từ bộ dữ liệu</h3>
                  <p>
                    {selected.reference_rating}/5 từ {selected.reference_count}{" "}
                    đánh giá trong tập học. Đây là dữ liệu tham khảo, được tách
                    riêng với đánh giá sau mua hàng trên web.
                  </p>
                </section>
              )}
              <section className="fo-reviews">
                <h3>Đánh giá từ khách đã mua</h3>
                {selected.demo_rating_source === "sample" && (
                  <p className="fo-muted">
                    Điểm và số lượt phía trên là dữ liệu mẫu để trình bày. Đánh
                    giá thật sau mua hàng được tính riêng bên dưới.
                  </p>
                )}
                {reviews?.count ? (
                  <>
                    <p>
                      <Star size={16} /> {reviews.average_rating}/5 từ{" "}
                      {reviews.count} đánh giá
                    </p>
                    {reviews.items.map((r) => (
                      <article key={r.id}>
                        <div className="fo-between">
                          <strong>{r.author}</strong>
                          <span>
                            {"★".repeat(r.stars)}
                            {"☆".repeat(5 - r.stars)}
                          </span>
                        </div>
                        <p>{r.comment || "Khách hàng chưa viết nhận xét."}</p>
                        <small>{date(r.updated_at)}</small>
                      </article>
                    ))}
                  </>
                ) : (
                  <p>
                    Chưa có đánh giá cho món này. Bạn có thể đánh giá trong đơn
                    hàng sau khi đơn hoàn thành.
                  </p>
                )}
              </section>
            </div>
          </Modal>
        )}
        {panel === "cart" && user && (
          <Modal title="Giỏ hàng của bạn" close={() => setPanel(null)}>
            {cart.items.length === 0 ? (
              <div className="fo-empty">
                <ShoppingBag size={38} />
                <h3>Giỏ hàng đang trống</h3>
                <button className="fo-primary" onClick={() => setPanel(null)}>
                  Chọn món ngay
                </button>
              </div>
            ) : (
              <>
                <div className="fo-cart-items">
                  {cart.items.map((i) => (
                    <article key={i.id}>
                      <img src={i.dish.image_url} alt={i.dish.name} />
                      <div>
                        <h3>{i.dish.name}</h3>
                        <p>
                          Size {i.options.size}
                          {i.options.topping_names.length > 0 &&
                            ` · ${i.options.topping_names.join(", ")}`}
                        </p>
                        {i.options.note && <p>Ghi chú: {i.options.note}</p>}
                        <span>{money(i.unit_price)} / món</span>
                        {!i.dish.is_available && (
                          <p className="fo-danger">
                            Món đã hết bán. Vui lòng xóa khỏi giỏ.
                          </p>
                        )}
                        <div className="fo-actions">
                          <button
                            aria-label={`Giảm ${i.dish.name}`}
                            disabled={busy || i.quantity <= 1}
                            onClick={() => changeQuantity(i.id, i.quantity - 1)}
                          >
                            −
                          </button>
                          <input
                            aria-label={`Số lượng ${i.dish.name}`}
                            type="number"
                            min={1}
                            max={99}
                            step={1}
                            value={i.quantity}
                            onChange={(e) =>
                              changeQuantity(i.id, Number(e.target.value))
                            }
                          />
                          <button
                            aria-label={`Tăng ${i.dish.name}`}
                            disabled={busy || i.quantity >= 99}
                            onClick={() => changeQuantity(i.id, i.quantity + 1)}
                          >
                            +
                          </button>
                          <button
                            className="fo-danger"
                            disabled={busy}
                            onClick={() => removeItem(i.id)}
                          >
                            Xóa
                          </button>
                        </div>
                      </div>
                      <strong>{money(i.subtotal)}</strong>
                    </article>
                  ))}
                </div>
                <form
                  className="fo-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void run(async () => {
                      const p = await request<Cart>(
                        "/api/orders/preview",
                        token,
                        "POST",
                        recipient,
                      );
                      setPreview(p);
                      checkoutKey.current = crypto.randomUUID();
                    });
                  }}
                >
                  <h3>Thông tin nhận hàng</h3>
                  {(
                    [
                      ["recipient_name", "Họ tên người nhận"],
                      ["phone_number", "Số điện thoại"],
                      ["delivery_address", "Địa chỉ giao hàng"],
                      ["note", "Ghi chú đơn hàng"],
                    ] as const
                  ).map(([key, label]) => (
                    <label className="fo-field" key={key}>
                      <span>{label}</span>
                      <input
                        required={key !== "note"}
                        type={key === "phone_number" ? "tel" : "text"}
                        pattern={
                          key === "phone_number" ? "0[0-9]{9,10}" : undefined
                        }
                        minLength={key === "delivery_address" ? 5 : undefined}
                        maxLength={
                          key === "delivery_address"
                            ? 1000
                            : key === "note"
                              ? 500
                              : 100
                        }
                        value={recipient[key]}
                        onChange={(e) => {
                          setRecipient({ ...recipient, [key]: e.target.value });
                          setPreview(null);
                        }}
                      />
                    </label>
                  ))}
                  <div className="fo-totals">
                    <span>Tiền món</span>
                    <strong>{money(cart.total_amount)}</strong>
                    <span>Phí giao hàng</span>
                    <strong>Miễn phí</strong>
                    <span>Thanh toán</span>
                    <strong>Tiền mặt khi nhận hàng (COD)</strong>
                    <b>Tổng cộng</b>
                    <b>{money(cart.final_amount)}</b>
                  </div>
                  <button
                    className="fo-secondary"
                    disabled={busy || !cart.can_checkout}
                  >
                    Kiểm tra thông tin đặt hàng
                  </button>
                </form>
                {preview && (
                  <div className="fo-checkout">
                    <h3>Xác nhận đơn hàng</h3>
                    <p>
                      {recipient.recipient_name} · {recipient.phone_number}
                      <br />
                      {recipient.delivery_address}
                    </p>
                    <ul>
                      {preview.items.map((i) => (
                        <li key={i.id}>
                          {i.quantity} × {i.dish.name} ({money(i.unit_price)}) —{" "}
                          {money(i.subtotal)}
                        </li>
                      ))}
                    </ul>
                    <strong>
                      Tổng thanh toán: {money(preview.final_amount)}
                    </strong>
                    <p className="fo-muted">
                      Giá và tình trạng món sẽ được kiểm tra lại khi tạo đơn.
                    </p>
                    <button
                      className="fo-primary"
                      disabled={busy}
                      onClick={placeOrder}
                    >
                      {busy ? "Đang tạo đơn…" : "Xác nhận đặt hàng"}
                    </button>
                  </div>
                )}
              </>
            )}
          </Modal>
        )}
        {panel === "history" && user && (
          <Modal title="Đơn hàng của tôi" close={() => setPanel(null)}>
            {orders.length === 0 ? (
              <div className="fo-empty">Bạn chưa có đơn hàng.</div>
            ) : (
              <div className="fo-order-list">
                {orders.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => {
                      setPanel(null);
                      setOrderDetail(o);
                    }}
                  >
                    <div className="fo-between">
                      <strong>{o.order_code}</strong>
                      <span className={`fo-status ${o.status}`}>
                        {statuses[o.status]}
                      </span>
                    </div>
                    <p>
                      {date(o.created_at)} ·{" "}
                      {o.items.reduce((s, i) => s + i.quantity, 0)} món
                    </p>
                    <div className="fo-between">
                      <span>{o.items.map((i) => i.name).join(", ")}</span>
                      <strong>{money(o.final_amount)}</strong>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </Modal>
        )}
        {orderDetail && (
          <Modal
            title={`Đơn ${orderDetail.order_code}`}
            close={() => setOrderDetail(null)}
          >
            <span className={`fo-status ${orderDetail.status}`}>
              {statuses[orderDetail.status]}
            </span>
            <p className="fo-muted">
              <Clock size={15} /> {date(orderDetail.created_at)}
            </p>
            {orderDetail.rejection_reason && (
              <div className="fo-error">
                Lý do từ chối: {orderDetail.rejection_reason}
              </div>
            )}
            <div className="fo-address">
              <h3>Người nhận</h3>
              <strong>{orderDetail.recipient_name}</strong>
              <p>
                {orderDetail.phone_number}
                <br />
                {orderDetail.delivery_address}
              </p>
              {orderDetail.note && <p>Ghi chú: {orderDetail.note}</p>}
            </div>
            <div className="fo-order-items">
              {orderDetail.items.map((i) => (
                <article key={i.id}>
                  <div className="fo-between">
                    <strong>
                      {i.quantity} × {i.name}
                    </strong>
                    <strong>{money(i.subtotal)}</strong>
                  </div>
                  <p>
                    {money(i.unit_price)} / món · Size {i.options.size || "S"}{" "}
                    {i.options.topping_names?.join(", ")}
                    {i.options.note && ` · ${i.options.note}`}
                  </p>
                  {!admin && orderDetail.status === "completed" && (
                    <form
                      className="fo-rating-form"
                      onSubmit={(e) => rating(e, i.dish_id, orderDetail.id)}
                    >
                      <label>
                        Điểm đánh giá
                        <select
                          aria-label={`Điểm ${i.name}`}
                          name="stars"
                          defaultValue="5"
                        >
                          <option value="5">5 — Rất thích</option>
                          <option value="4">4 — Thích</option>
                          <option value="3">3 — Bình thường</option>
                          <option value="2">2 — Không thích</option>
                          <option value="1">1 — Rất không thích</option>
                        </select>
                      </label>
                      <label>
                        Nhận xét
                        <textarea
                          name="comment"
                          maxLength={1000}
                          placeholder="Chia sẻ cảm nhận của bạn…"
                        />
                      </label>
                      <button className="fo-secondary" disabled={busy}>
                        Lưu đánh giá
                      </button>
                    </form>
                  )}
                </article>
              ))}
            </div>
            <div className="fo-between fo-order-total">
              <strong>Tổng thanh toán (COD)</strong>
              <strong>{money(orderDetail.final_amount)}</strong>
            </div>
            {admin && user?.role === "admin" && (
              <div className="fo-admin-order-actions">
                {orderDetail.status === "pending" && (
                  <>
                    <button
                      className="fo-primary"
                      disabled={busy}
                      onClick={() => updateStatus(orderDetail, "preparing")}
                    >
                      Xác nhận và chế biến
                    </button>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        updateStatus(
                          orderDetail,
                          "cancelled",
                          text(e.currentTarget, "reason"),
                        );
                      }}
                    >
                      <Field
                        label="Lý do từ chối đơn"
                        name="reason"
                        required
                        maxLength={1000}
                      />
                      <button className="fo-danger-button" disabled={busy}>
                        Từ chối đơn
                      </button>
                    </form>
                  </>
                )}
                {orderDetail.status === "preparing" && (
                  <button
                    className="fo-primary"
                    disabled={busy}
                    onClick={() => updateStatus(orderDetail, "completed")}
                  >
                    Đánh dấu hoàn thành
                  </button>
                )}
              </div>
            )}
          </Modal>
        )}
        {panel === "profile" && user && (
          <Modal title="Tài khoản của tôi" close={() => setPanel(null)}>
            <p>
              {user.email} ·{" "}
              {user.role === "admin" ? "Quản trị viên" : "Khách hàng"}
            </p>
            <form
              className="fo-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = e.currentTarget;
                void run(async () => {
                  const u = await request<User>("/api/users/me", token, "PUT", {
                    full_name: text(f, "full_name"),
                    phone_number: text(f, "phone_number"),
                  });
                  setUser(u);
                  setNotice("Đã lưu thông tin tài khoản");
                });
              }}
            >
              <Field
                label="Họ tên"
                name="full_name"
                defaultValue={user.full_name}
                required
                maxLength={100}
              />
              <Field
                label="Số điện thoại"
                name="phone_number"
                type="tel"
                defaultValue={user.phone_number || ""}
                required
                pattern="0[0-9]{9,10}"
              />
              <button className="fo-primary" disabled={busy}>
                Lưu thông tin
              </button>
            </form>
            <form
              className="fo-form fo-password"
              onSubmit={(e) => {
                e.preventDefault();
                const f = e.currentTarget;
                void run(async () => {
                  await request("/api/users/me/change-password", token, "PUT", {
                    current_password: text(f, "current_password"),
                    new_password: text(f, "new_password"),
                    confirm_new_password: text(f, "confirm_new_password"),
                  });
                  clearSession(token);
                  setToken("");
                  setUser(null);
                  setCart(emptyCart);
                  setOrders([]);
                  setSuggestions(null);
                  setPanel("auth");
                  setNotice("Đổi mật khẩu thành công. Vui lòng đăng nhập lại.");
                });
              }}
            >
              <h3>Đổi mật khẩu</h3>
              <Field
                label="Mật khẩu hiện tại"
                name="current_password"
                type="password"
                required
              />
              <Field
                label="Mật khẩu mới"
                name="new_password"
                type="password"
                required
                minLength={8}
                maxLength={128}
              />
              <Field
                label="Xác nhận mật khẩu mới"
                name="confirm_new_password"
                type="password"
                required
                minLength={8}
              />
              <button className="fo-secondary" disabled={busy}>
                Đổi mật khẩu
              </button>
            </form>
          </Modal>
        )}
        {editor && user?.role === "admin" && (
          <Modal
            title={editor === "new" ? "Thêm món ăn" : "Sửa món ăn"}
            close={() => setEditor(null)}
          >
            <form onSubmit={saveDish} className="fo-form">
              <Field
                label="Tên món"
                name="name"
                defaultValue={editor === "new" ? "" : editor.name}
                required
                maxLength={150}
              />
              <label className="fo-field">
                <span>Mô tả</span>
                <textarea
                  name="description"
                  defaultValue={editor === "new" ? "" : editor.description}
                  maxLength={5000}
                />
              </label>
              <Field
                label="Giá bán (đ)"
                name="base_price"
                type="number"
                defaultValue={editor === "new" ? 0 : editor.base_price}
                min={0}
                max={99999999}
                step={0.01}
                required
              />
              <Field
                label="Đường dẫn ảnh"
                name="image_url"
                defaultValue={
                  editor === "new" ? "/images/com-tam.png" : editor.image_url
                }
                required
                maxLength={255}
              />
              <label className="fo-field">
                <span>Danh mục</span>
                <select
                  name="category"
                  defaultValue={editor === "new" ? "com" : editor.categories[0]}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fo-field">
                <span>Trạng thái</span>
                <select
                  name="is_available"
                  defaultValue={
                    editor === "new" || editor.is_available ? "true" : "false"
                  }
                >
                  <option value="true">Còn bán</option>
                  <option value="false">Hết món</option>
                </select>
              </label>
              <div className="fo-two-columns">
                <Field
                  label="Năng lượng (kcal)"
                  name="calories"
                  type="number"
                  min={0}
                  max={10000}
                  defaultValue={editor === "new" ? "" : (editor.calories ?? "")}
                />
                <Field
                  label="Mức cay (0–3)"
                  name="spiciness_level"
                  type="number"
                  min={0}
                  max={3}
                  defaultValue={
                    editor === "new" ? "" : (editor.spiciness_level ?? "")
                  }
                />
              </div>
              <Field
                label="Nguyên liệu chính"
                name="main_ingredient"
                maxLength={100}
                defaultValue={
                  editor === "new" ? "" : editor.main_ingredient || ""
                }
              />
              <label className="fo-field">
                <span>Xác nhận món chay</span>
                <select
                  name="is_vegetarian"
                  defaultValue={
                    editor === "new" || editor.is_vegetarian === null
                      ? ""
                      : String(editor.is_vegetarian)
                  }
                >
                  <option value="">Chưa xác nhận</option>
                  <option value="true">Món chay</option>
                  <option value="false">Không phải món chay</option>
                </select>
              </label>
              <label>
                <input
                  name="customizable"
                  type="checkbox"
                  defaultChecked={
                    editor === "new" || editor.customizable !== false
                  }
                />{" "}
                Cho phép các size và topping của danh mục
              </label>
              <button className="fo-primary" disabled={busy}>
                Lưu món ăn
              </button>
            </form>
          </Modal>
        )}
      </div>
    </Feedback.Provider>
  );
}
