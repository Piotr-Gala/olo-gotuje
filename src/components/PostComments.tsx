"use client";

import { AuthorLink } from "./AuthorLink";
import type { AuthorProfile } from "@/lib/author-avatars";
import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { useLanguage } from "./LanguageProvider";
import { translate } from "@/lib/i18n";

export type PostComment = { id: string; author_id: string; content: string; created_at: string };

export function PostComments({ postId, userId, canModerate, comments, authors }: {
  postId: string; userId: string; canModerate: boolean; comments: PostComment[]; authors: Record<string, AuthorProfile>;
}) {
  const { language } = useLanguage();
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const router = useRouter();
  const [content, setContent] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const attemptId = useRef<string | null>(null);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !content.trim()) return;
    setBusy(true); setFailed(false);
    try {
      attemptId.current ??= crypto.randomUUID();
      // Retrying a lost response must not create the same comment twice.
      const { error } = await createClient().from("post_comments").upsert({ id: attemptId.current, post_id: postId, author_id: userId, content: content.trim() }, { onConflict: "id", ignoreDuplicates: true });
      if (error) throw new Error("Comment not saved");
      attemptId.current = null; setContent(""); router.refresh();
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (busy || !window.confirm(t("deleteCommentConfirm"))) return;
    setBusy(true); setFailed(false);
    try {
      const { data, error } = await createClient().from("post_comments").delete().eq("id", id).eq("post_id", postId).select("id");
      if (error || !data?.length) throw new Error("Comment not deleted");
      router.refresh();
    } catch { setFailed(true); }
    finally { setBusy(false); }
  }
  return <section className="post-comments" aria-labelledby="comments-title">
    <h2 id="comments-title">{t("comments")} ({comments.length})</h2>
    {failed && <p className="form-error" role="alert">{t("commentFailed")}</p>}
    {!comments.length && <p className="form-hint">{t("noComments")}</p>}
    <div className="comment-list">{comments.map(comment => <article className="comment" key={comment.id}>
      <div className="meta"><AuthorLink id={comment.author_id} profile={authors[comment.author_id]} fallbackName={t("member")}/>
        <time dateTime={comment.created_at}>{new Date(comment.created_at).toLocaleString(language === "pl" ? "pl-PL" : "en-US", { timeZone: "Europe/Warsaw" })}</time>
        {(comment.author_id === userId || canModerate) && <button className="text-button danger" disabled={busy} onClick={() => void remove(comment.id)}>{t("delete")}</button>}
      </div>
      <p>{comment.content}</p>
    </article>)}</div>
    <form className="profile-form" onSubmit={submit}>
      <label>{t("yourComment")}<textarea required disabled={busy} maxLength={2000} rows={3} value={content} onChange={event => { attemptId.current = null; setContent(event.target.value); }}/></label>
      <button className="button orange" disabled={busy || !content.trim()}>{t(busy ? "commentSaving" : "addComment")}</button>
    </form>
  </section>;
}
