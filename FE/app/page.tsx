import { FoodApp } from "@/components/food/food-app"
import { toFood, type ApiCategory, type ApiDish, type MenuCategory } from "@/lib/menu-api"
import type { Food } from "@/lib/menu-data"

export default async function Page() {
  let foods: Food[] = []
  let categories: MenuCategory[] = []
  let menuError: string | null = null
  try {
    const backend = (process.env.FOODORDER_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "")
    const responses = await Promise.all([
      fetch(`${backend}/api/dishes`, { cache: "no-store", signal: AbortSignal.timeout(5000) }),
      fetch(`${backend}/api/categories`, { cache: "no-store", signal: AbortSignal.timeout(5000) }),
    ])
    if (responses.some((response) => !response.ok)) throw new Error("Menu unavailable")
    const dishes: ApiDish[] = await responses[0].json()
    const rows: ApiCategory[] = await responses[1].json()
    foods = dishes.filter((dish) => dish.is_available).map(toFood)
    categories = rows.map((category) => ({
      id: String(category.id), name: category.name, image: category.image_url || "/images/hero.png",
    }))
  } catch {
    menuError = "Không thể tải thực đơn. Vui lòng thử lại sau."
  }
  return <FoodApp foods={foods} categories={categories} menuError={menuError} />
}
