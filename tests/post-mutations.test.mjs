import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { loadTypeScript } from "./load-typescript.mjs";

const { createPostSaveSession, savePostWithPhotos, deletePostWithPhotos } = await loadTypeScript("../src/lib/post-mutations.ts");
const values = { section_slug: "gotowanie", title: "Test post", slug: "test-post", excerpt: "", content: "Content", status: "published", published_at: "2026-10-18T12:00:00Z" };
const photos = [new File(["photo"], "test.png", { type: "image/png", lastModified: 1 })];

// Exercise the real SDK against a deterministic HTTP boundary with fault injection.
function fixture() {
  const state = { posts: new Map(), images: new Map(), files: new Set(), requests: [], fail: null, loseResponse: null };
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
  const fetch = async (input, options = {}) => {
    const url = new URL(input);
    const method = options.method ?? "GET";
    const body = typeof options.body === "string" ? JSON.parse(options.body) : null;
    const operation = `${method} ${url.pathname}`;
    state.requests.push(operation);
    const failure = () => json({ message: "Injected failure", error: "Injected failure", statusCode: "500" }, 500);
    if (state.fail && operation.startsWith(state.fail)) { state.fail = null; return failure(); }
    let response;
    if (url.pathname === "/rest/v1/posts") {
      if (method === "POST") {
        if (!state.posts.has(body.id)) state.posts.set(body.id, { ...body, post_images: [] });
        response = json(null, 201);
      } else {
        const id = url.searchParams.get("id")?.slice(3);
        const post = state.posts.get(id);
        if (!post) return json({ message: "No rows", code: "PGRST116" }, 406);
        if (method === "DELETE") state.posts.delete(id);
        else if (method === "PATCH") Object.assign(post, body);
        response = json({ ...post, post_images: [...state.images.values()].filter(image => image.post_id === id) });
      }
    } else if (url.pathname === "/rest/v1/post_images") {
      state.images.set(body.id, body);
      response = json(null, 201);
    } else if (url.pathname.startsWith("/storage/v1/object/family-post-images/")) {
      // Selected photos must never make a new post visible before the final update.
      if (state.posts.size === 1 && !state.allowPublishedUpload) assert.equal([...state.posts.values()][0].status, "draft");
      state.files.add(decodeURIComponent(url.pathname.split("family-post-images/")[1]));
      response = json({ Key: url.pathname }, 200);
    } else if (url.pathname === "/storage/v1/object/family-post-images" && method === "DELETE") {
      for (const path of body.prefixes) state.files.delete(path);
      response = json([]);
    } else {
      throw new Error(`Unexpected request: ${operation}`);
    }
    if (state.loseResponse && operation.startsWith(state.loseResponse)) { state.loseResponse = null; return failure(); }
    return response;
  };
  const client = createClient("https://fixture.supabase.co", "fixture-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
  });
  return { state, client, session: createPostSaveSession() };
}

test("upload failure leaves a draft and retry publishes the same post", async () => {
  const { state, client, session } = fixture();
  state.fail = "POST /storage/v1/object/family-post-images/";
  await assert.rejects(savePostWithPhotos(client, session, values, "editor", photos));
  assert.equal(state.posts.get(session.id).status, "draft");
  await savePostWithPhotos(client, session, values, "editor", photos);
  assert.equal(state.posts.size, 1);
  assert.equal(state.posts.get(session.id).status, "published");
  assert.equal(state.files.size, 1);
  assert.equal(state.images.size, 1);
});

test("a duplicate submit cannot run a second save", async () => {
  const { state, client, session } = fixture();
  const first = savePostWithPhotos(client, session, values, "editor", photos);
  assert.equal(await savePostWithPhotos(client, session, values, "editor", photos), null);
  await first;
  assert.equal(state.posts.size, 1);
  assert.equal(state.requests.filter(request => request === "PATCH /rest/v1/posts").length, 1);
});

for (const operation of ["POST /rest/v1/posts", "POST /storage/v1/object/family-post-images/", "POST /rest/v1/post_images", "PATCH /rest/v1/posts"]) {
  test(`lost response after ${operation} can be retried without duplicates`, async () => {
    const { state, client, session } = fixture();
    state.loseResponse = operation;
    await assert.rejects(savePostWithPhotos(client, session, values, "editor", photos));
    // If publication committed but its response was lost, do not regress it to draft.
    state.allowPublishedUpload = operation === "PATCH /rest/v1/posts";
    await savePostWithPhotos(client, session, values, "editor", photos);
    assert.equal(state.posts.size, 1);
    assert.equal(state.files.size, 1);
    assert.equal(state.images.size, 1);
    assert.equal(state.posts.get(session.id).status, "published");
  });
}

test("failed photo upload while editing preserves the published content", async () => {
  const { state, client } = fixture();
  const existing = { id: "existing", ...values, content: "Original content", post_images: [] };
  state.posts.set(existing.id, { ...existing });
  state.allowPublishedUpload = true;
  state.fail = "POST /storage/v1/object/family-post-images/";
  await assert.rejects(savePostWithPhotos(client, createPostSaveSession(existing), values, "editor", photos));
  assert.equal(state.posts.get(existing.id).content, "Original content");
  assert.equal(state.posts.get(existing.id).status, "published");
});

test("failed database deletion preserves photos", async () => {
  const { state, client } = fixture();
  const post = { id: "existing", post_images: [{ storage_path: "existing/photo.png" }] };
  state.posts.set(post.id, post);
  state.files.add("existing/photo.png");
  state.fail = "DELETE /rest/v1/posts";
  await assert.rejects(deletePostWithPhotos(client, post));
  assert.equal(state.files.size, 1);
  assert.ok(!state.requests.includes("DELETE /storage/v1/object/family-post-images"));
});

test("a denied or missing row never authorizes photo deletion", async () => {
  const { state, client } = fixture();
  await assert.rejects(deletePostWithPhotos(client, { id: "missing", post_images: [{ storage_path: "missing/photo.png" }] }));
  assert.ok(!state.requests.includes("DELETE /storage/v1/object/family-post-images"));
});

test("cleanup failure reports a deleted post and preserves files for retry", async () => {
  const { state, client } = fixture();
  const post = { id: "existing", post_images: [{ storage_path: "existing/photo.png" }] };
  state.posts.set(post.id, post);
  state.files.add("existing/photo.png");
  state.fail = "DELETE /storage/v1/object/family-post-images";
  const result = await deletePostWithPhotos(client, post);
  assert.ok(result.cleanupError);
  assert.equal(state.posts.size, 0);
  assert.equal(state.files.size, 1);
  const cleanup = await client.storage.from("family-post-images").remove(["existing/photo.png"]);
  assert.equal(cleanup.error, null);
  assert.equal(state.files.size, 0);
});
