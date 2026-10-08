"use client"

import Image from "next/image"
import { useEffect, useRef, useState } from "react"
import { Bot, Flame, Leaf, MessageCircle, Plus, SendHorizontal, Sparkles, X } from "lucide-react"
import { FOODS, formatVND, type Food } from "@/lib/menu-data"
import { cn } from "@/lib/utils"
import { useApp } from "./app-state"

type Message = { id: number; role: "bot" | "user"; text: string; foods?: Food[] }

const QUICK_REPLIES = ["Cơm trưa <50k", "Món chay", "Món bán chạy", "Đồ uống mát lạnh", "Ít calo"]

function normalize(text: string) {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
}

function buildReply(input: string): Omit<Message, "id" | "role"> {
  const q = normalize(input)
  const drinks = (f: Food) => f.toppingGroup === "drink"

  if (q.includes("chay") || q.includes("vegan")) {
    return {
      text: "Đây là những món chay thanh đạm, nhiều rau và đạm thực vật mà mình gợi ý cho bạn:",
      foods: FOODS.filter((f) => f.vegetarian && !drinks(f)),
    }
  }
  if (q.includes("50k") || q.includes("re") || q.includes("trua")) {
    return {
      text: "Bữa trưa ngon dưới 50.000đ, vừa no vừa tiết kiệm nè:",
      foods: FOODS.filter((f) => f.price < 50000 && !drinks(f)),
    }
  }
  if (q.includes("uong") || q.includes("tra") || q.includes("mat")) {
    return { text: "Giải nhiệt ngay với mấy ly này nhé:", foods: FOODS.filter(drinks) }
  }
  if (q.includes("calo") || q.includes("giam can") || q.includes("healthy")) {
    return {
      text: "Các món dưới 500 kcal, nhẹ bụng mà vẫn ngon:",
      foods: FOODS.filter((f) => f.calories < 500).sort((a, b) => a.calories - b.calories),
    }
  }
  if (q.includes("bun") || q.includes("pho") || q.includes("nuoc")) {
    return { text: "Mấy món nước nóng hổi đang được yêu thích:", foods: FOODS.filter((f) => f.categories.includes("bun")) }
  }
  if (q.includes("ban chay") || q.includes("hot") || q.includes("goi y") || q.includes("an gi")) {
    return { text: "Top món bán chạy nhất hôm nay:", foods: FOODS.filter((f) => f.bestseller).slice(0, 4) }
  }
  const matched = FOODS.filter((f) => normalize(f.name).split(" ").some((w) => w.length > 2 && q.includes(w)))
  if (matched.length) return { text: "Mình tìm thấy mấy món này cho bạn:", foods: matched }
  return {
    text: "Mình chưa hiểu lắm. Bạn có thể hỏi về món chay, cơm trưa dưới 50k, đồ uống hoặc món ít calo nhé!",
  }
}

