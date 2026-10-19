import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLanguage } from "@/lib/language-server";
import { translate } from "@/lib/i18n";
import { LanguageToggle } from "@/components/LanguageToggle";
import { getCoverPosition } from "@/lib/image-processing";
import { PostVideo } from "@/components/PostVideo";
import { updateMyFamilyProfile } from "../actions";

type ProfilePageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ status?: string }>;
};

export default async function FamilyProfilePage({ params, searchParams }: ProfilePageProps) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) notFound();

  const language = await getLanguage();
  const t = (key: Parameters<typeof translate>[1], values?: Record<string, string | number>) => translate(language, key, values);
  const supabase = await createClient();
  if (!supabase) redirect("/login");
  const { data: claims } = await supabase.auth.getClaims();
  const viewerId = claims?.claims?.sub;
  if (typeof viewerId !== "string") redirect("/login");
  const { data: viewer } = await supabase.from("profiles").select("is_approved").eq("id", viewerId).maybeSingle();
  if (!viewer?.is_approved) redirect("/");

  const [{ data: profile }, { data: posts, error: postsError }] = await Promise.all([
    supabase.from("family_profiles").select("id, display_name, bio").eq("id", id).maybeSingle(),
    supabase.from("posts")
      .select("id, title, excerpt, content, created_at, metadata, post_images(id, storage_path, alt_text, sort_order)")
      .eq("author_id", id)
      .eq("status", "published")
      .order("created_at", { ascending: false }),
  ]);
  if (!profile) notFound();

  const photoPaths = (posts ?? []).flatMap((post) => post.post_images.map((photo) => photo.storage_path));
  const { data: signedPhotos } = photoPaths.length
    ? await supabase.storage.from("family-post-images").createSignedUrls(photoPaths, 3600)
    : { data: [] };
  const photoUrls = Object.fromEntries((signedPhotos ?? []).flatMap((photo) => photo.path && photo.signedUrl ? [[photo.path, photo.signedUrl]] : []));
  const initials = profile.display_name.split(/\s+/).slice(0, 2).map((part: string) => Array.from(part)[0] ?? "").join("").toLocaleUpperCase();
  const isOwnProfile = viewerId === id;

  return <main className="profile-shell">
    <header className="profile-nav">
      <Link className="brand" href="/">🍳 olo<span className="brand-accent">gotuje.</span></Link>
      <div className="profile-nav-actions"><LanguageToggle/><Link className="button ghost" href="/">{t("backToBlog")}</Link></div>
    </header>
    <section className="profile-heading">
      <div className="profile-avatar" aria-hidden="true">{initials || "🍳"}</div>
      <div className="profile-intro">
        <p className="eyebrow">{t("familyProfile")}</p>
        <h1>{profile.display_name}</h1>
        <p>{profile.bio || t("profileBioEmpty")}</p>
      </div>
      {isOwnProfile && <a className="button ghost" href="#edit-profile">{t("editProfile")}</a>}
    </section>

    {isOwnProfile && <section className="profile-edit" id="edit-profile">
      <div><p className="eyebrow">{t("profileSettings")}</p><h2>{t("editProfile")}</h2></div>
      {query.status === "updated" && <p className="form-success" role="status">{t("profileSaved")}</p>}
      {query.status === "error" && <p className="form-error" role="alert">{t("profileSaveFailed")}</p>}
      <form action={updateMyFamilyProfile} className="profile-form">
        <label>{t("nickname")}<input name="display_name" required maxLength={40} defaultValue={profile.display_name}/></label>
        <label>{t("profileBio")}<textarea name="bio" rows={3} maxLength={280} defaultValue={profile.bio}/></label>
        <small>{t("profileNicknameHint")}</small>
        <button className="button orange">{t("profileSave")}</button>
      </form>
    </section>}

    <section className="profile-posts">
      <div className="profile-posts-heading"><div><p className="eyebrow">{t("profilePostsEyebrow")}</p><h2>{t("profilePosts", { count: posts?.length ?? 0 })}</h2></div></div>
      {postsError && <p className="form-error" role="alert">{t("profilePostsFailed")}</p>}
      {!postsError && !posts?.length && <p className="profile-empty">{t("profileNoPosts")}</p>}
      <div className="profile-post-list">{(posts ?? []).map((post) => {
        const cover = post.post_images[0];
        const coverUrl = cover ? photoUrls[cover.storage_path] : null;
        const coverPosition = getCoverPosition(post.metadata);
        return <article className="profile-post card" key={post.id}>
          {coverUrl && <img className="profile-post-cover" src={coverUrl} alt={cover.alt_text || post.title} style={{ objectPosition: `${coverPosition.x ?? 50}% ${coverPosition.y ?? 50}%` }}/>}
          <div className="card-body"><p className="meta">{new Date(post.created_at).toLocaleDateString(language === "en" ? "en-US" : "pl-PL")}</p>
            <h3>{post.title}</h3>{post.excerpt && <p>{post.excerpt}</p>}
            <div className="profile-post-content">{post.content.split("\n").filter(Boolean).map((line: string, index: number) => <p key={index}>{line}</p>)}
              <PostVideo postId={post.id}/>{post.post_images.slice(1).map((photo) => photoUrls[photo.storage_path] && <img className="inline-post-image" key={photo.id} src={photoUrls[photo.storage_path]} alt={photo.alt_text || post.title}/>)}
            </div>
          </div>
        </article>;
      })}</div>
    </section>
  </main>;
}
