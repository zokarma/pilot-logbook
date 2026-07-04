import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { supabaseConfigured } from "@/lib/supabaseServer";

export async function GET() {
  const username = await getSessionUser();
  return NextResponse.json({ username, cloud: supabaseConfigured() });
}
