"use client"

import Image from "next/image"
import { CATEGORIES, type CategoryId } from "@/lib/menu-data"
import { cn } from "@/lib/utils"

export function CategoryGrid({
  active,
  onChange,
}: {
  active: CategoryId | null
  onChange: (id: CategoryId | null) => void
}) {
  return (
    <section aria-labelledby="category-title" className="flex flex-col gap-4">
      <h2 id="category-title" className="text-xl font-bold md:text-2xl">
        Danh mục món
      </h2>
      <ul className="grid grid-cols-3 gap-3 sm:grid-cols-6">
        {CATEGORIES.map((cat) => {
          const isActive = active === cat.id
          return (
            <li key={cat.id}>
              <button
                type="button"
                aria-pressed={isActive}
                onClick={() => {
                  onChange(isActive ? null : cat.id)
                  document.getElementById("popular")?.scrollIntoView({ behavior: "smooth", block: "start" })
                }}
                className={cn(
                  "group flex w-full flex-col items-center gap-2 rounded-2xl border bg-card p-3 transition-all hover:-translate-y-0.5 hover:shadow-md",
                  isActive && "border-primary bg-accent ring-2 ring-primary/20",
                )}
              >
                <span className="relative size-16 overflow-hidden rounded-full bg-muted md:size-20">
                  <Image
                    src={cat.image}
                    alt=""
                    fill
                    sizes="80px"
                    className="object-cover transition-transform group-hover:scale-110"
                  />
                </span>
                <span className={cn("text-sm font-semibold", isActive && "text-primary")}>{cat.name}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
