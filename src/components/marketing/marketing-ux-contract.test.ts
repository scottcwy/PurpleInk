import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const readMarketingSource = (name: string) =>
  readFileSync(`src/components/marketing/${name}`, "utf8");

describe("marketing UX contracts", () => {
  it("renders actionable URL validation feedback in the launch composer", () => {
    const source = readMarketingSource("launch-composer.tsx");

    expect(source).toContain("noValidate");
    expect(source).toContain("required");
    expect(source).toMatch(
      /aria-describedby=\{message \? ["']product-url-error["'] : undefined\}/
    );
    expect(source).toContain("aria-invalid={Boolean(message)}");
    expect(source).toContain('id="product-url-error"');
    expect(source).toContain('role="alert"');
  });

  it("exposes launch quality and duration as named radio groups", () => {
    const source = readMarketingSource("launch-composer-support.tsx");

    expect(source.match(/role="radiogroup"/g)).toHaveLength(2);
    expect(source).toContain('role="radio"');
    expect(source).toContain("aria-checked={active}");
    expect(source).toContain('aria-label="视频质量"');
    expect(source).toContain('aria-label="视频时长"');
  });

  it("announces FAQ expansion and associates each answer panel", () => {
    const source = readMarketingSource("faq.tsx");

    expect(source).toContain("aria-expanded={isOpen}");
    expect(source).toContain("aria-controls={answerId}");
    expect(source).toContain("id={answerId}");
    expect(source).toContain("aria-labelledby={buttonId}");
    expect(source).toContain('role="region"');
  });

  it("does not publish placeholder marketing links", () => {
    const header = readMarketingSource("header.tsx");
    const footer = readMarketingSource("footer.tsx");
    const showcase = readMarketingSource("showcase-cards.tsx");
    const sources = [header, footer, showcase];

    for (const source of sources) {
      expect(source).not.toMatch(/href\s*[:=]\s*["']#["']/);
      expect(source).not.toMatch(/href\s*[:=]\s*["']["']/);
    }

    expect(header).toContain("mailto:support@purpleink.cn");
    expect(footer).toContain("mailto:support@purpleink.cn");
    expect(footer).toContain('label: "Community", href: "/community"');
  });
});
