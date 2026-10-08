"use client"

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react"
import { ADDRESSES, SIZES, TOPPINGS, type Food, type SizeOption, type Topping } from "@/lib/menu-data"

export type CartItem = {
  key: string
  food: Food
  size: SizeOption
  toppings: Topping[]
  note: string
  quantity: number
  unitPrice: number
}

type AddOptions = {
  size?: SizeOption
  toppings?: Topping[]
  note?: string
  quantity?: number
}

type AppState = {
  cart: CartItem[]
  cartCount: number
  subtotal: number
  addToCart: (food: Food, options?: AddOptions) => void
  updateQuantity: (key: string, quantity: number) => void
  removeItem: (key: string) => void
  clearCart: () => void
  selectedFood: Food | null
  openFood: (food: Food) => void
  closeFood: () => void
  cartOpen: boolean
  setCartOpen: (open: boolean) => void
  address: string
  setAddress: (address: string) => void
  search: string
  setSearch: (value: string) => void
  toast: string | null
}

const AppContext = createContext<AppState | null>(null)

export function computeUnitPrice(food: Food, size: SizeOption, toppings: Topping[]) {
  return food.price + size.extra + toppings.reduce((sum, t) => sum + t.price, 0)
}

export function AppProvider({
  children,
  selectedFood,
  onSelectedFoodChange,
}: {
  children: React.ReactNode
  selectedFood: Food | null
  onSelectedFoodChange: (food: Food | null) => void
}) {
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [address, setAddress] = useState(ADDRESSES[0])
  const [search, setSearch] = useState("")
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }, [])

  const addToCart = useCallback(
    (food: Food, options: AddOptions = {}) => {
      const size = options.size ?? SIZES[0]
      const toppings = options.toppings ?? []
      const note = options.note?.trim() ?? ""
      const quantity = options.quantity ?? 1
      const key = [food.id, size.id, toppings.map((t) => t.id).sort().join("+"), note].join("|")
      const unitPrice = computeUnitPrice(food, size, toppings)

      setCart((prev) => {
        const existing = prev.find((item) => item.key === key)
        if (existing) {
          return prev.map((item) =>
            item.key === key ? { ...item, quantity: Math.min(item.quantity + quantity, 99) } : item,
          )
        }
        return [...prev, { key, food, size, toppings, note, quantity, unitPrice }]
      })
      showToast(`Đã thêm ${quantity} × ${food.name}`)
    },
    [showToast],
  )

  const updateQuantity = useCallback((key: string, quantity: number) => {
    setCart((prev) =>
      quantity <= 0
        ? prev.filter((item) => item.key !== key)
        : prev.map((item) => (item.key === key ? { ...item, quantity: Math.min(quantity, 99) } : item)),
    )
  }, [])

  const removeItem = useCallback((key: string) => {
    setCart((prev) => prev.filter((item) => item.key !== key))
  }, [])

  const value = useMemo<AppState>(
    () => ({
      cart,
      cartCount: cart.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
      addToCart,
      updateQuantity,
      removeItem,
      clearCart: () => setCart([]),
      selectedFood,
      openFood: (food: Food) => onSelectedFoodChange(food),
      closeFood: () => onSelectedFoodChange(null),
      cartOpen,
      setCartOpen,
      address,
      setAddress,
      search,
      setSearch,
      toast,
    }),
    [
      cart,
      addToCart,
      updateQuantity,
      removeItem,
      selectedFood,
      onSelectedFoodChange,
      cartOpen,
      address,
      search,
      toast,
    ],
  )

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp() {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error("useApp must be used within AppProvider")
  return ctx
}

export { TOPPINGS }
