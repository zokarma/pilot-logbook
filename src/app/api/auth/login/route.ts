import { NextResponse } from "next/server";
import { getSupabase, supabaseConfigured } from "@/lib/supabaseServer";
import { setSessionUser } from "@/lib/session";
import { hashStr } from "@/lib/hash";

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

  const { data: row } = await sb
    .from("plb_users")
    .select("username, password_hash")
    .eq("username", user)
    .maybeSingle();

  if (!row) return NextResponse.json({ error: "No such user. Please sign up." }, { status: 404 });
  if (row.password_hash !== hashStr(password)) {
    return NextResponse.json({ error: "Incorrect password." }, { status: 401 });
  }

  await setSessionUser(user);
  return NextResponse.json({ username: user });
}
