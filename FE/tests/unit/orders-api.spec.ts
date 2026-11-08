import { test, expect } from "@playwright/test"
import { fetchCustomerOrder, isOrderId, ORDER_STATUSES, OrderApiError } from "../../lib/orders-api"
import { ORDER_A, ORDER_B, orderFixture } from "../fixtures/orders"

async function response(body: unknown, status: number, work: (calls: { input: RequestInfo | URL; init?: RequestInit }[]) => Promise<void>) {
  const original = globalThis.fetch
  const calls: { input: RequestInfo | URL; init?: RequestInit }[] = []
  globalThis.fetch = async (input, init) => {
    calls.push({ input, init })
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status })
  }
  try { await work(calls) } finally { globalThis.fetch = original }
}
const load = () => fetchCustomerOrder(ORDER_A, new AbortController().signal)

test("six actual model states have explicit Vietnamese labels", () => {
  expect(ORDER_STATUSES).toEqual({ pending: "Chờ xác nhận", confirmed: "Đã xác nhận", preparing: "Đang chuẩn bị",
    delivering: "Đang giao", completed: "Hoàn thành", cancelled: "Đã hủy" })
})
test("IDs are restricted to UUIDs rather than arbitrary proxy paths", async () => {
  for (const id of ["", "HD-12345", "../users/me", "http://example.test", `${ORDER_A}?user_id=other`]) {
    expect(isOrderId(id)).toBe(false)
    await expect(fetchCustomerOrder(id, new AbortController().signal)).rejects.toBeInstanceOf(OrderApiError)
  }
  expect(isOrderId(ORDER_A.toUpperCase())).toBe(true)
})
test("fetch sends only the normalized ID, keeps credentials server-side and bypasses caches", async () => {
  await response(orderFixture(), 200, async calls => {
    expect((await load()).id).toBe(ORDER_A)
    expect(calls[0].input).toBe(`/api/orders/${ORDER_A}`)
    expect(calls[0].init?.method).toBe("GET")
    expect(calls[0].init?.body).toBeUndefined()
    expect(calls[0].init?.headers).toBeUndefined()
    expect(calls[0].init?.credentials).toBe("same-origin")
    expect(calls[0].init?.cache).toBe("no-store")
  })
})
test("stored order prices, items and timestamps are returned without menu/demo substitution", async () => {
  const fixture = orderFixture()
  await response(fixture, 200, async () => { expect(await load()).toEqual(fixture) })
})
test("foreign/missing orders produce the same safe 404 message", async () => {
  await response({ detail: "private-order-details" }, 404, async () => {
    await expect(load()).rejects.toMatchObject({ status: 404, message: "Không tìm thấy đơn hàng của bạn." })
  })
})
test("missing or invalid sessions require reauthentication", async () => {
  for (const status of [401, 403]) await response({}, status, async () => {
    await expect(load()).rejects.toMatchObject({ status, message: expect.stringContaining("đăng nhập lại") })
  })
})
test("upstream errors and malformed/wrong-order data never become tracking details", async () => {
  await response({ detail: "private-error" }, 503, async () => {
    await expect(load()).rejects.toMatchObject({ status: 503, message: "Chưa thể tải đơn hàng. Vui lòng thử lại." })
  })
  for (const body of ["not-json", null, orderFixture({ id: ORDER_B }), orderFixture({ updated_at: "invalid-date" }),
    { ...orderFixture(), order_status: "invented", final_amount: "NaN" }]) {
    await response(body, 200, async () => { await expect(load()).rejects.toBeInstanceOf(OrderApiError) })
  }
})
test("cancelled orders retain a real optional reason and empty items stay empty", async () => {
  for (const reason of [null, "Cửa hàng không thể phục vụ"]) {
    const fixture = orderFixture({ order_status: "cancelled", cancellation_reason: reason, items: [] })
    await response(fixture, 200, async () => { expect(await load()).toEqual(fixture) })
  }
})
