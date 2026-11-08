"use client"

import Image from "next/image"
import { History, RotateCcw } from "lucide-react"
import { ORDER_HISTORY, formatVND, getFood } from "@/lib/menu-data"
import { useApp } from "./app-state"

export function ReorderRow() {
  const { addToCart, openFood, foods, isAdding } = useApp()

  if (!foods.length) return null

  return (
    <section aria-labelledby="reorder-title" className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <History className="size-5 text-primary" aria-hidden="true" />
        <h2 id="reorder-title" className="text-xl font-bold md:text-2xl">
          Đặt lại món quen thuộc
        </h2>
      </div>
      <ul className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 md:mx-0 md:grid md:grid-cols-4 md:overflow-visible md:px-0">
        {ORDER_HISTORY.map((entry) => {
          const sample = getFood(entry.foodId)
          const food = foods.find((dish) => dish.name === sample?.name)
          if (!food) return null
          return (
            <li key={entry.foodId} className="w-72 shrink-0 snap-start md:w-auto">
              <div className="flex items-center gap-3 rounded-2xl border bg-card p-3 transition-shadow hover:shadow-md">
                <button
                  type="button"
                  onClick={() => openFood(food)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <Image
                    src={food.image}
                    alt=""
                    width={64}
                    height={64}
                    className="size-16 shrink-0 rounded-xl object-cover"
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold">{food.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {entry.times} lần · {entry.lastOrdered}
                    </span>
                    <span className="mt-0.5 text-sm font-bold text-primary">{formatVND(food.price)}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => { void addToCart(food) }}
                  disabled={isAdding(food.id)}
                  aria-busy={isAdding(food.id)}
                  aria-label={`Đặt lại ${food.name}`}
                  className="flex size-9 shrink-0 items-center justify-center rounded-full bg-accent text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
