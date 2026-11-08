import { NextRequest } from "next/server"
import { profile } from "@/lib/auth-server"

export async function PUT(request: NextRequest) {
  return profile(request, "/api/users/me/change-password")
}
