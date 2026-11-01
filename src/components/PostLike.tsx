"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/browser";
import { useLanguage } from "./LanguageProvider";
import { translate } from "@/lib/i18n";
import { ProfileAvatar } from "./ProfileAvatar";

export function PostLike({ postId, userId, initialCount, initialLiked, onChange }: {
  postId: string; userId: string; initialCount: number; initialLiked: boolean; onChange?(liked: boolean): void;
}) {
  const { language } = useLanguage();
  const [liked, setLiked] = useState(initialLiked);
  const [count, setCount] = useState(initialCount);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const [people, setPeople] = useState<{ id: string; name: string; url: string | null; x: number; y: number; zoom: number }[]>([]);
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [peopleFailed, setPeopleFailed] = useState(false);
  async function showPeople() {
    dialog.current?.showModal();
    setLoadingPeople(true); setPeopleFailed(false);
    try {
      const client = createClient();
      const { data: likes, error } = await client.from("post_likes").select("user_id").eq("post_id", postId).order("created_at");
      if (error) throw error;
      const ids = (likes ?? []).map(like => like.user_id);
      const { data: profiles, error: profilesError } = ids.length
        ? await client.from("family_profiles").select("id,display_name,avatar_path,avatar_x,avatar_y,avatar_zoom").in("id", ids)
        : { data: [], error: null };
      if (profilesError) throw profilesError;
      const paths = (profiles ?? []).flatMap(profile => profile.avatar_path ? [profile.avatar_path] : []);
      const { data: photos } = paths.length ? await client.storage.from("family-avatars").createSignedUrls(paths, 3600) : { data: [] };
      const urls = new Map((photos ?? []).map(photo => [photo.path, photo.signedUrl]));
      setPeople(ids.map(id => {
        const profile = profiles?.find(person => person.id === id);
        return { id, name: profile?.display_name ?? translate(language, "member"), url: urls.get(profile?.avatar_path) ?? null, x: profile?.avatar_x ?? 50, y: profile?.avatar_y ?? 50, zoom: Number(profile?.avatar_zoom ?? 1) };
      }));
      setCount(ids.length);
    } catch { setPeopleFailed(true); }
    finally { setLoadingPeople(false); }
  }
  async function toggle() {
    if (busy) return;
    setBusy(true); setFailed(false);
    try {
      const client = createClient();
      const result = liked
        ? await client.from("post_likes").delete().eq("post_id", postId).eq("user_id", userId).select("user_id")
        : await client.from("post_likes").upsert({ post_id: postId, user_id: userId }, { onConflict: "post_id,user_id", ignoreDuplicates: true });
      if (result.error || (liked && !result.data?.length)) throw new Error("Like not saved");
      const { count: total, error } = await client.from("post_likes").select("user_id", { count: "exact", head: true }).eq("post_id", postId);
      setLiked(!liked); onChange?.(!liked);
      setCount(!error && total !== null ? total : Math.max(0, count + (liked ? -1 : 1)));
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }
  return <div className="like-control">
    <div className="like-actions">
    <button className="like-button" type="button" aria-pressed={liked} aria-label={translate(language, "favoriteToggle")} disabled={busy} onClick={() => void toggle()}>
      <span aria-hidden="true">{liked ? "♥" : "♡"}</span>
    </button>
    <button className="like-count" type="button" onClick={() => void showPeople()} aria-label={`${translate(language, "whoLiked")} (${count})`}>{count}</button>
    </div>
    {failed && <small className="form-error" role="alert">{translate(language, "likeFailed")}</small>}
    <dialog className="likes-dialog" ref={dialog} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
      <div className="likes-dialog-heading"><h2>{translate(language, "whoLiked")}</h2><button className="text-button" type="button" onClick={() => dialog.current?.close()} aria-label={translate(language, "close")}>✕</button></div>
      {loadingPeople ? <p>{translate(language, "loadingLikes")}</p> : peopleFailed ? <p className="form-error" role="alert">{translate(language, "likesLoadFailed")}</p> : !people.length ? <p>{translate(language, "noLikes")}</p> : <ul className="liker-list">{people.map(person => <li key={person.id}>
        <Link href={`/profil/${person.id}`}><ProfileAvatar url={person.url} name={person.name} x={person.x} y={person.y} zoom={person.zoom}/><span>{person.name}</span></Link>
      </li>)}</ul>}
    </dialog>
  </div>;
}
