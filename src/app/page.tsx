import Link from "next/link";
import { redirect } from "next/navigation";
import { FamilyBlog } from "@/components/FamilyBlog";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  if (!supabase) return <SetupNotice />;

  const { data: claims } = await supabase.auth.getClaims();
  if (!claims?.claims?.sub) redirect("/login");
  const userId = claims.claims.sub as string;
  const { data: profile } = await supabase.from("profiles").select("display_name, role, is_approved").eq("id", userId).maybeSingle();
  if (!profile?.is_approved) return <PendingAccess />;

  const [sectionResult, postResult] = await Promise.all([
    supabase.from("sections").select("slug, title, is_active, sort_order").order("sort_order"),
    supabase.from("posts").select("id, section_slug, author_id, title, slug, excerpt, content, metadata, status, published_at, created_at, post_images(id, storage_path, alt_text, sort_order)").order("created_at", { ascending: false }),
  ]);

  return <FamilyBlog
    user={{ id: userId, name: profile.display_name || "Użytkownik", role: profile.role }}
    sections={sectionResult.data ?? []}
    posts={postResult.data ?? []}
  />;
}

function SetupNotice() {
  return <main className="gate"><div className="gate-card"><div className="brand-symbol">🍳</div><p className="eyebrow">Olo Gotuje</p><h1>Jeszcze chwila!</h1><p>Panel rodzinny jest gotowy, ale trzeba podłączyć projekt Supabase. Uzupełnij <code>.env.local</code> według <code>.env.example</code>, a potem zastosuj migrację bazy.</p></div></main>;
}

function PendingAccess() {
  return <main className="gate"><div className="gate-card"><div className="brand-symbol">⏳</div><p className="eyebrow">Olo Gotuje</p><h1>Dostęp czeka na zatwierdzenie</h1><p>Logowanie działa. Administrator musi jeszcze zatwierdzić dostęp do rodzinnej strony. Możesz wrócić później — konto pozostanie zalogowane.</p><Link className="button" href="/">Odśwież status</Link></div></main>;
}
