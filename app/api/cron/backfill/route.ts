import { NextResponse } from "next/server";
import { fetchESPNData } from "@/lib/espn";
import { scoreTeams } from "@/lib/data";
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

  // Fetch current TXL totals (season to date) — used to scale the daily estimates
  const [rawStats, matchupRes, metaRes] = await Promise.all([
    fetchESPNData(),
    fetch(`${ESPN_API_BASE}/${leagueId}?view=mMatchup&view=mMatchupScore`, {
      headers: { Cookie: cookieHeader },
    }),
    fetch(`${ESPN_API_BASE}/${leagueId}?view=mTeam`, {
      headers: { Cookie: cookieHeader },
    }),
  ]);

  if (!matchupRes.ok || !metaRes.ok) {
    return NextResponse.json({ error: "ESPN fetch failed" }, { status: 500 });
  }

  const [matchupData, metaData] = await Promise.all([
    matchupRes.json(),
    metaRes.json(),
  ]);

  const currentPeriod: number = metaData.scoringPeriodId;

  // Current TXL totals per team name
  const scored = scoreTeams(rawStats);
  const txlTotalByTeam = new Map(scored.map((t) => [t.team, t.totalScore]));
  const managerByTeam = new Map(scored.map((t) => [t.team, t.manager]));

  // Build teamId -> teamName
  const teamNameById: Record<number, string> = {};
  for (const t of metaData.teams || []) teamNameById[t.id] = t.name;

  // Build teamId -> { scoringPeriod -> espnDailyPoints }
  const espnDailyById: Record<number, Record<number, number>> = {};
  for (const matchup of matchupData.schedule || []) {
    for (const side of ["home", "away"] as const) {
      const team = matchup[side];
      if (!team) continue;
      if (!espnDailyById[team.teamId]) espnDailyById[team.teamId] = {};
      for (const [period, pts] of Object.entries(team.pointsByScoringPeriod || {})) {
        espnDailyById[team.teamId][Number(period)] = pts as number;
      }
    }
  }

  // Compute cumulative ESPN totals per team per period, and overall season ESPN total
  // We'll use these to scale to TXL totals
  const espnCumByTeam: Record<number, number[]> = {}; // teamId -> cumulative per period
  for (const [idStr, daily] of Object.entries(espnDailyById)) {
    const id = Number(idStr);
    let cum = 0;
    espnCumByTeam[id] = [];
    for (let p = 1; p < currentPeriod; p++) {
      cum += daily[p] ?? 0;
      espnCumByTeam[id][p] = cum;
    }
  }

  const endPeriod = currentPeriod - 1;

  // Fetch AB/PA data per period (one call per period, for OPS tracking)
  // Run all fetches in parallel to speed up the backfill
  const rosterFetches = Array.from({ length: endPeriod }, (_, i) => i + 1).map((period) =>
    fetch(
      `${ESPN_API_BASE}/${leagueId}?view=mRoster&view=mTeam&scoringPeriodId=${period}`,
      { headers: { Cookie: cookieHeader } }
    ).then((r) => (r.ok ? r.json() : null))
  );
  const rosterResults = await Promise.all(rosterFetches);

  const results: { date: string; status: string }[] = [];

  for (let period = 1; period <= endPeriod; period++) {
    const date = scoringPeriodToDate(period);
    const rosterData = rosterResults[period - 1];

    // Build AB/PA per team for this period
    const abPaByTeamId: Record<number, { ab: number; pa: number }> = {};
    if (rosterData) {
      for (const team of rosterData.teams || []) {
        let ab = 0, pa = 0;
        for (const entry of team.roster?.entries || []) {
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
        abPaByTeamId[team.id] = { ab, pa };
      }
    }

    // For each team, estimate TXL cumulative total through this period by scaling
    // ESPN cumulative points proportionally to the known TXL season total.
    //
    //   txl_estimate[period] = (espn_cum[period] / espn_cum[final]) × txl_final
    //
    // This gives accurate day-to-day shape while landing on the exact TXL total.
    const teams = [];
    for (const [id, teamName] of Object.entries(teamNameById)) {
      const numId = Number(id);
      const txlFinal = txlTotalByTeam.get(teamName) ?? 0;
      const espnCum = espnCumByTeam[numId]?.[period] ?? 0;
      const espnFinal = espnCumByTeam[numId]?.[endPeriod] ?? 1;
      const estimatedTxlTotal = espnFinal > 0
        ? Math.round((espnCum / espnFinal) * txlFinal)
        : 0;

      // Daily delta = today's estimated total - yesterday's
      const prevEstimate = period > 1
        ? Math.round(((espnCumByTeam[numId]?.[period - 1] ?? 0) / espnFinal) * txlFinal)
        : 0;
      const dailyPoints = estimatedTxlTotal - prevEstimate;

      teams.push({
        team: teamName,
        manager: managerByTeam.get(teamName) ?? null,
        rank: null,
        hittingScore: null,
        pitchingScore: null,
        totalScore: estimatedTxlTotal,
        record: null,
        era: null,
        dailyPoints,
        trackedAB: abPaByTeamId[numId]?.ab ?? 0,
        trackedPA: abPaByTeamId[numId]?.pa ?? 0,
      });
    }

    const { error } = await getSupabase()
      .from("daily_snapshots")
      .upsert({ snapshot_date: date, teams }, { onConflict: "snapshot_date" });

    results.push({ date, status: error ? `Error: ${error.message}` : "ok" });
  }

  return NextResponse.json({ backfilled: results });
}
