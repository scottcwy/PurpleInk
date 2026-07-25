import { FAQ } from "@/components/marketing/faq";
import { Footer } from "@/components/marketing/footer";
import { Header } from "@/components/marketing/header";
import { Hero } from "@/components/marketing/hero";
import { ImageReveal } from "@/components/marketing/image-reveal";
import { ShowcaseCards } from "@/components/marketing/showcase-cards";
import { TextReveal } from "@/components/marketing/text-reveal";
import { ThemeSwitch } from "@/components/marketing/theme-switch";
import { ToolsCarousel } from "@/components/marketing/tools-carousel";
import { createMetadata } from "@/lib/metadata";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = createMetadata({
  title: "Launch your products with Purple Ink",
  description:
    "Turn verified product flows into reviewable, repeatable launch videos.",
  path: "/",
});

export default function HomePage(): ReactNode {
  return (
    <>
      <Header />
      <ThemeSwitch />
      <main id="main-content" className="flex-1">
        <Hero />

        {/* Text Reveal Section */}
        <section className="relative py-32 md:py-48">
          <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
            <TextReveal
              text="If you can dream it, you can prompt it into existence."
              className="text-foreground text-4xl font-medium tracking-tight sm:text-5xl md:text-6xl lg:text-7xl"
            />
          </div>
        </section>

        {/* Image Reveal Gallery */}
        <ImageReveal />

        {/* Tools Carousel */}
        <ToolsCarousel />

        {/* Showcase Cards */}
        <ShowcaseCards />

        {/* FAQ */}
        <FAQ />
      </main>

      <Footer />
    </>
  );
}
