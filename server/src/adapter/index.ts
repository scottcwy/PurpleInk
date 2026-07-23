// Capture 适配器公共入口。
// 用法：
//   import { runCaptureAdapter } from "./adapter"
//   const manifest = await runCaptureAdapter(input, { outDir: "videos/xxx/capture" })
export { runCaptureAdapter } from "./write-capture"
export { buildTokens, serializeTokens } from "./build-tokens"
export { buildVisibleText } from "./build-visible-text"
export { describeAssets } from "./describe-assets"
export type {
  AdapterInput,
  AdapterOptions,
  AdapterManifest,
  PageTokens,
  StepSnapshot,
  WrittenAsset,
} from "./types"
