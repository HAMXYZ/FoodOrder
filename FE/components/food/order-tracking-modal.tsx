"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Check, Clock3, MapPin, PackageCheck, RefreshCw, Search, X } from "lucide-react"
import { formatVND } from "@/lib/menu-data"
import { fetchCustomerOrder, isOrderId, ORDER_PROGRESS, ORDER_STATUSES, OrderApiError, type CustomerOrder } from "@/lib/orders-api"
import { useAuth } from "./auth-state"
import { useOverlay } from "./use-overlay"

// Existing local checkout receipt only. It is never treated as an authenticated order.
export type OrderTrackingDetails = {
  orderId: string
  address: string
  items: { name: string; quantity: number; unitPrice: number }[]
  total: number
}

type Props = {
  isOpen: boolean; onClose: () => void; onRequestLogin: () => void
  initialOrderId?: string; demoCheckout?: boolean
}

export function OrderTrackingModal({ isOpen, onClose, onRequestLogin, initialOrderId, demoCheckout }: Props) {
  const { user, loading, notice } = useAuth()
  useOverlay(isOpen, onClose)
  if (!isOpen) return null
  return (
    <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="order-tracking-title"
        className="relative flex max-h-[94dvh] w-full max-w-2xl animate-in slide-in-from-bottom-6 flex-col overflow-hidden rounded-t-3xl bg-card shadow-2xl duration-200 sm:rounded-3xl">
        <header className="flex items-start justify-between gap-4 border-b px-5 py-5 sm:px-7">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Đơn hàng của bạn</p>
            <h2 id="order-tracking-title" className="mt-1 text-xl font-extrabold sm:text-2xl">Theo dõi đơn hàng</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng theo dõi đơn hàng" autoFocus
            className="flex size-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>
        <div className="overflow-y-auto p-5 sm:p-7">
          {demoCheckout && <p role="status" className="mb-5 rounded-2xl border bg-muted p-4 text-sm">
            Đặt hàng hiện là bản demo, chưa lưu đơn trên hệ thống. Chưa có mã tra cứu hoặc trạng thái đơn thật.
          </p>}
          {loading ? <p role="status">Đang kiểm tra phiên đăng nhập...</p> : !user ? (
            <div className="space-y-4">
              <p role="alert">{notice || "Vui lòng đăng nhập để xem đơn hàng của mình."}</p>
              <button type="button" onClick={onRequestLogin} className="h-11 rounded-full bg-primary px-6 font-bold text-primary-foreground">Đăng nhập để theo dõi</button>
            </div>
          ) : user.role !== "customer" ? <p role="alert">Chỉ tài khoản khách hàng được tra cứu đơn của mình.</p> : (
            <TrackingContent key={user.id} initialOrderId={initialOrderId} />
          )}
        </div>
      </section>
    </div>
  )
}

function TrackingContent({ initialOrderId }: { initialOrderId?: string }) {
  const { refreshUser } = useAuth()
  const [input, setInput] = useState(initialOrderId ?? "")
  const [lookupId, setLookupId] = useState("")
  const [order, setOrder] = useState<CustomerOrder | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => pending.current?.abort(), [])

  const load = useCallback(async (id: string) => {
    pending.current?.abort()
    setOrder(null)
    setError(null)
    const requested = id.trim().toLowerCase()
    if (!isOrderId(requested)) {
      setLookupId("")
      setLoading(false)
      setError("Mã tra cứu đơn hàng chưa hợp lệ.")
      return
    }
    const controller = new AbortController()
    pending.current = controller
    setLookupId(requested)
    setLoading(true)
    try {
      const result = await fetchCustomerOrder(requested, controller.signal)
      if (!controller.signal.aborted) setOrder(result)
    } catch (failure) {
      if (!controller.signal.aborted) {
        setError(failure instanceof OrderApiError ? failure.message : "Chưa thể tải đơn hàng. Vui lòng thử lại.")
        if (failure instanceof OrderApiError && [401, 403].includes(failure.status)) void refreshUser()
      }
    } finally { if (!controller.signal.aborted) setLoading(false) }
  }, [refreshUser])
  useEffect(() => { if (initialOrderId) void load(initialOrderId) }, [initialOrderId, load])

  return (
    <div className="space-y-5">
      <form onSubmit={event => { event.preventDefault(); void load(input) }} className="space-y-2">
        <label htmlFor="tracking-order-id" className="text-sm font-bold">Mã tra cứu đơn hàng</label>
        <p id="tracking-help" className="text-xs text-muted-foreground">Nhập mã tra cứu được cung cấp sau khi đặt hàng.</p>
        <div className="flex gap-2">
          <input id="tracking-order-id" value={input} onChange={event => setInput(event.target.value)} aria-describedby="tracking-help"
            autoComplete="off" spellCheck={false} maxLength={36} placeholder="Mã tra cứu đơn hàng"
            className="h-11 min-w-0 flex-1 rounded-xl border bg-card px-3 text-sm outline-none focus:border-primary" />
          <button type="submit" className="flex h-11 shrink-0 items-center gap-2 rounded-xl bg-primary px-4 text-sm font-bold text-primary-foreground">
            <Search className="size-4" aria-hidden="true" />Tra cứu
          </button>
        </div>
      </form>
      {lookupId && <button type="button" disabled={loading} onClick={() => { void load(lookupId) }}
        className="inline-flex h-11 items-center gap-2 rounded-full border px-4 text-sm font-semibold disabled:opacity-40">
        <RefreshCw className="size-4" aria-hidden="true" />Làm mới trạng thái
      </button>}
      {loading && <p role="status" className="flex items-center gap-2 text-sm"><Clock3 className="size-4" aria-hidden="true" />Đang tải trạng thái đơn hàng...</p>}
      {error && <p role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm text-destructive">{error}</p>}
      {!lookupId && !error && <p className="text-sm text-muted-foreground">Chưa chọn đơn hàng để theo dõi.</p>}
      {order && <OrderDetails order={order} />}
    </div>
  )
}

