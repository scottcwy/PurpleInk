import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";

export async function writeBundle(bundle, outputDirectory) {
  const root = resolve(outputDirectory);
  for (const [relativePath, file] of Object.entries(bundle.files)) {
    const target = resolve(root, relativePath);
    if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error(`bundle path escapes output directory: ${relativePath}`);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.encoding === "base64" ? Buffer.from(file.content, "base64") : file.content);
  }
}
