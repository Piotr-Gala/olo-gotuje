"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/browser";

type Section = { slug: string; title: string; is_active: boolean; sort_order: number };
type ImageRow = { id: string; storage_path: string; alt_text: string; sort_order: number };
type Post = { id: string; section_slug: string; author_id: string; author_name: string; title: string; slug: string; excerpt: string; content: string; metadata: Record<string, unknown>; status: "draft" | "published"; published_at: string | null; created_at: string; post_images: ImageRow[] };
type User = { id: string; name: string; role: string };
const labels: Record<string, string> = { gotowanie: "🍝 Gotowanie", lego: "🧱 LEGO", muzyka: "🎵 Muzyka" };

export function FamilyBlog({ user, sections: initialSections, posts: initialPosts }: { user: User; sections: Section[]; posts: Post[] }) {
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
    const matchesText = `${post.title} ${post.excerpt} ${post.content}`.toLocaleLowerCase("pl").includes(search.trim().toLocaleLowerCase("pl"));
    return active && matchesSection && matchesText && (isEditor || post.status === "published");
  }), [posts, activeSections, isEditor, sectionFilter, search]);

  async function toggleSection(section: Section) {
    const client = createClient(); const next = !section.is_active;
    const { error } = await client.from("sections").update({ is_active: next }).eq("slug", section.slug);
    if (error) { setNotice(`Nie udało się zmienić działu: ${error.message}`); return; }
    setSections((current) => current.map((item) => item.slug === section.slug ? { ...item, is_active: next } : item));
    setNotice(`${section.title}: ${next ? "dział włączony" : "dział ukryty"}.`);
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
    if (!title || !content) { setNotice("Wpis potrzebuje tytułu i treści."); return; }
    const tooLarge = files.find((file) => file.size > 8 * 1024 * 1024);
    if (tooLarge) { setNotice(`Zdjęcie ${tooLarge.name} przekracza limit 8 MB.`); return; }
    const client = createClient();
    const base = { section_slug: sectionSlug, title, slug: makeSlug(title), excerpt, content, status, published_at: status === "published" ? editing?.published_at ?? new Date().toISOString() : null };
    let postId = editing?.id;
    const result = editing
      ? await client.from("posts").update(base).eq("id", editing.id).select("id").single()
      : await client.from("posts").insert({ ...base, author_id: user.id }).select("id").single();
    if (result.error || !result.data) { setNotice(`Nie udało się zapisać wpisu: ${result.error?.message ?? "brak odpowiedzi"}`); return; }
    postId = result.data.id;
    for (const [index, file] of files.entries()) {
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "-");
      const path = `${postId}/${crypto.randomUUID()}-${safeName}`;
      const upload = await client.storage.from("family-post-images").upload(path, file, { contentType: file.type, upsert: false });
      if (upload.error) { setNotice(`Wpis zapisany, ale zdjęcia nie udało się dodać: ${upload.error.message}`); return; }
      const metadata = await client.from("post_images").insert({ post_id: postId, storage_path: path, alt_text: title, sort_order: (editing?.post_images.length ?? 0) + index });
      if (metadata.error) { setNotice(`Zdjęcie wgrane, ale jego opis nie zapisał się: ${metadata.error.message}`); return; }
    }
    const { data, error } = await client.from("posts").select("id, section_slug, author_id, author_name, title, slug, excerpt, content, metadata, status, published_at, created_at, post_images(id, storage_path, alt_text, sort_order)").eq("id", postId).single();
    if (error || !data) { setNotice("Wpis zapisany. Odśwież stronę, aby zobaczyć aktualną wersję."); return; }
    setPosts((current) => [data as Post, ...current.filter((post) => post.id !== postId)]);
    setEditing(null); setShowForm(false); setNotice(status === "published" ? "Wpis opublikowany!" : "Wpis zapisany jako szkic.");
  }

  async function removePost(post: Post) {
    if (!window.confirm(`Usunąć wpis „${post.title}” wraz ze zdjęciami?`)) return;
    const client = createClient();
    if (post.post_images.length) {
      const { error: storageError } = await client.storage.from("family-post-images").remove(post.post_images.map((image) => image.storage_path));
      if (storageError) { setNotice(`Nie udało się usunąć zdjęć: ${storageError.message}`); return; }
    }
    const { error } = await client.from("posts").delete().eq("id", post.id);
    if (error) { setNotice(`Nie udało się usunąć wpisu: ${error.message}`); return; }
    setPosts((current) => current.filter((item) => item.id !== post.id)); setNotice("Wpis usunięty.");
  }

  async function logout() { await createClient().auth.signOut(); window.location.assign("/login"); }

  return <div className="shell">
    <header><a className="brand" href="#top"><span className="brand-symbol">🍳</span>olo<span className="brand-accent">gotuje.</span></a><nav><a href="#wpisy">Wpisy</a>{isEditor && <a href="#dzialy">Działy</a>}<a href="#o-olo">O blogu</a></nav><div className="account"><span>{user.name}</span>{isEditor && <span className="role-pill">{user.role === "owner" ? "Olo · twórca" : "Admin"}</span>}{user.role === "admin" && <a className="account-link" href="/admin">Konta</a>}<button className="text-button" type="button" onClick={logout}>Wyloguj</button></div></header>
    <main id="top">
      <section className="hero"><div><div className="eyebrow">Prywatny blog rodzinny</div><h1>Olo<br/><em>gotuje.</em><br/>i tworzy!</h1><p>Rodzinne przepisy, konstrukcje i muzyczne pomysły — wszystko w jednym miejscu.</p><div className="hero-actions"><a href="#wpisy" className="button orange">Zobacz wpisy <span>↗</span></a>{isEditor && <button className="button ghost" onClick={() => { setEditing(null); setShowForm(true); }}>＋ Dodaj wpis</button>}</div></div><div className="hero-art"><div className="plate"><div className="dish">🍝</div></div><div className="floating one">✨ Pomysły Ola</div><div className="floating two">💚 Tylko dla rodziny</div></div></section>
      <div className="ticker">{activeSections.map((section) => <span key={section.slug}>✳ {labels[section.slug] ?? section.title}</span>)}<span>✳ Bez spiny</span><span>✳ Rodzinne pomysły</span></div>
      {isEditor && <section className="section-admin" id="dzialy"><div><div className="eyebrow">Twoje miejsce, twoje tematy</div><h2>Aktywne działy</h2><p>Włącz tylko te, w których Olo chce publikować. Wyłączony dział nie pojawia się rodzinie.</p></div><div className="toggle-list">{sections.map((section) => <label className="toggle-row" key={section.slug}><span>{labels[section.slug] ?? section.title}</span><input type="checkbox" checked={section.is_active} onChange={() => void toggleSection(section)} aria-label={`Włącz dział ${section.title}`}/></label>)}</div></section>}
      <section className="recipes" id="wpisy"><div className="heading"><div><div className="eyebrow">Co nowego u Ola?</div><h2>Rodzinny blog.</h2></div><p>Wybierz dział albo wyszukaj wpis. Zdjęcia otwierają się w pełnym rozmiarze.</p></div>
        <div className="filters">{activeSections.map((section) => <button className="chip" key={section.slug} aria-pressed={sectionFilter === section.slug} onClick={() => setSectionFilter(section.slug)}>{labels[section.slug] ?? section.title}</button>)}<button className="chip" aria-pressed={sectionFilter === "all"} onClick={() => setSectionFilter("all")}>Wszystkie</button><button className="chip" aria-pressed={sectionFilter === "favorites"} onClick={() => setSectionFilter("favorites")}>♥ Ulubione</button><label className="search"><span>⌕</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Szukaj wpisu…" aria-label="Szukaj wpisu"/></label></div>
        <div className="cards">{visiblePosts.filter((post) => sectionFilter !== "favorites" || favorites.includes(post.id)).map((post) => <article className="card" key={post.id}><div className="card-top post-cover"><span className="stamp">{labels[post.section_slug] ?? post.section_slug}</span>{post.post_images[0] && imageUrls[post.post_images[0].storage_path] ? <img src={imageUrls[post.post_images[0].storage_path]} alt={post.post_images[0].alt_text || post.title}/> : <span className="food">{post.section_slug === "lego" ? "🧱" : post.section_slug === "muzyka" ? "🎵" : "🍝"}</span>}<button className="heart" aria-pressed={favorites.includes(post.id)} aria-label="Dodaj lub usuń z ulubionych" onClick={() => setFavorites((current) => current.includes(post.id) ? current.filter((id) => id !== post.id) : [...current, post.id])}>{favorites.includes(post.id) ? "♥" : "♡"}</button></div><div className="card-body"><div className="meta"><span>Autor: {post.author_name}</span><span>{new Date(post.created_at).toLocaleDateString("pl-PL")}</span><span>{post.status === "draft" ? "· Szkic" : "· Opublikowano"}</span></div><h3>{post.title}</h3>{post.excerpt && <p>{post.excerpt}</p>}<details className="post-details"><summary>Czytaj wpis →</summary><div>{post.content.split("\n").filter(Boolean).map((line, index) => <p key={index}>{line}</p>)}{post.post_images.slice(1).map((image) => imageUrls[image.storage_path] && <img className="inline-post-image" key={image.id} src={imageUrls[image.storage_path]} alt={image.alt_text || post.title}/>)}</div></details>{isEditor && <div className="post-actions"><button className="text-button" onClick={() => { setEditing(post); setShowForm(true); }}>Edytuj</button><button className="text-button danger" onClick={() => void removePost(post)}>Usuń</button></div>}</div></article>)}{visiblePosts.filter((post) => sectionFilter !== "favorites" || favorites.includes(post.id)).length === 0 && <div className="empty">{isEditor ? "Tu jeszcze nie ma wpisów. Dodaj pierwszy!" : "Nie ma tu jeszcze wpisów — zajrzyj później."}</div>}</div>
      </section>
      <aside className="quote"><div><small>Tu jest miejsce na wszystko</small><h2>„Najlepsze pomysły zaczynają się od: a co, jeśli…?”</h2></div><div className="chef">💡</div></aside>
      <section className="about" id="o-olo"><div><div className="eyebrow">Nasze miejsce w sieci</div><h2>Dobre pomysły.<br/>Rodzinna sprawa.</h2></div><p><strong>Olo Gotuje</strong> to rodzinny blog, który rośnie razem z pomysłami Ola. Działy włączamy wtedy, kiedy Olo ma ochotę coś w nich pokazać.</p></section>
    </main><footer><span><strong>Olo Gotuje.</strong> Prywatny blog rodzinny. 🍅</span><span>{activeSections.map((section) => section.title).join(" · ")}</span></footer>
    {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Zamknij komunikat">×</button></div>}
    {showForm && <div className="form-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowForm(false); }}><form className="post-form" onSubmit={(event) => void savePost(event)}><div className="modal-head"><div><div className="eyebrow">{editing ? "Zmień wpis" : "Nowy wpis"}</div><h2>{editing ? "Edytuj wpis" : "Co Olo chce pokazać?"}</h2></div><button className="close" type="button" onClick={() => setShowForm(false)} aria-label="Zamknij">×</button></div><div className="post-author-preview"><span>Autor</span><strong>{editing?.author_name ?? user.name}</strong>{!editing && <small>Wpis zostanie przypisany do Twojego konta.</small>}</div><label>Dział<select name="section_slug" defaultValue={editing?.section_slug ?? activeSections[0]?.slug ?? sections[0]?.slug} required>{sections.map((section) => <option key={section.slug} value={section.slug}>{labels[section.slug] ?? section.title}{section.is_active ? "" : " (wyłączony)"}</option>)}</select></label><label>Tytuł<input name="title" required maxLength={120} defaultValue={editing?.title ?? ""} placeholder="Np. Mój kosmiczny makaron"/></label><label>Krótki opis <span>(opcjonalnie)</span><input name="excerpt" maxLength={240} defaultValue={editing?.excerpt ?? ""} placeholder="Jedno zdanie o wpisie"/></label><label>Treść wpisu<textarea name="content" rows={8} required defaultValue={editing?.content ?? ""} placeholder="Opowiedz, co się wydarzyło…"/></label><label>Zdjęcia <span>(opcjonalnie, do 8 MB każde)</span><input name="photos" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple/></label>{editing?.post_images.length ? <p className="form-hint">Obecne zdjęcia zostaną zachowane. Nowe możesz dodać powyżej.</p> : null}<label>Co zrobić z wpisem<select name="status" defaultValue={editing?.status ?? "draft"}><option value="draft">Zapisz jako szkic</option><option value="published">Opublikuj rodzinie</option></select></label><div className="form-buttons"><button type="button" className="button ghost" onClick={() => setShowForm(false)}>Anuluj</button><button className="button orange">Zapisz wpis</button></div></form></div>}
  </div>;
}

function makeSlug(value: string) { return `${value.toLocaleLowerCase("pl").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/ł/g, "l").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${crypto.randomUUID().slice(0, 8)}`; }
