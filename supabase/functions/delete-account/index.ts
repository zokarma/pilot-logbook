// Supabase Edge Function: delete-account
//
// Permanently deletes the calling user's account. Required by Apple App Store
// Guideline 5.1.1(v) (apps with account creation must offer in-app deletion).
//
// The service-role key lives ONLY in this function's environment (injected by
// Supabase) — never in the app bundle. The caller is identified from their own
// JWT, so a user can only ever delete themselves. Deleting the auth user
// cascades and removes their `plb_app_state` row.
//
// Deploy: `supabase functions deploy delete-account`

import { createClient } from "jsr:@supabase/supabase-js@2";

// CORS is deliberately "*": the app is served from varying origins (Vercel
// previews, capacitor://localhost in the iOS shell), and this function
// authorizes strictly by the caller's own JWT — the origin is never trusted,
// and a caller can only ever delete their own account.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "Missing Authorization header" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Identify the caller from their JWT.
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "Invalid or expired session" }, 401);

  // Delete the user with admin privileges (cascades to plb_app_state).
  const admin = createClient(supabaseUrl, serviceKey);
  const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
  if (delErr) return json({ error: delErr.message }, 500);

  return json({ ok: true }, 200);
});
