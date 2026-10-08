"use client"

import { SearchX, X } from "lucide-react"
import { CATEGORIES, FOODS, type CategoryId } from "@/lib/menu-data"
import { useApp } from "./app-state"
import { FoodCard } from "./food-card"

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
}

export function PopularDishes({
  category,
  onClearCategory,
}: {
  category: CategoryId | null
  onClearCategory: () => void
}) {
  const { search, setSearch } = useApp()
  const query = normalize(search.trim())

  const foods = FOODS.filter((f) => !category || f.categories.includes(category))
    .filter((f) => !query || normalize(`${f.name} ${f.description}`).includes(query))
    .sort((a, b) => Number(!!b.bestseller) - Number(!!a.bestseller))

  const categoryName = CATEGORIES.find((c) => c.id === category)?.name

  return (
    <section id="popular" aria-labelledby="popular-title" className="flex scroll-mt-40 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="popular-title" className="text-xl font-bold md:text-2xl">
          {categoryName ? categoryName : "Món phổ biến"}
        </h2>
        <div className="flex flex-wrap gap-2">
          {category && (
            <FilterChip label={categoryName ?? ""} onClear={onClearCategory} />
          )}
          {search && <FilterChip label={`"${search}"`} onClear={() => setSearch("")} />}
        </div>
      </div>

      {foods.length > 0 ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-5 lg:grid-cols-4">
          {foods.map((food) => (
            <FoodCard key={food.id} food={food} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-card py-12 text-center">
          <SearchX className="size-8 text-muted-foreground" aria-hidden="true" />
          <p className="font-semibold">Không tìm thấy món phù hợp</p>
          <p className="text-sm text-muted-foreground">Thử từ khoá khác hoặc hỏi trợ lý AI nhé.</p>
        </div>
      )}
    </section>
  )
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      onClick={onClear}
      className="inline-flex items-center gap-1 rounded-full bg-accent px-3 py-1 text-sm font-medium text-primary hover:bg-primary hover:text-primary-foreground"
    >
      {label}
      <X className="size-3.5" aria-hidden="true" />
      <span className="sr-only">Bỏ lọc</span>
    </button>
  )
}
