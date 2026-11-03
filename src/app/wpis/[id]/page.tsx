import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getLanguage } from "@/lib/language-server";
import { sectionName, translate } from "@/lib/i18n";
import { getCoverPosition } from "@/lib/image-processing";
import { LanguageToggle } from "@/components/LanguageToggle";
import { PostVideo } from "@/components/PostVideo";
import { PostLike } from "@/components/PostLike";
import { PostComments } from "@/components/PostComments";
import { fetchAllRows } from "@/lib/pagination";

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const language = await getLanguage();
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const supabase = await createClient();
  if (!supabase) redirect("/login");
  const { data: claims } = await supabase.auth.getClaims();
  const userId = claims?.claims?.sub;
  if (typeof userId !== "string") redirect("/login");
  const { data: viewer, error: viewerError } = await supabase.from("profiles").select("is_approved, role").eq("id", userId).maybeSingle();
  if (viewerError) throw viewerError;
  if (!viewer?.is_approved) redirect("/");

  // Use the viewer's session so RLS also protects direct links to drafts and hidden sections.
  const { data: post, error } = await supabase.from("posts")
    .select("id, section_slug, author_id, author_name, title, excerpt, content, status, created_at, metadata, post_images(id, storage_path, alt_text, sort_order)")
    .eq("id", id).maybeSingle();
  if (error) throw error;
  if (!post) notFound();
  const { data: author } = await supabase.from("family_profiles").select("display_name").eq("id", post.author_id).maybeSingle();
  const photos = [...post.post_images].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
  const { data: signedPhotos, error: photosError } = photos.length
    ? await supabase.storage.from("family-post-images").createSignedUrls(photos.map(photo => photo.storage_path), 3600)
    : { data: [], error: null };
  if (photosError) throw photosError;
  const photoUrls = Object.fromEntries((signedPhotos ?? []).flatMap(photo => photo.path && photo.signedUrl ? [[photo.path, photo.signedUrl]] : []));
  const cover = photos[0];
  const coverPosition = getCoverPosition(post.metadata);
  const [likesResult, commentsResult, namesResult] = await Promise.all([
    fetchAllRows((from, to) => supabase.from("post_likes").select("user_id").eq("post_id", id).order("user_id").range(from, to)),
    fetchAllRows((from, to) => supabase.from("post_comments").select("id,author_id,content,created_at").eq("post_id", id).order("created_at").order("id").range(from, to)),
    fetchAllRows((from, to) => supabase.from("family_profiles").select("id,display_name").order("id").range(from, to)),
  ]);
  if (likesResult.error || commentsResult.error || namesResult.error) throw new Error("Could not load post discussion");

  return <main className="profile-shell post-page">
    <header className="profile-nav">
      <Link className="brand" href="/">🍳 olo<span className="brand-accent">gotuje.</span></Link>
      <div className="profile-nav-actions"><LanguageToggle/><Link className="button ghost" href="/">{t("backToBlog")}</Link></div>
    </header>
    <article className="post-page-article">
      <header>
        <p className="eyebrow">{sectionName(language, post.section_slug, post.section_slug)}</p>
        <h1>{post.title}</h1>
        <div className="meta">
          <span>{t("author")}: <Link className="profile-author-link" href={`/profil/${post.author_id}`}>{author?.display_name ?? post.author_name}</Link></span>
          <time dateTime={post.created_at}>{new Date(post.created_at).toLocaleDateString(language === "en" ? "en-US" : "pl-PL", { timeZone: "Europe/Warsaw" })}</time>
          <span>{t(post.status === "draft" ? "draft" : "published")}</span>
        </div>
        {post.excerpt && <p className="post-page-excerpt">{post.excerpt}</p>}
        <PostLike postId={id} userId={userId} initialCount={likesResult.data?.length ?? 0} initialLiked={likesResult.data?.some(like => like.user_id === userId) ?? false}/>
      </header>
      {cover && photoUrls[cover.storage_path] && <img className="post-page-cover" src={photoUrls[cover.storage_path]} alt={cover.alt_text || post.title} style={{ objectPosition: `${coverPosition.x}% ${coverPosition.y}%` }}/>}
      <div className="post-page-content">
        {post.content.split("\n").filter(Boolean).map((line: string, index: number) => <p key={index}>{line}</p>)}
        <PostVideo postId={post.id}/>
        {photos.slice(1).map(photo => photoUrls[photo.storage_path] && <img className="inline-post-image" key={photo.id} src={photoUrls[photo.storage_path]} alt={photo.alt_text || post.title}/>)}
      </div>
    </article>
    <PostComments postId={id} userId={userId} canModerate={viewer.role === "admin" || viewer.role === "owner"} comments={commentsResult.data ?? []} authorNames={Object.fromEntries((namesResult.data ?? []).map(profile => [profile.id, profile.display_name]))}/>
  </main>;
}
