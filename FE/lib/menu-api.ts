import type { CategoryId, Food, ToppingGroup } from "./menu-data"

export type MenuCategory = { id: CategoryId; name: string; image: string }
export type ApiCategory = { id: number; name: string; image_url: string | null }
export type ApiDish = {
  id: string
  category_id: number
  category_name: string
  name: string
  description: string
  base_price: number
  calories: number
  spiciness_level: number
  is_vegetarian: boolean
  image_url: string | null
  is_available: boolean
}

const toppingGroups: Record<string, ToppingGroup> = {
  "Cơm": "rice", "Bún & Phở": "noodle", "Bánh mì": "bread",
  "Trà sữa": "drink", "Trà trái cây": "drink", "Món chay": "veg",
}

export function toFood(dish: ApiDish): Food {
  return {
    id: dish.id,
    name: dish.name,
    description: dish.description,
    image: dish.image_url || "/images/hero.png",
    price: Number(dish.base_price),
    calories: dish.calories,
    spiciness: Math.max(0, Math.min(3, dish.spiciness_level)) as Food["spiciness"],
    categories: [String(dish.category_id)],
    vegetarian: dish.is_vegetarian,
    rating: 0,
    sold: "",
    toppingGroup: toppingGroups[dish.category_name] || (dish.is_vegetarian ? "veg" : "rice"),
  }
}

export class MenuApiError extends Error {}

export async function fetchDish(id: string, signal: AbortSignal): Promise<Food> {
  const response = await fetch(`/api/dishes/${encodeURIComponent(id)}`, { signal, cache: "no-store" })
  if (response.status === 404) throw new MenuApiError("Món ăn không tồn tại hoặc đã hết bán. Vui lòng chọn món khác.")
  if (!response.ok) throw new MenuApiError("Không thể kiểm tra món ăn. Vui lòng thử lại.")
  let dish: ApiDish
  try { dish = await response.json() } catch {
    throw new MenuApiError("Thông tin món ăn chưa hợp lệ. Vui lòng thử lại.")
  }
  if (!dish || typeof dish.id !== "string" || dish.id.toLowerCase() !== id.toLowerCase()
      || dish.is_available !== true) {
    throw new MenuApiError("Món ăn không tồn tại hoặc đã hết bán. Vui lòng chọn món khác.")
  }
  if (typeof dish.name !== "string" || !dish.name.trim() || typeof dish.description !== "string"
      || typeof dish.category_name !== "string" || typeof dish.base_price !== "number"
      || !Number.isFinite(dish.base_price) || dish.base_price < 0) {
    throw new MenuApiError("Thông tin món ăn chưa hợp lệ. Vui lòng thử lại.")
  }
  return toFood(dish)
}
