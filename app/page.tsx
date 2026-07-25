import { FAQ } from "@/components/faq";
import { Footer } from "@/components/footer";
import { Header } from "@/components/header";
import { Hero } from "@/components/hero";
import { ImageReveal } from "@/components/image-reveal";
import { ShowcaseCards } from "@/components/showcase-cards";
import { TextReveal } from "@/components/text-reveal";
import { ThemeSwitch } from "@/components/theme-switch";
import { ToolsCarousel } from "@/components/tools-carousel";
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
