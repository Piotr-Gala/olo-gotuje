import { cookies } from "next/headers";
import type { Language } from "./i18n";

export async function getLanguage(): Promise<Language> {
  return (await cookies()).get("olo-language")?.value === "pl" ? "pl" : "en";
}
