"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { useAuth } from "./auth-state"
import { useOverlay } from "./use-overlay"

export function AccountModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { user, logout } = useAuth()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  useOverlay(isOpen && !!user, onClose)
  if (!isOpen || !user) return null

  const signOut = async () => {
    setPending(true)
    setError("")
    try {
      await logout()
      onClose()
    } catch {
      setError("Chưa thể đăng xuất. Vui lòng thử lại.")
    } finally { setPending(false) }
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="account-title"
        className="relative w-full max-w-md rounded-3xl bg-card p-6 shadow-2xl">
        <button type="button" aria-label="Đóng thông tin tài khoản" onClick={onClose}
          className="absolute right-4 top-4 rounded-full p-2 hover:bg-muted" autoFocus><X className="size-5" /></button>
        <h2 id="account-title" className="pr-8 text-2xl font-bold">Tài khoản của tôi</h2>
        <dl className="my-6 space-y-4 break-words">
          <div><dt className="text-sm text-muted-foreground">Họ và tên</dt><dd className="font-semibold">{user.full_name}</dd></div>
          <div><dt className="text-sm text-muted-foreground">Email</dt><dd>{user.email}</dd></div>
          <div><dt className="text-sm text-muted-foreground">Số điện thoại</dt><dd>{user.phone_number || "Chưa cập nhật"}</dd></div>
        </dl>
        {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
        <button type="button" onClick={signOut} disabled={pending}
          className="h-12 w-full rounded-xl bg-foreground font-semibold text-background disabled:opacity-50">
          {pending ? "Đang đăng xuất..." : "Đăng xuất"}
        </button>
      </section>
    </div>
  )
}
