"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";
import { useLanguage } from "@/components/LanguageProvider";
import { LanguageToggle } from "@/components/LanguageToggle";
import { sectionName, translate, type MessageKey } from "@/lib/i18n";
import { createPostSaveSession, deletePostWithPhotos, savePostWithPhotos, type PostSaveSession } from "@/lib/post-mutations";
import { getCoverPosition, preparePostImage } from "@/lib/image-processing";
import { VideoAttachment, videoErrorText } from "@/components/PostVideo";
import { uploadPostVideo, videoRequest, type VideoUploadSession } from "@/lib/video-upload";
import { PostLike } from "./PostLike";

export type BlogView = "home" | "posts" | "about";

type Section = { slug: string; title: string; is_active: boolean; sort_order: number };
type ImageRow = { id: string; storage_path: string; alt_text: string; sort_order: number };
type Post = { id: string; section_slug: string; author_id: string; author_name: string; title: string; slug: string; excerpt: string; content: string; metadata: Record<string, unknown>; status: "draft" | "published"; published_at: string | null; created_at: string; post_images: ImageRow[] };
type User = { id: string; name: string; role: string };
type FamilyProfile = { id: string; display_name: string };

export function FamilyBlog({ view, user, sections: initialSections, posts: initialPosts, familyProfiles, likes }: { view: BlogView; user: User; sections: Section[]; posts: Post[]; familyProfiles: FamilyProfile[]; likes: { post_id: string; user_id: string }[] }) {
  const { language } = useLanguage();
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(language, key, values);
  const sections = initialSections;
  const [posts, setPosts] = useState(initialPosts);
  const [feedFilter, setFeedFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Post | null>(null);
  const [showForm, setShowForm] = useState(false);

  const [notice, setNotice] = useState("");
  const [favorites, setFavorites] = useState<string[]>(likes.filter(like => like.user_id === user.id).map(like => like.post_id));
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [selectedPhotos, setSelectedPhotos] = useState<File[]>([]);
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoPreparing, setPhotoPreparing] = useState(false);
  const [coverPosition, setCoverPosition] = useState({ x: 50, y: 50 });
  const [saving, setSaving] = useState(false);
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [videoPreparing, setVideoPreparing] = useState(false);
  const [videoProgress, setVideoProgress] = useState<number | null>(null);
  const [pendingVideoCleanup, setPendingVideoCleanup] = useState(false);
  const videoSession = useRef<VideoUploadSession | null>(null);
  const videoAbort = useRef<AbortController | null>(null);
  const saveSession = useRef<PostSaveSession | null>(null);


  const deleting = useRef(new Set<string>());
  const [pendingPhotoCleanup, setPendingPhotoCleanup] = useState<string[]>([]);
  const isEditor = user.role === "admin" || user.role === "owner";
  const activeSections = sections.filter((section) => section.is_active);
  const familyProfileNames = useMemo(() => new Map(familyProfiles.map((profile) => [profile.id, profile.display_name])), [familyProfiles]);
  const coverStyle = { objectPosition: `${coverPosition.x}% ${coverPosition.y}%` };
  const existingCoverUrl = editing?.post_images[0] ? imageUrls[editing.post_images[0].storage_path] : null;
  const coverPreviewUrl = existingCoverUrl ?? photoPreviewUrl;


  useEffect(() => {
    let cancelled = false;
    async function signImages() {
      const paths = posts.flatMap((post) => post.post_images.map((image) => image.storage_path));
      if (!paths.length) { setImageUrls({}); return; }
      const { data } = await createClient().storage.from("family-post-images").createSignedUrls(paths, 3600);
      if (!cancelled && data) setImageUrls(Object.fromEntries(data.flatMap((item) => item.path && item.signedUrl ? [[item.path, item.signedUrl]] : [])));
    }
    void signImages(); return () => { cancelled = true; };
  }, [posts]);
  useEffect(() => () => { if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl); }, [photoPreviewUrl]);
  useEffect(() => {
    if (!isEditor || view !== "posts") return;
    void retryVideoCleanup();
  }, [isEditor, view]);

  async function retryVideoCleanup() {
    try { const result = await videoRequest({ action: "cleanup" }); setPendingVideoCleanup(result.cleanupPending); }
    catch { setPendingVideoCleanup(true); }
  }
  async function cancelVideo() {
    if (saving) { videoAbort.current?.abort(); return; }
    if (videoSession.current) {
      try { const result = await videoRequest({ action: "remove", id: videoSession.current.id }); setPendingVideoCleanup(result.cleanupPending); }
      catch { setNotice(videoErrorText(null, language === "en")); return; }
    }
    videoSession.current = null; setVideoFile(null); setVideoProgress(null);
  }

  const visiblePosts = useMemo(() => posts.filter((post) => {
    const active = post.author_id === user.id || activeSections.some((section) => section.slug === post.section_slug);
    const matchesText = `${post.title} ${post.excerpt} ${post.content}`.toLocaleLowerCase(language === "en" ? "en" : "pl").includes(search.trim().toLocaleLowerCase(language === "en" ? "en" : "pl"));
    return active && matchesText && (post.author_id === user.id || post.status === "published");
  }), [posts, activeSections, user.id, search, language]);

  async function savePost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!isEditor || (editing && editing.author_id !== user.id) || saving || saveSession.current?.busy) return;
    setNotice("");
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const sectionSlug = String(form.get("section_slug") ?? "");
    const excerpt = String(form.get("excerpt") ?? "").trim();
    const content = String(form.get("content") ?? "").trim();
    const status = String(form.get("status")) as "draft" | "published";
    const files = selectedPhotos;
    if (!title || !content) { setNotice(t("missingPostText")); return; }
    if (photoPreparing || videoPreparing) return;
    saveSession.current ??= createPostSaveSession(editing ?? undefined);
    setSaving(true);
    const controller = new AbortController();
    videoAbort.current = controller;
    try {
      const data = await savePostWithPhotos(createClient(), saveSession.current, {
        section_slug: sectionSlug, title, slug: editing?.slug ?? makeSlug(title), excerpt, content, status,
        metadata: { ...(editing?.metadata ?? {}), coverPosition },
        published_at: status === "published" ? editing?.published_at ?? new Date().toISOString() : null,
      }, user.id, files, async postId => {
        if (!videoFile) return;
        videoSession.current ??= { id: crypto.randomUUID(), file: videoFile };
        setVideoProgress(0);
        await uploadPostVideo(postId, videoSession.current, controller.signal, setVideoProgress);
      });
      if (!data) return;
      setPosts((current) => [data as Post, ...current.filter((post) => post.id !== data.id)]);
      saveSession.current = null;
      videoSession.current = null; setVideoFile(null); setVideoProgress(null);
      setEditing(null); setShowForm(false); setNotice(status === "published" ? t("postPublished") : t("postSaved"));
    } catch (error) {
      if (controller.signal.aborted && videoSession.current) {
        try { const result = await videoRequest({ action: "remove", id: videoSession.current.id }); setPendingVideoCleanup(result.cleanupPending); }
        catch { setPendingVideoCleanup(true); }
        videoSession.current = null; setVideoFile(null); setVideoProgress(null);
        setNotice(language === "en" ? "Upload cancelled. A new post stays a draft." : "Wysyłanie anulowane. Nowy wpis nie został opublikowany.");
      } else setNotice(error instanceof Error && error.message.startsWith("video-") ? videoErrorText(error, language === "en") : t("saveRetry"));
    } finally {
      videoAbort.current = null;
      setSaving(false);
    }
  }

  async function removePost(post: Post) {
    if (!isEditor || post.author_id !== user.id || deleting.current.has(post.id)) return;
    if (!window.confirm(t("deleteConfirm", { title: post.title }))) return;
    deleting.current.add(post.id);
    try {
      const { cleanupError } = await deletePostWithPhotos(createClient(), post);
      setPosts((current) => current.filter((item) => item.id !== post.id));
      await retryVideoCleanup();
      if (cleanupError) {
        setPendingPhotoCleanup((current) => [...new Set([...current, ...post.post_images.map((image) => image.storage_path)])]);
        setNotice(t("postDeletedPhotosPending"));
      } else {
        setNotice(t("postDeleted"));
      }
    } catch {
      setNotice(t("deletePostRetry"));
    } finally {
      deleting.current.delete(post.id);
    }
  }

  async function retryPhotoCleanup() {
    const paths = pendingPhotoCleanup;
    try {
      const { error } = await createClient().storage.from("family-post-images").remove(paths);
      if (error) throw error;
      setPendingPhotoCleanup((current) => current.filter((path) => !paths.includes(path)));
      setNotice(t("photosCleanedUp"));
    } catch {
      setNotice(t("postDeletedPhotosPending"));
    }
  }

  function openPostForm(post: Post | null) {
    if (!isEditor || (post && post.author_id !== user.id)) return;
    if (saving || saveSession.current?.busy) return;
    saveSession.current = null;
    videoSession.current = null; setVideoFile(null); setVideoProgress(null);
    setEditing(post);
    setSelectedPhotos([]);
    setPhotoPreviewUrl(null);
    setCoverPosition(getCoverPosition(post?.metadata));
    setShowForm(true);
  }

  async function preparePhotos(files: FileList | null) {
    const sources = Array.from(files ?? []);
    if (!sources.length) { setSelectedPhotos([]); setPhotoPreviewUrl(null); return; }
    setSelectedPhotos([]);
    setPhotoPreviewUrl(null);
    setPhotoPreparing(true);
    setNotice("");
    try {
      const tooLarge = sources.find((file) => file.size > 15 * 1024 * 1024);
      if (tooLarge) { setNotice(t("photoTooLarge", { name: tooLarge.name })); return; }
      const prepared: File[] = [];
      for (const source of sources) prepared.push(await preparePostImage(source));
      setSelectedPhotos(prepared);
      setPhotoPreviewUrl(URL.createObjectURL(prepared[0]));
    } catch (error) {
      const name = error instanceof Error && error.message === "source-too-large" ? sources[0]?.name ?? "" : sources.find((file) => !["image/jpeg", "image/png", "image/webp", "image/gif"].includes(file.type))?.name ?? sources[0]?.name ?? "";
      setSelectedPhotos([]);
      setPhotoPreviewUrl(null);
      setNotice(error instanceof Error && error.message === "source-too-large" ? t("photoTooLarge", { name }) : t("photoPrepareFailed", { name }));
    } finally {
      setPhotoPreparing(false);
    }
  }

  async function logout() { await createClient().auth.signOut(); window.location.assign("/login"); }

  return <div className="shell">
    <header><Link className="brand" href="/"><span className="brand-symbol">🍳</span>olo<span className="brand-accent">gotuje.</span></Link><nav><Link href="/" aria-current={view === "home" ? "page" : undefined}>{t("home")}</Link><Link href="/wpisy" aria-current={view === "posts" ? "page" : undefined}>{t("posts")}</Link><Link href="/o-nas" aria-current={view === "about" ? "page" : undefined}>{t("about")}</Link></nav><div className="account"><span>{user.name}</span>{isEditor && <span className="role-pill">{user.role === "owner" ? t("roleOwner") : t("roleAdmin")}</span>}<Link className="account-link" href={`/profil/${user.id}`}>{t("profile")}</Link>{user.role === "admin" && <a className="account-link" href="/admin">{t("accounts")}</a>}<LanguageToggle/><button className="text-button" type="button" onClick={logout}>{t("logout")}</button></div></header>
    <main id="top">
      {view === "home" && <>
      <section className="hero"><div><div className="eyebrow">{t("familyBlog")}</div><h1>Olo<br/><em>{language === "en" ? "cooks." : "gotuje."}</em><br/>{language === "en" ? "and creates!" : "i tworzy!"}</h1><p>{t("heroDescription")}</p><div className="hero-actions"><Link href="/wpisy" className="button orange">{t("viewPosts")} <span>↗</span></Link></div></div><div className="hero-art"><div className="plate"><div className="dish">🍝</div></div><div className="floating one">{t("olaIdeas")}</div><div className="floating two">{t("familyOnly")}</div></div></section>
      </>}
      {view !== "about" && <>
      <section className="recipes" id="wpisy"><div className="heading"><div><div className="eyebrow">{t("whatsNew")}</div><h2>{view === "home" ? t("latestPosts") : t("familyFeed")}</h2></div>{view === "posts" && <div className="feed-tools"><p>{t("feedHelp")}</p>{isEditor && <button className="button orange" onClick={() => openPostForm(null)}>{t("addPost")}</button>}</div>}</div>
        {view === "posts" && <div className="filters"><button className="chip" aria-pressed={feedFilter === "all"} onClick={() => setFeedFilter("all")}>{t("all")}</button><button className="chip" aria-pressed={feedFilter === "favorites"} onClick={() => setFeedFilter("favorites")}>{t("favorites")}</button><label className="search"><span>⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchPost")} aria-label={t("searchPostLabel")}/></label></div>}
        <div className="cards">{visiblePosts.filter((post) => feedFilter !== "favorites" || favorites.includes(post.id)).map((post) => <article className="card" key={post.id}><div className="card-top post-cover"><span className="stamp">{sectionName(language, post.section_slug, post.section_slug)}</span>{post.post_images[0] && imageUrls[post.post_images[0].storage_path] ? <img src={imageUrls[post.post_images[0].storage_path]} alt={post.post_images[0].alt_text || post.title} style={{ objectPosition: `${getCoverPosition(post.metadata).x}% ${getCoverPosition(post.metadata).y}%` }}/> : <span className="food">{post.section_slug === "lego" ? "🧱" : post.section_slug === "muzyka" ? "🎵" : post.section_slug === "gotowanie" ? "🍝" : "📝"}</span>}<PostLike postId={post.id} userId={user.id} initialCount={likes.filter(like => like.post_id === post.id).length} initialLiked={favorites.includes(post.id)} onChange={liked => setFavorites(current => liked ? [...new Set([...current, post.id])] : current.filter(id => id !== post.id))}/></div><div className="card-body"><div className="meta"><span>{t("author")}: <Link className="profile-author-link" href={`/profil/${post.author_id}`}>{familyProfileNames.get(post.author_id) ?? post.author_name}</Link></span><span>{new Date(post.created_at).toLocaleDateString(language === "en" ? "en-US" : "pl-PL")}</span><span>· {post.status === "draft" ? t("draft") : t("published")}</span></div><h3>{post.title}</h3>{post.excerpt && <p>{post.excerpt}</p>}<Link className="post-read-trigger" href={`/wpis/${post.id}`}>{t("readPost")}</Link>{view === "posts" && isEditor && post.author_id === user.id && <div className="post-actions"><button className="text-button" onClick={() => openPostForm(post)}>{t("edit")}</button><button className="text-button danger" onClick={() => void removePost(post)}>{t("delete")}</button></div>}</div></article>)}{visiblePosts.filter((post) => feedFilter !== "favorites" || favorites.includes(post.id)).length === 0 && <div className="empty">{isEditor ? t("noPostsAdmin") : t("noPostsMember")}</div>}</div>
        {view === "home" && <div className="feed-more"><Link className="button ghost" href="/wpisy">{t("allPosts")} →</Link></div>}
      </section>
      </>}
      {view === "home" && <>
      <aside className="quote"><div><small>{t("quoteEyebrow")}</small><h2>{t("quote")}</h2></div><div className="chef">💡</div></aside>
      <section className="about" id="o-olo"><div><div className="eyebrow">{t("aboutEyebrow")}</div><h2>{t("aboutTitle")}</h2></div><p><strong>Olo Gotuje</strong> {t("aboutText")}</p></section>
      </>}
      {view === "about" && <section className="about-page" aria-labelledby="about-page-title">
        <div className="about-page-heading"><p className="eyebrow">{t("aboutEyebrow")}</p><h1 id="about-page-title">{t("aboutPageTitle")}</h1><p>{t("aboutPageIntro")}</p></div>
        <div className="about-info-grid">
          <article className="about-info-card"><h2>{t("aboutOloTitle")}</h2><p>{t("aboutOloText")}</p></article>
          <article className="about-info-card"><h2>{t("aboutSiteTitle")}</h2><p>{t("aboutSiteText")}</p><Link className="post-read-trigger" href="/wpisy">{t("viewPosts")} →</Link></article>
          <article className="about-info-card about-info-wide"><h2>{t("aboutInfoTitle")}</h2><ul><li>{t("aboutAccessInfo")}</li><li>{t("aboutAuthorInfo")}</li><li>{t("aboutSharingInfo")}</li></ul></article>
        </div>
      </section>}
    </main><footer><span><strong>Olo Gotuje.</strong> {t("footer")}</span></footer>
    {pendingVideoCleanup && <div className="cleanup-warning" role="status"><span>{language === "en" ? "Video cleanup needs a retry." : "Sprzątanie plików filmowych wymaga ponowienia."}</span><button className="text-button" onClick={() => void retryVideoCleanup()}>{language === "en" ? "Retry video cleanup" : "Ponów sprzątanie filmów"}</button></div>}
    {pendingPhotoCleanup.length > 0 && <div className="cleanup-warning" role="status"><span>{t("postDeletedPhotosPending")}</span><button className="text-button" onClick={() => void retryPhotoCleanup()}>{t("retryPhotoCleanup")}</button></div>}
    {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label={t("closeNotice")}>×</button></div>}
    {showForm && <div className="form-backdrop" role="presentation" onMouseDown={(event) => { if (!saving && event.target === event.currentTarget) setShowForm(false); }}><form className="post-form" onSubmit={(event) => void savePost(event)} aria-busy={saving || photoPreparing}><fieldset className="post-form-fields" disabled={saving}><div className="modal-head"><div><div className="eyebrow">{editing ? t("formEdit") : t("formNew")}</div><h2>{editing ? t("formEditTitle") : t("formNewTitle")}</h2></div><button className="close" type="button" onClick={() => { if (!saving) setShowForm(false); }} aria-label={t("close")}>×</button></div><div className="post-author-preview"><span>{t("author")}</span><strong>{editing?.author_name ?? user.name}</strong>{!editing && <small>{t("authorAssigned")}</small>}</div><fieldset className="post-category-picker"><legend>{t("section")}</legend><div className="post-category-options">{sections.map((category) => <label className="post-category-option" key={category.slug}><input type="radio" name="section_slug" value={category.slug} defaultChecked={category.slug === (editing?.section_slug ?? "gotowanie")} required/><span>{sectionName(language, category.slug, category.title)}</span></label>)}</div></fieldset><label>{t("title")}<input name="title" required maxLength={120} defaultValue={editing?.title ?? ""} placeholder={t("titlePlaceholder")}/></label><label>{t("excerpt")} <span>{t("optional")}</span><input name="excerpt" maxLength={240} defaultValue={editing?.excerpt ?? ""} placeholder={t("excerptPlaceholder")}/></label><label>{t("content")}<textarea name="content" rows={8} required defaultValue={editing?.content ?? ""} placeholder={t("contentPlaceholder")}/></label><label>{t("photos")} <span>{t("photoLimit")}</span><input name="photos" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple onChange={(event) => void preparePhotos(event.currentTarget.files)}/></label>{photoPreparing && <p className="form-hint" role="status">{t("photoPreparing")}</p>}{editing?.post_images.length ? <p className="form-hint">{t("keepPhotos")}</p> : null}{coverPreviewUrl && <div className="cover-crop-control"><strong>{t("cropPhoto")}</strong><div className="cover-crop-preview"><img src={coverPreviewUrl} alt="" style={coverStyle}/></div><label>{t("cropHorizontal")}<input type="range" min="0" max="100" value={coverPosition.x} onChange={(event) => setCoverPosition((position) => ({ ...position, x: Number(event.target.value) }))}/></label><label>{t("cropVertical")}<input type="range" min="0" max="100" value={coverPosition.y} onChange={(event) => setCoverPosition((position) => ({ ...position, y: Number(event.target.value) }))}/></label></div>}<VideoAttachment postId={editing?.id} selected={videoFile} locked={!!videoSession.current} onSelect={setVideoFile} onPreparing={setVideoPreparing} onError={setNotice}/><label>{t("postAction")}<select name="status" defaultValue={editing?.status ?? "draft"}><option value="draft">{t("saveDraft")}</option><option value="published">{t("publishFamily")}</option></select></label><div className="form-buttons"><button type="button" className="button ghost" onClick={() => { if (!saving) setShowForm(false); }}>{t("cancel")}</button><button className="button orange" disabled={saving || photoPreparing || videoPreparing}>{photoPreparing ? t("photoPreparing") : saving ? t("savingPost") : t("savePost")}</button></div></fieldset>{videoProgress !== null && <div className="video-upload-status" role="status"><label htmlFor="video-progress">{language === "en" ? "Uploading video" : "Wysyłanie filmu"}: {videoProgress}%</label><progress id="video-progress" max={100} value={videoProgress}/>{(videoProgress < 100 || !saving) && <button className="text-button" type="button" onClick={() => void cancelVideo()}>{saving ? (language === "en" ? "Cancel upload" : "Anuluj wysyłanie") : (language === "en" ? "Remove selected video" : "Usuń wybrany film")}</button>}</div>}</form></div>}
  </div>;
}

function makeSlug(value: string) { return `${value.toLocaleLowerCase("pl").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${crypto.randomUUID().slice(0, 8)}`; }
