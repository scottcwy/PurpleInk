import { RootProviders } from "@/app/providers";
import { SkipToContent } from "@/components/marketing/skip-to-content";
import { baseMetadata } from "@/lib/metadata";
import { AppMotionConfig } from "@/lib/motion/config";
import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

// `geist` 内部使用 next/font/local，自托管字体避免构建期访问 Google Fonts。
// 导出的变量名仍是 --font-geist-sans / --font-geist-mono，globals 契约不变。

export const metadata: Metadata = baseMetadata;

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  viewportFit: "cover",
  colorScheme: "light dark",
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
