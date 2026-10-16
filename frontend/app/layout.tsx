import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP } from "next/font/google";
import "./globals.css";

// 日本語フォントは文字数が多く、先読みすると重いので preload しない(ビルド時に取り込んで自分のサーバーから配信する)
const notoSansJp = Noto_Sans_JP({
  weight: ["400", "500", "700", "800"],
  preload: false,
  variable: "--font-noto-sans-jp",
});

export const metadata: Metadata = {
  title: "収支管理",
  description: "カンバン式の個人向け収支管理アプリ",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ja" className={notoSansJp.variable}>
      <body>{children}</body>
    </html>
  );
}
