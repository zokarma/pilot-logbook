import { NextResponse } from "next/server";
import { getSupabase, supabaseConfigured } from "@/lib/supabaseServer";
import { setSessionUser } from "@/lib/session";
import { hashStr } from "@/lib/hash";
import { emptyData } from "@/lib/types";

export async function POST(req: Request) {
  if (!supabaseConfigured()) {
    return NextResponse.json({ error: "cloud-not-configured" }, { status: 503 });
  }
  const sb = getSupabase()!;
  const { username, password } = await req.json();
  const user = String(username || "").trim();
  if (!user || !password) {
    return NextResponse.json({ error: "Username and password are required." }, { status: 400 });
  }

  const { data: existing } = await sb.from("plb_users").select("username").eq("username", user).maybeSingle();
  if (existing) {
    return NextResponse.json({ error: "Username already exists. Try logging in." }, { status: 409 });
  }

  const { error } = await sb.from("plb_users").insert({ username: user, password_hash: hashStr(password) });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await sb.from("plb_app_state").upsert({
    username: user,
    data: emptyData(),
    updated_at: new Date().toISOString(),
  });

  await setSessionUser(user);
  return NextResponse.json({ username: user });
}
