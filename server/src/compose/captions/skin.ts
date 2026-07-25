// Caption skin HTML generation.
// Produces a <template>-wrapped sub-composition for caption rendering.
// Includes bottom-centered caption container, semi-transparent background,
// white text, and GSAP-driven fade in/out.

/** Options for caption skin customization */
export interface CaptionSkinOptions {
  fontSize?: string // default: "1.2rem"
  fontFamily?: string // default: "inherit"
  backgroundColor?: string // default: "rgba(0,0,0,0.7)"
  textColor?: string // default: "#ffffff"
  padding?: string // default: "0.5em 1em"
  borderRadius?: string // default: "0.25em"
}

/**
 * Generate caption skin HTML.
 * Returns a <template>-wrapped sub-composition containing:
 * - Bottom-centered caption container
 * - 83% preserve area (bottom 17% for captions)
 * - Semi-transparent background + white text
 * - GSAP-driven fade in/out
 */
export function generateCaptionSkin(options?: CaptionSkinOptions): string {
  const opts = {
    fontSize: options?.fontSize ?? "1.2rem",
    fontFamily: options?.fontFamily ?? "inherit",
    backgroundColor: options?.backgroundColor ?? "rgba(0,0,0,0.7)",
    textColor: options?.textColor ?? "#ffffff",
    padding: options?.padding ?? "0.5em 1em",
    borderRadius: options?.borderRadius ?? "0.25em",
  }

  return `<template id="caption-skin-template">
  <div data-composition-id="caption-skin" data-width="1920" data-height="1080">
    <style>
      .caption-container {
        position: absolute;
        bottom: 8%;
        left: 50%;
        transform: translateX(-50%);
        max-width: 80%;
        z-index: 100;
        pointer-events: none;
      }
      .caption-line {
        display: inline-block;
        background: ${opts.backgroundColor};
        color: ${opts.textColor};
        font-family: ${opts.fontFamily};
        font-size: ${opts.fontSize};
        padding: ${opts.padding};
        border-radius: ${opts.borderRadius};
        line-height: 1.4;
        text-align: center;
        opacity: 0;
        max-width: 100%;
        word-wrap: break-word;
      }
    </style>
    <div class="caption-container">
      <!-- Caption lines are dynamically inserted here -->
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      var captionTl = gsap.timeline({ paused: true });
      window.__timelines["captions"] = captionTl;
    </script>
  </div>
</template>`
}

/** Default caption-skin.html content */
export const DEFAULT_CAPTION_SKIN = generateCaptionSkin()
