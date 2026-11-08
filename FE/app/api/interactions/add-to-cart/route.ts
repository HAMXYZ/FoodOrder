import { NextRequest } from "next/server"
import { authenticatedRequest } from "@/lib/auth-server"

export async function POST(request: NextRequest) {
  return authenticatedRequest(request, "/api/interactions/add-to-cart", {
    errorMessages: {
      400: "Yêu cầu chưa hợp lệ.", 404: "Không tìm thấy món ăn đang bán.",
      409: "Mã sự kiện đã được sử dụng cho nội dung khác.", 422: "Dữ liệu thêm giỏ chưa hợp lệ.",
    },
    unavailableMessage: "Chưa thể ghi nhận thao tác thêm giỏ. Vui lòng thử lại.",
  })
}
