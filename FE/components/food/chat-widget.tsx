"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Bot, MessageCircle, Send, Sparkles, X } from "lucide-react";
import { request, money, type Dish } from "@/lib/api";

type Message = { role: "user" | "assistant"; content: string; items?: Dish[] };
type Status = { conversational_ai: boolean; description: string };
type Reply = {
  reply: string;
  items: Dish[];
  personalized: boolean;
  mode: string;
};
const prompts = [
  "Chào bạn, mình chưa biết ăn gì",
  "Giới thiệu phở bò tái nạm",
  "2 phần phở gà bao nhiêu tiền?",
  "Combo 2 người tối đa 100k",
  "Món chay dưới 50k",
];

export function ChatWidget({
  token,
  openDish,
  add,
}: {
  token: string;
  openDish: (dish: Dish) => void;
  add: (dish: Dish) => void;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scrollEnd = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pending = useRef(false);

  useEffect(() => {
    if (open) {
      request<Status>("/api/assistant/status", "")
        .then((result) => {
          setStatus(result);
          setError("");
        })
        .catch(() =>
          setError("Chưa kết nối được trợ lý. Bạn thử lại sau nhé."),
        );
      inputRef.current?.focus();
    }
  }, [open]);
  useEffect(() => {
    if (open)
      scrollEnd.current?.scrollIntoView({
        behavior: "smooth",
        block: "nearest",
      });
  }, [messages, busy, open]);

  async function send(content: string) {
    const value = content.trim();
    if (!value || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    setInput("");
    const next: Message[] = [...messages, { role: "user", content: value }];
    setMessages(next);
    try {
      const result = await request<Reply>(
        "/api/assistant/chat",
        token,
        "POST",
        {
          message: value,
          history: messages.slice(-12).map(({ role, content }) => ({
            role,
            content: content.slice(0, 1500),
          })),
        },
      );
      setMessages([
        ...next,
        { role: "assistant", content: result.reply, items: result.items },
      ]);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Chưa nhận được trả lời. Vui lòng thử lại.",
      );
      setInput(value);
    } finally {
      setBusy(false);
      pending.current = false;
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    void send(input);
  }

  return (
    <div className="fo-chat-widget">
      {open && (
        <section
          className="fo-chat-panel"
          role="region"
          aria-label="Trợ lý chọn món FoodAI"
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
          }}
        >
          <header className="fo-chat-head">
            <div className="fo-chat-avatar">
              <Bot size={25} />
            </div>
            <div>
              <h2>Trợ lý FoodAI</h2>
              <p>
                {status?.conversational_ai
                  ? "AI hội thoại · Hiểu thực đơn cửa hàng"
                  : "Tìm món theo khẩu vị và ngân sách"}
              </p>
            </div>
            <button aria-label="Đóng chat" onClick={() => setOpen(false)}>
              <X size={20} />
            </button>
          </header>
          <div className="fo-chat-mode">
            <Sparkles size={14} />
            <span>
              {status?.conversational_ai
                ? "AI tư vấn dựa trên thực đơn đang còn bán."
                : "Chế độ gợi ý thực đơn. AI hội thoại chưa được bật."}
            </span>
          </div>
          <div
            className="fo-chat-messages"
            role="log"
            aria-live="polite"
            aria-relevant="additions"
          >
            <div className="fo-chat-message assistant">
              <p>
                Chào bạn, mình là trợ lý FoodAI! Hôm nay bạn muốn ăn một bữa no
                hay ăn nhẹ? Cứ cho mình biết ngân sách và khẩu vị nhé. Bạn cũng
                có thể hỏi về từng món, size/topping, tính tiền nhiều phần hoặc
                nhờ mình so sánh để dễ chọn hơn.
                {!token &&
                  " Đăng nhập để mình kết hợp gợi ý theo sở thích riêng của bạn."}
              </p>
            </div>
            {messages.map((message, index) => (
              <div key={index} className={`fo-chat-message ${message.role}`}>
                <p>{message.content}</p>
                {message.items && message.items.length > 0 && (
                  <div className="fo-chat-dishes">
                    {message.items.map((dish) => (
                      <article key={dish.id}>
                        <button
                          className="fo-chat-dish-info"
                          onClick={() => {
                            setOpen(false);
                            openDish(dish);
                          }}
                        >
                          <img src={dish.image_url} alt={dish.name} />
                          <span>
                            <strong>{dish.name}</strong>
                            <small>{money(dish.base_price)} · Còn bán</small>
                            {dish.demo_rating_source === "sample" &&
                              dish.demo_rating != null && (
                                <small>
                                  ★ {dish.demo_rating.toFixed(1)}/5 ·{" "}
                                  {dish.demo_review_count} lượt · Đánh giá mẫu
                                </small>
                              )}
                          </span>
                        </button>
                        <button
                          className="fo-chat-add"
                          aria-label={`Thêm từ chat: ${dish.name}`}
                          disabled={!dish.is_available}
                          onClick={() => {
                            setOpen(false);
                            add(dish);
                          }}
                        >
                          +
                        </button>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {busy && (
              <div
                className="fo-chat-message assistant fo-chat-typing"
                role="status"
              >
                <span /> <span /> <span /> Đang tìm món phù hợp…
              </div>
            )}
            <div ref={scrollEnd} />
          </div>
          <div className="fo-chat-prompts">
            {prompts.map((prompt) => (
              <button
                key={prompt}
                disabled={busy}
                onClick={() => void send(prompt)}
              >
                {prompt}
              </button>
            ))}
          </div>
          {error && (
            <div className="fo-chat-error" role="alert">
              {error}
            </div>
          )}
          <form className="fo-chat-input" onSubmit={submit}>
            <input
              ref={inputRef}
              aria-label="Tin nhắn cho trợ lý"
              placeholder="Hỏi giá, nguyên liệu hoặc combo…"
              maxLength={1500}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoComplete="off"
            />
            <button aria-label="Gửi tin nhắn" disabled={busy || !input.trim()}>
              <Send size={18} />
            </button>
          </form>
          <p className="fo-chat-footnote">
            Giá và tình trạng món được kiểm tra lại khi đặt hàng.
          </p>
        </section>
      )}
      <button
        className="fo-chat-launcher"
        aria-label={open ? "Thu gọn trợ lý" : "Mở chat tư vấn món ăn"}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X size={22} /> : <MessageCircle size={23} />}
        <span>{open ? "Thu gọn" : "Hỏi trợ lý chọn món"}</span>
        {!open && <span className="fo-chat-dot" />}
      </button>
    </div>
  );
}
