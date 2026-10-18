import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LanguageProvider } from "@/components/LanguageProvider";
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
  const language = (await cookies()).get("olo-language")?.value === "pl" ? "pl" : "en";
  return (
    <html lang={language}>
      <body><LanguageProvider initialLanguage={language}>{children}</LanguageProvider></body>
    </html>
  );
}
