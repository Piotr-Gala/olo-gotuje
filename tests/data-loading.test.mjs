import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { loadTypeScript } from "./load-typescript.mjs";

const { fetchAllRows } = await loadTypeScript("../src/lib/pagination.ts");
const { setPostLiked } = await loadTypeScript("../src/lib/post-likes.ts");
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const clientWithFetch = fetch => createClient("https://fixture.supabase.co", "fixture-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch },
});

test("pagination reads beyond the API row cap without skipping short pages", async () => {
  const rows = Array.from({ length: 1205 }, (_, index) => ({ id: String(index).padStart(4, "0") }));
  const offsets = [];
  const client = clientWithFetch(async input => {
    const url = new URL(input);
    assert.equal(url.searchParams.get("order"), "id.asc");
    const offset = Number(url.searchParams.get("offset"));
    offsets.push(offset);
    // Simulate a server configured with a smaller cap than the requested page.
    const limit = Math.min(37, Number(url.searchParams.get("limit")));
    return json(rows.slice(offset, offset + limit));
  });
  const result = await fetchAllRows((from, to) => client.from("posts").select("id").order("id").range(from, to));
  assert.equal(result.error, null);
  assert.deepEqual(result.data, rows);
  assert.equal(offsets.at(-1), rows.length);
});

test("a failed later page never returns a silently incomplete list", async () => {
  const client = clientWithFetch(async input => {
    const url = new URL(input);
    return Number(url.searchParams.get("offset")) === 0
      ? json([{ id: "first" }])
      : json({ code: "42501", message: "Access denied" }, 403);
  });
  const result = await fetchAllRows((from, to) => client.from("posts").select("id").order("id").range(from, to));
  assert.equal(result.error.code, "42501");
  assert.deepEqual(result.data, []);
});

test("unlike retries succeed when a lost response already removed the row", async () => {
  let liked = true;
  let loseResponse = true;
  const client = clientWithFetch(async (input, options) => {
    const url = new URL(input);
    assert.equal(options.method, "DELETE");
    assert.equal(url.searchParams.get("post_id"), "eq.post");
    assert.equal(url.searchParams.get("user_id"), "eq.user");
    liked = false;
    if (loseResponse) {
      loseResponse = false;
      return json({ message: "Response lost" }, 500);
    }
    return new Response(null, { status: 204 });
  });
  await assert.rejects(setPostLiked(client, "post", "user", false));
  assert.equal(liked, false);
  await setPostLiked(client, "post", "user", false);
  assert.equal(liked, false);
});

test("unlike still reports an actual API failure", async () => {
  const client = clientWithFetch(async () => json({ code: "42501", message: "Access denied" }, 403));
  await assert.rejects(setPostLiked(client, "post", "user", false), error => error.code === "42501");
});
