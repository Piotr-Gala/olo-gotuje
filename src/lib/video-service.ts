import type { SupabaseClient } from "@supabase/supabase-js";

export const MAX_VIDEO_BYTES = 1_000_000_000;
export const VIDEO_PART_BYTES = 16 * 1024 * 1024;
export function isSameVideoOrigin(origin: string | null, host: string | null) {
  if (!origin || !host) return false;
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol) && url.origin === origin && url.host === host.toLowerCase();
  } catch { return false; }
}
export type VideoRow = {
  id: string; post_id: string | null; object_key: string; file_name: string;
  size_bytes: number; upload_id: string | null;
  state: "uploading" | "completing" | "ready" | "deleting";
  cleanup_after: string | null;
};
export type VideoPart = { number: number; size: number; etag: string };
export type VideoStorage = {
  start(key: string): Promise<string>;
  parts(key: string, uploadId: string): Promise<VideoPart[]>;
  partUrl(key: string, uploadId: string, number: number, size: number): Promise<string>;
  complete(key: string, uploadId: string, parts: VideoPart[]): Promise<void>;
  inspect(key: string): Promise<{ size: number; type: string; header: Uint8Array } | null>;
  readUrl(key: string): Promise<string>;
  abort(key: string, uploadId: string): Promise<void>;
  remove(key: string, uploadId: string | null): Promise<void>;
};

export class VideoError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}
export function assertVideoMetadata(name: unknown, size: unknown, type: unknown) {
  if (typeof name !== "string" || !name.toLowerCase().endsWith(".mp4") || name.length > 255 || type !== "video/mp4") throw new VideoError("video-format");
  if (!Number.isSafeInteger(size) || (size as number) < 12 || (size as number) > MAX_VIDEO_BYTES) throw new VideoError("video-size");
}
export function assertVideoId(id: unknown): asserts id is string {
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new VideoError("video-request");
}
export function expectedPartSize(size: number, number: unknown) {
  if (!Number.isInteger(number) || (number as number) < 1 || (number as number) > Math.ceil(size / VIDEO_PART_BYTES)) throw new VideoError("video-part");
  return Math.min(VIDEO_PART_BYTES, size - ((number as number) - 1) * VIDEO_PART_BYTES);
}
export function assertVideoParts(size: number, parts: VideoPart[]) {
  if (parts.length !== Math.ceil(size / VIDEO_PART_BYTES)) throw new VideoError("video-incomplete", 409);
  parts.forEach((part, index) => {
    if (part.number !== index + 1 || part.size !== expectedPartSize(size, index + 1) || !part.etag) throw new VideoError("video-incomplete", 409);
  });
}
export function assertStoredVideo(expectedSize: number, object: Awaited<ReturnType<VideoStorage["inspect"]>>) {
  if (!object || object.size !== expectedSize || object.type !== "video/mp4"
    || String.fromCharCode(...object.header.slice(4, 8)) !== "ftyp") throw new VideoError("video-invalid");
}

function checked<T>(result: { data: T; error: unknown }): T {
  if (result.error) throw new VideoError("video-database", 503);
  return result.data;
}
async function rowById(client: SupabaseClient, id: unknown): Promise<VideoRow> {
  assertVideoId(id);
  const row = checked(await client.from("post_videos").select("*").eq("id", id).maybeSingle()) as VideoRow | null;
  if (!row) throw new VideoError("video-missing", 404);
  return row;
}
const publicVideo = (row: VideoRow) => ({ id: row.id, name: row.file_name, size: row.size_bytes, state: row.state });

export async function readPostVideo(client: SupabaseClient, storage: VideoStorage, postId: unknown) {
  assertVideoId(postId);
  // RLS on both tables is the source of truth for visibility, including drafts/sections.
  const post = checked(await client.from("posts").select("id").eq("id", postId).maybeSingle());
  if (!post) throw new VideoError("video-missing", 404);
  const row = checked(await client.from("post_videos").select("*").eq("post_id", postId).neq("state", "deleting").maybeSingle()) as VideoRow | null;
  if (!row) return { video: null };
  if (row.state !== "ready") return { video: publicVideo(row) };
  return { video: publicVideo(row), url: await storage.readUrl(row.object_key), expiresAt: Date.now() + 15 * 60_000 };
}

