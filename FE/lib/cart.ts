import { SIZES, TOPPINGS, type Food, type SizeOption, type Topping } from "./menu-data"

export const CART_LINE_LIMIT = 99
export type CartItem = {
  key: string; food: Food; size: SizeOption; toppings: Topping[]
  note: string; quantity: number; unitPrice: number
}
export type AddOptions = { size?: SizeOption; toppings?: Topping[]; note?: string; quantity?: number }
export type CartSelection = {
  sizeId: SizeOption["id"]; toppingIds: string[]; note: string; quantity: number
}

export class CartAddError extends Error {}

// Capture only option IDs and values relevant to the action before any await.
// Labels/prices supplied by a component are never used as canonical option data.
export function prepareCartSelection(options: AddOptions = {}): CartSelection {
  const quantity = options.quantity === undefined ? 1 : options.quantity
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > CART_LINE_LIMIT) {
    throw new CartAddError("Không thể thêm món. Vui lòng chọn số lượng từ 1 đến 99.")
  }
  const sizeId = options.size === undefined ? SIZES[0].id : options.size?.id
  if (!SIZES.some(size => size.id === sizeId)) throw new CartAddError("Size món chưa hợp lệ. Vui lòng chọn lại.")
  const toppings = options.toppings === undefined ? [] : options.toppings
  if (!Array.isArray(toppings) || toppings.some(topping => !topping || typeof topping.id !== "string")) {
    throw new CartAddError("Topping chưa hợp lệ. Vui lòng chọn lại.")
  }
  const toppingIds = toppings.map(topping => topping.id)
  if (new Set(toppingIds).size !== toppingIds.length) throw new CartAddError("Topping bị chọn trùng. Vui lòng chọn lại.")
  const note = options.note === undefined ? "" : options.note
  if (typeof note !== "string" || note.trim().length > 200) {
    throw new CartAddError("Ghi chú cho bếp chỉ được tối đa 200 ký tự.")
  }
  return { sizeId, toppingIds, quantity, note: note.trim() }
}

export function cartItemKey(dishId: string, selection: CartSelection) {
  return [dishId, selection.sizeId, [...selection.toppingIds].sort().join("+"), selection.note].join("|")
}

export function computeUnitPrice(food: Food, size: SizeOption, toppings: Topping[]) {
  return food.price + size.extra + toppings.reduce((sum, topping) => sum + topping.price, 0)
}

// Quantity edits change only an existing line's quantity. Invalid/unchanged values
// are no-ops: editing quantity never removes a line, reprices it or records an add.
export function updateCartItemQuantity(previous: CartItem[], key: string, quantity: number): CartItem[] {
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > CART_LINE_LIMIT) return previous
  const item = previous.find(line => line.key === key)
  if (!item || item.quantity === quantity) return previous
  return previous.map(line => line.key === key ? { ...line, quantity } : line)
}

// Resolve each click against the current snapshot, even before React re-renders.
export function stepCartItemQuantity(previous: CartItem[], key: string, step: -1 | 1): CartItem[] {
  if (step !== -1 && step !== 1) return previous
  const item = previous.find(line => line.key === key)
  return item ? updateCartItemQuantity(previous, key, item.quantity + step) : previous
}

// Keys include the selected options, so removing one variant keeps the others.
// Repeated/stale removals are no-ops and never alter any remaining line.
export function removeCartItem(previous: CartItem[], key: string): CartItem[] {
  return previous.some(line => line.key === key) ? previous.filter(line => line.key !== key) : previous
}

// The caller supplies the freshly validated catalog dish, never the stale card object.
// Return a new array without mutating other lines or triggering any telemetry.
export function addCartItem(previous: readonly CartItem[], food: Food, selection: CartSelection) {
  const size = SIZES.find(option => option.id === selection.sizeId)
  const available = TOPPINGS[food.toppingGroup]
  if (!size || !available || selection.toppingIds.some(id => !available.some(topping => topping.id === id))) {
    throw new CartAddError("Tùy chọn món đã thay đổi hoặc chưa hợp lệ. Vui lòng chọn lại.")
  }
  const toppings = available.filter(topping => selection.toppingIds.includes(topping.id)).map(topping => ({ ...topping }))
  const unitPrice = computeUnitPrice(food, size, toppings)
  if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new CartAddError("Giá món chưa hợp lệ. Vui lòng thử lại.")
  const key = cartItemKey(food.id, selection)
  const existing = previous.find(item => item.key === key)
  const added = Math.min(selection.quantity, CART_LINE_LIMIT - (existing?.quantity ?? 0))
  if (added <= 0) throw new CartAddError("Món này đã đạt giới hạn 99 trong giỏ hàng.")
  const item: CartItem = {
    key, food, size: { ...size }, toppings, note: selection.note,
    quantity: (existing?.quantity ?? 0) + added, unitPrice,
  }
  return {
    added, item,
    cart: existing ? previous.map(line => line.key === key ? item : line) : [...previous, item],
  }
}
