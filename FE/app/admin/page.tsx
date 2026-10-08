"use client"

import Image from "next/image"
import Link from "next/link"
import { useMemo, useState, type FormEvent } from "react"
import {
  ArrowLeft,
  ArrowUpRight,
  Bike,
  Check,
  ChefHat,
  ClipboardList,
  Clock3,
  LayoutDashboard,
  Menu,
  Pencil,
  Plus,
  Search,
  ShoppingBag,
  Star,
  TrendingUp,
  Utensils,
  X,
  Trash2,
} from "lucide-react"
import { CATEGORIES, FOODS, formatVND, type CategoryId, type Food } from "@/lib/menu-data"

type AdminSection = "dashboard" | "menu" | "orders"
type OrderStatus = "Mới" | "Đang nấu" | "Đang giao"

type AdminOrder = {
  id: string
  customer: string
  items: string
  total: number
  time: string
  status: OrderStatus
}

const INITIAL_ORDERS: AdminOrder[] = [
  {
    id: "HD-88308",
    customer: "Nguyễn Minh Anh",
    items: "Cơm tấm sườn bì chả × 2",
    total: 110_000,
    time: "Vừa xong",
    status: "Mới",
  },
  {
    id: "HD-88307",
    customer: "Trần Hoàng Nam",
    items: "Bún bò Huế đặc biệt × 1, Trà đào cam sả × 1",
    total: 94_000,
    time: "3 phút trước",
    status: "Đang nấu",
  },
  {
    id: "HD-88306",
    customer: "Lê Ngọc Hà",
    items: "Phở bò tái nạm × 1",
    total: 65_000,
    time: "8 phút trước",
    status: "Đang giao",
  },
  {
    id: "HD-88305",
    customer: "Phạm Đức Long",
    items: "Bánh mì thịt nướng × 2, Trà sữa trân châu × 1",
    total: 89_000,
    time: "14 phút trước",
    status: "Đang giao",
  },
]

const NAV_ITEMS: { id: AdminSection; label: string; icon: typeof LayoutDashboard }[] = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "menu", label: "Quản lý Thực đơn", icon: Utensils },
  { id: "orders", label: "Quản lý Đơn hàng", icon: ClipboardList },
]

const ORDER_STATUS_STYLES: Record<OrderStatus, string> = {
  Mới: "bg-amber-100 text-amber-800",
  "Đang nấu": "bg-sky-100 text-sky-800",
  "Đang giao": "bg-emerald-100 text-emerald-800",
}

