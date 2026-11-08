// Controlled API fixtures only. Never imported by production components or written to MariaDB.
import type { CustomerOrder } from "../../lib/orders-api"
export const ORDER_A = "11111111-1111-4111-8111-111111111111"
export const ORDER_B = "22222222-2222-4222-8222-222222222222"
export function orderFixture(changes: Partial<CustomerOrder> = {}): CustomerOrder {
  return {
    id: ORDER_A, order_code: "MOCK-ORDER-001", order_status: "pending",
    delivery_address: "Địa chỉ fixture kiểm thử", created_at: "2026-11-08T09:00:00Z", updated_at: "2026-11-08T10:00:00Z",
    total_amount: "20000.00", shipping_fee: "15000.00", discount_amount: "5000.00", final_amount: "30000.00",
    payment_method: "COD", payment_status: "unpaid", cancellation_reason: null,
    items: [{ id: "33333333-3333-4333-8333-333333333333", dish_id: "44444444-4444-4444-8444-444444444444",
      dish_name: "Món fixture kiểm thử", quantity: 2, unit_price: "10000.00", subtotal: "20000.00", options_selected: {} }],
    ...changes,
  }
}
