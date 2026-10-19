import { createClient } from "@/lib/supabase/server";
import { createVideoStorage } from "@/lib/r2";
import { isSameVideoOrigin, mutateVideo, readPostVideo, VideoError } from "@/lib/video-service";

export const runtime = "nodejs";
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });

async function handle(request: Request) {
  try {
    // Next.js may reconstruct request.url with the bound server address (0.0.0.0).
    // Host is the origin addressed by the browser; arbitrary forwarded headers are ignored.
    if (request.method === "POST" && !isSameVideoOrigin(request.headers.get("origin"), request.headers.get("host"))) throw new VideoError("video-forbidden", 403);
    const client = await createClient();
    if (!client) throw new VideoError("video-unconfigured", 503);
    const { data: auth, error: authError } = await client.auth.getUser();
    if (authError || !auth.user) throw new VideoError("video-login", 401);
    const { data: profile, error } = await client.from("profiles").select("role,is_approved").eq("id", auth.user.id).maybeSingle();
    if (error || !profile?.is_approved) throw new VideoError("video-forbidden", 403);
    const storage = createVideoStorage();
    if (request.method === "GET") return json(await readPostVideo(client, storage, new URL(request.url).searchParams.get("postId")));
    if (!["admin", "owner"].includes(profile.role)) throw new VideoError("video-forbidden", 403);
    if (!request.headers.get("content-type")?.startsWith("application/json") || Number(request.headers.get("content-length")) > 4096) throw new VideoError("video-request");
    const text = await request.text();
    if (text.length > 4096) throw new VideoError("video-request");
    const input = JSON.parse(text);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new VideoError("video-request");
    return json(await mutateVideo(client, storage, input));
  } catch (error) {
    if (error instanceof VideoError) return json({ error: error.code }, error.status);
    if (error instanceof SyntaxError) return json({ error: "video-request" }, 400);
    return json({ error: error instanceof Error && error.message === "video-unconfigured" ? "video-unconfigured" : "video-storage" }, 503);
  }
}
export const GET = handle;
export const POST = handle;
