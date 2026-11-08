"use client"

import { useEffect, useState, type FormEvent } from "react"
import { Eye, EyeOff, Mail, Phone, UserRound, X } from "lucide-react"
import { useOverlay } from "./use-overlay"
import { useAuth } from "./auth-state"

interface AuthModalProps {
  isOpen: boolean
  onClose: () => void
}

type AuthTab = "login" | "register"

const inputClassName =
  "h-12 w-full rounded-xl border bg-background px-4 text-sm outline-none transition focus:border-[#E85D04] focus:ring-4 focus:ring-[#E85D04]/15"

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
  const { login, register } = useAuth()
  const [activeTab, setActiveTab] = useState<AuthTab>("login")
  const [feedback, setFeedback] = useState("")
  const [pending, setPending] = useState(false)

  useEffect(() => { if (isOpen) setFeedback("") }, [isOpen])

  useOverlay(isOpen, onClose)

  if (!isOpen) return null

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    const form = event.currentTarget
    const data = new FormData(form)
    setPending(true)
    setFeedback("")
    try {
      await login({ email: String(data.get("identifier") || ""),
        password: String(data.get("password") || ""), remember: data.get("remember") === "on" })
      form.reset()
      onClose()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Chưa thể đăng nhập. Vui lòng thử lại.")
    } finally { setPending(false) }
  }

  const handleRegister = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (pending) return
    const form = event.currentTarget
    const formData = new FormData(event.currentTarget)
    if (formData.get("password") !== formData.get("confirmPassword")) {
      setFeedback("Mật khẩu nhập lại chưa khớp. Vui lòng kiểm tra lại.")
      return
    }

    setPending(true)
    setFeedback("")
    try {
      await register({ full_name: String(formData.get("name") || ""),
        email: String(formData.get("email") || ""), password: String(formData.get("password") || ""),
        phone_number: String(formData.get("phone") || "") })
      form.reset()
      onClose()
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Chưa thể đăng ký. Vui lòng thử lại.")
    } finally { setPending(false) }
  }

  const showUnavailableMessage = (provider: string) => {
    setFeedback(`${provider} sẽ sớm được hỗ trợ. Vui lòng dùng biểu mẫu đăng nhập.`)
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center overflow-y-auto bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-modal-title"
        className="relative my-auto w-full max-w-md animate-in fade-in zoom-in-95 rounded-3xl bg-card p-6 shadow-2xl duration-200 sm:p-8"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng cửa sổ đăng nhập"
          className="absolute right-4 top-4 flex size-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
          autoFocus
        >
          <X className="size-5" aria-hidden="true" />
        </button>

        <div className="mb-6 pr-8">
          <span className="mb-3 inline-flex size-11 items-center justify-center rounded-2xl bg-[#E85D04]/10 text-[#E85D04]">
            <UserRound className="size-5" aria-hidden="true" />
          </span>
          <h2 id="auth-modal-title" className="text-2xl font-extrabold tracking-tight">
            Chào mừng đến với FoodAI
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Đăng nhập để đặt món ngon nhanh hơn.</p>
        </div>

        <div
          role="tablist"
          aria-label="Chọn hình thức tài khoản"
          className="mb-6 grid grid-cols-2 rounded-xl bg-muted p-1"
        >
          <button
            id="auth-login-tab"
            disabled={pending}
            type="button"
            role="tab"
            aria-selected={activeTab === "login"}
            aria-controls="auth-form-panel"
            onClick={() => {
              setActiveTab("login")
              setFeedback("")
            }}
            className={`h-10 rounded-lg text-sm font-semibold transition ${
              activeTab === "login" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Đăng nhập
          </button>
          <button
            id="auth-register-tab"
            disabled={pending}
            type="button"
            role="tab"
            aria-selected={activeTab === "register"}
            aria-controls="auth-form-panel"
            onClick={() => {
              setActiveTab("register")
              setFeedback("")
            }}
            className={`h-10 rounded-lg text-sm font-semibold transition ${
              activeTab === "register"
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            Đăng ký
          </button>
        </div>

        <div
          id="auth-form-panel"
          role="tabpanel"
          aria-labelledby={activeTab === "login" ? "auth-login-tab" : "auth-register-tab"}
        >
          {activeTab === "login" ? (
            <form key="login" className="space-y-4" onSubmit={handleLogin}>
              <div className="space-y-2">
                <label htmlFor="auth-login-identifier" className="text-sm font-semibold">
                  Email
                </label>
                <input
                  id="auth-login-identifier"
                  name="identifier"
                  type="email"
                  autoComplete="username"
                  placeholder="you@example.com"
                  required
                  className={inputClassName}
                />
              </div>

              <PasswordField
                id="auth-login-password"
                name="password"
                label="Mật khẩu"
                autoComplete="current-password"
              />

              <div className="flex items-center justify-between gap-3 text-sm">
                <label className="flex cursor-pointer items-center gap-2 text-muted-foreground">
                  <input
                    type="checkbox"
                    name="remember"
                    className="size-4 rounded border-border accent-[#E85D04] focus-visible:ring-2 focus-visible:ring-[#E85D04]/40"
                  />
                  Ghi nhớ đăng nhập
                </label>
                <button
                  type="button"
                  onClick={() => showUnavailableMessage("Tính năng khôi phục mật khẩu")}
                  className="font-semibold text-[#E85D04] hover:underline"
                >
                  Quên mật khẩu?
                </button>
              </div>

              <button
                type="submit"
                disabled={pending}
                className="h-12 w-full rounded-xl bg-[#E85D04] text-sm font-bold text-white transition hover:bg-[#d65300] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#E85D04]/30"
              >
                {pending ? "Đang đăng nhập..." : "Đăng nhập"}
              </button>
            </form>
          ) : (
            <form key="register" className="space-y-3.5" onSubmit={handleRegister}>
              <div className="space-y-2">
                <label htmlFor="auth-register-name" className="text-sm font-semibold">
                  Họ và tên
                </label>
                <input
                  id="auth-register-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  placeholder="Nguyễn Văn A"
                  required
                  className={inputClassName}
                />
              </div>

              <div className="space-y-2">
                <label htmlFor="auth-register-email" className="text-sm font-semibold">
                  Email
                </label>
                <div className="relative">
                  <Mail
                    className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <input
                    id="auth-register-email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    required
                    className={`${inputClassName} pl-11`}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="auth-register-phone" className="text-sm font-semibold">
                  Số điện thoại
                </label>
                <div className="relative">
                  <Phone
                    className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                    aria-hidden="true"
                  />
                  <input
                    id="auth-register-phone"
                    name="phone"
                    type="tel"
                    autoComplete="tel"
                    inputMode="tel"
                    placeholder="09xx xxx xxx"
                    required
                    className={`${inputClassName} pl-11`}
                  />
                </div>
              </div>

              <PasswordField
                id="auth-register-password"
                name="password"
                label="Mật khẩu"
                autoComplete="new-password"
              />
              <PasswordField
                id="auth-register-confirm-password"
                name="confirmPassword"
                label="Nhập lại mật khẩu"
                autoComplete="new-password"
              />

              <label className="flex cursor-pointer items-start gap-2 pt-1 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  name="terms"
                  required
                  className="mt-0.5 size-4 shrink-0 rounded border-border accent-[#E85D04] focus-visible:ring-2 focus-visible:ring-[#E85D04]/40"
                />
                <span>
                  Tôi đồng ý với{" "}
                  <a href="#terms" className="font-semibold text-[#E85D04] hover:underline">
                    Điều khoản dịch vụ
                  </a>
                </span>
              </label>

              <button
                type="submit"
                disabled={pending}
                className="h-12 w-full rounded-xl bg-[#E85D04] text-sm font-bold text-white transition hover:bg-[#d65300] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#E85D04]/30"
              >
                {pending ? "Đang tạo tài khoản..." : "Tạo tài khoản"}
              </button>
            </form>
          )}
        </div>

        {feedback && (
          <p role="status" aria-live="polite" className="mt-3 text-sm text-[#b44703]">
            {feedback}
          </p>
        )}

        <div className="my-5 flex items-center gap-3">
          <span className="h-px flex-1 bg-border" />
          <span className="text-xs font-medium text-muted-foreground">Hoặc tiếp tục với</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => showUnavailableMessage("Đăng nhập bằng Google")}
            className="flex h-11 items-center justify-center gap-2 rounded-xl border bg-card text-sm font-semibold transition hover:bg-muted"
          >
            <span aria-hidden="true" className="text-base font-bold text-[#4285F4]">
              G
            </span>
            Google
          </button>
          <button
            type="button"
            onClick={() => showUnavailableMessage("Đăng nhập bằng Facebook")}
            className="flex h-11 items-center justify-center gap-2 rounded-xl border bg-card text-sm font-semibold transition hover:bg-muted"
          >
            <span aria-hidden="true" className="text-lg font-extrabold leading-none text-[#1877F2]">
              f
            </span>
            Facebook
          </button>
        </div>
      </section>
    </div>
  )
}

function PasswordField({
  id,
  name,
  label,
  autoComplete,
}: {
  id: string
  name: string
  label: string
  autoComplete: string
}) {
  const [isVisible, setIsVisible] = useState(false)

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-semibold">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={name}
          type={isVisible ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder="Tối thiểu 8 ký tự"
          minLength={8}
          required
          className={`${inputClassName} pr-12`}
        />
        <button
          type="button"
          onClick={() => setIsVisible((visible) => !visible)}
          aria-label={isVisible ? "Ẩn mật khẩu" : "Hiện mật khẩu"}
          aria-pressed={isVisible}
          className="absolute right-2 top-1/2 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground"
        >
          {isVisible ? (
            <EyeOff className="size-4" aria-hidden="true" />
          ) : (
            <Eye className="size-4" aria-hidden="true" />
          )}
        </button>
      </div>
    </div>
  )
}
