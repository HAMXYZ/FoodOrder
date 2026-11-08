import { test, expect } from "@playwright/test"
import { addCartItem, prepareCartSelection, removeCartItem, updateCartItemQuantity, stepCartItemQuantity } from "../../lib/cart"
import { toFood, type ApiDish } from "../../lib/menu-api"
import { SIZES, TOPPINGS } from "../../lib/menu-data"

const dish: ApiDish = {
  id: "694606b5-7fe6-4f9d-a37a-86ad4e187325", category_id: 1, category_name: "Cơm",
  name: "Món kiểm thử", description: "Fixture", base_price: 10000, calories: 100,
  spiciness_level: 0, is_vegetarian: false, image_url: null, is_available: true,
}
function initial() {
  let cart = addCartItem([], toFood(dish), prepareCartSelection()).cart
  cart = addCartItem(cart, toFood(dish), prepareCartSelection({
    size: SIZES[2], toppings: [TOPPINGS.rice[0]], note: "Ít cay", quantity: 3,
  })).cart
  return addCartItem(cart, toFood({ ...dish, id: "bc6df33d-a92b-4998-8213-c35d2800cd9f", name: "Món khác", base_price: 20000 }),
    prepareCartSelection({ quantity: 2 })).cart
}

test("removing the last line returns an empty cart without mutating the input", () => {
  const before = initial().slice(0, 1)
  Object.freeze(before)
  Object.freeze(before[0])
  expect(removeCartItem(before, before[0].key)).toEqual([])
  expect(before).toHaveLength(1)
  expect(before[0].quantity).toBe(1)
})

test("first, middle and last removals preserve every remaining object and its metadata", () => {
  const before = initial()
  Object.freeze(before)
  for (const item of before) Object.freeze(item)
  for (let index = 0; index < before.length; index++) {
    const after = removeCartItem(before, before[index].key)
    expect(after).toHaveLength(2)
    for (const item of before.filter((_, i) => i !== index)) {
      expect(after.find(line => line.key === item.key)).toBe(item)
    }
  }
  expect(before).toHaveLength(3)
})

test("removal uses the full option key rather than a dish ID or an array index", () => {
  const before = initial()
  expect(before[0].food.id).toBe(before[1].food.id)
  const after = removeCartItem(before, before[1].key)
  expect(after[0]).toBe(before[0])
  expect(after[1]).toBe(before[2])
  expect(removeCartItem(before, dish.id)).toBe(before)
})

test("removal deletes the entire selected line for quantities 2 through 99", () => {
  for (const quantity of [2, 42, 99]) {
    const before = initial()
    const changed = updateCartItemQuantity(before, before[0].key, quantity)
    const after = removeCartItem(changed, before[0].key)
    expect(after).toEqual(before.slice(1))
    expect(changed[0].quantity).toBe(quantity)
  }
})

test("empty, unknown or malformed keys do not affect the cart", () => {
  const before = initial()
  for (const key of ["", "missing", 0, null, undefined]) {
    expect(removeCartItem(before, key as string)).toBe(before)
  }
  const empty: typeof before = []
  expect(removeCartItem(empty, before[0].key)).toBe(empty)
})

test("repeated removal of an already removed key is idempotent", () => {
  const before = initial()
  const after = removeCartItem(before, before[0].key)
  for (let i = 0; i < 100; i++) expect(removeCartItem(after, before[0].key)).toBe(after)
  expect(after[0]).toBe(before[1])
  expect(after[1]).toBe(before[2])
})

test("interleaved removal and quantity edits preserve the latest unrelated line", () => {
  let cart = initial()
  const [plain, custom, other] = cart
  cart = removeCartItem(cart, plain.key)
  for (let i = 0; i < 30; i++) {
    cart = stepCartItemQuantity(cart, other.key, 1)
    cart = removeCartItem(cart, plain.key)
  }
  cart = removeCartItem(cart, custom.key)
  expect(cart).toEqual([{ ...other, quantity: 32 }])
  expect(cart[0].unitPrice).toBe(20000)
})

test("a new explicit add after removal can create that option key again", () => {
  const before = initial()
  const removed = removeCartItem(before, before[0].key)
  const result = addCartItem(removed, toFood(dish), prepareCartSelection({ quantity: 2 }))
  expect(result.item.key).toBe(before[0].key)
  expect(result.item.quantity).toBe(2)
  expect(result.cart[0]).toBe(before[1])
  expect(result.cart[1]).toBe(before[2])
})
