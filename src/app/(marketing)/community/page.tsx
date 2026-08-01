import { CommunityGallery } from "@/components/marketing/community-gallery";
import { Footer } from "@/components/marketing/footer";
import { Header } from "@/components/marketing/header";
import { communityFilms } from "@/features/community/catalog";
import { createMetadata } from "@/lib/metadata";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = createMetadata({
  title: "Community films",
  description: "A selection of product stories made visible with PurpleInk.",
  path: "/community",
  image: "/img/community/ai-coding-workflow.webp",
});

export default function CommunityPage(): ReactNode {
  return (
    <>
      <Header />
      <main
        id="main-content"
        className="bg-background text-foreground min-h-screen px-4 pt-36 pb-24 sm:px-6 sm:pt-44 lg:px-8"
      >
        <section className="mx-auto max-w-7xl">
          <div className="border-border mb-14 grid gap-8 border-b pb-12 lg:grid-cols-12 lg:items-end">
            <div className="lg:col-span-8">
              <p className="text-muted-foreground font-mono text-xs">
                COMMUNITY / 04 FILMS
              </p>
              <h1 className="mt-5 max-w-4xl text-5xl leading-[0.95] font-medium sm:text-6xl lg:text-7xl">
                Community films
              </h1>
            </div>
            <p className="text-muted-foreground max-w-md text-base leading-7 lg:col-span-4 lg:justify-self-end">
              Product ideas told through interface, motion and evidence. A
              living selection of work made with PurpleInk.
            </p>
          </div>

          <CommunityGallery films={communityFilms} />
        </section>
      </main>
      <Footer />
    </>
  );
}