function OrderDetails({ order }: { order: CustomerOrder }) {
  const currentStep = ORDER_PROGRESS.indexOf(order.order_status)
  return (
    <div className="space-y-5" aria-live="polite">
      <div className="min-w-0 space-y-2">
        <h3 className="break-words text-lg font-extrabold">Mã đơn hàng #{order.order_code}</h3>
        <p className="font-bold text-primary" data-testid="order-status">{ORDER_STATUSES[order.order_status]}</p>
        <p className="text-xs text-muted-foreground">Cập nhật lúc: <time dateTime={order.updated_at}>{new Date(order.updated_at).toLocaleString("vi-VN")}</time></p>
      </div>
      {order.order_status === "cancelled" ? (
        <p role="status" className="break-words rounded-2xl border border-destructive/30 p-4 text-sm">
          {order.cancellation_reason || "Đơn hàng đã bị hủy. Hệ thống chưa có thông tin lý do hủy."}
        </p>
      ) : (
        <ol aria-label="Tiến trình đơn hàng" className="grid grid-cols-5 gap-1">
          {ORDER_PROGRESS.map((step, index) => <li key={step} aria-current={step === order.order_status ? "step" : undefined}
            className="flex min-w-0 flex-col items-center text-center">
            <span className={`flex size-9 items-center justify-center rounded-full border-2 ${index <= currentStep ? "border-primary bg-accent text-primary" : "border-border text-muted-foreground"}`}>
              {index < currentStep ? <Check className="size-4" aria-hidden="true" /> : <PackageCheck className="size-4" aria-hidden="true" />}
            </span>
            <span className="mt-2 text-[11px] font-semibold leading-tight">{ORDER_STATUSES[step]}</span>
          </li>)}
        </ol>
      )}
      <section className="rounded-2xl border p-4">
        <h4 className="mb-2 flex items-center gap-2 text-sm font-bold"><MapPin className="size-4" aria-hidden="true" />Địa chỉ giao hàng</h4>
        <p className="break-words text-sm text-muted-foreground">{order.delivery_address}</p>
      </section>
      <section className="rounded-2xl border p-4">
        <h4 className="mb-3 text-sm font-bold">Chi tiết đơn hàng</h4>
        {order.items.length ? <ul className="space-y-3">{order.items.map(item => (
          <li key={item.id} className="flex items-start justify-between gap-3 text-sm">
            <span className="min-w-0 break-words"><strong>{item.quantity} × </strong>{item.dish_name}</span>
            <span className="shrink-0 font-semibold">{formatVND(Number(item.subtotal))}</span>
          </li>
        ))}</ul> : <p className="text-sm text-muted-foreground">Đơn hàng chưa có danh sách món.</p>}
        <dl className="mt-4 space-y-2 border-t pt-4 text-sm">
          {[["Tạm tính", order.total_amount], ["Phí giao hàng", order.shipping_fee], ["Giảm giá", order.discount_amount], ["Tổng tiền", order.final_amount]].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-2"><dt>{label}</dt><dd className="font-bold">{formatVND(Number(value))}</dd></div>
          ))}
        </dl>
      </section>
    </div>
  )
}
