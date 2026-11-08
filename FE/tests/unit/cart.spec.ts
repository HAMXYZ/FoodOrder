import { test, expect } from "@playwright/test"
import { addCartItem, prepareCartSelection, cartItemKey, CartAddError, type AddOptions } from "../../lib/cart"
import { fetchDish, MenuApiError, toFood, type ApiDish } from "../../lib/menu-api"
import { SIZES, TOPPINGS } from "../../lib/menu-data"

const api: ApiDish = {
  id: "694606b5-7fe6-4f9d-a37a-86ad4e187325", category_id: 1, category_name: "Cơm",
  name: "Món kiểm thử", description: "Fixture", base_price: 10000, calories: 100,
  spiciness_level: 0, is_vegetarian: false, image_url: null, is_available: true,
}
const food = () => toFood(api)
const select = (options: AddOptions = {}) => prepareCartSelection(options)

test("a new line stores the catalog dish, defaults, quantity and price", () => {
  const result = addCartItem([], food(), select())
  expect(result.added).toBe(1)
  expect(result.cart).toHaveLength(1)
  expect(result.item.food.id).toBe(api.id)
  expect(result.item.food.name).toBe(api.name)
  expect(result.item.unitPrice).toBe(api.base_price)
  expect(result.item.quantity).toBe(1)
  expect(result.item.size.id).toBe("S")
})

test("adding another dish preserves the previous line and input array", () => {
  const first = addCartItem([], food(), select()).cart
  Object.freeze(first)
  Object.freeze(first[0])
  const other = { ...food(), id: "bc6df33d-a92b-4998-8213-c35d2800cd9f", name: "Món thứ hai" }
  const result = addCartItem(first, other, select({ quantity: 2 }))
  expect(first).toHaveLength(1)
  expect(result.cart).toHaveLength(2)
  expect(result.cart[0]).toBe(first[0])
  expect(result.cart.reduce((count, line) => count + line.quantity, 0)).toBe(3)
})

test("same dish and options merge into one line", () => {
  const first = addCartItem([], food(), select({ quantity: 2 })).cart
  const result = addCartItem(first, food(), select({ quantity: 3 }))
  expect(result.cart).toHaveLength(1)
  expect(result.item.quantity).toBe(5)
  expect(result.added).toBe(3)
  expect(first[0].quantity).toBe(2)
})

test("different sizes, toppings or notes create different lines", () => {
  let cart = addCartItem([], food(), select()).cart
  cart = addCartItem(cart, food(), select({ size: SIZES[2] })).cart
  cart = addCartItem(cart, food(), select({ toppings: [TOPPINGS.rice[0]] })).cart
  cart = addCartItem(cart, food(), select({ note: "Ít cay" })).cart
  expect(cart).toHaveLength(4)
  expect(new Set(cart.map(line => line.key)).size).toBe(4)
})

test("topping order and surrounding note whitespace do not split identical lines", () => {
  const options = { toppings: [TOPPINGS.rice[0], TOPPINGS.rice[1]], note: "  Ít cay  " }
  const selection = select(options)
  const originalIDs = [...selection.toppingIds]
  const first = addCartItem([], food(), selection).cart
  const reversed = select({ toppings: [...options.toppings].reverse(), note: "Ít cay" })
  expect(cartItemKey(api.id, selection)).toBe(cartItemKey(api.id, reversed))
  expect(addCartItem(first, food(), reversed).item.quantity).toBe(2)
  expect(selection.toppingIds).toEqual(originalIDs)
})

test("option IDs resolve canonical labels and prices instead of supplied values", () => {
  const result = addCartItem([], food(), select({
    size: { id: "L", label: "Giá giả", extra: 0 },
    toppings: [{ id: "egg", name: "Topping giả", price: 0 }],
  }))
  expect(result.item.unitPrice).toBe(10000 + 20000 + 7000)
  expect(result.item.size.label).toBe("Lớn")
  expect(result.item.toppings[0].name).toBe(TOPPINGS.rice[0].name)
})

test("zero, negative, fractional, excessive and nonnumeric quantities fail", () => {
  for (const quantity of [0, -1, 1.5, 100, NaN, Infinity, null, "2"]) {
    expect(() => select({ quantity } as AddOptions)).toThrow(CartAddError)
  }
})

