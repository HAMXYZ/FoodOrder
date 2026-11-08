"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import type { AuthUser, LoginInput, RegisterInput, SessionData } from "@/lib/auth-types"

type AuthState = {
  user: AuthUser | null
  loading: boolean
  notice: string | null
  login: (input: LoginInput) => Promise<void>
  register: (input: RegisterInput) => Promise<void>
  logout: () => Promise<void>
  refreshUser: () => Promise<void>
  clearNotice: () => void
}

const AuthContext = createContext<AuthState | null>(null)

async function post(path: string, body?: unknown) {
  let response: Response
  let data
  try {
    response = await fetch(path, {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}),
    })
    data = await response.json()
  } catch {
    throw new Error("Chưa thể kết nối dịch vụ tài khoản. Vui lòng thử lại.")
  }
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : "Chưa thể xử lý yêu cầu. Vui lòng thử lại.")
  return data
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState<string | null>(null)
  const [expiry, setExpiry] = useState<number | null>(null)
  const currentUser = useRef<AuthUser | null>(null)
  const currentExpiry = useRef<number | null>(null)
  const generation = useRef(0)
  const refreshing = useRef<AbortController | null>(null)
  const channel = useRef<BroadcastChannel | null>(null)

  const setSession = useCallback((data: SessionData | null) => {
    currentUser.current = data?.user ?? null
    currentExpiry.current = data?.expires_at ?? null
    setUser(data?.user ?? null)
    setExpiry(data?.expires_at ?? null)
  }, [])

  const refreshUser = useCallback(async () => {
    const version = generation.current
    refreshing.current?.abort()
    const controller = new AbortController()
    refreshing.current = controller
    try {
      const response = await fetch("/api/users/me", {
        credentials: "same-origin", cache: "no-store", signal: controller.signal,
      })
      const data = await response.json()
      if (version !== generation.current || controller.signal.aborted) return
      if (response.status === 401 || response.status === 403) {
        if (currentUser.current || data.code === "session_expired") {
          setNotice("Phiên đăng nhập đã hết hạn hoặc không còn hợp lệ. Vui lòng đăng nhập lại.")
        }
        setSession(null)
      } else if (response.ok) {
        setSession(data)
        setNotice(null)
      } else {
        if (currentExpiry.current !== null && currentExpiry.current <= Date.now()) setSession(null)
        setNotice("Chưa thể kiểm tra phiên đăng nhập. Vui lòng thử lại.")
      }
    } catch {
      if (!controller.signal.aborted && version === generation.current) {
        if (currentExpiry.current !== null && currentExpiry.current <= Date.now()) setSession(null)
        setNotice("Chưa thể kiểm tra phiên đăng nhập. Vui lòng thử lại.")
      }
    } finally {
      if (!controller.signal.aborted && version === generation.current) setLoading(false)
    }
  }, [setSession])

  useEffect(() => {
    void refreshUser()
    const focus = () => { void refreshUser() }
    const visible = () => { if (document.visibilityState === "visible") void refreshUser() }
    window.addEventListener("focus", focus)
    document.addEventListener("visibilitychange", visible)
    if (typeof BroadcastChannel !== "undefined") {
      channel.current = new BroadcastChannel("foodorder-auth")
      channel.current.onmessage = () => { void refreshUser() }
    }
    return () => {
      refreshing.current?.abort()
      window.removeEventListener("focus", focus)
      document.removeEventListener("visibilitychange", visible)
      channel.current?.close()
    }
  }, [refreshUser])

  useEffect(() => {
    if (expiry === null) return
    const timer = setTimeout(() => {
      // Another tab may have replaced this cookie with a newer valid session.
      // Let FastAPI validate the current cookie before clearing it.
      setLoading(true)
      void refreshUser()
    }, Math.max(1000, expiry - Date.now() + 1000))
    return () => clearTimeout(timer)
  }, [expiry, user, refreshUser])

  const login = useCallback(async (input: LoginInput) => {
    const version = ++generation.current
    refreshing.current?.abort()
    await post("/api/auth/login", input)
    let response: Response
    let data: SessionData
    try {
      response = await fetch("/api/users/me", { credentials: "same-origin", cache: "no-store" })
      data = await response.json()
    } catch {
      throw new Error("Chưa thể xác minh tài khoản. Vui lòng thử lại.")
    }
    if (!response.ok) throw new Error("Chưa thể xác minh tài khoản. Vui lòng đăng nhập lại.")
    if (version !== generation.current) return
    setSession(data)
    setLoading(false)
    setNotice(null)
    channel.current?.postMessage("changed")
  }, [setSession])

  const register = useCallback(async (input: RegisterInput) => {
    await post("/api/auth/register", input)
    try {
      await login({ email: input.email, password: input.password })
    } catch {
      throw new Error("Tài khoản đã tạo. Vui lòng chuyển sang đăng nhập để tiếp tục.")
    }
  }, [login])

  const logout = useCallback(async () => {
    generation.current++
    refreshing.current?.abort()
    await post("/api/auth/logout")
    setSession(null)
    setLoading(false)
    setNotice(null)
    channel.current?.postMessage("changed")
  }, [setSession])

  return <AuthContext.Provider value={{ user, loading, notice, login, register, logout, refreshUser,
    clearNotice: () => setNotice(null) }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const auth = useContext(AuthContext)
  if (!auth) throw new Error("useAuth must be used within AuthProvider")
  return auth
}
