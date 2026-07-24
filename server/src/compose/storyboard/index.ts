// Storyboard module: LLM-driven storyboard generation + validation + HTML rendering.
export { generateStoryboard } from "./generate"
export { validateStoryboard } from "./validate"
export { buildStoryboardPrompt } from "./prompts"
export { storyboardToChapters } from "./to-html"
export type { Storyboard, StoryboardShot, StoryboardMeta, LayerSpec } from "./types"
