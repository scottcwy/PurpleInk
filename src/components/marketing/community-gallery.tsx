"use client";

import { Dialog } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import type { CommunityFilm } from "@/features/community/catalog";
import { cn } from "@/lib/utils";
import { ArrowUpRight, Play, X } from "lucide-react";
import Image from "next/image";
import {
  useEffect,
  useState,
  type ReactNode,
  type SyntheticEvent,
} from "react";

const placementClasses: Record<CommunityFilm["placement"], string> = {
  featured: "lg:col-span-8",
  portrait: "mx-auto w-[78%] sm:w-full lg:col-span-4 lg:row-span-2 lg:w-full",
  standard: "lg:col-span-4",
};

function previewEnabled(): boolean {
  return window.matchMedia(
    "(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)"
  ).matches;
}

function FilmCard({
  film,
  onSelect,
}: {
  film: CommunityFilm;
  onSelect: () => void;
}): ReactNode {
  const [previewing, setPreviewing] = useState(false);

  function startPreview(event: SyntheticEvent<HTMLButtonElement>) {
    if (!previewEnabled()) return;
    const video = event.currentTarget.querySelector("video");
    if (!video) return;
    setPreviewing(true);
    void video.play().catch(() => setPreviewing(false));
  }

  function stopPreview(event: SyntheticEvent<HTMLButtonElement>) {
    const video = event.currentTarget.querySelector("video");
    if (video) {
      video.pause();
      video.currentTime = 0;
    }
    setPreviewing(false);
  }

  return (
    <article className="h-full min-w-0">
      <button
        type="button"
        className={cn(
          "group flex w-full flex-col overflow-hidden rounded-lg border border-white/10 bg-black text-left shadow-[0_18px_50px_rgba(10,10,20,0.14)]",
          film.orientation === "portrait" ? "lg:h-full" : "h-full"
        )}
        aria-label={`播放《${film.title}》`}
        data-film={film.slug}
        onMouseEnter={startPreview}
        onMouseLeave={stopPreview}
        onFocus={startPreview}
        onBlur={stopPreview}
        onClick={onSelect}
      >
        <span
          className={cn(
            "relative block w-full overflow-hidden",
            film.orientation === "portrait"
              ? "aspect-[9/16] lg:aspect-auto lg:min-h-0 lg:flex-1"
              : "aspect-video"
          )}
        >
          <Image
            src={film.posterSrc}
            alt=""
            fill
            loading={film.placement === "featured" ? "eager" : "lazy"}
            sizes={
              film.orientation === "portrait"
                ? "(min-width: 1024px) 33vw, 78vw"
                : film.placement === "featured"
                  ? "(min-width: 1024px) 66vw, 100vw"
                  : "(min-width: 1024px) 33vw, 100vw"
            }
            className={cn(
              "object-cover transition duration-slow ease-standard group-hover:scale-[1.015]",
              previewing && "opacity-0"
            )}
          />
          <video
            className={cn(
              "pointer-events-none absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-narrative ease-standard",
              previewing && "opacity-100"
            )}
            src={film.videoSrc}
            poster={film.posterSrc}
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
          />
          <span className="absolute top-4 left-4 rounded-sm border border-white/20 bg-black/45 px-2 py-1 font-mono text-[10px] text-white backdrop-blur-md">
            {film.category}
          </span>
          <span className="absolute top-4 right-4 flex size-10 items-center justify-center rounded-full bg-white text-black transition-transform duration-narrative ease-standard group-hover:scale-110">
            <Play className="size-4 fill-current" aria-hidden="true" />
          </span>
        </span>
        <span className="flex min-h-20 w-full items-end justify-between gap-4 border-t border-white/10 p-4 text-white">
          <span className="min-w-0">
            <span className="block text-base font-semibold sm:text-lg">
              {film.title}
            </span>
            <span className="mt-1 hidden max-w-lg text-xs leading-5 text-white/55 sm:line-clamp-1">
              {film.description}
            </span>
          </span>
          <span className="shrink-0 font-mono text-xs text-white/70">
            {film.duration}
          </span>
        </span>
      </button>
    </article>
  );
}

export function CommunityGallery({
  films,
}: {
  films: readonly CommunityFilm[];
}): ReactNode {
  const [selected, setSelected] = useState<CommunityFilm>();

  useEffect(() => {
    if (!selected) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelected(undefined);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [selected]);

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-12">
        {films.map((film) => (
          <div key={film.slug} className={placementClasses[film.placement]}>
            <FilmCard film={film} onSelect={() => setSelected(film)} />
          </div>
        ))}
      </div>

      <Dialog
        open={Boolean(selected)}
        onClose={() => setSelected(undefined)}
        title={selected?.title}
        description={
          <span className="text-white/60">{selected?.description}</span>
        }
        className="relative w-[1120px] gap-4 bg-[#09090c] p-4 text-white sm:p-5"
      >
        <IconButton
          icon={X}
          type="button"
          aria-label="关闭播放器"
          className="absolute top-4 right-4 z-10 border-white/15 bg-black/45 text-white hover:bg-black/70 hover:text-white"
          onClick={() => setSelected(undefined)}
        />
        {selected ? (
          <video
            key={selected.slug}
            src={selected.videoSrc}
            poster={selected.posterSrc}
            controls
            autoPlay
            playsInline
            className={cn(
              "w-full rounded-md bg-black object-contain",
              selected.orientation === "portrait"
                ? "mx-auto max-h-[72vh] w-auto"
                : "aspect-video"
            )}
          />
        ) : null}
        <div className="flex items-center justify-between gap-4 font-mono text-[11px] text-white/55">
          <span>{selected?.category}</span>
          <span className="inline-flex items-center gap-1.5">
            FULL FILM <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </span>
        </div>
      </Dialog>
    </>
  );
}
