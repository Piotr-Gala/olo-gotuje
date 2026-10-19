"use client";

import { useEffect, useRef, useState } from "react";
import { useLanguage } from "./LanguageProvider";
import { getPostVideo, validateSelectedVideo, videoRequest, type VideoInfo } from "@/lib/video-upload";

export function videoErrorText(error: unknown, en: boolean) {
  const code = error instanceof Error ? error.message : "";
  if (code === "video-size") return en ? "The video must be no larger than 1 GB." : "Film może mieć maksymalnie 1 GB.";
  if (code === "video-format" || code === "video-invalid") return en ? "Choose a playable MP4 file (H.264/AAC recommended)." : "Wybierz film MP4 możliwy do odtworzenia w przeglądarce (zalecane H.264/AAC).";
  if (code === "video-exists") return en ? "This post already has a video or unfinished upload. Remove it first." : "Wpis ma już film lub niedokończony upload. Najpierw go usuń.";
  if (code === "video-unconfigured") return en ? "Video storage is not configured on this server yet." : "Obsługa filmów nie jest jeszcze skonfigurowana na tym serwerze.";
  return en ? "Video operation failed. Retry; uploaded parts are kept while this form stays open." : "Operacja na filmie nie powiodła się. Ponów zapis — wysłane części pozostają, dopóki ten formularz jest otwarty.";
}

export function PostVideo({ postId }: { postId: string }) {
  const { language } = useLanguage();
  const en = language === "en";
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const player = useRef<HTMLVideoElement | null>(null);
  const resume = useRef({ time: 0, play: false });
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const data = await getPostVideo(postId, controller.signal);
        if (controller.signal.aborted) return;
        if (player.current) resume.current = { time: player.current.currentTime, play: !player.current.paused };
        setUrl(data.url ?? null); setError(false);
        if (data.url && data.expiresAt) timer = setTimeout(() => void refresh(), Math.max(10_000, data.expiresAt - Date.now() - 60_000));
      } catch { if (!controller.signal.aborted) { setUrl(null); setError(true); } }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [postId, attempt]);
  if (error) return <p className="form-hint" role="status">{en ? "Could not play the video." : "Nie udało się odtworzyć filmu."} <button className="text-button" type="button" onClick={() => setAttempt(value => value + 1)}>{en ? "Retry" : "Spróbuj ponownie"}</button></p>;
  if (!url) return null;
  return <video className="post-video" controls playsInline preload="metadata" src={url} ref={player}
    onLoadedMetadata={() => { if (player.current && resume.current.time) { player.current.currentTime = resume.current.time; if (resume.current.play) void player.current.play().catch(() => {}); } }}
    onError={() => setError(true)} aria-label={en ? "Post video" : "Film do wpisu"}>{en ? "Your browser cannot play this video." : "Twoja przeglądarka nie potrafi odtworzyć tego filmu."}</video>;
}

export function VideoAttachment({ postId, selected, locked, onSelect, onPreparing, onError }: {
  postId?: string; selected: File | null; locked: boolean; onSelect(file: File | null): void; onPreparing(preparing: boolean): void; onError(message: string): void;
}) {
  const { language } = useLanguage();
  const en = language === "en";
  const [existing, setExisting] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(!!postId);
  const [failed, setFailed] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!postId) return;
    const controller = new AbortController();
    setLoading(true); setFailed(false);
    getPostVideo(postId, controller.signal).then(data => { if (!controller.signal.aborted) setExisting(data.video); })
      .catch(() => { if (!controller.signal.aborted) setFailed(true); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [postId, revision]);
  async function remove() {
    if (!existing || !window.confirm(en ? "Remove this video?" : "Usunąć ten film?")) return;
    setLoading(true);
    try {
      const result = await videoRequest({ action: "remove", id: existing.id });
      setExisting(null); onSelect(null);
      if (result.cleanupPending) onError(en ? "Video detached. File cleanup will be retried." : "Film odłączony. Sprzątanie pliku zostanie ponowione.");
    } catch (error) { onError(videoErrorText(error, en)); }
    finally { setLoading(false); }
  }
  return <div className="video-attachment">
    <label>{en ? "Video" : "Film"} <span>{en ? "One MP4, up to 1 GB. Recommended: H.264/AAC." : "Jeden MP4, do 1 GB. Zalecane: H.264/AAC."}</span>
      <input type="file" accept="video/mp4,.mp4" disabled={locked || loading || failed || (!!existing && !selected)} onChange={async event => {
        const file = event.currentTarget.files?.[0];
        if (!file) { onSelect(null); return; }
        onPreparing(true);
        try { await validateSelectedVideo(file); onSelect(file); }
        catch (error) { onSelect(null); onError(videoErrorText(error, en)); }
        finally { onPreparing(false); }
      }}/>
    </label>
    {selected && <small>{selected.name} · {(selected.size / 1_000_000).toFixed(1)} MB</small>}
    {loading && <small>{en ? "Loading video…" : "Wczytywanie filmu…"}</small>}
    {failed && <button className="text-button" type="button" onClick={() => setRevision(value => value + 1)}>{en ? "Retry loading video" : "Ponów wczytywanie filmu"}</button>}
    {existing && !selected && <p>{existing.name} {existing.state !== "ready" && (en ? "(unfinished upload)" : "(niedokończony upload)")} <button className="text-button danger" type="button" disabled={loading} onClick={() => void remove()}>{en ? "Remove video" : "Usuń film"}</button></p>}
  </div>;
}
