import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { loadTypeScript } from "./load-typescript.mjs";

const { mutateVideo, readPostVideo, assertVideoMetadata, expectedPartSize, VIDEO_PART_BYTES, isSameVideoOrigin } = await loadTypeScript("../src/lib/video-service.ts");
const postId = "20000000-0000-4000-8000-000000000001";
const videoId = "30000000-0000-4000-8000-000000000001";
const start = { action: "start", id: videoId, postId, name: "test.mp4", size: 40, type: "video/mp4" };
const mp4Header = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);

function fixture() {
  const rows = new Map();
  const state = { rows, post: true, object: null, parts: [], starts: 0, completions: 0, removes: 0, failRemove: false, loseComplete: false, detachDuringComplete: false, dbFailure: null };
  const fetch = async (input, options = {}) => {
    const url = new URL(input);
    const table = url.pathname.split("/").at(-1);
    const method = options.method ?? "GET";
    const body = options.body ? JSON.parse(options.body) : null;
    const headers = new Headers(options.headers);
    const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
    if (state.dbFailure === `${method} ${table}`) { state.dbFailure = null; return response({ message: "Injected database failure" }, 503); }
    if (table === "posts") return response(state.post ? [{ id: postId }] : []);
    assert.equal(table, "post_videos");
    const matches = row => [...url.searchParams].every(([key, filter]) => {
      if (["select", "order", "limit", "on_conflict"].includes(key)) return true;
      if (filter.startsWith("eq.")) return String(row[key]) === filter.slice(3);
      if (filter.startsWith("neq.")) return String(row[key]) !== filter.slice(4);
      if (filter === "is.null") return row[key] === null;
      if (filter.startsWith("in.(")) return filter.slice(4, -1).split(",").includes(row[key]);
      throw new Error(`Unexpected filter: ${key} ${filter}`);
    });
    let results = [...rows.values()].filter(matches);
    if (method === "POST") {
      if (!rows.has(body.id)) {
        if ([...rows.values()].some(row => row.post_id === body.post_id)) return response({ code: "23505" }, 409);
        rows.set(body.id, { ...body, object_key: `videos/${body.id}.mp4`, state: "uploading", upload_id: null, cleanup_after: null });
      }
      return response(null, 201);
    }
    if (method === "PATCH") {
      for (const row of results) {
        if (body.post_id === null && row.post_id !== null) Object.assign(row, { state: "deleting", cleanup_after: new Date(Date.now() + 3600_000).toISOString() });
        Object.assign(row, body);
      }
    }
    if (method === "DELETE") for (const row of results) rows.delete(row.id);
    if (method !== "GET" && !headers.get("prefer")?.includes("return=representation")) return response(null);
    if (headers.get("accept")?.includes("vnd.pgrst.object")) return results.length === 1 ? response(results[0]) : response({ code: "PGRST116", details: "The result contains 0 rows" }, 406);
    return response(results);
  };
  const client = createClient("https://fixture.supabase.co", "fixture-key", { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch } });
  const storage = {
    async start() { state.starts++; return `upload-${state.starts}`; },
    async parts() { return state.parts; },
    async partUrl(key, id, number, size) { return `https://r2.invalid/${key}?part=${number}&size=${size}`; },
    async complete() {
      state.completions++;
      state.object = { size: [...rows.values()][0].size_bytes, type: "video/mp4", header: mp4Header };
      if (state.detachDuringComplete) Object.assign(rows.get(videoId), { post_id: null, state: "deleting", cleanup_after: new Date(Date.now() + 3600_000).toISOString() });
      if (state.loseComplete) { state.loseComplete = false; throw new Error("Lost R2 response"); }
    },
    async inspect() { return state.object; },
    async readUrl() { return "https://r2.invalid/signed-read"; },
    async abort() {},
    async remove() { state.removes++; if (state.failRemove) throw new Error("R2 unavailable"); state.object = null; },
  };
  return { state, client, storage, action: input => mutateVideo(client, storage, input) };
}

test("video format, exact 1 GB limit, and part bounds are validated", () => {
  assert.doesNotThrow(() => assertVideoMetadata("test.mp4", 1_000_000_000, "video/mp4"));
  for (const size of [0, -1, 1.5, 1_000_000_001, Number.NaN, "40"]) assert.throws(() => assertVideoMetadata("test.mp4", size, "video/mp4"));
  assert.throws(() => assertVideoMetadata("test.mov", 40, "video/quicktime"));
  for (const number of [0, -1, 1.5, "1", 3]) assert.throws(() => expectedPartSize(VIDEO_PART_BYTES + 9, number));
  assert.equal(expectedPartSize(VIDEO_PART_BYTES + 9, 2), 9);
});

