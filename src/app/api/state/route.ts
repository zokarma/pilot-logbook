import { NextResponse } from "next/server";
import { getSupabase, supabaseConfigured } from "@/lib/supabaseServer";
import { getSessionUser } from "@/lib/session";
import { migrateData } from "@/lib/migrate";
import { AppData, BugReport, emptyData } from "@/lib/types";

// GET /api/state — full AppData for the signed-in user.
// Flights/duty/pilots live in plb_app_state (jsonb); bug reports live in the
// shared plb_bug_reports table (visible across users), screenshots excluded.
export async function GET() {
  if (!supabaseConfigured()) return NextResponse.json({ error: "cloud-not-configured" }, { status: 503 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "not-authenticated" }, { status: 401 });
  const sb = getSupabase()!;

  const { data: row } = await sb.from("plb_app_state").select("data").eq("username", user).maybeSingle();
  const data: AppData = migrateData((row?.data as AppData) || emptyData());

  try {
    const { data: bugRows } = await sb.from("plb_bug_reports").select("*");
    if (bugRows) data.bugReports = bugRows as unknown as BugReport[];
  } catch {
    /* missing table OK — feature degrades */
  }

  return NextResponse.json(data);
}

// PUT /api/state — persist the whole logbook (last-write-wins). Bug reports are
// stored via /api/bugs, so they're stripped here to avoid duplication.
export async function PUT(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: "cloud-not-configured" }, { status: 503 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "not-authenticated" }, { status: 401 });
  const sb = getSupabase()!;

  const body = (await req.json()) as AppData;
  const toStore = { ...body };
  delete (toStore as Partial<AppData>).bugReports;

  const { error } = await sb.from("plb_app_state").upsert({
    username: user,
    data: toStore,
    updated_at: new Date().toISOString(),
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
