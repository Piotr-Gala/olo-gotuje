"use client";

import { useLanguage } from "./LanguageProvider";
import { translate } from "@/lib/i18n";
import { ThemeToggle } from "./ThemeToggle";

export function LanguageToggle() {
  const { language, setLanguage } = useLanguage();
  const nextLanguage = language === "pl" ? "en" : "pl";
  return <span className="display-controls"><button
    type="button"
    className="language-toggle"
    aria-label={translate(language, "changeLanguage")}
    onClick={() => setLanguage(nextLanguage)}
  >{nextLanguage.toUpperCase()}</button><ThemeToggle/></span>;
}
