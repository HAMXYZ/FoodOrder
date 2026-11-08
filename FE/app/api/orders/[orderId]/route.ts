import { NextRequest } from "next/server"
import { authenticatedRequest, authResponse, SESSION_COOKIE } from "@/lib/auth-server"
import { isOrderId } from "@/lib/orders-api"

export async function GET(request: NextRequest, context: { params: Promise<{ orderId: string }> }) {
  if (!request.cookies.get(SESSION_COOKIE)?.value) {
    return authResponse({ detail: "Chưa đăng nhập.", code: "unauthenticated" }, 401)
  }
  const { orderId } = await context.params
  if (!isOrderId(orderId)) return authResponse({ detail: "Mã tra cứu đơn hàng chưa hợp lệ." }, 422)
  // Only a UUID enters this fixed endpoint; no client query, user_id or Authorization is forwarded.
  return authenticatedRequest(request, `/api/orders/${orderId.toLowerCase()}`, {
    errorMessages: { 404: "Không tìm thấy đơn hàng của bạn.", 422: "Mã tra cứu đơn hàng chưa hợp lệ." },
    unavailableMessage: "Chưa thể tải đơn hàng. Vui lòng thử lại.",
  })
}