test("unknown sizes, duplicate toppings and unavailable topping groups fail", () => {
  expect(() => select({ size: { id: "XL" } } as unknown as AddOptions)).toThrow(CartAddError)
  expect(() => select({ toppings: [TOPPINGS.rice[0], TOPPINGS.rice[0]] })).toThrow(CartAddError)
  expect(() => addCartItem([], food(), select({ toppings: [TOPPINGS.drink[0]] }))).toThrow(CartAddError)
})

test("the action selection is a snapshot independent of subsequent form changes", () => {
  const options: AddOptions = { size: { ...SIZES[2] }, toppings: [{ ...TOPPINGS.rice[0] }], quantity: 2, note: "  Ban đầu " }
  const selection = select(options)
  options.quantity = 5
  options.size!.id = "M"
  options.toppings!.splice(0)
  options.note = "Đã thay đổi"
  expect(selection).toEqual({ sizeId: "L", toppingIds: ["egg"], quantity: 2, note: "Ban đầu" })
})

test("notes are trimmed and limited to 200 characters", () => {
  expect(select({ note: "  Ít cay  " }).note).toBe("Ít cay")
  expect(select({ note: "x".repeat(200) }).note).toHaveLength(200)
  expect(() => select({ note: "x".repeat(201) })).toThrow(CartAddError)
  expect(() => select({ note: 1 } as unknown as AddOptions)).toThrow(CartAddError)
})

test("the existing per-line limit clamps partial additions and rejects a full line", () => {
  const first = addCartItem([], food(), select({ quantity: 98 })).cart
  const result = addCartItem(first, food(), select({ quantity: 2 }))
  expect(result.added).toBe(1)
  expect(result.item.quantity).toBe(99)
  expect(() => addCartItem(result.cart, food(), select())).toThrow(CartAddError)
  expect(first[0].quantity).toBe(98)
})

test("re-adding a dish updates the merged quote from the latest catalog", () => {
  const old = addCartItem([], food(), select()).cart
  const fresh = { ...food(), name: "Tên mới", price: 20000 }
  const result = addCartItem(old, fresh, select())
  expect(result.item.food.name).toBe("Tên mới")
  expect(result.item.unitPrice).toBe(20000)
  expect(result.item.quantity).toBe(2)
  expect(old[0].unitPrice).toBe(10000)
})

test("invalid catalog prices never produce a cart mutation", () => {
  for (const price of [-1, NaN, Infinity]) {
    expect(() => addCartItem([], { ...food(), price }, select())).toThrow(CartAddError)
  }
})

async function withFetch(body: string | ApiDish, status: number, work: (calls: { input: RequestInfo | URL; init?: RequestInit }[]) => Promise<void>) {
  const previous = globalThis.fetch
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = []
  globalThis.fetch = async (input, init) => {
    calls.push({ input, init })
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
  }
  try { await work(calls) } finally { globalThis.fetch = previous }
}

test("catalog validation sends only the dish ID and uses the fresh server price", async () => {
  await withFetch({ ...api, base_price: 45000 }, 200, async calls => {
    const fresh = await fetchDish(api.id, new AbortController().signal)
    expect(fresh.price).toBe(45000)
    expect(calls).toHaveLength(1)
    expect(calls[0].input).toBe(`/api/dishes/${api.id}`)
    expect(calls[0].init?.body).toBeUndefined()
    expect(calls[0].init?.cache).toBe("no-store")
  })
})

test("missing or unavailable dishes are rejected before cart mutation", async () => {
  for (const [body, status] of [[api, 404], [{ ...api, is_available: false }, 200]] as const) {
    await withFetch(body, status, async () => {
      await expect(fetchDish(api.id, new AbortController().signal)).rejects.toBeInstanceOf(MenuApiError)
    })
  }
})

test("malformed responses, wrong IDs and invalid server prices are rejected", async () => {
  const invalid: (ApiDish | string)[] = ["not-json", { ...api, id: "another-dish" },
    { ...api, base_price: -1 }, { ...api, base_price: NaN }, { ...api, name: "" }]
  for (const body of invalid) {
    await withFetch(body, 200, async () => {
      await expect(fetchDish(api.id, new AbortController().signal)).rejects.toBeInstanceOf(MenuApiError)
    })
  }
})