export default function AdminPage() {
  const [section, setSection] = useState<AdminSection>("dashboard")
  const [foods, setFoods] = useState<Food[]>(() => [...FOODS])
  const [inStock, setInStock] = useState<Record<string, boolean>>(
    () => Object.fromEntries(FOODS.map((food) => [food.id, true])),
  )
  const [orders, setOrders] = useState<AdminOrder[]>(INITIAL_ORDERS)
  const [search, setSearch] = useState("")
  const [editingFood, setEditingFood] = useState<Food | null>(null)
  const [isCreatingFood, setIsCreatingFood] = useState(false)
  const [deletingFood, setDeletingFood] = useState<Food | null>(null)
  const [notice, setNotice] = useState("")

  const filteredFoods = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("vi")
    if (!query) return foods
    return foods.filter((food) => food.name.toLocaleLowerCase("vi").includes(query))
  }, [foods, search])

  const openSection = (nextSection: AdminSection) => {
    setSection(nextSection)
    setNotice("")
  }

  const saveFood = (food: Food, isNew: boolean) => {
    if (isNew) {
      setFoods((current) => [food, ...current])
      setInStock((current) => ({ ...current, [food.id]: true }))
      setNotice(`Đã thêm món "${food.name}".`)
    } else {
      setFoods((current) => current.map((item) => (item.id === food.id ? food : item)))
      setNotice(`Đã cập nhật món "${food.name}".`)
    }
    setEditingFood(null)
    setIsCreatingFood(false)
  }

  const confirmDeleteFood = () => {
    if (!deletingFood) return
    setFoods((current) => current.filter((food) => food.id !== deletingFood.id))
    setInStock((current) => {
      const next = { ...current }
      delete next[deletingFood.id]
      return next
    })
    setNotice(`Đã xóa món "${deletingFood.name}".`)
    setDeletingFood(null)
  }

  const advanceOrder = (orderId: string) => {
    setOrders((current) =>
      current.map((order) => {
        if (order.id !== orderId) return order
        const nextStatus: Record<OrderStatus, OrderStatus> = {
          Mới: "Đang nấu",
          "Đang nấu": "Đang giao",
          "Đang giao": "Đang giao",
        }
        return { ...order, status: nextStatus[order.status] }
      }),
    )
  }

  const newOrdersCount = orders.filter((order) => order.status === "Mới").length
  const averageRating =
    foods.length > 0 ? foods.reduce((total, food) => total + food.rating, 0) / foods.length : 0

  return (
    <div className="min-h-screen bg-[#f7f8fa] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-20 items-center gap-3 border-b border-slate-100 px-6">
          <span className="flex size-10 items-center justify-center rounded-xl bg-[#E85D04] text-white">
            <ChefHat className="size-5" aria-hidden="true" />
          </span>
          <div>
            <p className="font-extrabold tracking-tight">FoodAI <span className="text-[#E85D04]">Order</span></p>
            <p className="text-xs text-slate-500">Trang quản trị</p>
          </div>
        </div>

        <nav aria-label="Điều hướng quản trị" className="flex-1 space-y-1 px-3 py-6">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const active = section === item.id
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => openSection(item.id)}
                aria-current={active ? "page" : undefined}
                className={`flex h-12 w-full items-center gap-3 rounded-xl px-4 text-left text-sm font-semibold transition ${
                  active
                    ? "bg-[#fff1e8] text-[#c44e00]"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`}
              >
                <Icon className="size-5" aria-hidden="true" />
                {item.label}
                {item.id === "orders" && newOrdersCount > 0 && (
                  <span className="ml-auto rounded-full bg-[#E85D04] px-2 py-0.5 text-xs font-bold text-white">
                    {newOrdersCount}
                  </span>
                )}
              </button>
            )
          })}
        </nav>

        <div className="border-t border-slate-100 p-4">
          <Link
            href="/"
            className="flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-slate-600 transition hover:bg-slate-50 hover:text-[#E85D04]"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Quay lại trang Khách hàng
          </Link>
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-7">
          <div className="flex items-center gap-3">
            <span className="flex size-9 items-center justify-center rounded-xl bg-[#E85D04] text-white lg:hidden">
              <ChefHat className="size-5" aria-hidden="true" />
            </span>
            <div>
              <p className="text-sm font-bold sm:text-base">Xin chào, Quản trị viên 👋</p>
              <p className="hidden text-xs text-slate-500 sm:block">Chúc bạn một ngày kinh doanh hiệu quả.</p>
            </div>
          </div>
          <Link
            href="/"
            className="inline-flex h-10 items-center gap-2 rounded-full border border-slate-200 px-3 text-xs font-semibold transition hover:border-[#E85D04] hover:text-[#E85D04] sm:px-4 sm:text-sm"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            <span className="hidden sm:inline">Trang Khách hàng</span>
            <span className="sm:hidden">Quay lại</span>
          </Link>
        </header>

        <main className="mx-auto max-w-7xl space-y-7 p-4 sm:p-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-[#E85D04]">FoodAI Order / Quản trị</p>
              <h1 className="mt-1 text-2xl font-extrabold tracking-tight sm:text-3xl">
                {section === "dashboard"
                  ? "Tổng quan"
                  : section === "menu"
                    ? "Quản lý thực đơn"
                    : "Quản lý đơn hàng"}
              </h1>
            </div>
            {section !== "dashboard" && (
              <button
                type="button"
                onClick={() => openSection("dashboard")}
                className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 transition hover:bg-white hover:text-slate-900 lg:hidden"
              >
                <Menu className="size-4" aria-hidden="true" />
                Dashboard
              </button>
            )}
          </div>

          <nav aria-label="Các mục quản trị" className="flex gap-2 overflow-x-auto lg:hidden">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openSection(item.id)}
                  aria-current={section === item.id ? "page" : undefined}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold ${
                    section === item.id
                      ? "bg-[#E85D04] text-white"
                      : "border border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  <Icon className="size-4" aria-hidden="true" />
                  {item.label}
                </button>
              )
            })}
          </nav>

          {notice && (
            <div role="status" className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-medium text-emerald-800">
              <Check className="size-4 shrink-0" aria-hidden="true" />
              {notice}
            </div>
          )}

          {section === "dashboard" && (
            <DashboardContent
              foods={foods}
              orders={orders}
              averageRating={averageRating}
              newOrdersCount={newOrdersCount}
              onNavigate={openSection}
              onAdvanceOrder={advanceOrder}
            />
          )}
          {section === "menu" && (
            <MenuContent
              foods={filteredFoods}
              totalCount={foods.length}
              inStock={inStock}
              search={search}
              onSearch={setSearch}
              onToggleStock={(foodId) =>
                setInStock((current) => ({ ...current, [foodId]: !current[foodId] }))
              }
              onCreate={() => setIsCreatingFood(true)}
              onEdit={setEditingFood}
              onDelete={setDeletingFood}
            />
          )}
          {section === "orders" && <OrdersContent orders={orders} onAdvanceOrder={advanceOrder} />}
        </main>
      </div>

      {(isCreatingFood || editingFood) && (
        <FoodEditor
          key={editingFood?.id ?? "new-food"}
          food={editingFood}
          onClose={() => {
            setEditingFood(null)
            setIsCreatingFood(false)
          }}
          onSave={(food) => saveFood(food, isCreatingFood)}
        />
      )}

      {deletingFood && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4">
          <section role="alertdialog" aria-modal="true" aria-labelledby="delete-food-title" className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl">
            <h2 id="delete-food-title" className="text-lg font-extrabold">Xóa món ăn?</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">
              Món “{deletingFood.name}” sẽ bị xóa khỏi danh sách thực đơn hiện tại.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setDeletingFood(null)} className="h-10 rounded-xl border px-4 text-sm font-semibold hover:bg-slate-50">
                Hủy
              </button>
              <button type="button" onClick={confirmDeleteFood} className="h-10 rounded-xl bg-red-600 px-4 text-sm font-bold text-white hover:bg-red-700">
                Xóa món
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}

