import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLanguage } from "@/lib/language-server";
import { translate } from "@/lib/i18n";
import { LanguageToggle } from "@/components/LanguageToggle";
import { getCoverPosition } from "@/lib/image-processing";
import { updateMyFamilyProfile } from "../actions";
import { PasswordForm } from "@/components/PasswordForm";
import { ProfileAvatar } from "@/components/ProfileAvatar";
import { AvatarEditor } from "@/components/AvatarEditor";
import { fetchAllRows } from "@/lib/pagination";

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
  if (!viewer || (!viewer.is_approved && viewerId !== id)) redirect("/");

  const [{ data: profile }, { data: posts, error: postsError }] = await Promise.all([
    supabase.from("family_profiles").select("id, display_name, bio, avatar_path, avatar_x, avatar_y, avatar_zoom").eq("id", id).maybeSingle(),
    fetchAllRows((from, to) => supabase.from("posts")
      .select("id, title, excerpt, created_at, metadata, post_images(id, storage_path, alt_text, sort_order)")
      .eq("author_id", id)
      .eq("status", "published")
      .order("created_at", { ascending: false }).order("id")
      .order("sort_order", { referencedTable: "post_images" }).order("id", { referencedTable: "post_images" }).range(from, to)),
  ]);
  if (!profile) notFound();

  const photoPaths = (posts ?? []).flatMap((post) => post.post_images.map((photo) => photo.storage_path));
  const { data: signedPhotos } = photoPaths.length
    ? await supabase.storage.from("family-post-images").createSignedUrls(photoPaths, 3600)
    : { data: [] };
  const photoUrls = Object.fromEntries((signedPhotos ?? []).flatMap((photo) => photo.path && photo.signedUrl ? [[photo.path, photo.signedUrl]] : []));
  const { data: signedAvatar } = profile.avatar_path
    ? await supabase.storage.from("family-avatars").createSignedUrl(profile.avatar_path, 3600)
    : { data: null };
  const isOwnProfile = viewerId === id;

  return <main className="profile-shell">
    <header className="profile-nav">
      <Link className="brand" href="/">🍳 olo<span className="brand-accent">gotuje.</span></Link>
      <div className="profile-nav-actions"><LanguageToggle/><Link className="button ghost" href="/">{t("backToBlog")}</Link></div>
    </header>
    <section className="profile-heading">
      <ProfileAvatar url={signedAvatar?.signedUrl} name={profile.display_name} x={profile.avatar_x} y={profile.avatar_y} zoom={Number(profile.avatar_zoom)}/>
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
      {query.status === "nickname-taken" && <p className="form-error" role="alert">{t("nicknameTaken")}</p>}
      <form action={updateMyFamilyProfile} className="profile-form">
        <label>{t("nickname")}<input name="display_name" required maxLength={40} defaultValue={profile.display_name}/></label>
        <label>{t("profileBio")}<textarea name="bio" rows={3} maxLength={280} defaultValue={profile.bio}/></label>
        <small>{t("profileNicknameHint")}</small>
        <button className="button orange">{t("profileSave")}</button>
      </form>
    </section>}

    {isOwnProfile && <AvatarEditor userId={viewerId} name={profile.display_name} initialUrl={signedAvatar?.signedUrl ?? null} initialPath={profile.avatar_path} initialX={profile.avatar_x} initialY={profile.avatar_y} initialZoom={Number(profile.avatar_zoom)}/>}
    {isOwnProfile && <PasswordForm language={language}/>}

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
            <Link className="post-read-trigger" href={`/wpis/${post.id}`}>{t("readPost")}</Link>
          </div>
        </article>;
      })}</div>
    </section>
  </main>;
}
