import { redirect } from "next/navigation";
import { FamilyBlog } from "@/components/FamilyBlog";
import { createClient } from "@/lib/supabase/server";
import { getLanguage } from "@/lib/language-server";
import { translate } from "@/lib/i18n";
import { LogoutButton } from "@/components/LogoutButton";

export default async function Home() {
  const language = await getLanguage();
  const supabase = await createClient();
  if (!supabase) return <SetupNotice language={language} />;

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");
  const userId = claims.claims.sub as string;
  const { data: profile, error: profileError } = await supabase.from("profiles").select("display_name, role, is_approved").eq("id", userId).maybeSingle();
  if (profileError || !profile) return <LoadError language={language} />;
  if (!profile.is_approved) return <PendingAccess language={language} />;

  const [sectionResult, postResult, familyProfileResult] = await Promise.all([
    supabase.from("sections").select("slug, title, is_active, sort_order").order("sort_order"),
    supabase.from("posts").select("id, section_slug, author_id, author_name, title, slug, excerpt, content, metadata, status, published_at, created_at, post_images(id, storage_path, alt_text, sort_order)").order("created_at", { ascending: false }),
    supabase.from("family_profiles").select("id, display_name"),
  ]);
  if (sectionResult.error || postResult.error || familyProfileResult.error) return <LoadError language={language} />;

  return <FamilyBlog
    user={{ id: userId, name: familyProfileResult.data?.find((familyProfile) => familyProfile.id === userId)?.display_name || profile.display_name || "Użytkownik", role: profile.role }}
    sections={sectionResult.data ?? []}
    posts={postResult.data ?? []}
    familyProfiles={familyProfileResult.data ?? []}
  />;
}

function SetupNotice({ language }: { language: "pl" | "en" }) {
  const en = language === "en";
  return <main className="gate"><div className="gate-card"><div className="brand-symbol">🍳</div><p className="eyebrow">Olo Gotuje</p><h1>{translate(language, "setupTitle")}</h1><p>{en ? "The family site is ready, but it still needs a Supabase project. Add the server configuration, then apply the database migration." : "Panel rodzinny jest gotowy, ale trzeba podłączyć projekt Supabase. Uzupełnij konfigurację serwera, a potem zastosuj migrację bazy."}</p></div></main>;
}

function PendingAccess({ language }: { language: "pl" | "en" }) {
  return <main className="gate"><div className="gate-card"><div className="brand-symbol">⏳</div><p className="eyebrow">Olo Gotuje</p><h1>{translate(language, "pendingTitle")}</h1><p>{translate(language, "pendingText")}</p><a className="button" href="/">{translate(language, "refreshStatus")}</a><LogoutButton language={language}/></div></main>;
}

function LoadError({ language }: { language: "pl" | "en" }) {
  return <main className="gate"><div className="gate-card"><div className="brand-symbol">⚠️</div><p className="eyebrow">Olo Gotuje</p><h1>{translate(language, "blogLoadFailed")}</h1><p role="alert">{translate(language, "blogLoadHelp")}</p><a className="button" href="/">{translate(language, "tryAgain")}</a><LogoutButton language={language}/></div></main>;
}
