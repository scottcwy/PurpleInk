// Shared prompt rule fragments used by both storyboard and chapter generation.
// Avoids duplicating the same constraints across multiple prompt files.

/**
 * Authenticity rule: instructs the LLM to use only real capture data
 * and never fabricate statistics, pricing, or partner names.
 */
export const AUTHENTICITY_RULE =
  "Use the product's REAL content from the capture data. NEVER fabricate statistics, pricing, or partner names."

/**
 * Output format suffix: tells the LLM not to wrap its response in
 * markdown code fences or add explanations.
 */
export const NO_MARKDOWN_SUFFIX = "No markdown, no code fences, no explanation."

/**
 * Ordered palette variable names used by both storyboard and chapter prompts.
 * Each entry: [cssVarName, semanticLabel]
 */
export const PALETTE_VARS: Array<[string, string]> = [
  ["fg", "foreground/text"],
  ["bg", "background"],
  ["accent", "brand accent"],
  ["accent-fg", "text on accent"],
  ["muted", "secondary text"],
  ["secondary", "secondary bg"],
  ["border", "borders"],
]
