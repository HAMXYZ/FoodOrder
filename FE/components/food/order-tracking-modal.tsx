"use client"

import { Bike, Check, Clock3, CookingPot, MapPin, MessageCircle, PackageCheck, Phone, X } from "lucide-react"
import { formatVND } from "@/lib/menu-data"
import { useOverlay } from "./use-overlay"

interface OrderTrackingModalProps {
  isOpen: boolean
  onClose: () => void
  orderId?: string
  order?: OrderTrackingDetails
}

export type OrderTrackingDetails = {
  orderId: string
  address: string
  items: { name: string; quantity: number; unitPrice: number }[]
  total: number
}

const SAMPLE_ORDER: OrderTrackingDetails = {
  orderId: "HD-88293",
  address: "123 Nguyễn Huệ, Phường Bến Nghé, Quận 1, TP. Hồ Chí Minh",
  items: [
    { name: "Cơm tấm sườn bì chả", quantity: 1, unitPrice: 55_000 },
    { name: "Trà đào cam sả", quantity: 1, unitPrice: 35_000 },
  ],
  total: 90_000,
}

const ORDER_STEPS = [
  { label: "Đã nhận đơn", icon: Check, state: "complete" },
  { label: "Đang chế biến", icon: CookingPot, state: "active" },
  { label: "Đang giao", icon: Bike, state: "upcoming" },
  { label: "Thành công", icon: PackageCheck, state: "upcoming" },
] as const

export function OrderTrackingModal({
  isOpen,
  onClose,
  order,
  orderId,
}: OrderTrackingModalProps) {
  useOverlay(isOpen, onClose)

  if (!isOpen) return null

  const trackingOrder = order ?? {
    ...SAMPLE_ORDER,
    orderId: orderId ?? SAMPLE_ORDER.orderId,
  }

  return (
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/50 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-tracking-title"
        className="relative flex max-h-[94dvh] w-full max-w-2xl animate-in slide-in-from-bottom-6 flex-col overflow-hidden rounded-t-3xl bg-card shadow-2xl duration-200 sm:rounded-3xl"
      >
        <header className="flex items-start justify-between gap-4 border-b px-5 py-5 sm:px-7">
          <div className="min-w-0">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Theo dõi đơn hàng
            </p>
            <h2 id="order-tracking-title" className="mt-1 text-xl font-extrabold sm:text-2xl">
              Mã đơn hàng <span className="text-[#E85D04]">#{trackingOrder.orderId}</span>
            </h2>
            <p className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-[#b44703]">
              <Clock3 className="size-4 shrink-0" aria-hidden="true" />
              Dự kiến giao trong 15-20 phút
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Đóng theo dõi đơn hàng"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground"
            autoFocus
          >
            <X className="size-5" aria-hidden="true" />
          </button>
        </header>

        <div className="overflow-y-auto">
          <div className="px-5 py-6 sm:px-7">
            <ol
              aria-label="Tiến trình đơn hàng"
              className="grid grid-cols-4"
            >
              {ORDER_STEPS.map((step, index) => {
                const StepIcon = step.icon
                const isComplete = step.state === "complete"
                const isActive = step.state === "active"

                return (
                  <li key={step.label} className="relative flex flex-col items-center text-center">
                    {index > 0 && (
                      <span
                        className={`absolute right-1/2 top-5 h-0.5 w-full ${
                          isComplete ? "bg-[#E85D04]" : "bg-border"
                        }`}
                        aria-hidden="true"
                      />
                    )}
                    <span
                      className={`relative z-10 flex size-10 items-center justify-center rounded-full border-2 ${
                        isComplete
                          ? "border-[#E85D04] bg-[#E85D04] text-white"
                          : isActive
                            ? "border-[#E85D04] bg-[#E85D04]/10 text-[#E85D04] ring-4 ring-[#E85D04]/10"
                            : "border-border bg-card text-muted-foreground"
                      }`}
                    >
                      <StepIcon
                        className={`size-4 ${isActive ? "animate-pulse" : ""}`}
                        aria-hidden="true"
                      />
                    </span>
                    <span
                      className={`mt-2 max-w-20 text-[11px] font-semibold leading-tight sm:max-w-none sm:text-xs ${
                        isComplete || isActive ? "text-foreground" : "text-muted-foreground"
                      }`}
                    >
                      {step.label}
                    </span>
                    {isActive && <span className="sr-only">Đang thực hiện</span>}
                  </li>
                )
              })}
            </ol>
          </div>

          <div className="space-y-5 px-5 pb-6 sm:px-7">
            <section aria-labelledby="shipper-title" className="rounded-2xl border p-4">
              <h3 id="shipper-title" className="mb-3 text-sm font-bold">
                Tài xế giao hàng
              </h3>
              <div className="flex flex-wrap items-center gap-3">
                <div
                  className="flex size-12 shrink-0 items-center justify-center rounded-full bg-[#E85D04]/10 text-[#E85D04]"
                  aria-hidden="true"
                >
                  <Bike className="size-6" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">Nguyễn Văn Shipper</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">Xe máy · 59-X1 123.45</p>
                </div>
                <div className="flex w-full gap-2 sm:w-auto">
                  <a
                    href="tel:+84912345678"
                    className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full border px-3 text-sm font-semibold transition hover:bg-muted sm:flex-none"
                  >
                    <Phone className="size-4" aria-hidden="true" />
                    Gọi điện
                  </a>
                  <a
                    href="sms:+84912345678"
                    className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-full border px-3 text-sm font-semibold transition hover:bg-muted sm:flex-none"
                  >
                    <MessageCircle className="size-4" aria-hidden="true" />
                    Nhắn tin
                  </a>
                </div>
              </div>
            </section>

            <section aria-labelledby="delivery-address-title" className="flex gap-3 rounded-2xl border p-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[#E85D04]/10 text-[#E85D04]">
                <MapPin className="size-5" aria-hidden="true" />
              </span>
              <div className="min-w-0">
                <h3 id="delivery-address-title" className="text-sm font-bold">
                  Địa chỉ giao hàng
                </h3>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  {trackingOrder.address}
                </p>
              </div>
            </section>

            <section aria-labelledby="order-items-title" className="rounded-2xl border p-4">
              <h3 id="order-items-title" className="mb-3 text-sm font-bold">
                Chi tiết đơn hàng
              </h3>
              <ul className="space-y-3">
                {trackingOrder.items.map((item, index) => (
                  <li key={`${item.name}-${index}`} className="flex items-start justify-between gap-4 text-sm">
                    <span className="min-w-0">
                      <span className="mr-2 inline-flex min-w-6 justify-center rounded-md bg-muted px-1.5 py-0.5 text-xs font-bold">
                        {item.quantity}x
                      </span>
                      <span className="font-medium">{item.name}</span>
                    </span>
                    <span className="shrink-0 font-semibold">{formatVND(item.unitPrice * item.quantity)}</span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex items-center justify-between border-t pt-4">
                <span className="font-bold">Tổng tiền</span>
                <span className="text-lg font-extrabold text-[#E85D04]">{formatVND(trackingOrder.total)}</span>
              </div>
            </section>
          </div>
        </div>
      </section>
    </div>
  )
}
