import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

const ESPN_API_BASE =
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2026/segments/0/leagues";

/** Active batter lineup slot IDs (C, 1B, 2B, 3B, SS, OF, UTIL) */
const ACTIVE_BATTER_SLOTS = new Set([0, 1, 2, 3, 4, 5, 12]);

/** Season start: March 25, 2026 = scoring period 1 */
const SEASON_START = new Date("2026-03-25");

function scoringPeriodToDate(period: number): string {
  const d = new Date(SEASON_START);
  d.setDate(d.getDate() + period - 1);
  return d.toISOString().split("T")[0]; // YYYY-MM-DD
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const leagueId = process.env.ESPN_LEAGUE_ID;
  const espnS2 = process.env.ESPN_S2;
  const swid = process.env.ESPN_SWID;

  if (!leagueId || !espnS2 || !swid) {
    return NextResponse.json({ error: "Missing ESPN env vars" }, { status: 500 });
  }

  const cookieHeader = `espn_s2=${espnS2}; SWID=${swid}`;

  // Get current scoring period to know where to stop
  const metaRes = await fetch(`${ESPN_API_BASE}/${leagueId}?view=mTeam`, {
    headers: { Cookie: cookieHeader },
  });
  if (!metaRes.ok) {
    return NextResponse.json({ error: "ESPN meta fetch failed" }, { status: 500 });
  }
  const metaData = await metaRes.json();
  const currentPeriod: number = metaData.scoringPeriodId;

  // Build teamId -> teamName lookup
  const teamNames: Record<number, string> = {};
  for (const t of metaData.teams || []) {
    teamNames[t.id] = t.name;
  }

  // Get all matchup data (contains pointsByScoringPeriod for all periods)
  const matchupRes = await fetch(
    `${ESPN_API_BASE}/${leagueId}?view=mMatchup&view=mMatchupScore`,
    { headers: { Cookie: cookieHeader } }
  );
  if (!matchupRes.ok) {
    return NextResponse.json({ error: "ESPN matchup fetch failed" }, { status: 500 });
  }
  const matchupData = await matchupRes.json();
  const schedule = matchupData.schedule || [];

  // Build a map of teamId -> { scoringPeriodId -> dailyPoints } across all matchups
  const dailyPointsMap: Record<number, Record<number, number>> = {};
  for (const matchup of schedule) {
    for (const side of ["home", "away"] as const) {
      const team = matchup[side];
      if (!team) continue;
      if (!dailyPointsMap[team.teamId]) dailyPointsMap[team.teamId] = {};
      const pts = team.pointsByScoringPeriod || {};
      for (const [period, points] of Object.entries(pts)) {
        dailyPointsMap[team.teamId][Number(period)] = points as number;
      }
    }
  }

  const results: { date: string; status: string }[] = [];

  // Backfill each scoring period from 1 to yesterday (currentPeriod - 1)
  // Today's snapshot is handled by the regular cron
  const endPeriod = currentPeriod - 1;

  for (let period = 1; period <= endPeriod; period++) {
    const date = scoringPeriodToDate(period);

    // Fetch roster for this specific scoring period to get AB/PA
    // Must use mRoster view (not mMatchup) to get per-day player stat splits
    const rosterRes = await fetch(
      `${ESPN_API_BASE}/${leagueId}?view=mRoster&view=mTeam&scoringPeriodId=${period}`,
      { headers: { Cookie: cookieHeader } }
    );

    if (!rosterRes.ok) {
      results.push({ date, status: `ESPN fetch failed: ${rosterRes.status}` });
      continue;
    }

    const rosterData = await rosterRes.json();

    // Build AB/PA per team for this period
    const abPaMap: Record<number, { ab: number; pa: number }> = {};
    for (const team of rosterData.teams || []) {
      let ab = 0, pa = 0;
      const roster = team.roster?.entries || [];
      for (const entry of roster) {
        if (!ACTIVE_BATTER_SLOTS.has(entry.lineupSlotId)) continue;
        const stats = entry.playerPoolEntry?.player?.stats || [];
        const dayStats = stats.find(
          (s: { statSplitTypeId: number; scoringPeriodId: number }) =>
            s.statSplitTypeId === 5 && s.scoringPeriodId === period
        );
        if (dayStats?.stats) {
          ab += dayStats.stats["0"] || 0;
          pa += dayStats.stats["16"] || 0;
        }
      }
      abPaMap[team.id] = { ab, pa };
    }

    // Build snapshot for this day
    const teams = Object.keys(teamNames).map((idStr) => {
      const id = Number(idStr);
      return {
        team: teamNames[id],
        manager: null,
        rank: null,
        hittingScore: null,
        pitchingScore: null,
        totalScore: null,
        record: null,
        era: null,
        dailyPoints: dailyPointsMap[id]?.[period] ?? 0,
        trackedAB: abPaMap[id]?.ab ?? 0,
        trackedPA: abPaMap[id]?.pa ?? 0,
      };
    });

    const { error } = await getSupabase()
      .from("daily_snapshots")
      .upsert(
        { snapshot_date: date, teams },
        { onConflict: "snapshot_date" }
      );

    results.push({ date, status: error ? `Error: ${error.message}` : "ok" });
  }

  return NextResponse.json({ backfilled: results });
}
