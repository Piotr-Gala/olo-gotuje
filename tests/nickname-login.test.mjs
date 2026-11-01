import assert from "node:assert/strict";
import test from "node:test";
import { createHandler } from "../supabase/functions/nickname-login/index.js";

const env = { get: name => ({ SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "secret", SUPABASE_ANON_KEY: "public" })[name] };
const request = body => new Request("https://example.invalid", { method: "POST", body: JSON.stringify(body) });

test("nickname login returns only session tokens after Auth verifies the password", async () => {
  const calls = [];
  const handler = createHandler(env, async (url, options) => {
    calls.push({ url, ...options, body: options.body ? JSON.parse(options.body) : null });
    return Response.json(calls.length === 1 ? "user-id" : calls.length === 2 ? { email: "private@example.invalid" } : { access_token: "access", refresh_token: "refresh", user: { email: "private@example.invalid" } });
  });
  const response = await handler(request({ identifier: " OLO ", password: "password" }));
  assert.deepEqual(await response.json(), { access_token: "access", refresh_token: "refresh" });
  assert.equal(calls[0].body.login_nickname, "OLO");
  assert.deepEqual(calls[2].body, { email: "private@example.invalid", password: "password" });
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});

test("unknown nickname and wrong password return the same error without revealing email", async () => {
  for (const email of [null, "private@example.invalid"]) {
    let calls = 0;
    const handler = createHandler(env, async () => {
      calls++;
      if (calls === 1) return Response.json(email ? "user-id" : null);
      if (email && calls === 2) return Response.json({ email });
      return Response.json({ error: "private error" }, { status: 400 });
    });
    const response = await handler(request({ identifier: "Olo", password: "wrong" }));
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Invalid credentials" });
    assert.equal(calls, email ? 3 : 2);
  }
});

test("invalid input never reaches the database; Auth rate limits are preserved", async () => {
  const handler = createHandler(env, () => { throw new Error("Unexpected fetch"); });
  assert.equal((await handler(request({ identifier: {}, password: "password" }))).status, 400);
  let calls = 0;
  const limited = createHandler(env, async () => ++calls === 1 ? Response.json(null) : new Response(null, { status: 429 }));
  assert.equal((await limited(request({ identifier: "Olo", password: "password" }))).status, 429);
});