function DashboardContent({
  foods,
  orders,
  averageRating,
  newOrdersCount,
  onNavigate,
  onAdvanceOrder,
}: {
  foods: Food[]
  orders: AdminOrder[]
  averageRating: number
  newOrdersCount: number
  onNavigate: (section: AdminSection) => void
  onAdvanceOrder: (orderId: string) => void
}) {
  const stats = [
    {
      label: "Doanh thu hôm nay",
      value: formatVND(2_850_000),
      change: "+12,8%",
      icon: TrendingUp,
      color: "bg-orange-50 text-[#E85D04]",
    },
    {
      label: "Đơn hàng mới",
      value: String(newOrdersCount).padStart(2, "0"),
      change: "Đang chờ xử lý",
      icon: ShoppingBag,
      color: "bg-sky-50 text-sky-600",
    },
    {
      label: "Số món ăn",
      value: String(foods.length).padStart(2, "0"),
      change: "Trong thực đơn",
      icon: Utensils,
      color: "bg-violet-50 text-violet-600",
    },
    {
      label: "Đánh giá trung bình",
      value: averageRating.toFixed(1),
      change: "Trên 5.0",
      icon: Star,
      color: "bg-amber-50 text-amber-600",
    },
  ]

  return (
    <>
      <section aria-label="Chỉ số kinh doanh" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((stat) => {
          const Icon = stat.icon
          return (
            <article key={stat.label} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-slate-500">{stat.label}</p>
                  <p className="mt-3 text-2xl font-extrabold tracking-tight">{stat.value}</p>
                  <p className="mt-2 flex items-center gap-1 text-xs font-semibold text-emerald-600">
                    {stat.label === "Doanh thu hôm nay" && <ArrowUpRight className="size-3.5" aria-hidden="true" />}
                    {stat.change}
                  </p>
                </div>
                <span className={`flex size-11 items-center justify-center rounded-xl ${stat.color}`}>
                  <Icon className="size-5" aria-hidden="true" />
                </span>
              </div>
            </article>
          )
        })}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
          <div>
            <h2 className="font-extrabold">Đơn hàng gần đây</h2>
            <p className="mt-1 text-xs text-slate-500">Theo dõi và cập nhật tiến độ xử lý đơn.</p>
          </div>
          <button type="button" onClick={() => onNavigate("orders")} className="text-sm font-bold text-[#E85D04] hover:underline">
            Xem tất cả
          </button>
        </div>
        <OrdersTable orders={orders.slice(0, 4)} onAdvanceOrder={onAdvanceOrder} compact />
      </section>

      <section className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm leading-relaxed text-amber-900">
        Số liệu doanh thu và đơn hàng mẫu để minh họa giao diện quản trị; trang chưa kết nối hệ thống backend hoặc nguồn dữ liệu trực tiếp.
      </section>
    </>
  )
}

