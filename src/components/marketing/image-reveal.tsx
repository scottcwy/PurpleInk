"use client";

import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
} from "motion/react";
import { useRef, useSyncExternalStore, type ReactNode } from "react";

interface RevealImage {
  src: string;
  alt: string;
}

interface ImageRevealProps {
  images?: RevealImage[];
  className?: string;
}

interface RevealOrigin {
  xPercent: number;
  scaleX: number;
  scaleY: number;
  transformOrigin: string;
  blur: number;
}

export const REVEAL_ORIGINS: readonly RevealOrigin[] = [
  {
    xPercent: -120,
    scaleX: 1.18,
    scaleY: 0.92,
    transformOrigin: "0% 50%",
    blur: 2,
  },
  {
    xPercent: 0,
    scaleX: 0.94,
    scaleY: 0.94,
    transformOrigin: "50% 50%",
    blur: 1,
  },
  {
    xPercent: 120,
    scaleX: 1.18,
    scaleY: 0.92,
    transformOrigin: "100% 50%",
    blur: 2,
  },
];

const defaultImages: RevealImage[] = Array.from({ length: 12 }, (_, index) => ({
  src: `/img/mock${index + 1}_compressed.webp`,
  alt: `PurpleInk launch video ${index + 1}`,
}));

const subscribeToHydration = () => () => {};

function revealProgress(value: number, reduced: boolean): number {
  return reduced ? 1 : value;
}

function RevealTile({
  image,
  origin,
}: {
  image: RevealImage;
  origin: RevealOrigin;
}): ReactNode {
  const itemRef = useRef<HTMLElement>(null);
  const prefersReducedMotion = useReducedMotion();
  const motionReady = useSyncExternalStore(
    subscribeToHydration,
    () => true,
    () => false,
  );
  const { scrollYProgress } = useScroll({
    target: itemRef,
    offset: ["start end", "end start"],
  });
  const progress = (value: number) =>
    revealProgress(value, motionReady && Boolean(prefersReducedMotion));
  const x = useTransform(
    scrollYProgress,
    (value) => `${origin.xPercent * (1 - progress(value))}%`,
  );
  const opacity = useTransform(scrollYProgress, progress);
  const scaleX = useTransform(
    scrollYProgress,
    (value) => origin.scaleX + (1 - origin.scaleX) * progress(value),
  );
  const scaleY = useTransform(
    scrollYProgress,
    (value) => origin.scaleY + (1 - origin.scaleY) * progress(value),
  );
  const filter = useTransform(
    scrollYProgress,
    (value) => `blur(${origin.blur * (1 - progress(value))}px)`,
  );

  return (
    <figure ref={itemRef} className="column__item">
      <motion.div
        className="column__item-imgwrap relative aspect-3/4 w-full overflow-hidden rounded-xl motion-reduce:transform-none! motion-reduce:opacity-100! motion-reduce:filter-none!"
        style={{
          x,
          opacity,
          scaleX,
          scaleY,
          filter,
          transformOrigin: origin.transformOrigin,
          willChange: "filter",
        }}
      >
        <div
          className="column__item-img h-full w-full bg-cover bg-center"
          style={{ backgroundImage: `url(${image.src})` }}
          role="img"
          aria-label={image.alt}
        />
        <div
          className="pointer-events-none absolute inset-0 mix-blend-color"
          style={{
            background: "linear-gradient(135deg, #333DA7 0%, #7388DF 100%)",
          }}
          aria-hidden="true"
        />
      </motion.div>
    </figure>
  );
}

export function ImageReveal({
  images = defaultImages,
  className = "",
}: ImageRevealProps): ReactNode {
  const columns: [RevealImage[], RevealImage[], RevealImage[]] = [[], [], []];
  images.forEach((image, index) => {
    columns[index % columns.length]!.push(image);
  });

  return (
    <section className={`-mt-24 overflow-hidden ${className}`}>
      <div className="columns mx-auto grid max-w-7xl grid-cols-2 gap-4 px-4 sm:px-6 md:grid-cols-3 md:gap-6 lg:gap-8 lg:px-8">
        {columns.map((column, columnIndex) => (
          <div
            key={columnIndex}
            className={`column flex-col gap-4 md:gap-6 lg:gap-8 ${
              columnIndex === columns.length - 1 ? "hidden md:flex" : "flex"
            }`}
          >
            {column.map((image) => (
              <RevealTile
                key={image.src}
                image={image}
                origin={REVEAL_ORIGINS[columnIndex]!}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
