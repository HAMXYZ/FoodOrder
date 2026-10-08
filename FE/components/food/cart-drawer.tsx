"use client"

import Image from "next/image"
import { useState } from "react"
import { Banknote, CheckCircle2, MapPin, ShoppingBag, Smartphone, Ticket, Trash2, Wallet, X } from "lucide-react"
import { SHIPPING_FEE, VOUCHERS, formatVND } from "@/lib/menu-data"
import type { OrderTrackingDetails } from "@/components/food/order-tracking-modal"
import { cn } from "@/lib/utils"
import { useApp } from "./app-state"
import { QuantityStepper } from "./food-detail-modal"
import { useOverlay } from "./use-overlay"

const PAYMENT_METHODS = [
  { id: "cod", name: "Tiền mặt (COD)", description: "Thanh toán khi nhận hàng", icon: Banknote },
  { id: "vnpay", name: "VnPay", description: "Thẻ ATM / QR ngân hàng", icon: Wallet },
  { id: "momo", name: "MoMo", description: "Ví điện tử MoMo", icon: Smartphone },
] as const

type PaymentId = (typeof PAYMENT_METHODS)[number]["id"]

export function CartDrawer({
  onOrderPlaced,
}: {
  onOrderPlaced?: (order: OrderTrackingDetails) => void
}) {
  const { cartOpen, setCartOpen } = useApp()
  const close = () => setCartOpen(false)
  useOverlay(cartOpen, close)
  if (!cartOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 animate-in fade-in bg-black/50" onClick={close} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="cart-title"
        className="relative flex h-full w-full max-w-md animate-in slide-in-from-right flex-col bg-background shadow-2xl duration-300"
      >
        <CartContent onClose={close} onOrderPlaced={onOrderPlaced} />
      </aside>
    </div>
  )
}

