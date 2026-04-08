import { NextResponse } from "next/server";
import { fetchESPNData, fetchDailyDetails } from "@/lib/espn";
import { scoreTeams } from "@/lib/data";
import { getSupabase } from "@/lib/supabase";

export async function GET(request: Request) {
  // Verify cron secret
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const [raw, dailyDetails] = await Promise.all([
      fetchESPNData(),
      fetchDailyDetails(),
    ]);
    const scored = scoreTeams(raw);

    // Build lookup for daily details by team name
    const dailyByName = new Map(
      dailyDetails.map((d) => [d.teamName, d])
    );

    // Use Central Time for the date since this is a US fantasy baseball league
    const today = new Date().toLocaleDateString("en-CA", {
      timeZone: "America/Chicago",
    }); // YYYY-MM-DD

    const teams = scored.map((t) => {
      const daily = dailyByName.get(t.team);
      return {
        team: t.team,
        manager: t.manager,
        rank: t.rank,
        hittingScore: t.hittingScore,
        pitchingScore: t.pitchingScore,
        totalScore: t.totalScore,
        record: t.record,
        era: t.era,
        dailyPoints: daily?.dailyPoints ?? 0,
        trackedAB: daily?.trackedAB ?? 0,
        trackedPA: daily?.trackedPA ?? 0,
      };
    });

    // Upsert so re-runs on the same day overwrite rather than fail
    const { error } = await getSupabase()
      .from("daily_snapshots")
      .upsert(
        { snapshot_date: today, teams },
        { onConflict: "snapshot_date" }
      );

    if (error) {
      console.error("Supabase upsert error:", error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, date: today, teamsCount: teams.length });
  } catch (error) {
    console.error("Snapshot cron error:", error);
    return NextResponse.json(
      { error: "Failed to create snapshot" },
      { status: 500 }
    );
  }
}
