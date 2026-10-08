"use client"

import Image from "next/image"
import { Flame, Leaf, Plus, Star, TrendingUp } from "lucide-react"
import { formatVND, type Food } from "@/lib/menu-data"
import { useApp } from "./app-state"

export function FoodBadges({ food }: { food: Food }) {
  return (
    <>
      {food.bestseller && (
        <span className="inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground">
          <TrendingUp className="size-3" aria-hidden="true" />
          Bán chạy
        </span>
      )}
      {food.vegetarian && (
        <span className="inline-flex items-center gap-1 rounded-full bg-success px-2 py-0.5 text-[11px] font-bold text-success-foreground">
          <Leaf className="size-3" aria-hidden="true" />
          Chay
        </span>
      )}
    </>
  )
}

export function FoodCard({ food }: { food: Food }) {
  const { openFood, addToCart } = useApp()
  const discount = food.originalPrice ? Math.round((1 - food.price / food.originalPrice) * 100) : 0

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border bg-card transition-all hover:-translate-y-1 hover:shadow-lg">
      <div className="relative aspect-[4/3] overflow-hidden bg-muted">
        <Image
          src={food.image}
          alt={food.name}
          fill
          sizes="(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw"
          className="object-cover transition-transform duration-500 group-hover:scale-105"
        />
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          <FoodBadges food={food} />
        </div>
        {discount > 0 && (
          <span className="absolute right-2 top-2 rounded-lg bg-card px-2 py-0.5 text-xs font-bold text-primary shadow">
            -{discount}%
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col gap-1.5 p-3 md:p-4">
        <h3 className="line-clamp-1 font-semibold">
          <button type="button" onClick={() => openFood(food)} className="text-left after:absolute after:inset-0">
            {food.name}
          </button>
        </h3>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Flame className="size-3.5 text-primary" aria-hidden="true" />
            {food.calories} kcal
          </span>
          <span className="flex items-center gap-1">
            <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
            {food.rating}
            <span className="hidden sm:inline">· {food.sold} đã bán</span>
          </span>
        </div>
        <div className="mt-auto flex items-end justify-between gap-2 pt-2">
          <div className="flex flex-col leading-tight">
            {food.originalPrice && (
              <span className="text-xs text-muted-foreground line-through">{formatVND(food.originalPrice)}</span>
            )}
            <span className="text-lg font-extrabold text-primary">{formatVND(food.price)}</span>
          </div>
          <button
            type="button"
            onClick={() => addToCart(food)}
            aria-label={`Thêm ${food.name} vào giỏ`}
            className="relative z-10 flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md shadow-primary/30 transition-transform hover:scale-110 active:scale-95"
          >
            <Plus className="size-5" aria-hidden="true" />
          </button>
        </div>
      </div>
    </article>
  )
}
