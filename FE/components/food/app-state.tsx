"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react"
import { fetchDish, MenuApiError, type MenuCategory } from "@/lib/menu-api"
import { recordDishView, recordDishAddToCart, type DishInteractionEvent } from "@/lib/interactions-api"
import { useAuth } from "./auth-state"
import { ADDRESSES, TOPPINGS, type Food } from "@/lib/menu-data"
import { addCartItem, updateCartItemQuantity, stepCartItemQuantity, removeCartItem, cartItemKey, prepareCartSelection, CartAddError, CART_LINE_LIMIT, type CartItem, type AddOptions, type CartSelection } from "@/lib/cart"
export { computeUnitPrice } from "@/lib/cart"
export type { CartItem } from "@/lib/cart"

type AppState = {
  foods: Food[]
  categories: MenuCategory[]
  menuError: string | null
  detailLoading: boolean
  detailError: string | null
  cart: CartItem[]
  cartCount: number
  subtotal: number
  addToCart: (food: Food, options?: AddOptions) => Promise<boolean>
  isAdding: (dishId: string) => boolean
  updateQuantity: (key: string, quantity: number) => void
  stepQuantity: (key: string, step: -1 | 1) => void
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

export function AppProvider({
  children,
  selectedFood,
  onSelectedFoodChange,
  foods,
  categories,
  menuError,
}: {
  children: React.ReactNode
  selectedFood: Food | null
  onSelectedFoodChange: (food: Food | null) => void
  foods: Food[]
  categories: MenuCategory[]
  menuError: string | null
}) {
  const [cart, setCart] = useState<CartItem[]>([])
  // All cart actions share this synchronous snapshot, including rapid clicks.
  // Side effects never run inside a React state updater that Strict Mode may replay.
  const currentCart = useRef<CartItem[]>([])
  const commitCart = useCallback((next: CartItem[]) => {
    currentCart.current = next
    setCart(next)
  }, [])
  const [adding, setAdding] = useState<Record<string, number>>({})
  // Associate catalog validation with the exact line, not just its dish.
  const pendingAdds = useRef(new Map<AbortController, string>())
  const mounted = useRef(true)
  const isAdding = useCallback((dishId: string) => (adding[dishId] ?? 0) > 0, [adding])
  const [cartOpen, setCartOpen] = useState(false)
  const [address, setAddress] = useState(ADDRESSES[0])
  const [search, setSearch] = useState("")
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const detailRequest = useRef<AbortController | null>(null)
  const pendingInteractions = useRef(new Set<AbortController>())
  const auth = useAuth()
  const currentAuth = useRef(auth)
  currentAuth.current = auth
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      detailRequest.current?.abort()
      for (const controller of pendingAdds.current.keys()) controller.abort()
      pendingAdds.current.clear()
      if (toastTimer.current) clearTimeout(toastTimer.current)
    }
  }, [])
  // Cancel pending telemetry on account changes/unmount; this effect never records an interaction.
  useEffect(() => () => {
    for (const controller of pendingInteractions.current) controller.abort()
    pendingInteractions.current.clear()
  }, [auth.user?.id])

  const sendInteraction = useCallback((type: "view" | "add_to_cart", event: DishInteractionEvent, customerId: string) => {
    const sameCustomer = () => currentAuth.current.user?.id === customerId
    if (!sameCustomer()) return
    const controller = new AbortController()
    pendingInteractions.current.add(controller)
    const record = type === "view" ? recordDishView : recordDishAddToCart
    void record(event, controller.signal, sameCustomer).then((result) => {
      if (result === "expired" && sameCustomer()) void currentAuth.current.refreshUser()
    }).catch(() => {
      // Telemetry retries never repeat or roll back the user's cart action.
    }).finally(() => pendingInteractions.current.delete(controller))
  }, [])

  const openFood = useCallback((food: Food) => {
    detailRequest.current?.abort()
    const controller = new AbortController()
    detailRequest.current = controller
    const { user, loading } = currentAuth.current
    const viewerId = !loading && user?.role === "customer" ? user.id : null
    // One ID per user action, never per render, detail refresh, or retry.
    const event = viewerId ? { event_id: crypto.randomUUID(), dish_id: food.id } : null
    onSelectedFoodChange(food)
    setDetailLoading(true)
    setDetailError(null)
    fetchDish(food.id, controller.signal).then((dish) => {
      if (controller.signal.aborted) return
      onSelectedFoodChange(dish)
      if (event && viewerId) sendInteraction("view", event, viewerId)
    }).catch(() => {
      if (!controller.signal.aborted) setDetailError("Không thể tải chi tiết món. Vui lòng đóng và thử lại.")
    }).finally(() => {
      if (!controller.signal.aborted) setDetailLoading(false)
    })
  }, [onSelectedFoodChange, sendInteraction])

  const closeFood = useCallback(() => {
    detailRequest.current?.abort()
    onSelectedFoodChange(null)
    setDetailLoading(false)
    setDetailError(null)
  }, [onSelectedFoodChange])

  const showToast = useCallback((message: string) => {
    setToast(message)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }, [])

  const addToCart = useCallback(
    async (food: Food, options: AddOptions = {}): Promise<boolean> => {
      let selection: CartSelection
      try {
        selection = prepareCartSelection(options)
        const existing = currentCart.current.find(item => item.key === cartItemKey(food.id, selection))
        if (existing && existing.quantity >= CART_LINE_LIMIT) {
          throw new CartAddError("Món này đã đạt giới hạn 99 trong giỏ hàng.")
        }
      } catch (error) {
        showToast(error instanceof CartAddError ? error.message : "Không thể thêm món. Vui lòng chọn lại tùy chọn.")
        return false
      }
      // Snapshot the action's identity/options, so later login or form edits do not
      // retroactively change the intent while the catalog request is pending.
      const { user, loading } = currentAuth.current
      const customerId = !loading && user?.role === "customer" ? user.id : null
      const controller = new AbortController()
      pendingAdds.current.set(controller, cartItemKey(food.id, selection))
      setAdding(previous => ({ ...previous, [food.id]: (previous[food.id] ?? 0) + 1 }))
      try {
        const freshFood = await fetchDish(food.id, AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]))
        if (controller.signal.aborted || !mounted.current) return false
        // Always merge into the CURRENT cart; another dish may have finished first.
        const result = addCartItem(currentCart.current, freshFood, selection)
        commitCart(result.cart)
        const priceNotice = freshFood.price !== food.price ? ". Giá món đã được cập nhật theo thực đơn mới." : ""
        showToast(`Đã thêm ${result.added} × ${freshFood.name}${priceNotice}`)
        if (customerId) {
          try {
            sendInteraction("add_to_cart", { event_id: crypto.randomUUID(), dish_id: freshFood.id }, customerId)
          } catch { /* Telemetry setup never undoes or retries a successful local add. */ }
        }
        return true
      } catch (error) {
        if (!controller.signal.aborted && mounted.current) {
          showToast(error instanceof CartAddError || error instanceof MenuApiError
            ? error.message : "Không thể kiểm tra món ăn. Vui lòng thử lại.")
        }
        return false
      } finally {
        pendingAdds.current.delete(controller)
        if (mounted.current) setAdding(previous => {
          const next = { ...previous }
          if ((next[food.id] ?? 0) <= 1) delete next[food.id]
          else next[food.id]--
          return next
        })
      }
    },
    [commitCart, sendInteraction, showToast],
  )

  const updateQuantity = useCallback((key: string, quantity: number) => {
    const next = updateCartItemQuantity(currentCart.current, key, quantity)
    if (next !== currentCart.current) commitCart(next)
  }, [commitCart])

  const stepQuantity = useCallback((key: string, step: -1 | 1) => {
    const next = stepCartItemQuantity(currentCart.current, key, step)
    if (next !== currentCart.current) commitCart(next)
  }, [commitCart])

  const removeItem = useCallback((key: string) => {
    const previous = currentCart.current
    const item = previous.find(line => line.key === key)
    if (!item) return
    // A pending re-add of this exact line must not undo the later removal.
    // Do not cancel other option sets or telemetry for already successful adds.
    for (const [controller, pendingKey] of pendingAdds.current) {
      if (pendingKey === key) controller.abort()
    }
    commitCart(removeCartItem(previous, key))
    showToast(`Đã xóa ${item.food.name} khỏi giỏ hàng`)
  }, [commitCart, showToast])

  const clearCart = useCallback(() => commitCart([]), [commitCart])

  const value = useMemo<AppState>(
    () => ({
      foods,
      categories,
      menuError,
      detailLoading,
      detailError,
      cart,
      cartCount: cart.reduce((sum, item) => sum + item.quantity, 0),
      subtotal: cart.reduce((sum, item) => sum + item.unitPrice * item.quantity, 0),
      addToCart,
      isAdding,
      updateQuantity,
      stepQuantity,
      removeItem,
      clearCart,
      selectedFood,
      openFood,
      closeFood,
      cartOpen,
      setCartOpen,
      address,
      setAddress,
      search,
      setSearch,
      toast,
    }),
    [
      foods, categories, menuError, detailLoading, detailError, openFood, closeFood,
      cart,
      addToCart,
      isAdding,
      updateQuantity,
      stepQuantity,
      removeItem,
      clearCart,
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
