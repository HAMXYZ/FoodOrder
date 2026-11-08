"use client"

import { useEffect, useState } from "react"
import { CheckCircle2 } from "lucide-react"
import type { CategoryId, Food } from "@/lib/menu-data"
import type { MenuCategory } from "@/lib/menu-api"
import { AiChatWidget } from "./ai-chat-widget"
import { AuthModal } from "@/components/food/AuthModal"
import { FoodDetailModal } from "@/components/food/food-detail-modal"
import { OrderTrackingModal } from "@/components/food/order-tracking-modal"
import { AppProvider, useApp } from "./app-state"
import { CartDrawer } from "./cart-drawer"
import { CategoryGrid } from "./category-grid"
import { HeroBanner } from "./hero-banner"
import { PopularDishes } from "./popular-dishes"
import { ReorderRow } from "./reorder-row"
import { SiteHeader } from "./site-header"
import { AuthProvider, useAuth } from "./auth-state"
import { AccountModal } from "./account-modal"

type Dish = Food
type FoodAppProps = {
  foods: Food[]; categories: MenuCategory[]; menuError: string | null
}

export function FoodApp(props: FoodAppProps) {
  return <AuthProvider><FoodAppContent {...props} /></AuthProvider>
}

function FoodAppContent({ foods, categories, menuError }: FoodAppProps) {
  const { user: currentUser, loading: authLoading } = useAuth()
  const [selectedDish, setSelectedDish] = useState<Dish | null>(null)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [isTrackingOpen, setIsTrackingOpen] = useState(false)
  const [isAccountOpen, setIsAccountOpen] = useState(false)
  const [demoCheckout, setDemoCheckout] = useState(false)

  useEffect(() => { if (!currentUser) setIsAccountOpen(false) }, [currentUser])

  return (
    <AppProvider selectedFood={selectedDish} onSelectedFoodChange={setSelectedDish}
      foods={foods} categories={categories} menuError={menuError}>
      <SiteHeader onAuthClick={() => currentUser ? setIsAccountOpen(true) : setIsAuthOpen(true)}
        currentUser={currentUser} authLoading={authLoading}
        onTrackClick={() => { setDemoCheckout(false); setIsTrackingOpen(true) }} />
      <HomeContent />
      <FoodDetailModal />
      <CartDrawer
        onOrderPlaced={() => {
          setDemoCheckout(true)
          setIsTrackingOpen(true)
        }}
      />
      <AiChatWidget />
      <Toast />
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
      />
      <AccountModal isOpen={isAccountOpen} onClose={() => setIsAccountOpen(false)} />
      <OrderTrackingModal
        isOpen={isTrackingOpen}
        onClose={() => setIsTrackingOpen(false)}
        demoCheckout={demoCheckout}
        onRequestLogin={() => { setIsTrackingOpen(false); setIsAuthOpen(true) }}
      />
    </AppProvider>
  )
}

function HomeContent() {
  const [category, setCategory] = useState<CategoryId | null>(null)
  const { menuError } = useApp()
  const { notice, clearNotice, refreshUser } = useAuth()
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-10 px-4 pb-28 pt-5 md:px-6 md:pt-8">
      <HeroBanner />
      {notice && <div role="status" className="rounded-2xl border bg-muted p-4">
        <p>{notice}</p>
        <button type="button" onClick={() => { void refreshUser() }} className="mr-4 mt-2 font-semibold underline">Kiểm tra lại phiên</button>
        <button type="button" onClick={clearNotice} className="mt-2 underline">Đóng thông báo</button>
      </div>}
      {menuError && (
        <div role="alert" className="rounded-2xl border border-destructive/30 bg-destructive/10 p-4">
          <p>{menuError}</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-2 font-semibold underline">Thử lại</button>
        </div>
      )}
      <ReorderRow />
      <CategoryGrid active={category} onChange={setCategory} />
      <PopularDishes category={category} onClearCategory={() => setCategory(null)} />
    </main>
  )
}

function Toast() {
  const { toast } = useApp()
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 top-20 z-[60] flex justify-center px-4">
      {toast && (
        <p className="flex animate-in slide-in-from-top-2 fade-in items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-xl">
          <CheckCircle2 className="size-4 text-success" aria-hidden="true" />
          {toast}
        </p>
      )}
    </div>
  )
}
