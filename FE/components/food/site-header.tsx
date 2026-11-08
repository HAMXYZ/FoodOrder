"use client"

import { useState } from "react"
import Link from "next/link"
import { Check, ChevronDown, LayoutDashboard, MapPin, Search, ShoppingBag, Sparkles, UserRound, PackageSearch } from "lucide-react"
import { ADDRESSES } from "@/lib/menu-data"
import { useApp } from "./app-state"
import type { AuthUser } from "@/lib/auth-types"

function LocationSelector() {
  const { address, setAddress } = useApp()
  const [open, setOpen] = useState(false)

  return (
    <div className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="flex w-full min-w-0 items-center gap-2 rounded-xl px-2 py-1.5 text-left transition-colors hover:bg-muted"
      >
        <MapPin className="size-5 shrink-0 text-primary" aria-hidden="true" />
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="text-xs text-muted-foreground">Giao đến...</span>
          <span className="truncate text-sm font-semibold">{address}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      {open && (
        <ul
          role="listbox"
          aria-label="Chọn địa chỉ giao hàng"
          className="absolute left-0 top-full z-50 mt-2 w-72 rounded-2xl border bg-card p-2 shadow-xl"
        >
          {ADDRESSES.map((a) => (
            <li key={a}>
              <button
                type="button"
                role="option"
                aria-selected={a === address}
                onClick={() => {
                  setAddress(a)
                  setOpen(false)
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm hover:bg-muted"
              >
                <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="flex-1">{a}</span>
                {a === address && <Check className="size-4 text-primary" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function SearchBar({ className = "" }: { className?: string }) {
  const { search, setSearch } = useApp()
  return (
    <div className={`relative ${className}`}>
      <label htmlFor="food-search" className="sr-only">
        Tìm món ăn
      </label>
      <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
      <input
        id="food-search"
        type="search"
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          if (e.target.value) document.getElementById("popular")?.scrollIntoView({ behavior: "smooth", block: "start" })
        }}
        placeholder="Tìm cơm tấm, bún bò, trà sữa..."
        className="h-11 w-full rounded-full border bg-muted/60 pl-10 pr-4 text-sm outline-none transition focus:border-primary focus:bg-card focus:ring-4 focus:ring-primary/15"
      />
    </div>
  )
}

export function SiteHeader({
  onAuthClick,
  onTrackClick,
  currentUser,
  authLoading,
}: {
  onAuthClick: () => void
  onTrackClick: () => void
  currentUser: AuthUser | null
  authLoading: boolean
}) {
  const { cartCount, setCartOpen } = useApp()

  return (
    <header className="sticky top-0 z-40 border-b bg-card/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:gap-6 md:px-6">
        <div className="flex items-center justify-between gap-3">
          <a href="#" className="flex shrink-0 items-center gap-2" aria-label="FoodAI Order - Trang chủ">
            <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="size-5" aria-hidden="true" />
            </span>
            <span className="text-lg font-extrabold tracking-tight">
              FoodAI <span className="text-primary">Order</span>
            </span>
          </a>
          <div className="flex items-center gap-2 md:hidden">
            <TrackingButton onClick={onTrackClick} />
            <CartButton count={cartCount} onClick={() => setCartOpen(true)} />
            <AuthButton onClick={onAuthClick} userName={currentUser?.full_name} loading={authLoading} />
            {currentUser?.role === "admin" && <AdminLink compact />}
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-3 md:flex-1">
          <div className="hidden min-w-0 max-w-64 lg:block">
            <LocationSelector />
          </div>
          <SearchBar className="flex-1" />
        </div>

        <div className="md:hidden">
          <LocationSelector />
        </div>

        <div className="hidden items-center gap-2 md:flex">
          {currentUser?.role === "admin" && <AdminLink />}
          <TrackingButton onClick={onTrackClick} />
          <CartButton count={cartCount} onClick={() => setCartOpen(true)} />
          <AuthButton onClick={onAuthClick} userName={currentUser?.full_name} loading={authLoading} />
        </div>
      </div>
    </header>
  )
}

function TrackingButton({ onClick }: { onClick: () => void }) {
  return <button type="button" onClick={onClick} aria-label="Theo dõi đơn hàng" title="Theo dõi đơn hàng"
    className="flex size-10 shrink-0 items-center justify-center rounded-full border bg-card text-muted-foreground hover:text-primary">
    <PackageSearch className="size-5" aria-hidden="true" />
  </button>
}

function AdminLink({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      href="/admin"
      aria-label={compact ? "Mở trang quản trị" : undefined}
      className={
        compact
          ? "flex size-10 items-center justify-center rounded-full border bg-card text-muted-foreground transition-colors hover:border-primary hover:text-primary"
          : "inline-flex h-10 items-center gap-2 rounded-full border bg-card px-3 text-sm font-semibold text-muted-foreground transition-colors hover:border-primary hover:text-primary"
      }
    >
      <LayoutDashboard className="size-4" aria-hidden="true" />
      {!compact && <span>Admin</span>}
    </Link>
  )
}

function CartButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Giỏ hàng, ${count} món`}
      className="relative flex size-11 items-center justify-center rounded-full border bg-card transition-colors hover:border-primary hover:text-primary"
    >
      <ShoppingBag className="size-5" aria-hidden="true" />
      {count > 0 && (
        <span
          key={count}
          className="absolute -right-1 -top-1 flex min-w-5 animate-in zoom-in-50 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold leading-5 text-primary-foreground ring-2 ring-card"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </button>
  )
}

function AuthButton({ onClick, userName, loading }: { onClick: () => void; userName?: string; loading: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="flex h-11 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-semibold text-background transition-opacity hover:opacity-90"
    >
      <UserRound className="size-4" aria-hidden="true" />
      <span className="hidden max-w-36 truncate sm:inline">{loading ? "Đang kiểm tra..." : userName ?? "Đăng nhập"}</span>
      <span className="sr-only sm:hidden">{loading ? "Đang kiểm tra..." : userName ?? "Đăng nhập"}</span>
    </button>
  )
}
