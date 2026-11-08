export const ORDER_STATUSES = {
  pending: "Chờ xác nhận", confirmed: "Đã xác nhận", preparing: "Đang chuẩn bị",
  delivering: "Đang giao", completed: "Hoàn thành", cancelled: "Đã hủy",
} as const
export type OrderStatus = keyof typeof ORDER_STATUSES
export const ORDER_PROGRESS: OrderStatus[] = ["pending", "confirmed", "preparing", "delivering", "completed"]
export const isOrderId = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

export type CustomerOrder = {
  id: string; order_code: string; order_status: OrderStatus; delivery_address: string
  created_at: string; updated_at: string; cancellation_reason: string | null
  total_amount: string; shipping_fee: string; discount_amount: string; final_amount: string
  payment_method: "COD" | "VNPAY" | "MOMO"; payment_status: "unpaid" | "paid" | "refunded"
  items: { id: string; dish_id: string; dish_name: string; quantity: number; unit_price: string;
    subtotal: string; options_selected: Record<string, unknown> }[]
}
export class OrderApiError extends Error {
  constructor(public readonly status: number, message: string) { super(message) }
}
const money = (value: unknown) => typeof value === "string" && /^\d+(\.\d+)?$/.test(value) && Number.isFinite(Number(value))
const date = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value))

function validOrder(value: CustomerOrder, id: string) {
  return value && typeof value.id === "string" && value.id.toLowerCase() === id.toLowerCase()
    && typeof value.order_code === "string" && !!value.order_code.trim()
    && Object.hasOwn(ORDER_STATUSES, value.order_status) && typeof value.delivery_address === "string"
    && date(value.created_at) && date(value.updated_at)
    && [value.total_amount, value.shipping_fee, value.discount_amount, value.final_amount].every(money)
    && ["COD", "VNPAY", "MOMO"].includes(value.payment_method)
    && ["unpaid", "paid", "refunded"].includes(value.payment_status)
    && (value.cancellation_reason === null || typeof value.cancellation_reason === "string")
    && Array.isArray(value.items) && value.items.every(item => item && isOrderId(item.id) && isOrderId(item.dish_id)
      && typeof item.dish_name === "string" && Number.isSafeInteger(item.quantity) && item.quantity > 0
      && money(item.unit_price) && money(item.subtotal) && item.options_selected !== null
      && typeof item.options_selected === "object" && !Array.isArray(item.options_selected))
}

export async function fetchCustomerOrder(id: string, signal: AbortSignal): Promise<CustomerOrder> {
  if (!isOrderId(id)) throw new OrderApiError(422, "Mã tra cứu đơn hàng chưa hợp lệ.")
  const response = await fetch(`/api/orders/${encodeURIComponent(id.toLowerCase())}`, {
    method: "GET", credentials: "same-origin", cache: "no-store",
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  })
  if (response.status === 401 || response.status === 403) {
    throw new OrderApiError(response.status, "Phiên đăng nhập không còn hợp lệ. Vui lòng đăng nhập lại.")
  }
  if (response.status === 404) throw new OrderApiError(404, "Không tìm thấy đơn hàng của bạn.")
  if (!response.ok) throw new OrderApiError(response.status, "Chưa thể tải đơn hàng. Vui lòng thử lại.")
  let data: CustomerOrder
  try { data = await response.json() } catch {
    throw new OrderApiError(502, "Thông tin đơn hàng chưa hợp lệ. Vui lòng thử lại.")
  }
  if (!validOrder(data, id)) throw new OrderApiError(502, "Thông tin đơn hàng chưa hợp lệ. Vui lòng thử lại.")
  return data
}
