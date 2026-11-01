"use client";

import { useTheme } from "./ThemeProvider";
import { useLanguage } from "./LanguageProvider";
import { translate } from "@/lib/i18n";

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const { language } = useLanguage();
  const label = translate(language, theme === "light" ? "switchToDark" : "switchToLight");
  return <button className="language-toggle theme-toggle" type="button" onClick={toggleTheme} aria-label={label} title={label}>
    <span aria-hidden="true">{theme === "light" ? "☾" : "☀"}</span> {translate(language, theme === "light" ? "darkTheme" : "lightTheme")}
  </button>;
}