function CartContent({
  onClose,
  onOrderPlaced,
}: {
  onClose: () => void
  onOrderPlaced?: (order: OrderTrackingDetails) => void
}) {
  const { cart, subtotal, updateQuantity, removeItem, clearCart, address, setAddress, cartCount } = useApp()
  const [voucherInput, setVoucherInput] = useState("")
  const [voucherCode, setVoucherCode] = useState<string | null>(null)
  const [voucherError, setVoucherError] = useState("")
  const [payment, setPayment] = useState<PaymentId>("cod")
  const [placedOrder, setPlacedOrder] = useState<{ total: number; payment: string } | null>(null)

  const voucher = voucherCode ? VOUCHERS[voucherCode] : null
  const freeShipByAmount = subtotal >= 150000
  const shipping = cart.length === 0 || freeShipByAmount || voucher?.type === "freeship" ? 0 : SHIPPING_FEE
  const discount =
    voucher?.type === "percent" ? Math.min(Math.round((subtotal * voucher.value) / 100), voucher.max ?? Infinity) : 0
  const total = Math.max(0, subtotal + shipping - discount)

  const applyVoucher = () => {
    const code = voucherInput.trim().toUpperCase()
    if (!code) return
    if (VOUCHERS[code]) {
      setVoucherCode(code)
      setVoucherError("")
    } else {
      setVoucherCode(null)
      setVoucherError("Mã không hợp lệ. Thử FOODAI20 hoặc FREESHIP.")
    }
  }

  const placeOrder = () => {
    if (!address.trim() || cart.length === 0) return
    const order: OrderTrackingDetails = {
      orderId: `HD-${Date.now().toString().slice(-5)}`,
      address: address.trim(),
      items: cart.map((item) => ({
        name: `${item.food.name} · Size ${item.size.id}${
          item.toppings.length > 0 ? ` · ${item.toppings.map((topping) => topping.name).join(", ")}` : ""
        }`,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
      })),
      total,
    }
    setPlacedOrder({ total, payment: PAYMENT_METHODS.find((p) => p.id === payment)?.name ?? "" })
    clearCart()
    if (onOrderPlaced) {
      onClose()
      onOrderPlaced(order)
    }
  }

  if (placedOrder) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
        <span className="flex size-20 items-center justify-center rounded-full bg-success/15">
          <CheckCircle2 className="size-10 text-success" aria-hidden="true" />
        </span>
        <h2 id="cart-title" className="text-2xl font-extrabold">
          Đặt hàng thành công!
        </h2>
        <p className="text-pretty text-sm text-muted-foreground">
          Đơn hàng {formatVND(placedOrder.total)} thanh toán qua {placedOrder.payment} đang được chuẩn bị và sẽ giao đến{" "}
          <strong className="text-foreground">{address}</strong> trong khoảng 25 phút.
        </p>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 h-12 rounded-full bg-primary px-8 font-bold text-primary-foreground"
        >
          Tiếp tục đặt món
        </button>
      </div>
    )
  }

  return (
    <>
      <div className="flex items-center justify-between border-b bg-card px-5 py-4">
        <h2 id="cart-title" className="flex items-center gap-2 text-lg font-extrabold">
          <ShoppingBag className="size-5 text-primary" aria-hidden="true" />
          Giỏ hàng <span className="text-muted-foreground">({cartCount})</span>
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Đóng giỏ hàng"
          className="flex size-9 items-center justify-center rounded-full hover:bg-muted"
          autoFocus
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>

      {cart.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
          <span className="flex size-20 items-center justify-center rounded-full bg-accent">
            <ShoppingBag className="size-9 text-primary" aria-hidden="true" />
          </span>
          <p className="text-lg font-bold">Giỏ hàng đang trống</p>
          <p className="text-sm text-muted-foreground">Chọn vài món ngon hoặc nhờ trợ lý AI gợi ý nhé!</p>
          <button
            type="button"
            onClick={onClose}
            className="mt-2 h-11 rounded-full bg-primary px-6 text-sm font-bold text-primary-foreground"
          >
            Khám phá món ăn
          </button>
        </div>
      ) : (
        <>
          <div className="flex flex-1 flex-col gap-5 overflow-y-auto p-5">
            <section aria-label="Món đã chọn" className="flex flex-col gap-3">
              {cart.map((item) => (
                <div key={item.key} className="flex gap-3 rounded-2xl border bg-card p-3">
                  <Image
                    src={item.food.image}
                    alt={item.food.name}
                    width={72}
                    height={72}
                    className="size-18 shrink-0 rounded-xl object-cover"
                  />
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold leading-snug">{item.food.name}</p>
                      <button
                        type="button"
                        onClick={() => removeItem(item.key)}
                        aria-label={`Xoá ${item.food.name}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Size {item.size.id}
                      {item.toppings.length > 0 && ` · ${item.toppings.map((t) => t.name).join(", ")}`}
                    </p>
                    {item.note && <p className="text-xs italic text-muted-foreground">{`"${item.note}"`}</p>}
                    <div className="mt-1 flex items-center justify-between">
                      <span className="font-bold text-primary">{formatVND(item.unitPrice * item.quantity)}</span>
                      <QuantityStepper
                        size="sm"
                        min={0}
                        value={item.quantity}
                        onChange={(q) => updateQuantity(item.key, q)}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </section>

            <section className="flex flex-col gap-2">
              <label htmlFor="delivery-address" className="flex items-center gap-2 text-sm font-bold">
                <MapPin className="size-4 text-primary" aria-hidden="true" />
                Địa chỉ giao hàng
              </label>
              <input
                id="delivery-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Số nhà, đường, phường, quận..."
                className="h-11 rounded-xl border bg-card px-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/15"
              />
              {!address.trim() && <p className="text-xs text-destructive">Vui lòng nhập địa chỉ giao hàng.</p>}
            </section>

            <section className="flex flex-col gap-2">
              <label htmlFor="voucher" className="flex items-center gap-2 text-sm font-bold">
                <Ticket className="size-4 text-primary" aria-hidden="true" />
                Mã giảm giá
              </label>
              <div className="flex gap-2">
                <input
                  id="voucher"
                  value={voucherInput}
                  onChange={(e) => setVoucherInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229) applyVoucher()
                  }}
                  placeholder="Nhập mã (FOODAI20)"
                  className="h-11 min-w-0 flex-1 rounded-xl border bg-card px-3 text-sm uppercase outline-none placeholder:normal-case focus:border-primary focus:ring-4 focus:ring-primary/15"
                />
                <button
                  type="button"
                  onClick={applyVoucher}
                  className="h-11 rounded-xl bg-foreground px-4 text-sm font-bold text-background hover:opacity-90"
                >
                  Áp dụng
                </button>
              </div>
              {voucher && (
                <p className="flex items-center justify-between rounded-xl bg-success/10 px-3 py-2 text-xs font-medium text-success">
                  <span>
                    {voucherCode}: {voucher.label}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setVoucherCode(null)
                      setVoucherInput("")
                    }}
                    className="underline"
                  >
                    Gỡ
                  </button>
                </p>
              )}
              {voucherError && (
                <p className="text-xs text-destructive" role="alert">
                  {voucherError}
                </p>
              )}
            </section>

            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-bold">Phương thức thanh toán</legend>
              {PAYMENT_METHODS.map((m) => {
                const active = payment === m.id
                const Icon = m.icon
                return (
                  <label
                    key={m.id}
                    className={cn(
                      "flex cursor-pointer items-center gap-3 rounded-2xl border-2 bg-card p-3 transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40",
                      active ? "border-primary" : "border-transparent hover:border-border",
                    )}
                  >
                    <input
                      type="radio"
                      name="payment"
                      value={m.id}
                      checked={active}
                      onChange={() => setPayment(m.id)}
                      className="sr-only"
                    />
                    <span
                      className={cn(
                        "flex size-10 items-center justify-center rounded-xl",
                        active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <span className="flex flex-1 flex-col">
                      <span className="text-sm font-semibold">{m.name}</span>
                      <span className="text-xs text-muted-foreground">{m.description}</span>
                    </span>
                    <span
                      className={cn(
                        "size-5 rounded-full border-2",
                        active ? "border-[6px] border-primary" : "border-border",
                      )}
                      aria-hidden="true"
                    />
                  </label>
                )
              })}
            </fieldset>
          </div>

          <div className="flex flex-col gap-3 border-t bg-card p-5">
            <dl className="flex flex-col gap-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tạm tính</dt>
                <dd>{formatVND(subtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Phí giao hàng</dt>
                <dd>{shipping === 0 ? <span className="font-medium text-success">Miễn phí</span> : formatVND(shipping)}</dd>
              </div>
              {discount > 0 && (
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Giảm giá</dt>
                  <dd className="font-medium text-success">-{formatVND(discount)}</dd>
                </div>
              )}
              <div className="mt-1 flex justify-between border-t pt-2 text-base font-extrabold">
                <dt>Tổng cộng</dt>
                <dd className="text-primary">{formatVND(total)}</dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={placeOrder}
              disabled={!address.trim()}
              className="h-12 rounded-full bg-primary font-bold text-primary-foreground shadow-lg shadow-primary/30 transition-transform hover:scale-[1.01] disabled:opacity-50"
            >
              Đặt hàng ngay · {formatVND(total)}
            </button>
          </div>
        </>
      )}
    </>
  )
}
