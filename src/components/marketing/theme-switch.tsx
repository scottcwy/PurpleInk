"use client";

import { Moon, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { useThemeMode } from "@/lib/hooks/use-theme-mode";

export function ThemeSwitch(): ReactNode {
  const { hydrated, setTheme, resolvedTheme } = useThemeMode();

  const toggleTheme = (): void => {
    setTheme(resolvedTheme === "dark" ? "light" : "dark");
  };

  if (!hydrated) {
    return (
      <div className="fixed bottom-6 right-6 z-50">
        <button
          className="w-12 h-12 rounded-full bg-foreground/10 opacity-30 cursor-not-allowed"
          aria-label="Toggle theme"
          disabled
        />
      </div>
    );
  }

  const isDark = resolvedTheme === "dark";

  return (
    <div className="fixed bottom-6 right-6 z-50">
      <button
        onClick={toggleTheme}
        className="w-10 h-10 cursor-pointer rounded-full bg-muted text-foreground flex items-center justify-center opacity-30 hover:opacity-100 transition-opacity duration-narrative shadow-lg hover:shadow-xl"
        aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
        aria-pressed={isDark}
        type="button"
      >
        {isDark ? (
          <Sun className="w-5 h-5" aria-hidden="true" />
        ) : (
          <Moon className="w-5 h-5" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
