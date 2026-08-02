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
      /aria-describedby=\{message \? ["']product-url-error["'] : undefined\}/,
    );
    expect(source).toContain("aria-invalid={Boolean(message)}");
    expect(source).toContain('id="product-url-error"');
    expect(source).toContain('role="alert"');
  });

  it("labels launch quality and duration button groups", () => {
    const source = readMarketingSource("launch-composer-support.tsx");

    expect(source.match(/role="group"/g)).toHaveLength(2);
    expect(source).toContain('aria-label="视频质量"');
    expect(source).toContain('aria-label="视频时长"');
    expect(source).toContain("aria-pressed={active}");
    expect(source).toContain("min-h-11");
    expect(source).not.toContain('role="radiogroup"');
    expect(source).not.toContain('role="radio"');
  });

  it("announces FAQ expansion and associates each answer panel", () => {
    const source = readMarketingSource("faq.tsx");

    expect(source).toContain("aria-expanded={isOpen}");
    expect(source).toContain("aria-controls={answerId}");
    expect(source).toContain("id={answerId}");
    expect(source).toContain("aria-labelledby={buttonId}");
    expect(source).toContain('role="region"');
    expect(source).toContain("<h2");
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
    expect(header).toContain("h-11 w-11");
    expect(footer).toContain("mailto:support@purpleink.cn");
    expect(footer).toContain('label: "Community", href: "/community"');
    expect(showcase).toContain('href="/community"');
    expect(showcase).toContain("View community films");
  });
});
