const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
};

export function createHandler(env, fetcher = fetch) {
  return async (request) => {
    const reply = (body, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { ...cors, "Content-Type": "application/json" },
    });
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
    try {
      const { identifier, password } = await request.json();
      if (typeof identifier !== "string" || !identifier.trim() || identifier.length > 40 || identifier.includes("@") ||
          typeof password !== "string" || !password || password.length > 4096) {
        return reply({ error: "Invalid credentials" }, 400);
      }
      const url = env.get("SUPABASE_URL");
      const key = env.get("SUPABASE_SERVICE_ROLE_KEY");
      const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
      const lookup = await fetcher(`${url}/rest/v1/rpc/login_user_for_nickname`, {
        method: "POST", headers, body: JSON.stringify({ login_nickname: identifier.trim() }),
      });
      if (!lookup.ok) return reply({ error: "Sign in unavailable" }, 503);
      const userId = await lookup.json();
      let email;
      if (userId) {
        const user = await fetcher(`${url}/auth/v1/admin/users/${userId}`, { headers });
        if (!user.ok) return reply({ error: "Sign in unavailable" }, 503);
        email = (await user.json()).email;
      }
      // Unknown nicknames also reach Auth, preserving its password checks and rate limits.
      const auth = await fetcher(`${url}/auth/v1/token?grant_type=password`, {
        method: "POST", headers: { ...headers, apikey: env.get("SUPABASE_ANON_KEY") },
        body: JSON.stringify({ email: email || "unknown-login@accounts.olo.invalid", password }),
      });
      if (!auth.ok) return reply({ error: "Invalid credentials" }, auth.status === 429 ? 429 : 401);
      const session = await auth.json();
      return reply({ access_token: session.access_token, refresh_token: session.refresh_token });
    } catch {
      return reply({ error: "Sign in unavailable" }, 503);
    }
  };
}

if (typeof Deno !== "undefined") Deno.serve(createHandler(Deno.env));
