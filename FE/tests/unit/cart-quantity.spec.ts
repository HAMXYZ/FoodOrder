import { test, expect } from "@playwright/test"
import {
  addCartItem, prepareCartSelection, updateCartItemQuantity, stepCartItemQuantity,
  type CartItem,
} from "../../lib/cart"
import { toFood, type ApiDish } from "../../lib/menu-api"
import { SIZES, TOPPINGS } from "../../lib/menu-data"

const dish: ApiDish = {
  id: "694606b5-7fe6-4f9d-a37a-86ad4e187325", category_id: 1, category_name: "Cơm",
  name: "Món kiểm thử", description: "Fixture", base_price: 10000, calories: 100,
  spiciness_level: 0, is_vegetarian: false, image_url: null, is_available: true,
}
function initial(): CartItem[] {
  const first = addCartItem([], toFood(dish), prepareCartSelection({
    size: SIZES[2], toppings: [TOPPINGS.rice[0]], note: "Ít cay",
  })).cart
  return addCartItem(first, toFood({ ...dish, id: "bc6df33d-a92b-4998-8213-c35d2800cd9f", name: "Món khác" }),
    prepareCartSelection({ quantity: 3 })).cart
}

test("quantity 1 -> 2 -> 1 changes only the target quantity, preserving prices and other lines", () => {
  const before = initial()
  Object.freeze(before)
  for (const item of before) Object.freeze(item)
  const increased = updateCartItemQuantity(before, before[0].key, 2)
  expect(increased[0]).toEqual({ ...before[0], quantity: 2 })
  expect(increased[0].food).toBe(before[0].food)
  expect(increased[0].size).toBe(before[0].size)
  expect(increased[0].toppings).toBe(before[0].toppings)
  expect(increased[0].unitPrice).toBe(37000)
  expect(increased[0].unitPrice * increased[0].quantity).toBe(74000)
  expect(increased[1]).toBe(before[1])
  expect(updateCartItemQuantity(increased, before[0].key, 1)).toEqual(before)
  expect(before[0].quantity).toBe(1)
})

test("zero, negatives, overflow, fractions and nonnumbers never change or delete a line", () => {
  const before = initial()
  const invalid: unknown[] = [0, -1, -99, 100, 1000, 1.5, NaN, Infinity, -Infinity,
    Number.MAX_SAFE_INTEGER + 1, "2", null, undefined, true, {}]
  for (const quantity of invalid) {
    expect(updateCartItemQuantity(before, before[0].key, quantity as number)).toBe(before)
  }
  expect(before).toHaveLength(2)
  expect(before[0].quantity).toBe(1)
})

test("absolute boundary values 1 and 99 are accepted without clamping invalid requests", () => {
  const before = initial()
  const maximum = updateCartItemQuantity(before, before[0].key, 99)
  expect(maximum[0].quantity).toBe(99)
  expect(updateCartItemQuantity(maximum, before[0].key, 100)).toBe(maximum)
  expect(updateCartItemQuantity(maximum, before[0].key, 1)[0].quantity).toBe(1)
})

test("an unknown key does not insert a line or change the cart", () => {
  const before = initial()
  expect(updateCartItemQuantity(before, "unknown", 2)).toBe(before)
  expect(stepCartItemQuantity(before, "unknown", 1)).toBe(before)
  const empty: CartItem[] = []
  expect(updateCartItemQuantity(empty, before[0].key, 2)).toBe(empty)
})

test("unchanged quantities are no-ops and preserve the array reference", () => {
  const before = initial()
  expect(updateCartItemQuantity(before, before[0].key, 1)).toBe(before)
})

test("the same dish with different options is addressed by the exact line key", () => {
  const before = addCartItem(initial(), toFood(dish), prepareCartSelection({ size: SIZES[1], note: "Không hành" })).cart
  const after = updateCartItemQuantity(before, before[2].key, 4)
  expect(after).toHaveLength(3)
  expect(after[0]).toBe(before[0])
  expect(after[1]).toBe(before[1])
  expect(after[2]).toEqual({ ...before[2], quantity: 4 })
})

test("consecutive steps resolve the latest snapshot without losing intermediate updates", () => {
  let cart = initial()
  const key = cart[0].key
  const other = cart[1]
  for (let i = 0; i < 30; i++) cart = stepCartItemQuantity(cart, key, 1)
  expect(cart[0].quantity).toBe(31)
  for (let i = 0; i < 10; i++) cart = stepCartItemQuantity(cart, key, -1)
  expect(cart[0].quantity).toBe(21)
  expect(cart[1]).toBe(other)
})

test("steps stop at both boundaries and reject directions other than +1/-1", () => {
  const before = initial()
  expect(stepCartItemQuantity(before, before[0].key, -1)).toBe(before)
  const maximum = updateCartItemQuantity(before, before[0].key, 99)
  expect(stepCartItemQuantity(maximum, before[0].key, 1)).toBe(maximum)
  expect(stepCartItemQuantity(maximum, before[0].key, -1)[0].quantity).toBe(98)
  for (const step of [0, 2, -2, NaN]) {
    expect(stepCartItemQuantity(before, before[0].key, step as 1 | -1)).toBe(before)
  }
})
