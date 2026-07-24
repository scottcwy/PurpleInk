import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import LoginPage from "@/app/login/page";
import SignupPage from "@/app/signup/page";
import DashboardPage from "@/app/dashboard/page";
import ProductsPage from "@/app/products/page";
import ReleasesPage from "@/app/releases/page";

describe("authentication route shells", () => {
  it("renders an accessible login form", () => {
    const html = renderToStaticMarkup(<LoginPage />);

    expect(html).toContain("Welcome back");
    expect(html).toContain('name="email"');
    expect(html).toContain('name="password"');
    expect(html).toContain('href="/signup"');
  });

  it("renders workspace signup fields", () => {
    const html = renderToStaticMarkup(<SignupPage />);

    expect(html).toContain("Create your workspace");
    expect(html).toContain('name="name"');
    expect(html).toContain('name="workspaceName"');
    expect(html).toContain('href="/login"');
  });
});

describe("control-plane route shells", () => {
  it.each([
    [DashboardPage, "What are you launching?", "Workspace service required"],
    [
      ProductsPage,
      "Which product belongs in your library?",
      "Product service required",
    ],
    [ReleasesPage, "What are you releasing?", "Release service required"],
  ])("renders shared navigation for %s", (Page, title, emptyState) => {
    const html = renderToStaticMarkup(<Page />);

    expect(html).toContain(title);
    expect(html).toContain(emptyState);
    expect(html).toContain('href="/dashboard"');
    expect(html).toContain('href="/products"');
    expect(html).toContain('href="/releases"');
    expect(html).toContain("Workspace");
  });
});
