// standalone 产物卫生门禁（防回归）
//
// 背景：Turbopack 对仓库根的动态文件访问无法静态裁剪，会把整个仓库 trace 进
// `.next/standalone`（实测 277M：videos/51M、docs/9.6M、deploy/reverse-proxy/secrets/
// 的 Basic Auth 真实凭据全在）。next.config.ts 的 outputFileTracingExcludes 只对
// 路由 entry 生效，instrumentation 等非路由入口的 nft 不受控（Next 16 机制限制），
// 所以两道防线：
//   1. Dockerfile.web 白名单 COPY（主防线：镜像只收 server.js/package.json/
//      node_modules/.next/public/assets，其他任何顶层条目都进不了镜像）；
//   2. 本脚本：默认报错模式（CI/本地检查）；`--prune` 模式在镜像构建期
//      build 完成后物理清理 standalone 顶层，保证构建器目录本身也干净。
//
// 用法：
//   pnpm build && node scripts/verify/standalone-hygiene.mjs          # 检查
//   pnpm build && node scripts/verify/standalone-hygiene.mjs --prune  # 清理
import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

const PRUNE = process.argv.includes("--prune");

// standalone 顶层白名单：真实运行只需要这些条目（assets 为硬字幕字体，
// 与 Dockerfile.web 的源 COPY 一致）。
const ALLOWED_TOP = new Set(["server.js", "package.json", "node_modules", ".next", "public", "assets"]);
// 敏感文件名模式：任何层级出现即失败（.env*、secret、credential、pem、明文口令）。
const SENSITIVE = [/\.env/i, /secret/i, /credential/i, /\.pem$/i, /plaintext/i];

const root = path.resolve(".next/standalone");
let entries;
try {
  entries = await readdir(root);
} catch {
  console.error("[standalone-hygiene] 缺少 .next/standalone，先运行 pnpm build");
  process.exit(1);
}

const violations = [];
for (const entry of entries) {
  if (!ALLOWED_TOP.has(entry)) {
    if (PRUNE) {
      await rm(path.join(root, entry), { recursive: true, force: true });
      console.log(`[standalone-hygiene] prune: ${entry}`);
    } else {
      violations.push(`顶层非白名单条目: ${entry}`);
    }
  }
}

// 递归扫描白名单内目录中的敏感文件（node_modules 跳过，体积大且由锁文件管控）。
async function scanSensitive(dir) {
  for (const entry of await readdir(dir)) {
    const full = path.join(dir, entry);
    const st = await stat(full);
    if (st.isDirectory()) {
      if (entry === "node_modules") continue;
      await scanSensitive(full);
      continue;
    }
    if (SENSITIVE.some((re) => re.test(entry))) {
      violations.push(`敏感文件: ${path.relative(root, full)}`);
    }
  }
}
await scanSensitive(root);

if (violations.length) {
  console.error("[standalone-hygiene] standalone 产物不干净：");
  for (const v of violations) console.error("  -", v);
  process.exit(1);
}
const remaining = await readdir(root);
console.log(`[standalone-hygiene] ${PRUNE ? "prune 完成" : "干净"}：顶层仅 ${[...ALLOWED_TOP].join(", ")}，共 ${remaining.length} 个条目`);