async function cleanRow(client: SupabaseClient, storage: VideoStorage, row: VideoRow) {
  await storage.remove(row.object_key, row.upload_id);
  // Keep recent tombstones for another pass after in-flight requests have expired.
  if (row.cleanup_after && Date.parse(row.cleanup_after) <= Date.now()) {
    checked(await client.from("post_videos").delete().eq("id", row.id).eq("state", "deleting"));
  }
}
export async function mutateVideo(client: SupabaseClient, storage: VideoStorage, input: Record<string, unknown>) {
  if (input.action === "cleanup") {
    const rows = checked(await client.from("post_videos").select("*").eq("state", "deleting").order("cleanup_after").limit(20)) as VideoRow[];
    let failures = 0;
    for (const row of rows) { try { await cleanRow(client, storage, row); } catch { failures++; } }
    return { cleanupPending: failures > 0 };
  }
  if (input.action === "start") {
    assertVideoId(input.id); assertVideoId(input.postId);
    assertVideoMetadata(input.name, input.size, input.type);
    const post = checked(await client.from("posts").select("id").eq("id", input.postId).maybeSingle());
    if (!post) throw new VideoError("video-missing", 404);
    const insert = await client.from("post_videos").upsert({ id: input.id, post_id: input.postId, file_name: input.name, size_bytes: input.size }, { onConflict: "id", ignoreDuplicates: true });
    if (insert.error) throw new VideoError("video-exists", 409);
    let row = await rowById(client, input.id);
    if (row.post_id !== input.postId || row.file_name !== input.name || row.size_bytes !== input.size || row.state === "deleting") throw new VideoError("video-exists", 409);
    if (row.state === "ready") return { video: publicVideo(row), parts: [] };
    if (!row.upload_id) {
      const uploadId = await storage.start(row.object_key);
      const result = await client.from("post_videos").update({ upload_id: uploadId }).eq("id", row.id).eq("state", "uploading").is("upload_id", null).select("*").maybeSingle();
      if (result.error || !result.data) {
        await storage.abort(row.object_key, uploadId);
        if (result.error) throw new VideoError("video-database", 503);
        row = await rowById(client, row.id);
      } else row = result.data as VideoRow;
    }
    if (!row.upload_id || !row.post_id) throw new VideoError("video-missing", 409);
    // Completion can be retried after a lost response without uploading the file again.
    if (row.state === "completing") return { video: publicVideo(row), parts: [], completing: true };
    return { video: publicVideo(row), parts: await storage.parts(row.object_key, row.upload_id) };
  }
  const row = await rowById(client, input.id);
  if (input.action === "remove") {
    const detached = checked(await client.from("post_videos").update({ post_id: null }).eq("id", row.id).select("*").single()) as VideoRow;
    try { await cleanRow(client, storage, detached); return { cleanupPending: false }; }
    catch { return { cleanupPending: true }; }
  }
  if (!row.post_id || row.state === "deleting") throw new VideoError("video-missing", 404);
  if (input.action === "part") {
    if (row.state !== "uploading" || !row.upload_id) throw new VideoError("video-incomplete", 409);
    const size = expectedPartSize(row.size_bytes, input.number);
    return { url: await storage.partUrl(row.object_key, row.upload_id, input.number as number, size) };
  }
  if (input.action !== "complete") throw new VideoError("video-request");
  if (row.state === "ready") return { video: publicVideo(row) };
  if (!row.upload_id) throw new VideoError("video-incomplete", 409);
  let object = await storage.inspect(row.object_key);
  if (!object) {
    const parts = await storage.parts(row.object_key, row.upload_id);
    assertVideoParts(row.size_bytes, parts);
    const active = checked(await client.from("post_videos").update({ state: "completing" }).eq("id", row.id).in("state", ["uploading", "completing"]).eq("post_id", row.post_id).select("id").maybeSingle());
    if (!active) throw new VideoError("video-missing", 409);
    await storage.complete(row.object_key, row.upload_id, parts);
    object = await storage.inspect(row.object_key);
  } else {
    checked(await client.from("post_videos").update({ state: "completing" }).eq("id", row.id).eq("state", "uploading"));
  }
  try { assertStoredVideo(row.size_bytes, object); }
  catch (error) {
    checked(await client.from("post_videos").update({ post_id: null }).eq("id", row.id));
    await storage.remove(row.object_key, row.upload_id);
    throw error;
  }
  const saved = checked(await client.from("post_videos").update({ state: "ready" }).eq("id", row.id).eq("post_id", row.post_id).eq("state", "completing").select("*").maybeSingle()) as VideoRow | null;
  if (!saved) {
    const current = await rowById(client, row.id);
    if (current.state === "ready" && current.post_id === row.post_id) return { video: publicVideo(current) };
    await storage.remove(row.object_key, row.upload_id);
    throw new VideoError("video-missing", 409);
  }
  return { video: publicVideo(saved) };
}
