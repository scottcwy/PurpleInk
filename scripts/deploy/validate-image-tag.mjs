const IMMUTABLE_IMAGE_TAG = /^sha-[0-9a-f]{40}$/;

export function isImmutableImageTag(value) {
  return IMMUTABLE_IMAGE_TAG.test(value ?? "");
}

export function assertImmutableImageTag(value) {
  if (!isImmutableImageTag(value)) {
    throw new Error(
      "PURPLEINK_IMAGE_TAG must be sha- followed by 40 lowercase hex characters"
    );
  }
  return value;
}

if (
  process.argv[1] &&
  import.meta.url ===
    new URL(`file:///${process.argv[1].replaceAll("\\", "/")}`).href
) {
  try {
    const tag = assertImmutableImageTag(
      process.argv[2] ?? process.env.PURPLEINK_IMAGE_TAG
    );
    console.log(`[deploy] immutable image tag accepted: ${tag}`);
  } catch (error) {
    console.error(
      `[deploy] ${error instanceof Error ? error.message : "invalid image tag"}`
    );
    process.exitCode = 1;
  }
}
