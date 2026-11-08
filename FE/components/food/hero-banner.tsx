import Image from "next/image"
import { BadgePercent, Clock, Truck } from "lucide-react"

export function HeroBanner() {
  return (
    <section aria-labelledby="hero-title" className="relative overflow-hidden rounded-3xl bg-foreground">
      <Image
        src="/images/hero.png"
        alt=""
        fill
        priority
        sizes="(min-width: 1280px) 1232px, 100vw"
        className="object-cover opacity-80"
      />
      <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/50 to-transparent" aria-hidden="true" />
      <div className="relative flex min-h-72 flex-col justify-center gap-4 p-6 text-white md:min-h-80 md:max-w-xl md:p-10">
        <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-bold uppercase tracking-wide">
          <BadgePercent className="size-3.5" aria-hidden="true" />
          Ưu đãi trưa nay
        </span>
        <h1 id="hero-title" className="text-balance text-3xl font-extrabold leading-tight md:text-5xl">
          Giảm 20% cho đơn đầu tiên
        </h1>
        <p className="text-pretty text-sm text-white/85 md:text-base">
          Nhập mã <strong className="rounded-md bg-white/15 px-1.5 py-0.5 font-mono text-white">FOODAI20</strong> khi
          thanh toán. Hoặc hỏi trợ lý AI để được gợi ý món hợp khẩu vị.
        </p>
        <ul className="flex flex-wrap gap-4 text-sm text-white/90">
          <li className="flex items-center gap-1.5">
            <Clock className="size-4" aria-hidden="true" /> Giao trong 25 phút
          </li>
          <li className="flex items-center gap-1.5">
            <Truck className="size-4" aria-hidden="true" /> Freeship đơn từ 150k
          </li>
        </ul>
        <a
          href="#popular"
          className="mt-1 inline-flex h-11 w-fit items-center rounded-full bg-primary px-6 text-sm font-bold text-primary-foreground transition-transform hover:scale-[1.03]"
        >
          Đặt món ngay
        </a>
      </div>
    </section>
  )
}
