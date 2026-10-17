import type { Metadata } from "next";
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pl">
      <body>{children}</body>
    </html>
  );
}
