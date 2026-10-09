"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "./preferences";

export function ThemeToggle() {
  const [theme, setTheme] = useTheme();
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="inline-flex size-8 items-center justify-center rounded-md text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === "dark" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
    </button>
  );
}