test("origin checks use the browser Host while denying foreign and missing origins", () => {
  assert.equal(isSameVideoOrigin("http://localhost:3000", "localhost:3000"), true);
  assert.equal(isSameVideoOrigin("https://www.olo-gotuje.pl", "www.olo-gotuje.pl"), true);
  for (const origin of [null, "null", "https://example.invalid", "https://www.olo-gotuje.pl.evil.invalid", "http://localhost:3000/path", "data:text/plain,test"]) {
    assert.equal(isSameVideoOrigin(origin, "www.olo-gotuje.pl"), false);
  }
  assert.equal(isSameVideoOrigin("http://localhost:3000", "localhost:3001"), false);
});

test("start retries keep one row and one multipart upload", async () => {
  const f = fixture();
  await f.action(start); await f.action(start);
  assert.equal(f.state.starts, 1); assert.equal(f.state.rows.size, 1);
  assert.equal((await f.action({ action: "part", id: videoId, number: 1 })).url.includes("size=40"), true);
});

test("resume reports uploaded parts and never accepts another post identity", async () => {
  const f = fixture(); await f.action(start);
  f.state.parts = [{ number: 1, size: 40, etag: "part-1" }];
  assert.deepEqual((await f.action(start)).parts, f.state.parts);
  await assert.rejects(f.action({ ...start, postId: "20000000-0000-4000-8000-000000000002" }), /video-exists/);
});

test("incomplete or oversized parts cannot publish and remain resumable", async () => {
  const f = fixture(); await f.action(start);
  await assert.rejects(f.action({ action: "complete", id: videoId }), /video-incomplete/);
  assert.equal(f.state.rows.get(videoId).state, "uploading");
  f.state.parts = [{ number: 1, size: 41, etag: "part-1" }];
  await assert.rejects(f.action({ action: "complete", id: videoId }), /video-incomplete/);
  assert.equal(f.state.completions, 0);
});

test("completion checks actual R2 bytes before enabling read URLs", async () => {
  const f = fixture(); await f.action(start);
  assert.equal((await readPostVideo(f.client, f.storage, postId)).url, undefined);
  f.state.parts = [{ number: 1, size: 40, etag: "part-1" }];
  await f.action({ action: "complete", id: videoId });
  const video = await readPostVideo(f.client, f.storage, postId);
  assert.equal(video.url, "https://r2.invalid/signed-read");
  assert.ok(video.expiresAt - Date.now() <= 900_000);
});

test("a lost R2 completion response is recovered by inspecting the saved object", async () => {
  const f = fixture(); await f.action(start);
  f.state.parts = [{ number: 1, size: 40, etag: "part-1" }]; f.state.loseComplete = true;
  await assert.rejects(f.action({ action: "complete", id: videoId }));
  await f.action({ action: "complete", id: videoId });
  assert.equal(f.state.completions, 1); assert.equal(f.state.rows.get(videoId).state, "ready");
});

test("invalid MP4 bytes are detached and deleted instead of becoming playable", async () => {
  const f = fixture(); await f.action(start);
  f.state.object = { size: 40, type: "video/mp4", header: new Uint8Array(12) };
  await assert.rejects(f.action({ action: "complete", id: videoId }), /video-invalid/);
  assert.equal(f.state.rows.get(videoId).state, "deleting"); assert.equal(f.state.object, null);
});

test("post deletion during completion deletes the object and keeps a cleanup tombstone", async () => {
  const f = fixture(); await f.action(start); f.state.detachDuringComplete = true;
  f.state.parts = [{ number: 1, size: 40, etag: "part-1" }];
  await assert.rejects(f.action({ action: "complete", id: videoId }), /video-missing/);
  assert.equal(f.state.object, null); assert.equal(f.state.rows.get(videoId).state, "deleting");
});

test("cleanup failures survive retries and recent tombstones cover outstanding requests", async () => {
  const f = fixture(); await f.action(start); f.state.failRemove = true;
  assert.equal((await f.action({ action: "remove", id: videoId })).cleanupPending, true);
  assert.equal(f.state.rows.get(videoId).post_id, null);
  assert.equal((await f.action({ action: "cleanup" })).cleanupPending, true);
  f.state.failRemove = false;
  assert.equal((await f.action({ action: "cleanup" })).cleanupPending, false);
  assert.equal(f.state.rows.size, 1);
  f.state.rows.get(videoId).cleanup_after = "2000-01-01T00:00:00Z";
  f.state.dbFailure = "DELETE post_videos";
  assert.equal((await f.action({ action: "cleanup" })).cleanupPending, true);
  assert.equal(f.state.rows.size, 1);
  await f.action({ action: "cleanup" });
  assert.equal(f.state.rows.size, 0);
});

test("a missing or hidden post never receives a signed URL", async () => {
  const f = fixture(); await f.action(start);
  f.state.post = false;
  await assert.rejects(readPostVideo(f.client, f.storage, postId), /video-missing/);
});
