import { NextResponse } from "next/server";
import { getSupabase, supabaseConfigured } from "@/lib/supabaseServer";
import { getSessionUser } from "@/lib/session";
import { BugReport } from "@/lib/types";

// POST /api/bugs — upsert a bug report into the shared table.
// The screenshot is intentionally never pushed — it stays a local blob only.
export async function POST(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: "cloud-not-configured" }, { status: 503 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "not-authenticated" }, { status: 401 });
  const sb = getSupabase()!;

  const r = (await req.json()) as BugReport;
  const { error } = await sb.from("plb_bug_reports").upsert([
    {
      id: r.id,
      username: r.username,
      created_at: r.created_at,
      status: r.status,
      severity: r.severity,
      description: r.description,
      steps: r.steps || "",
      tab: r.tab || "",
      url: r.url || "",
      user_agent: r.user_agent || "",
      viewport: r.viewport || "",
      app_version: r.app_version || "",
      app_state: r.app_state || {},
      recent_errors: r.recent_errors || [],
    },
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

// DELETE /api/bugs?id=... — remove a bug report from the shared table.
export async function DELETE(req: Request) {
  if (!supabaseConfigured()) return NextResponse.json({ error: "cloud-not-configured" }, { status: 503 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "not-authenticated" }, { status: 401 });
  const sb = getSupabase()!;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const { error } = await sb.from("plb_bug_reports").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