export function AiChatWidget() {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState("")
  const [typing, setTyping] = useState(false)
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 0,
      role: "bot",
      text: "Xin chào! Mình là FoodAI. Hôm nay bạn muốn ăn gì? Chọn gợi ý bên dưới hoặc nhắn cho mình nhé.",
    },
  ])
  const nextId = useRef(1)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }, [messages, typing, open])

  const send = (text: string) => {
    const trimmed = text.trim()
    if (!trimmed || typing) return
    setMessages((prev) => [...prev, { id: nextId.current++, role: "user", text: trimmed }])
    setInput("")
    setTyping(true)
    setTimeout(() => {
      setMessages((prev) => [...prev, { id: nextId.current++, role: "bot", ...buildReply(trimmed) }])
      setTyping(false)
    }, 700)
  }

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 md:bottom-6 md:right-6">
      {open && (
        <section
          id="ai-chat"
          aria-label="Trợ lý đặt món AI"
          className="flex h-[min(600px,calc(100dvh-7rem))] w-[calc(100vw-2rem)] max-w-sm animate-in slide-in-from-bottom-4 fade-in flex-col overflow-hidden rounded-3xl border bg-card shadow-2xl duration-200"
        >
          <div className="flex items-center gap-3 bg-primary px-4 py-3 text-primary-foreground">
            <span className="flex size-10 items-center justify-center rounded-full bg-white/20">
              <Bot className="size-5" aria-hidden="true" />
            </span>
            <div className="flex flex-1 flex-col leading-tight">
              <span className="font-bold">Trợ lý FoodAI</span>
              <span className="flex items-center gap-1.5 text-xs text-white/85">
                <span className="size-2 rounded-full bg-success ring-2 ring-white/40" aria-hidden="true" />
                Đang trực tuyến
              </span>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Thu nhỏ trợ lý"
              className="flex size-8 items-center justify-center rounded-full hover:bg-white/20"
            >
              <X className="size-5" aria-hidden="true" />
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto bg-background p-4" aria-live="polite">
            {messages.map((m) => (
              <ChatBubble key={m.id} message={m} />
            ))}
            {typing && (
              <div className="flex w-fit items-center gap-1 rounded-2xl rounded-bl-md bg-card px-4 py-3 shadow-sm">
                <span className="sr-only">FoodAI đang trả lời</span>
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="size-2 animate-bounce rounded-full bg-muted-foreground/60"
                    style={{ animationDelay: `${i * 150}ms` }}
                    aria-hidden="true"
                  />
                ))}
              </div>
            )}
            <div ref={endRef} />
          </div>

          <div className="flex flex-col gap-2 border-t bg-card p-3">
            <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1">
              {QUICK_REPLIES.map((chip) => (
                <button
                  key={chip}
                  type="button"
                  onClick={() => send(chip)}
                  className="flex shrink-0 items-center gap-1 rounded-full border border-primary/30 bg-accent px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground"
                >
                  {chip === "Món chay" && <Leaf className="size-3" aria-hidden="true" />}
                  {chip}
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                send(input)
              }}
              className="flex items-center gap-2"
            >
              <label htmlFor="chat-input" className="sr-only">
                Nhắn tin cho trợ lý
              </label>
              <input
                id="chat-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.nativeEvent.isComposing || e.keyCode === 229)) e.preventDefault()
                }}
                placeholder="Hỏi FoodAI: hôm nay ăn gì?"
                className="h-11 min-w-0 flex-1 rounded-full border bg-muted/50 px-4 text-sm outline-none focus:border-primary focus:bg-card focus:ring-4 focus:ring-primary/15"
              />
              <button
                type="submit"
                disabled={!input.trim() || typing}
                aria-label="Gửi"
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
              >
                <SendHorizontal className="size-5" aria-hidden="true" />
              </button>
            </form>
          </div>
        </section>
      )}

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="ai-chat"
        aria-label={open ? "Đóng trợ lý AI" : "Mở trợ lý AI"}
        className="group relative flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl shadow-primary/40 transition-transform hover:scale-105 active:scale-95"
      >
        {!open && <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" aria-hidden="true" />}
        {open ? (
          <X className="relative size-6" aria-hidden="true" />
        ) : (
          <>
            <MessageCircle className="relative size-6" aria-hidden="true" />
            <Sparkles className="absolute right-2.5 top-2.5 size-3.5" aria-hidden="true" />
          </>
        )}
      </button>
    </div>
  )
}

function ChatBubble({ message }: { message: Message }) {
  const isUser = message.role === "user"
  return (
    <div className={cn("flex flex-col gap-2", isUser ? "items-end" : "items-start")}>
      <p
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed shadow-sm",
          isUser ? "rounded-br-md bg-primary text-primary-foreground" : "rounded-bl-md bg-card",
        )}
      >
        {message.text}
      </p>
      {message.foods && message.foods.length > 0 && (
        <ul className="flex w-full flex-col gap-2">
          {message.foods.map((food) => (
            <li key={food.id}>
              <ChatFoodCard food={food} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ChatFoodCard({ food }: { food: Food }) {
  const { addToCart, openFood } = useApp()
  return (
    <div className="flex items-center gap-3 rounded-2xl border bg-card p-2 shadow-sm">
      <button type="button" onClick={() => openFood(food)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Image src={food.image} alt={food.name} width={56} height={56} loading="eager" className="size-14 shrink-0 rounded-xl object-cover" />
        <span className="flex min-w-0 flex-col">
          <span className="truncate text-sm font-semibold">{food.name}</span>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="flex items-center gap-0.5">
              <Flame className="size-3 text-primary" aria-hidden="true" />
              {food.calories} kcal
            </span>
            {food.vegetarian && <span className="font-semibold text-success">Chay</span>}
          </span>
          <span className="text-sm font-bold text-primary">{formatVND(food.price)}</span>
        </span>
      </button>
      <button
        type="button"
        onClick={() => addToCart(food)}
        className="flex shrink-0 items-center gap-1 rounded-full bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:opacity-90"
      >
        <Plus className="size-3.5" aria-hidden="true" />
        Thêm vào giỏ
      </button>
    </div>
  )
}
