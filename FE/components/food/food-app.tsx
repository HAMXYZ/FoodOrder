"use client"

import { useState } from "react"
import { CheckCircle2 } from "lucide-react"
import type { CategoryId, Food } from "@/lib/menu-data"
import { AiChatWidget } from "./ai-chat-widget"
import { AuthModal } from "@/components/food/AuthModal"
import { FoodDetailModal } from "@/components/food/food-detail-modal"
import { OrderTrackingModal, type OrderTrackingDetails } from "@/components/food/order-tracking-modal"
import { AppProvider, useApp } from "./app-state"
import { CartDrawer } from "./cart-drawer"
import { CategoryGrid } from "./category-grid"
import { HeroBanner } from "./hero-banner"
import { PopularDishes } from "./popular-dishes"
import { ReorderRow } from "./reorder-row"
import { SiteHeader } from "./site-header"

type Dish = Food
type CurrentUser = { name: string; email: string; role: "admin" | "customer" }

export function FoodApp() {
  const [selectedDish, setSelectedDish] = useState<Dish | null>(null)
  const [isAuthOpen, setIsAuthOpen] = useState(false)
  const [isTrackingOpen, setIsTrackingOpen] = useState(false)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [currentOrder, setCurrentOrder] = useState<OrderTrackingDetails | null>(null)

  return (
    <AppProvider selectedFood={selectedDish} onSelectedFoodChange={setSelectedDish}>
      <SiteHeader onAuthClick={() => setIsAuthOpen(true)} currentUser={currentUser} />
      <HomeContent />
      <FoodDetailModal />
      <CartDrawer
        onOrderPlaced={(order) => {
          setCurrentOrder(order)
          setIsTrackingOpen(true)
        }}
      />
      <AiChatWidget />
      <Toast />
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onLoginSuccess={(user) => setCurrentUser({ ...user, role: "customer" })}
      />
      <OrderTrackingModal
        isOpen={isTrackingOpen}
        onClose={() => setIsTrackingOpen(false)}
        order={currentOrder ?? undefined}
      />
    </AppProvider>
  )
}

function HomeContent() {
  const [category, setCategory] = useState<CategoryId | null>(null)
  return (
    <main className="mx-auto flex max-w-7xl flex-col gap-10 px-4 pb-28 pt-5 md:px-6 md:pt-8">
      <HeroBanner />
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
