import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  let query = getSupabase()
    .from("daily_snapshots")
    .select("snapshot_date, teams")
    .order("snapshot_date", { ascending: true });

  if (from) query = query.gte("snapshot_date", from);
  if (to) query = query.lte("snapshot_date", to);

  // Default to last 30 days if no range specified
  if (!from && !to) {
    const thirtyAgo = new Date();
    thirtyAgo.setDate(thirtyAgo.getDate() - 30);
    query = query.gte("snapshot_date", thirtyAgo.toISOString().split("T")[0]);
  }

  const { data, error } = await query;

  if (error) {
    console.error("Snapshots fetch error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ snapshots: data });
}
