"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/browser";
import { useLanguage } from "@/components/LanguageProvider";
import { LanguageToggle } from "@/components/LanguageToggle";
import { sectionName, translate, type MessageKey } from "@/lib/i18n";

type Section = { slug: string; title: string; is_active: boolean; sort_order: number };
type ImageRow = { id: string; storage_path: string; alt_text: string; sort_order: number };
type Post = { id: string; section_slug: string; author_id: string; author_name: string; title: string; slug: string; excerpt: string; content: string; metadata: Record<string, unknown>; status: "draft" | "published"; published_at: string | null; created_at: string; post_images: ImageRow[] };
type User = { id: string; name: string; role: string };

export function FamilyBlog({ user, sections: initialSections, posts: initialPosts }: { user: User; sections: Section[]; posts: Post[] }) {
  const { language } = useLanguage();
  const t = (key: MessageKey, values?: Record<string, string | number>) => translate(language, key, values);
  const [sections, setSections] = useState(initialSections);
  const [posts, setPosts] = useState(initialPosts);
  const [sectionFilter, setSectionFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Post | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [notice, setNotice] = useState("");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const isEditor = user.role === "admin" || user.role === "owner";
  const activeSections = sections.filter((section) => section.is_active);

  useEffect(() => {
    try { const stored = JSON.parse(localStorage.getItem("olo-favorites") ?? "[]"); if (Array.isArray(stored)) setFavorites(stored.filter((x): x is string => typeof x === "string")); } catch { /* ignore invalid local data */ }
  }, []);
  useEffect(() => { localStorage.setItem("olo-favorites", JSON.stringify(favorites)); }, [favorites]);
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

  const visiblePosts = useMemo(() => posts.filter((post) => {
    const active = isEditor || activeSections.some((section) => section.slug === post.section_slug);
    const matchesSection = sectionFilter === "all" || sectionFilter === "favorites" || post.section_slug === sectionFilter;
    const matchesText = `${post.title} ${post.excerpt} ${post.content}`.toLocaleLowerCase(language === "en" ? "en" : "pl").includes(search.trim().toLocaleLowerCase(language === "en" ? "en" : "pl"));
    return active && matchesSection && matchesText && (isEditor || post.status === "published");
  }), [posts, activeSections, isEditor, sectionFilter, search, language]);

  async function toggleSection(section: Section) {
    const client = createClient(); const next = !section.is_active;
    const { error } = await client.from("sections").update({ is_active: next }).eq("slug", section.slug);
    if (error) { setNotice(t("sectionToggleFailed", { error: error.message })); return; }
    setSections((current) => current.map((item) => item.slug === section.slug ? { ...item, is_active: next } : item));
    setNotice(`${sectionName(language, section.slug, section.title)}: ${next ? t("sectionEnabled") : t("sectionHidden")}.`);
  }

  async function savePost(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setNotice("");
    const form = new FormData(event.currentTarget);
    const title = String(form.get("title") ?? "").trim();
    const sectionSlug = String(form.get("section_slug") ?? "");
    const excerpt = String(form.get("excerpt") ?? "").trim();
    const content = String(form.get("content") ?? "").trim();
    const status = String(form.get("status")) as "draft" | "published";
    const files = form.getAll("photos").filter((file): file is File => file instanceof File && file.size > 0);
    if (!title || !content) { setNotice(t("missingPostText")); return; }
    const tooLarge = files.find((file) => file.size > 8 * 1024 * 1024);
    if (tooLarge) { setNotice(t("photoTooLarge", { name: tooLarge.name })); return; }
    const client = createClient();
    const base = { section_slug: sectionSlug, title, slug: makeSlug(title), excerpt, content, status, published_at: status === "published" ? editing?.published_at ?? new Date().toISOString() : null };
    let postId = editing?.id;
    const result = editing
      ? await client.from("posts").update(base).eq("id", editing.id).select("id").single()
      : await client.from("posts").insert({ ...base, author_id: user.id }).select("id").single();
    if (result.error || !result.data) { setNotice(t("saveFailed", { error: result.error?.message ?? (language === "en" ? "no response" : "brak odpowiedzi") })); return; }
    postId = result.data.id;
    for (const [index, file] of files.entries()) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = `${postId}/${crypto.randomUUID()}-${safeName}`;
      const upload = await client.storage.from("family-post-images").upload(path, file, { contentType: file.type, upsert: false });
      if (upload.error) { setNotice(t("uploadFailed", { error: upload.error.message })); return; }
      const metadata = await client.from("post_images").insert({ post_id: postId, storage_path: path, alt_text: title, sort_order: (editing?.post_images.length ?? 0) + index });
      if (metadata.error) { setNotice(t("imageMetadataFailed", { error: metadata.error.message })); return; }
    }
    const { data, error } = await client.from("posts").select("id, section_slug, author_id, author_name, title, slug, excerpt, content, metadata, status, published_at, created_at, post_images(id, storage_path, alt_text, sort_order)").eq("id", postId).single();
    if (error || !data) { setNotice(t("refreshPost")); return; }
    setPosts((current) => [data as Post, ...current.filter((post) => post.id !== postId)]);
    setEditing(null); setShowForm(false); setNotice(status === "published" ? t("postPublished") : t("postSaved"));
  }

  async function removePost(post: Post) {
    if (!window.confirm(t("deleteConfirm", { title: post.title }))) return;
    const client = createClient();
    if (post.post_images.length) {
      const { error: storageError } = await client.storage.from("family-post-images").remove(post.post_images.map((image) => image.storage_path));
      if (storageError) { setNotice(t("deletePhotosFailed", { error: storageError.message })); return; }
    }
    const { error } = await client.from("posts").delete().eq("id", post.id);
    if (error) { setNotice(t("deletePostFailed", { error: error.message })); return; }
    setPosts((current) => current.filter((item) => item.id !== post.id)); setNotice(t("postDeleted"));
  }

  async function logout() { await createClient().auth.signOut(); window.location.assign("/login"); }

  return <div className="shell">
    <header><a className="brand" href="#top"><span className="brand-symbol">🍳</span>olo<span className="brand-accent">gotuje.</span></a><nav><a href="#wpisy">{t("posts")}</a>{isEditor && <a href="#dzialy">{t("sections")}</a>}<a href="#o-olo">{t("about")}</a></nav><div className="account"><span>{user.name}</span>{isEditor && <span className="role-pill">{user.role === "owner" ? t("roleOwner") : t("roleAdmin")}</span>}{user.role === "admin" && <a className="account-link" href="/admin">{t("accounts")}</a>}<LanguageToggle/><button className="text-button" type="button" onClick={logout}>{t("logout")}</button></div></header>
    <main id="top">
      <section className="hero"><div><div className="eyebrow">{t("familyBlog")}</div><h1>Olo<br/><em>{language === "en" ? "cooks." : "gotuje."}</em><br/>{language === "en" ? "and creates!" : "i tworzy!"}</h1><p>{t("heroDescription")}</p><div className="hero-actions"><a href="#wpisy" className="button orange">{t("viewPosts")} <span>↗</span></a>{isEditor && <button className="button ghost" onClick={() => { setEditing(null); setShowForm(true); }}>{t("addPost")}</button>}</div></div><div className="hero-art"><div className="plate"><div className="dish">🍝</div></div><div className="floating one">{t("olaIdeas")}</div><div className="floating two">{t("familyOnly")}</div></div></section>
      <div className="ticker">{activeSections.map((section) => <span key={section.slug}>✳ {sectionName(language, section.slug, section.title)}</span>)}</div>
      {isEditor && <section className="section-admin" id="dzialy"><div><div className="eyebrow">{t("sectionIntro")}</div><h2>{t("activeSections")}</h2><p>{t("sectionHelp")}</p></div><div className="toggle-list">{sections.map((section) => <label className="toggle-row" key={section.slug}><span>{sectionName(language, section.slug, section.title)}</span><input type="checkbox" checked={section.is_active} onChange={() => void toggleSection(section)} aria-label={`${language === "en" ? "Enable section" : "Włącz dział"} ${sectionName(language, section.slug, section.title)}`}/></label>)}</div></section>}
      <section className="recipes" id="wpisy"><div className="heading"><div><div className="eyebrow">{t("whatsNew")}</div><h2>{t("familyFeed")}</h2></div><p>{t("feedHelp")}</p></div>
        <div className="filters">{activeSections.map((section) => <button className="chip" key={section.slug} aria-pressed={sectionFilter === section.slug} onClick={() => setSectionFilter(section.slug)}>{sectionName(language, section.slug, section.title)}</button>)}<button className="chip" aria-pressed={sectionFilter === "all"} onClick={() => setSectionFilter("all")}>{t("all")}</button><button className="chip" aria-pressed={sectionFilter === "favorites"} onClick={() => setSectionFilter("favorites")}>{t("favorites")}</button><label className="search"><span>⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("searchPost")} aria-label={t("searchPostLabel")}/></label></div>
        <div className="cards">{visiblePosts.filter((post) => sectionFilter !== "favorites" || favorites.includes(post.id)).map((post) => <article className="card" key={post.id}><div className="card-top post-cover"><span className="stamp">{sectionName(language, post.section_slug, post.section_slug)}</span>{post.post_images[0] && imageUrls[post.post_images[0].storage_path] ? <img src={imageUrls[post.post_images[0].storage_path]} alt={post.post_images[0].alt_text || post.title}/> : <span className="food">{post.section_slug === "lego" ? "🧱" : post.section_slug === "muzyka" ? "🎵" : "🍝"}</span>}<button className="heart" aria-pressed={favorites.includes(post.id)} aria-label={t("favoriteToggle")} onClick={() => setFavorites((current) => current.includes(post.id) ? current.filter((id) => id !== post.id) : [...current, post.id])}>{favorites.includes(post.id) ? "♥" : "♡"}</button></div><div className="card-body"><div className="meta"><span>{t("author")}: {post.author_name}</span><span>{new Date(post.created_at).toLocaleDateString(language === "en" ? "en-US" : "pl-PL")}</span><span>· {post.status === "draft" ? t("draft") : t("published")}</span></div><h3>{post.title}</h3>{post.excerpt && <p>{post.excerpt}</p>}<details className="post-details"><summary>{t("readPost")}</summary><div>{post.content.split("\n").filter(Boolean).map((line, index) => <p key={index}>{line}</p>)}{post.post_images.slice(1).map((image) => imageUrls[image.storage_path] && <img className="inline-post-image" key={image.id} src={imageUrls[image.storage_path]} alt={image.alt_text || post.title}/>)}</div></details>{isEditor && <div className="post-actions"><button className="text-button" onClick={() => { setEditing(post); setShowForm(true); }}>{t("edit")}</button><button className="text-button danger" onClick={() => void removePost(post)}>{t("delete")}</button></div>}</div></article>)}{visiblePosts.filter((post) => sectionFilter !== "favorites" || favorites.includes(post.id)).length === 0 && <div className="empty">{isEditor ? t("noPostsAdmin") : t("noPostsMember")}</div>}</div>
      </section>
      <aside className="quote"><div><small>{t("quoteEyebrow")}</small><h2>{t("quote")}</h2></div><div className="chef">💡</div></aside>
      <section className="about" id="o-olo"><div><div className="eyebrow">{t("aboutEyebrow")}</div><h2>{t("aboutTitle")}</h2></div><p><strong>Olo Gotuje</strong> {t("aboutText")}</p></section>
    </main><footer><span><strong>Olo Gotuje.</strong> {t("footer")}</span><span>{activeSections.map((section) => sectionName(language, section.slug, section.title)).join(" · ")}</span></footer>
    {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label={t("closeNotice")}>×</button></div>}
    {showForm && <div className="form-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowForm(false); }}><form className="post-form" onSubmit={(event) => void savePost(event)}><div className="modal-head"><div><div className="eyebrow">{editing ? t("formEdit") : t("formNew")}</div><h2>{editing ? t("formEditTitle") : t("formNewTitle")}</h2></div><button className="close" type="button" onClick={() => setShowForm(false)} aria-label={t("close")}>×</button></div><div className="post-author-preview"><span>{t("author")}</span><strong>{editing?.author_name ?? user.name}</strong>{!editing && <small>{t("authorAssigned")}</small>}</div><label>{t("section")}<select name="section_slug" defaultValue={editing?.section_slug ?? activeSections[0]?.slug ?? sections[0]?.slug} required>{sections.map((section) => <option key={section.slug} value={section.slug}>{sectionName(language, section.slug, section.title)}{section.is_active ? "" : language === "en" ? " (disabled)" : " (wyłączony)"}</option>)}</select></label><label>{t("title")}<input name="title" required maxLength={120} defaultValue={editing?.title ?? ""} placeholder={t("titlePlaceholder")}/></label><label>{t("excerpt")} <span>{t("optional")}</span><input name="excerpt" maxLength={240} defaultValue={editing?.excerpt ?? ""} placeholder={t("excerptPlaceholder")}/></label><label>{t("content")}<textarea name="content" rows={8} required defaultValue={editing?.content ?? ""} placeholder={t("contentPlaceholder")}/></label><label>{t("photos")} <span>{t("photoLimit")}</span><input name="photos" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple/></label>{editing?.post_images.length ? <p className="form-hint">{t("keepPhotos")}</p> : null}<label>{t("postAction")}<select name="status" defaultValue={editing?.status ?? "draft"}><option value="draft">{t("saveDraft")}</option><option value="published">{t("publishFamily")}</option></select></label><div className="form-buttons"><button type="button" className="button ghost" onClick={() => setShowForm(false)}>{t("cancel")}</button><button className="button orange">{t("savePost")}</button></div></form></div>}
  </div>;
}

function makeSlug(value: string) { return `${value.toLocaleLowerCase("pl").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${crypto.randomUUID().slice(0, 8)}`; }