function MenuContent({
  foods,
  totalCount,
  inStock,
  search,
  onSearch,
  onToggleStock,
  onCreate,
  onEdit,
  onDelete,
}: {
  foods: Food[]
  totalCount: number
  inStock: Record<string, boolean>
  search: string
  onSearch: (value: string) => void
  onToggleStock: (foodId: string) => void
  onCreate: () => void
  onEdit: (food: Food) => void
  onDelete: (food: Food) => void
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-col gap-4 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
        <div>
          <h2 className="font-extrabold">Danh sách món ăn</h2>
          <p className="mt-1 text-sm text-slate-500">{totalCount} món trong thực đơn</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative">
            <span className="sr-only">Tìm món ăn</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(event) => onSearch(event.target.value)}
              placeholder="Tìm món ăn..."
              className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-[#E85D04] focus:ring-4 focus:ring-[#E85D04]/10 sm:w-52"
            />
          </label>
          <button type="button" onClick={onCreate} className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-[#E85D04] px-4 text-sm font-bold text-white transition hover:bg-[#cf5200]">
            <Plus className="size-4" aria-hidden="true" />
            Thêm món mới
          </button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[850px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th scope="col" className="px-5 py-3 font-semibold">Món ăn</th>
              <th scope="col" className="px-4 py-3 font-semibold">Danh mục</th>
              <th scope="col" className="px-4 py-3 font-semibold">Giá bán</th>
              <th scope="col" className="px-4 py-3 font-semibold">Đánh giá</th>
              <th scope="col" className="px-4 py-3 font-semibold">Tình trạng</th>
              <th scope="col" className="px-4 py-3 text-right font-semibold">Thao tác</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {foods.map((food) => {
              const category = CATEGORIES.find((item) => food.categories.includes(item.id))
              const available = inStock[food.id] ?? true
              return (
                <tr key={food.id} className="transition hover:bg-slate-50/70">
                  <td className="px-5 py-3.5">
                    <div className="flex items-center gap-3">
                      <Image src={food.image} alt="" width={48} height={48} className="size-12 rounded-xl bg-slate-100 object-cover" />
                      <div className="max-w-64">
                        <p className="truncate font-bold text-slate-900">{food.name}</p>
                        <p className="mt-0.5 truncate text-xs text-slate-500">{food.description}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-slate-600">{category?.name ?? "Khác"}</td>
                  <td className="whitespace-nowrap px-4 py-3.5 font-bold">{formatVND(food.price)}</td>
                  <td className="px-4 py-3.5">
                    <span className="inline-flex items-center gap-1 font-semibold">
                      <Star className="size-3.5 fill-amber-400 text-amber-400" aria-hidden="true" />
                      {food.rating.toFixed(1)}
                    </span>
                  </td>
                  <td className="px-4 py-3.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={available}
                      aria-label={`${food.name}: ${available ? "Còn hàng" : "Hết hàng"}`}
                      onClick={() => onToggleStock(food.id)}
                      className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-bold transition ${
                        available ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      <span className={`size-2 rounded-full ${available ? "bg-emerald-500" : "bg-slate-400"}`} aria-hidden="true" />
                      {available ? "Còn hàng" : "Hết hàng"}
                    </button>
                  </td>
                  <td className="px-4 py-3.5">
                    <div className="flex justify-end gap-1">
                      <button type="button" onClick={() => onEdit(food)} aria-label={`Sửa ${food.name}`} className="flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-orange-50 hover:text-[#E85D04]">
                        <Pencil className="size-4" aria-hidden="true" />
                      </button>
                      <button type="button" onClick={() => onDelete(food)} aria-label={`Xóa ${food.name}`} className="flex size-9 items-center justify-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-600">
                        <Trash2 className="size-4" aria-hidden="true" />
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {foods.length === 0 && (
          <p className="px-5 py-12 text-center text-sm text-slate-500">
            {search ? "Không tìm thấy món ăn phù hợp." : "Chưa có món ăn trong thực đơn."}
          </p>
        )}
      </div>
    </section>
  )
}

function OrdersContent({
  orders,
  onAdvanceOrder,
}: {
  orders: AdminOrder[]
  onAdvanceOrder: (orderId: string) => void
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
        <div>
          <h2 className="font-extrabold">Xử lý đơn hàng</h2>
          <p className="mt-1 text-sm text-slate-500">{orders.length} đơn hàng đang hiển thị</p>
        </div>
        <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
          <span className="relative flex size-2">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
          </span>
          Đơn hàng gần đây
        </span>
      </div>
      <OrdersTable orders={orders} onAdvanceOrder={onAdvanceOrder} />
      <p className="border-t border-slate-100 px-5 py-3 text-xs text-slate-500">
        Danh sách minh họa hiện dùng dữ liệu mẫu trong trình duyệt; chưa kết nối API cập nhật đơn hàng trực tiếp.
      </p>
    </section>
  )
}

function OrdersTable({
  orders,
  onAdvanceOrder,
  compact = false,
}: {
  orders: AdminOrder[]
  onAdvanceOrder: (orderId: string) => void
  compact?: boolean
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[740px] text-left text-sm">
        <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
          <tr>
            <th scope="col" className="px-5 py-3 font-semibold">Mã đơn / Thời gian</th>
            <th scope="col" className="px-4 py-3 font-semibold">Khách hàng</th>
            <th scope="col" className="px-4 py-3 font-semibold">Món đã đặt</th>
            <th scope="col" className="px-4 py-3 font-semibold">Tổng tiền</th>
            <th scope="col" className="px-4 py-3 font-semibold">Trạng thái</th>
            <th scope="col" className="px-4 py-3 text-right font-semibold">Cập nhật</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {(compact ? orders.slice(0, 4) : orders).map((order) => (
            <tr key={order.id} className="hover:bg-slate-50/70">
              <td className="px-5 py-4">
                <p className="font-bold">{order.id}</p>
                <p className="mt-1 inline-flex items-center gap-1 text-xs text-slate-500">
                  <Clock3 className="size-3" aria-hidden="true" />
                  {order.time}
                </p>
              </td>
              <td className="px-4 py-4 font-medium">{order.customer}</td>
              <td className="max-w-64 px-4 py-4 text-slate-600">{order.items}</td>
              <td className="whitespace-nowrap px-4 py-4 font-bold">{formatVND(order.total)}</td>
              <td className="px-4 py-4">
                <span className={`whitespace-nowrap rounded-full px-2.5 py-1.5 text-xs font-bold ${ORDER_STATUS_STYLES[order.status]}`}>
                  {order.status}
                </span>
              </td>
              <td className="px-4 py-4 text-right">
                {order.status !== "Đang giao" ? (
                  <button
                    type="button"
                    onClick={() => onAdvanceOrder(order.id)}
                    className="whitespace-nowrap rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold transition hover:border-[#E85D04] hover:text-[#E85D04]"
                  >
                    {order.status === "Mới" ? "Nhận đơn" : "Bắt đầu giao"}
                  </button>
                ) : (
                  <span className="inline-flex items-center justify-end gap-1 text-xs font-semibold text-emerald-700">
                    <Bike className="size-4" aria-hidden="true" />
                    Đang giao
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {orders.length === 0 && <p className="px-5 py-12 text-center text-sm text-slate-500">Chưa có đơn hàng nào.</p>}
    </div>
  )
}

function FoodEditor({
  food,
  onClose,
  onSave,
}: {
  food: Food | null
  onClose: () => void
  onSave: (food: Food) => void
}) {
  const [selectedCategory, setSelectedCategory] = useState<CategoryId>(food?.categories[0] ?? "com")

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const formData = new FormData(event.currentTarget)
    const category = CATEGORIES.find((item) => item.id === selectedCategory) ?? CATEGORIES[0]
    const price = Number(formData.get("price"))
    const name = String(formData.get("name")).trim()
    const description = String(formData.get("description")).trim()

    onSave({
      id: food?.id ?? `food-${Date.now()}`,
      name,
      description,
      image: food?.image ?? category.image,
      price,
      ...(food?.originalPrice !== undefined ? { originalPrice: food.originalPrice } : {}),
      calories: food?.calories ?? 400,
      spiciness: food?.spiciness ?? 0,
      categories: [selectedCategory],
      vegetarian: food?.vegetarian,
      bestseller: food?.bestseller,
      rating: food?.rating ?? 5,
      sold: food?.sold ?? "0",
      toppingGroup: categoryToToppingGroup(selectedCategory),
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-950/50 p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="food-editor-title" className="my-auto w-full max-w-lg rounded-3xl bg-white p-6 shadow-2xl sm:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="food-editor-title" className="text-xl font-extrabold">{food ? "Sửa món ăn" : "Thêm món mới"}</h2>
            <p className="mt-1 text-sm text-slate-500">Thông tin sẽ được cập nhật trong phiên hiện tại.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Đóng" className="flex size-9 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100">
            <X className="size-5" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="food-name" className="mb-1.5 block text-sm font-semibold">Tên món ăn</label>
            <input id="food-name" name="name" required maxLength={100} defaultValue={food?.name ?? ""} placeholder="Ví dụ: Cơm gà xối mỡ" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#E85D04] focus:ring-4 focus:ring-[#E85D04]/10" />
          </div>
          <div>
            <label htmlFor="food-description" className="mb-1.5 block text-sm font-semibold">Mô tả</label>
            <textarea id="food-description" name="description" required maxLength={240} rows={3} defaultValue={food?.description ?? ""} placeholder="Mô tả ngắn về món ăn..." className="w-full resize-y rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none focus:border-[#E85D04] focus:ring-4 focus:ring-[#E85D04]/10" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="food-price" className="mb-1.5 block text-sm font-semibold">Giá bán (VND)</label>
              <input id="food-price" name="price" type="number" required min={1000} step={1000} defaultValue={food?.price ?? ""} placeholder="55000" className="h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-[#E85D04] focus:ring-4 focus:ring-[#E85D04]/10" />
            </div>
            <div>
              <label htmlFor="food-category" className="mb-1.5 block text-sm font-semibold">Danh mục</label>
              <select
                id="food-category"
                value={selectedCategory}
                onChange={(event) => {
                  const category = CATEGORIES.find((item) => item.id === event.target.value)
                  if (category) setSelectedCategory(category.id)
                }}
                className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm outline-none focus:border-[#E85D04] focus:ring-4 focus:ring-[#E85D04]/10"
              >
                {CATEGORIES.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold hover:bg-slate-50">Hủy</button>
            <button type="submit" className="h-11 rounded-xl bg-[#E85D04] px-5 text-sm font-bold text-white transition hover:bg-[#cf5200]">
              {food ? "Lưu thay đổi" : "Thêm món"}
            </button>
          </div>
        </form>
      </section>
    </div>
  )
}

function categoryToToppingGroup(category: CategoryId): Food["toppingGroup"] {
  switch (category) {
    case "com":
      return "rice"
    case "bun":
      return "noodle"
    case "banh-mi":
      return "bread"
    case "tra-sua":
    case "tra-trai-cay":
      return "drink"
    case "chay":
      return "veg"
  }
}
