import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./foodorder.css";

export const metadata: Metadata = {
  title: "FoodAI Order - Đặt món ngon, giao nhanh",
  description:
    "Đặt cơm, bún, phở, trà sữa và món chay. Gợi ý món ăn theo sở thích của bạn.",
  icons: {
    icon: [
      { url: "/icon-light-32x32.png", media: "(prefers-color-scheme: light)" },
      { url: "/icon-dark-32x32.png", media: "(prefers-color-scheme: dark)" },
      { url: "/icon.svg", type: "image/svg+xml" },
    ],
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  colorScheme: "light",
  themeColor: "#E85D04",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="vi">
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
