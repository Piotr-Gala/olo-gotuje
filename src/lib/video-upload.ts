import { assertVideoMetadata, VIDEO_PART_BYTES } from "./video-service";

export type VideoInfo = { id: string; name: string; size: number; state: string };
export type VideoUploadSession = { id: string; file: File };
export async function videoRequest(input: Record<string, unknown>, signal?: AbortSignal) {
  const response = await fetch("/api/videos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input), signal: signal ?? AbortSignal.timeout(30_000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "video-storage");
  return data;
}
export async function getPostVideo(postId: string, signal?: AbortSignal): Promise<{ video: VideoInfo | null; url?: string; expiresAt?: number }> {
  const response = await fetch(`/api/videos?postId=${encodeURIComponent(postId)}`, { cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "video-storage");
  return data;
}
export async function validateSelectedVideo(file: File) {
  assertVideoMetadata(file.name, file.size, file.type);
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (String.fromCharCode(...header.slice(4, 8)) !== "ftyp") throw new Error("video-format");
}

function uploadPart(url: string, chunk: Blob, signal: AbortSignal, progress: (bytes: number) => void) {
  return new Promise<void>((resolve, reject) => {
    signal.throwIfAborted();
    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const finish = (error?: Error) => {
      signal.removeEventListener("abort", abort);
      if (error) reject(error); else resolve();
    };
    xhr.open("PUT", url);
    xhr.timeout = 300_000;
    xhr.upload.onprogress = event => { if (event.lengthComputable) progress(event.loaded); };
    xhr.onload = () => finish(xhr.status >= 200 && xhr.status < 300 ? undefined : new Error("video-storage"));
    xhr.onerror = xhr.ontimeout = () => finish(new Error("video-storage"));
    xhr.onabort = () => finish(new DOMException("Upload cancelled", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    // Blob.size supplies the signed Content-Length; credentials never reach this client.
    xhr.send(chunk);
  });
}
export async function uploadPostVideo(postId: string, session: VideoUploadSession, signal: AbortSignal, progress: (percent: number) => void) {
  signal.throwIfAborted();
  const file = session.file;
  const start = await videoRequest({ action: "start", id: session.id, postId, name: file.name, size: file.size, type: file.type });
  signal.throwIfAborted();
  if (start.video.state === "ready") { progress(100); return; }
  if (!start.completing) {
    const parts = new Map<number, number>(start.parts.map((part: { number: number; size: number }) => [part.number, part.size]));
    let sent = 0;
    for (let number = 1; number <= Math.ceil(file.size / VIDEO_PART_BYTES); number++) {
      signal.throwIfAborted();
      const chunk = file.slice((number - 1) * VIDEO_PART_BYTES, Math.min(number * VIDEO_PART_BYTES, file.size));
      if (parts.get(number) !== chunk.size) {
        for (let attempt = 0; ; attempt++) {
          try {
            const { url } = await videoRequest({ action: "part", id: session.id, number }, signal);
            await uploadPart(url, chunk, signal, bytes => progress(Math.min(99, Math.floor((sent + bytes) / file.size * 100))));
            break;
          } catch (error) {
            if (signal.aborted || attempt >= 2) throw error;
          }
        }
      }
      sent += chunk.size;
      progress(Math.min(99, Math.floor(sent / file.size * 100)));
    }
  }
  signal.throwIfAborted();
  await videoRequest({ action: "complete", id: session.id });
  signal.throwIfAborted();
  progress(100);
}
