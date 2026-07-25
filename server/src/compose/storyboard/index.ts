// Storyboard module: LLM-driven storyboard generation + validation + HTML rendering.
export { generateStoryboard } from "./generate"
export { validateStoryboard, getHardErrors, getWarnings } from "./validate"
export { buildStoryboardPrompt } from "./prompts"
export { storyboardToChapters, storyboardToChapterPlans } from "./to-html"
export { serializeStoryboard } from "./serialize"
export type {
  Storyboard,
  StoryboardShot,
  StoryboardMeta,
  LayerSpec,
  TransitionType,
} from "./types"
