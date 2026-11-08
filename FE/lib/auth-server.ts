import "server-only"
import { NextRequest, NextResponse } from "next/server"

export const SESSION_COOKIE = "foodorder_session"

const backendURL = () => (process.env.FOODORDER_API_URL || "http://127.0.0.1:8000").replace(/\/$/, "")
const cookieOptions = {
  httpOnly: true, sameSite: "lax" as const, path: "/",
  secure: process.env.NODE_ENV === "production",
}

export function authResponse(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store", "Pragma": "no-cache" } })
}

function clearSession(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { ...cookieOptions, maxAge: 0 })
  return response
}

function originAllowed(request: NextRequest) {
  const origin = request.headers.get("origin")
  if (!origin) return true
  try {
    // Next.js dev canonicalizes 127.0.0.1 to localhost in nextUrl. Use the
    // actual request authority so both supported browser origins work.
    const authority = request.headers.get("host") || request.nextUrl.host
    const expected = new URL(`${request.nextUrl.protocol}//${authority}`).origin
    return new URL(origin).origin === expected
  } catch { return false }
}

function deniedOrigin() {
  return authResponse({ detail: "Nguồn yêu cầu không được phép." }, 403)
}

async function backend(path: string, options: RequestInit = {}) {
  return fetch(`${backendURL()}${path}`, {
    ...options, cache: "no-store", signal: AbortSignal.timeout(8000),
    headers: { "Content-Type": "application/json", ...options.headers },
  })
}

async function backendError(response: Response) {
  // Never forward request validation inputs (which can contain passwords).
  const messages: Record<number, string> = {
    400: "Thông tin chưa hợp lệ.", 401: "Email hoặc mật khẩu không chính xác.",
    403: "Tài khoản không hoạt động hoặc không được phép truy cập.",
    409: "Email đã được đăng ký.", 422: "Vui lòng kiểm tra thông tin đã nhập.",
  }
  return authResponse({ detail: messages[response.status] || "Chưa thể xử lý yêu cầu. Vui lòng thử lại." },
    response.status >= 500 ? 503 : response.status)
}

function expiresAt(token: string): number {
  // Used only for UI scheduling AFTER FastAPI validates the token via /me.
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString())
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) throw new Error("Invalid expiration")
  return payload.exp * 1000
}

export async function login(request: NextRequest) {
  if (!originAllowed(request)) return deniedOrigin()
  try {
    const input = await request.json()
    const response = await backend("/api/auth/login", {
      method: "POST", body: JSON.stringify({ email: input.email, password: input.password }),
    })
    if (!response.ok) return backendError(response)
    const session = await response.json()
    if (typeof session.access_token !== "string") throw new Error("Missing token")
    const profile = await backend("/api/users/me", {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
    if (!profile.ok) return clearSession(await backendError(profile))
    const { user } = await profile.json()
    const expiry = expiresAt(session.access_token)
    const result = authResponse({ user, expires_at: expiry })
    const maxAge = Math.max(0, Math.floor((expiry - Date.now()) / 1000))
    result.cookies.set(SESSION_COOKIE, session.access_token, {
      ...cookieOptions, ...(input.remember === true ? { maxAge } : {}),
    })
    return result
  } catch {
    return authResponse({ detail: "Chưa thể đăng nhập. Vui lòng thử lại." }, 503)
  }
}

export async function register(request: NextRequest) {
  if (!originAllowed(request)) return deniedOrigin()
  try {
    const input = await request.json()
    // Extra fields are left for FastAPI to reject; client roles/IDs are never accepted.
    const response = await backend("/api/auth/register", { method: "POST", body: JSON.stringify(input) })
    if (!response.ok) return backendError(response)
    const { user } = await response.json()
    return authResponse({ user }, 201)
  } catch {
    return authResponse({ detail: "Chưa thể đăng ký. Vui lòng thử lại." }, 503)
  }
}

export async function logout(request: NextRequest) {
  if (!originAllowed(request)) return deniedOrigin()
  return clearSession(authResponse({ message: "Đã đăng xuất." }))
}

type AuthenticatedOptions = {
  includeExpiry?: boolean
  errorMessages?: Record<number, string>
  unavailableMessage?: string
}

// Same HttpOnly cookie and origin checks for every authenticated Next.js API.
// Callers supply fixed server-side paths, never a path chosen by the browser.
export async function authenticatedRequest(request: NextRequest, path: string, options: AuthenticatedOptions = {}) {
  if (request.method !== "GET" && !originAllowed(request)) return deniedOrigin()
  const token = request.cookies.get(SESSION_COOKIE)?.value
  if (!token) return authResponse({ detail: "Chưa đăng nhập.", code: "unauthenticated" }, 401)
  try {
    const response = await backend(path, {
      method: request.method, headers: { Authorization: `Bearer ${token}` },
      ...(request.method === "GET" ? {} : { body: JSON.stringify(await request.json()) }),
    })
    if (response.status === 401 || response.status === 403) {
      return clearSession(authResponse({ detail: "Phiên đăng nhập không còn hợp lệ.", code: "session_expired" }, response.status))
    }
    if (!response.ok) {
      if (!options.errorMessages) return backendError(response)
      return authResponse({ detail: options.errorMessages[response.status] || options.unavailableMessage || "Chưa thể ghi nhận tương tác." },
        response.status >= 500 ? 503 : response.status)
    }
    const data = await response.json()
    return authResponse(options.includeExpiry ? { ...data, expires_at: expiresAt(token) } : data, response.status)
  } catch {
    return authResponse({ detail: options.unavailableMessage || "Chưa thể kiểm tra tài khoản. Vui lòng thử lại." }, 503)
  }
}

export async function profile(request: NextRequest, path = "/api/users/me") {
  return authenticatedRequest(request, path, { includeExpiry: true })
}
