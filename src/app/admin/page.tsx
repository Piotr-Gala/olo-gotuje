import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { updateAccountApproval, updateAccountRole } from "./actions";
import { getLanguage } from "@/lib/language-server";
import { translate } from "@/lib/i18n";
import { LanguageToggle } from "@/components/LanguageToggle";

type SearchParams = Promise<{ status?: string }>;

export default async function AdminPage({ searchParams }: { searchParams: SearchParams }) {
  const language = await getLanguage();
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const supabase = await createClient();
  if (!supabase) redirect("/login");
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") redirect("/login");

  const { data: admin } = await supabase.from("profiles").select("role, is_approved").eq("id", userId).maybeSingle();
  if (admin?.role !== "admin" || !admin.is_approved) redirect("/");

  const [{ data: profiles, error }, params] = await Promise.all([
    supabase.from("profiles")
      .select("id, first_name, last_name, nickname, role, is_approved, is_primary_owner, created_at")
      .neq("id", userId)
      .order("created_at", { ascending: true }),
    searchParams,
  ]);
  const pendingCount = profiles?.filter((profile) => !profile.is_approved).length ?? 0;

  return <main className="admin-shell">
    <header className="admin-header">
      <Link className="brand" href="/">🍳 olo<span className="brand-accent">gotuje.</span></Link>
      <div className="admin-header-actions"><LanguageToggle/><Link className="button ghost" href="/">{t("backToBlog")}</Link></div>
    </header>
    <section className="admin-intro">
      <p className="eyebrow">{t("adminSettings")}</p>
      <h1>{t("familyAccounts")}</h1>
      <p>{t("adminHelp")}</p>
      <div className="admin-count">{t("pendingAccounts")} <strong>{pendingCount}</strong></div>
    </section>
    {params.status === "updated" && <p className="form-success" role="status">{t("updated")}</p>}
    {params.status === "error" && <p className="form-error" role="alert">{t("updateFailed")}</p>}
    {error && <p className="form-error" role="alert">{t("accountsLoadFailed")}</p>}
    {!error && profiles?.length === 0 && <p className="admin-empty">{t("noAccounts")}</p>}
    <div className="account-list">
      {(profiles ?? []).map((profile) => {
        const name = [profile.first_name, profile.last_name].filter(Boolean).join(" ") || profile.nickname || "Bez nazwy";
        return <article className="account-card" key={profile.id}>
          <div className="account-card-main">
            <div>
              <h2>{name}</h2>
              {profile.nickname && profile.nickname !== name && <p>{t("nicknamePrefix")} {profile.nickname}</p>}
            </div>
            <span className={`account-status ${profile.is_approved ? "is-approved" : "is-pending"}`}>
              {profile.is_approved ? t("approved") : t("awaiting")}
            </span>
          </div>
          <div className="account-card-actions">
            {profile.is_primary_owner ? <span className="role-pill">{t("protectedOwner")}</span> : <>
              <form action={updateAccountApproval.bind(null, profile.id)}>
                <input type="hidden" name="approved" value={String(!profile.is_approved)} />
                <button className={`button ${profile.is_approved ? "ghost" : "orange"}`}>
                  {profile.is_approved ? t("pauseAccess") : t("approveAccount")}
                </button>
              </form>
              <form className="role-form" action={updateAccountRole.bind(null, profile.id)}>
              <label>{t("role")}<select name="role" defaultValue={profile.role}>
                <option value="member">{t("member")}</option>
                <option value="admin">{t("administrator")}</option>
                <option value="owner">{t("owner")}</option>
              </select></label>
              <button className="button ghost">{t("saveRole")}</button>
              </form>
            </>}
          </div>
        </article>;
      })}
    </div>
  </main>;
}
