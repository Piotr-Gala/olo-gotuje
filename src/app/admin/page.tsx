import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateAccountApproval, updateAccountRole } from "./actions";

type SearchParams = Promise<{ status?: string }>;

export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  const supabase = await createClient();
  if (!supabase) redirect("/login");
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") redirect("/login");

  const { data: admin } = await supabase.from("profiles").select("role, is_approved").eq("id", userId).maybeSingle();
  if (admin?.role !== "admin" || !admin.is_approved) redirect("/");

  const [{ data: profiles, error }, params] = await Promise.all([
    supabase.from("profiles")
      .select("id, first_name, last_name, nickname, role, is_approved, created_at")
      .neq("role", "owner")
      .order("created_at", { ascending: true }),
    searchParams,
  ]);
  const pendingCount = profiles?.filter((profile) => !profile.is_approved).length ?? 0;

  return <main className="admin-shell">
    <header className="admin-header">
      <Link className="brand" href="/">🍳 olo<span className="brand-accent">gotuje.</span></Link>
      <Link className="button ghost" href="/">Wróć do bloga</Link>
    </header>
    <section className="admin-intro">
      <p className="eyebrow">Ustawienia rodziny</p>
      <h1>Konta rodzinne</h1>
      <p>Zatwierdzaj dostęp i ustawiaj rolę. Oczekujące konta nie widzą wpisów.</p>
      <div className="admin-count">Oczekujące: <strong>{pendingCount}</strong></div>
    </section>
    {params.status === "updated" && <p className="form-success" role="status">Zmiany zapisane.</p>}
    {params.status === "error" && <p className="form-error" role="alert">Nie udało się zapisać zmian. Odśwież stronę i spróbuj ponownie.</p>}
    {error && <p className="form-error" role="alert">Nie udało się wczytać kont. Spróbuj ponownie później.</p>}
    {!error && profiles?.length === 0 && <p className="admin-empty">Nie ma jeszcze kont rodzinnych do wyświetlenia.</p>}
    <div className="account-list">
      {(profiles ?? []).map((profile) => {
        const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.nickname || "Bez nazwy";
        return <article className="account-card" key={profile.id}>
          <div className="account-card-main">
            <div>
              <h2>{name}</h2>
              {profile.nickname && profile.nickname !== name && <p>Nick: {profile.nickname}</p>}
            </div>
            <span className={`account-status ${profile.is_approved ? "is-approved" : "is-pending"}`}>
              {profile.is_approved ? "Zatwierdzone" : "Oczekuje"}
            </span>
          </div>
          <div className="account-card-actions">
            <form action={updateAccountApproval.bind(null, profile.id)}>
              <input type="hidden" name="approved" value={String(!profile.is_approved)} />
              <button className={`button ${profile.is_approved ? "ghost" : "orange"}`}>
                {profile.is_approved ? "Wstrzymaj dostęp" : "Zatwierdź konto"}
              </button>
            </form>
            <form className="role-form" action={updateAccountRole.bind(null, profile.id)}>
              <label>Rola<select name="role" defaultValue={profile.role === "admin" ? "admin" : "member"}>
                <option value="member">Członek rodziny</option>
                <option value="admin">Administrator</option>
              </select></label>
              <button className="button ghost">Zapisz rolę</button>
            </form>
          </div>
        </article>;
      })}
    </div>
  </main>;
}
