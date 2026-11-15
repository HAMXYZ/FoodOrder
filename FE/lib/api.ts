export const API_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001";
export const money = (n: number) =>
  new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(
    n,
  );
export const statuses: Record<string, string> = {
  pending: "Chờ xác nhận",
  preparing: "Đang chế biến",
  completed: "Hoàn thành",
  cancelled: "Đã hủy",
  confirmed: "Đã xác nhận",
  delivering: "Đang giao",
};
export type User = {
  id: string;
  full_name: string;
  email: string;
  phone_number: string;
  role: string;
};
export type Dish = {
  id: string;
  name: string;
  description: string;
  image_url: string;
  base_price: number;
  is_available: boolean;
  calories: number | null;
  spiciness_level: number | null;
  is_vegetarian: boolean | null;
  main_ingredient?: string | null;
  source_category?: string | null;
  source_dish_id?: number | null;
  source?: string;
  customizable?: boolean;
  image_is_illustration?: boolean;
  reference_rating?: number | null;
  reference_count?: number;
  reference_source?: string | null;
  categories: string[];
  topping_group: string;
  average_rating: number | null;
  review_count: number;
  demo_rating?: number | null;
  demo_review_count?: number;
  demo_rating_source?: "sample" | null;
  score?: number;
};
export type CartItem = {
  id: string;
  dish: Dish;
  quantity: number;
  unit_price: number;
  subtotal: number;
  options: {
    size: string;
    toppings: string[];
    topping_names: string[];
    note: string;
  };
};
export type Cart = {
  items: CartItem[];
  total_amount: number;
  final_amount: number;
  shipping_fee: number;
  discount_amount: number;
  can_checkout: boolean;
};
export const emptyCart: Cart = {
  items: [],
  total_amount: 0,
  final_amount: 0,
  shipping_fee: 0,
  discount_amount: 0,
  can_checkout: false,
};
export type Order = {
  id: string;
  order_code: string;
  customer_name: string;
  recipient_name: string;
  phone_number: string;
  delivery_address: string;
  note: string;
  status: string;
  rejection_reason: string | null;
  total_amount: number;
  final_amount: number;
  shipping_fee: number;
  discount_amount: number;
  created_at: string;
  items: {
    id: string;
    dish_id: string;
    name: string;
    quantity: number;
    unit_price: number;
    subtotal: number;
    options: { size?: string; topping_names?: string[]; note?: string };
  }[];
};
export type Suggestions = {
  mode: string;
  interaction_count: number;
  revision: string;
  items: Dish[];
};
export type AdminOverview = {
  users: number;
  dishes: number;
  available_dishes: number;
  categories: number;
  total_orders: number;
  completed_orders: number;
  revenue: number;
  status_counts: Record<string, number>;
  top_dishes: { name: string; quantity: number; amount: number }[];
};
export type AdminUser = User & {
  status: "active" | "inactive" | "banned";
  order_count: number;
  created_at: string;
};
export type AdminCategory = {
  id: number;
  name: string;
  image_url: string | null;
  dish_count: number;
};
export type Reviews = {
  average_rating: number | null;
  count: number;
  items: {
    id: string;
    author: string;
    stars: number;
    comment: string;
    updated_at: string;
  }[];
};

export async function request<T>(
  path: string,
  token: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(API_URL + path, {
    method,
    cache: "no-store",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const data = await response
    .json()
    .catch(() => ({ detail: "Không đọc được phản hồi từ máy chủ" }));
  if (!response.ok) {
    const detail = data.detail;
    const message = Array.isArray(detail)
      ? detail
          .map(
            (e: { loc?: string[]; msg: string }) =>
              `${e.loc?.slice(1).join(".") || "Dữ liệu"}: ${e.msg.replace("Value error, ", "")}`,
          )
          .join("; ")
      : detail;
    throw new Error(message || `Yêu cầu không thành công (${response.status})`);
  }
  return data as T;
}
