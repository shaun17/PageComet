import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Wenren — 软件工程师与独立开发者",
  description: "Wenren 的个人网站，收录职业经历、独立作品与日常记录。",
};

// 根布局统一设置中文语义、站点字体与页面元信息。
const RootLayout = ({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) => (
  <html lang="zh-CN">
    <body className={`${geistSans.variable} ${geistMono.variable}`}>
      {children}
    </body>
  </html>
);

export default RootLayout;
