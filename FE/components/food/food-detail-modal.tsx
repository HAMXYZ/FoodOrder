"use client"

import Image from "next/image"
import { useState } from "react"
import { Check, Flame, Minus, Plus, Star, X } from "lucide-react"
import { SIZES, TOPPINGS, formatVND, type Food, type SizeOption, type Topping } from "@/lib/menu-data"
import { cn } from "@/lib/utils"
import { computeUnitPrice, useApp } from "./app-state"
import { FoodBadges } from "./food-card"
import { useOverlay } from "./use-overlay"

export function FoodDetailModal() {
  const { selectedFood, closeFood } = useApp()
  useOverlay(!!selectedFood, closeFood)
  if (!selectedFood) return null
  return <FoodDetailContent key={selectedFood.id} food={selectedFood} onClose={closeFood} />
}

function FoodDetailContent({ food, onClose }: { food: Food; onClose: () => void }) {
  const { addToCart } = useApp()
  const [size, setSize] = useState<SizeOption>(SIZES[0])
  const [toppings, setToppings] = useState<Topping[]>([])
  const [note, setNote] = useState("")
  const [quantity, setQuantity] = useState(1)

  const options = TOPPINGS[food.toppingGroup]
  const total = computeUnitPrice(food, size, toppings) * quantity

  const toggleTopping = (topping: Topping) =>
    setToppings((prev) =>
      prev.some((t) => t.id === topping.id) ? prev.filter((t) => t.id !== topping.id) : [...prev, topping],
    )

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <div className="absolute inset-0 animate-in fade-in bg-black/50" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="food-modal-title"
        className="relative flex max-h-[92dvh] w-full max-w-lg animate-in slide-in-from-bottom-8 flex-col overflow-hidden rounded-t-3xl bg-card shadow-2xl duration-300 sm:rounded-3xl"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng"
          className="absolute right-3 top-3 z-10 flex size-9 items-center justify-center rounded-full bg-card/90 shadow backdrop-blur hover:bg-card"
          autoFocus
        >
          <X className="size-5" aria-hidden="true" />
        </button>

        <div className="overflow-y-auto">
          <div className="relative aspect-[4/3] bg-muted sm:aspect-[16/11]">
            <Image src={food.image} alt="" fill sizes="(min-width: 640px) 512px, 100vw" className="object-cover" priority />
            <div
              className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent"
              aria-hidden="true"
            />
            <div className="absolute left-4 top-4 flex gap-1">
              <FoodBadges food={food} />
            </div>
            <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 p-5 text-white">
              <h2 id="food-modal-title" className="text-2xl font-extrabold leading-tight text-balance sm:text-3xl">
                {food.name}
              </h2>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-extrabold text-[#FFB27A]">{formatVND(food.price)}</span>
                {food.originalPrice && (
                  <span className="text-sm text-white/60 line-through">{formatVND(food.originalPrice)}</span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                <span className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 backdrop-blur">
                  <Flame className="size-3.5 text-[#FFB27A]" aria-hidden="true" /> {food.calories} kcal
                </span>
                <SpicinessMeter level={food.spiciness} />
                <span className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 backdrop-blur">
                  <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden="true" /> {food.rating} ·{" "}
                  {food.sold} đã bán
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-6 p-5">
            <p className="text-sm leading-relaxed text-muted-foreground">{food.description}</p>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-3 flex w-full items-center justify-between font-bold">
                Chọn size
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  Bắt buộc
                </span>
              </legend>
              <div className="grid grid-cols-3 gap-2">
                {SIZES.map((s) => {
                  const active = s.id === size.id
                  return (
                    <label
                      key={s.id}
                      className={cn(
                        "flex cursor-pointer flex-col items-center gap-0.5 rounded-2xl border-2 p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40",
                        active ? "border-primary bg-accent" : "hover:border-primary/40",
                      )}
                    >
                      <input
                        type="radio"
                        name="size"
                        value={s.id}
                        checked={active}
                        onChange={() => setSize(s)}
                        className="sr-only"
                      />
                      <span className={cn("text-lg font-extrabold", active && "text-primary")}>{s.id}</span>
                      <span className="text-xs text-muted-foreground">{s.label}</span>
                      <span className="text-xs font-semibold">{s.extra ? `+${formatVND(s.extra)}` : "Mặc định"}</span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <fieldset className="flex flex-col">
              <legend className="mb-3 flex w-full items-center justify-between font-bold">
                Thêm topping
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                  Tuỳ chọn
                </span>
              </legend>
              <div className="flex flex-col divide-y rounded-2xl border">
                {options.map((t) => {
                  const checked = toppings.some((x) => x.id === t.id)
                  return (
                    <label
                      key={t.id}
                      className="flex cursor-pointer items-center gap-3 px-4 py-3 hover:bg-muted/50 has-[:focus-visible]:bg-muted"
                    >
                      <input type="checkbox" checked={checked} onChange={() => toggleTopping(t)} className="sr-only" />
                      <span
                        className={cn(
                          "flex size-5 items-center justify-center rounded-md border-2 transition-colors",
                          checked ? "border-primary bg-primary text-primary-foreground" : "border-border",
                        )}
                        aria-hidden="true"
                      >
                        {checked && <Check className="size-3.5" strokeWidth={3} />}
                      </span>
                      <span className="flex-1 text-sm font-medium">{t.name}</span>
                      <span className="text-sm text-muted-foreground">+{formatVND(t.price)}</span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <div className="flex flex-col gap-2">
              <label htmlFor="kitchen-note" className="font-bold">
                Ghi chú cho bếp
              </label>
              <textarea
                id="kitchen-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={200}
                rows={3}
                placeholder="VD: Ít cay, không hành, nhiều nước dùng..."
                className="resize-none rounded-2xl border bg-muted/40 p-3 text-sm outline-none focus:border-primary focus:bg-card focus:ring-4 focus:ring-primary/15"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 border-t bg-card p-4">
          <QuantityStepper value={quantity} onChange={setQuantity} />
          <button
            type="button"
            onClick={() => {
              addToCart(food, { size, toppings, note, quantity })
              onClose()
            }}
            className="flex h-12 flex-1 items-center justify-center rounded-full bg-primary px-4 text-sm font-bold text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-[1.02] active:scale-[0.98] sm:text-base"
          >
            <span>
              Thêm vào giỏ hàng <span aria-hidden="true">•</span>{" "}
              <span className="tabular-nums">{formatVND(total)}</span>
            </span>
          </button>
        </div>
      </div>
    </div>
  )
}

const SPICE_LABELS = ["Không cay", "Cay nhẹ", "Cay vừa", "Rất cay"] as const

function SpicinessMeter({ level }: { level: Food["spiciness"] }) {
  return (
    <span
      className="flex items-center gap-1.5 rounded-full bg-white/15 px-2.5 py-1 backdrop-blur"
      aria-label={`Độ cay: ${SPICE_LABELS[level]} (${level}/3)`}
    >
      <span className="flex items-center gap-0.5" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <ChiliIcon key={i} className={cn("size-3.5", i <= level ? "text-red-500" : "text-white/35")} />
        ))}
      </span>
      <span aria-hidden="true">{SPICE_LABELS[level]}</span>
    </span>
  )
}

function ChiliIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M17.5 2.5c-.4 0-.8.3-.9.7l-.4 1.5c-1-.2-2.1.1-2.9.8-.5.5-.8 1.1-.9 1.8-1.6 4.4-4.4 8.1-9.2 10.2-.6.3-.8 1-.4 1.5 1.2 1.6 3.3 2.5 5.7 2.5 5.6 0 10.2-5 10.2-11 0-.9-.1-1.7-.4-2.4.6-.9.7-2 .2-3l.9-1.4c.3-.4.1-1-.3-1.2-.4-.2-1-.1-1.2.3l-.9 1.3c-.3-.1-.6-.2-.9-.2l.4-1.4c.1-.5-.2-1-.7-1.1h-.3z" />
    </svg>
  )
}

export function QuantityStepper({
  value,
  onChange,
  min = 1,
  size = "md",
}: {
  value: number
  onChange: (v: number) => void
  min?: number
  size?: "sm" | "md"
}) {
  const btn = size === "sm" ? "size-7" : "size-10"
  return (
    <div className="flex items-center gap-1 rounded-full border p-1">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        disabled={value <= min && min > 0}
        aria-label="Giảm số lượng"
        className={cn(btn, "flex items-center justify-center rounded-full hover:bg-muted disabled:opacity-40")}
      >
        <Minus className="size-4" aria-hidden="true" />
      </button>
      <span className="min-w-6 text-center text-sm font-bold tabular-nums" aria-live="polite">
        {value}
      </span>
      <button
        type="button"
        onClick={() => onChange(Math.min(99, value + 1))}
        aria-label="Tăng số lượng"
        className={cn(btn, "flex items-center justify-center rounded-full text-primary hover:bg-accent")}
      >
        <Plus className="size-4" aria-hidden="true" />
      </button>
    </div>
  )
}
