export type AuthUser = {
  id: string
  full_name: string
  email: string
  phone_number: string | null
  role: "customer" | "admin" | "shipper"
  status: "active" | "inactive" | "banned"
}

export type SessionData = { user: AuthUser; expires_at: number }
export type LoginInput = { email: string; password: string; remember?: boolean }
export type RegisterInput = { full_name: string; email: string; password: string; phone_number: string }
