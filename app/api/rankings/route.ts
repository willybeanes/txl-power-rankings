import { NextResponse } from "next/server";
import { fetchESPNData, fetchSchedule } from "@/lib/espn";
import { scoreTeams, type ScheduleData } from "@/lib/data";

async function fetchTrackedAbPa(): Promise<Record<string, { ab: number; pa: number }>> {
  try {
    const { getSupabase } = await import("@/lib/supabase");
    const { data } = await getSupabase()
      .from("daily_snapshots")
      .select("teams")
      .gte("snapshot_date", "2026-03-25");

    const result: Record<string, { ab: number; pa: number }> = {};
    if (data) {
      for (const row of data) {
        for (const t of row.teams as { team: string; trackedAB?: number; trackedPA?: number }[]) {
          if (!result[t.team]) result[t.team] = { ab: 0, pa: 0 };
          result[t.team].ab += t.trackedAB || 0;
          result[t.team].pa += t.trackedPA || 0;
        }
      }
    }
    return result;
  } catch {
    // Supabase not configured (e.g. local dev) — return empty
    return {};
  }
}

async function fetchScheduleSafe(): Promise<ScheduleData | undefined> {
  try {
    return await fetchSchedule();
  } catch {
    return undefined;
  }
}

export async function GET() {
  try {
    const [teams, trackedAbPa, scheduleData] = await Promise.all([
      fetchESPNData(),
      fetchTrackedAbPa(),
      fetchScheduleSafe(),
    ]);
    const rankings = scoreTeams(teams, trackedAbPa, scheduleData, 8);
    return NextResponse.json({ rankings, updatedAt: new Date().toISOString() });
  } catch (error) {
    console.error("ESPN fetch error:", error);
    return NextResponse.json(
      { error: "Failed to fetch ESPN data" },
      { status: 500 }
    );
  }
}
