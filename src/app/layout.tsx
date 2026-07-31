import { RootProviders } from "@/app/providers";
import { SkipToContent } from "@/components/marketing/skip-to-content";
import { baseMetadata } from "@/lib/metadata";
import { AppMotionConfig } from "@/lib/motion/config";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// 字体走 `geist` 包自托管（内部是 next/font/local），不用 next/font/google：
// 后者在 `next build` 期间必须访问 fonts.googleapis.com，Dockerfile 的 build
// 阶段一旦没有出网就整个构建失败，且失败信息只说「Failed to fetch Geist」。
// 两个包导出的 CSS 变量名与 --font-geist-sans / --font-geist-mono 完全一致
// （见 globals.css 的 --font-sans / --font-mono），所以样式契约不变。

export const metadata: Metadata = baseMetadata;

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>): ReactNode {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var mode = localStorage.getItem('theme-mode');
                if (mode === 'dark' || ((mode === 'system' || !mode) && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                  document.documentElement.classList.add('dark');
                }
              })();
            `,
          }}
        />
      </head>
      <body
        className={`${GeistSans.variable} ${GeistMono.variable} bg-background text-foreground min-h-screen font-sans antialiased`}
      >
        <AppMotionConfig>
          <RootProviders>
            <SkipToContent />
            {children}
          </RootProviders>
        </AppMotionConfig>
      </body>
    </html>
  );
}
