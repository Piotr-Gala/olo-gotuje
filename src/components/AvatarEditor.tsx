"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { preparePostImage } from "@/lib/image-processing";
import { useLanguage } from "./LanguageProvider";
import { translate } from "@/lib/i18n";
import { ProfileAvatar } from "./ProfileAvatar";

export function AvatarEditor({ userId, name, initialUrl, initialPath, initialX, initialY, initialZoom }: {
  userId: string; name: string; initialUrl: string | null; initialPath: string | null;
  initialX: number; initialY: number; initialZoom: number;
}) {
  const { language } = useLanguage();
  const t = (key: Parameters<typeof translate>[1]) => translate(language, key);
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const uploadedPath = useRef<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [x, setX] = useState(initialX);
  const [y, setY] = useState(initialY);
  const [zoom, setZoom] = useState(initialZoom);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<"avatarSaved" | "avatarFailed" | "avatarInvalid" | null>(null);
  useEffect(() => { if (!file) { setPreview(null); return; } const url = URL.createObjectURL(file); setPreview(url); return () => URL.revokeObjectURL(url); }, [file]);
  async function selectFile(source?: File) {
    if (!source) return;
    setMessage(null); setBusy(true);
    try {
      if (!["image/jpeg", "image/png", "image/webp"].includes(source.type)) throw new Error("Invalid avatar");
      const image = await preparePostImage(source);
      uploadedPath.current = null;
      setFile(image); setX(50); setY(50); setZoom(1);
    } catch { setMessage("avatarInvalid"); }
    finally { setBusy(false); }
  }
  async function save() {
    if (busy) return;
    setBusy(true); setMessage(null);
    const client = createClient();
    try {
      let path = uploadedPath.current ?? initialPath;
      if (file && !uploadedPath.current) {
        path = `${userId}/${crypto.randomUUID()}.webp`;
        const { error } = await client.storage.from("family-avatars").upload(path, file, { contentType: file.type, upsert: false });
        if (error) throw error;
        uploadedPath.current = path;
      }
      const { error } = await client.rpc("update_my_avatar", { p_path: path, p_x: x, p_y: y, p_zoom: zoom });
      if (error) throw error;
      if (file && initialPath && initialPath !== path) await client.storage.from("family-avatars").remove([initialPath]).catch(() => {});
      setMessage("avatarSaved"); router.refresh();
    } catch {
      // A lost RPC response may already have saved the path; retain the upload for a safe retry.
      setMessage("avatarFailed");
    } finally { setBusy(false); }
  }
  const url = preview ?? initialUrl;
  return <section className="profile-edit">
    <h2>{t("profilePhoto")}</h2>
    <div className="profile-form avatar-editor">
      <label>{t("chooseProfilePhoto")}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => void selectFile(event.target.files?.[0])}/></label>
      <small>{t("avatarHint")}</small>
      <div className="avatar-preview"><ProfileAvatar url={url} name={name} x={x} y={y} zoom={zoom}/></div>
      {url && <>
        <label>{t("cropHorizontal")}<input type="range" min={0} max={100} value={x} disabled={busy} onChange={event => setX(Number(event.target.value))}/></label>
        <label>{t("cropVertical")}<input type="range" min={0} max={100} value={y} disabled={busy} onChange={event => setY(Number(event.target.value))}/></label>
        <label>{t("avatarZoom")}<input type="range" min={1} max={3} step={0.01} value={zoom} disabled={busy} onChange={event => setZoom(Number(event.target.value))}/></label>
        <button className="text-button" type="button" disabled={busy} onClick={() => { setX(50); setY(50); setZoom(1); }}>{t("centerPhoto")}</button>
      </>}
      {message && <p className={message === "avatarSaved" ? "form-success" : "form-error"} role={message === "avatarSaved" ? "status" : "alert"}>{t(message)}</p>}
      <button className="button orange" type="button" disabled={busy || !url} onClick={() => void save()}>{t(busy ? "commentSaving" : "saveProfilePhoto")}</button>
    </div>
  </section>;
}
