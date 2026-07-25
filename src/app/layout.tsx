import { RootProviders } from "@/app/providers";
import { SkipToContent } from "@/components/marketing/skip-to-content";
import { baseMetadata } from "@/lib/metadata";
import { AppMotionConfig } from "@/lib/motion/config";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";

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
    <html lang="zh-CN" data-scroll-behavior="smooth" suppressHydrationWarning>
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
      <body className="bg-background text-foreground min-h-screen font-sans antialiased">
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
