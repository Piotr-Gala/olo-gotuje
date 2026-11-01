import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LanguageProvider } from "@/components/LanguageProvider";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AdminRefresh } from "@/components/AdminRefresh";
import "./globals.css";

export const metadata: Metadata = {
  title: "Olo Gotuje — rodzinny blog",
  description: "Rodzinny blog Ola z przepisami i pomysłami z kuchni.",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
  },
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const cookieStore = await cookies();
  const language = cookieStore.get("olo-language")?.value === "pl" ? "pl" : "en";
  const theme = cookieStore.get("olo-theme")?.value === "dark" ? "dark" : "light";
  return (
    <html lang={language} data-theme={theme}>
      <body><LanguageProvider initialLanguage={language}><ThemeProvider initialTheme={theme}>{children}<AdminRefresh/></ThemeProvider></LanguageProvider></body>
    </html>
  );
}
