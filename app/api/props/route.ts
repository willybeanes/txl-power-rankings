import { NextResponse } from "next/server";
import { fetchESPNData } from "@/lib/espn";
import { scoreTeams } from "@/lib/data";

const ESPN_API_BASE =
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2026/segments/0/leagues";

export async function GET() {
  const leagueId = process.env.ESPN_LEAGUE_ID;
  const espnS2 = process.env.ESPN_S2;
  const swid = process.env.ESPN_SWID;

  if (!leagueId || !espnS2 || !swid) {
    return NextResponse.json({ error: "Missing ESPN env vars" }, { status: 500 });
  }

  const cookieHeader = `espn_s2=${espnS2}; SWID=${swid}`;
  const cacheOpts = { next: { revalidate: 300 } } as const;

  const [raw, matchupRes, metaRes] = await Promise.all([
    fetchESPNData(),
    fetch(`${ESPN_API_BASE}/${leagueId}?view=mMatchup&view=mMatchupScore`, {
      headers: { Cookie: cookieHeader },
      ...cacheOpts,
    }),
    fetch(`${ESPN_API_BASE}/${leagueId}?view=mTeam`, {
      headers: { Cookie: cookieHeader },
      ...cacheOpts,
    }),
  ]);

  if (!matchupRes.ok || !metaRes.ok) {
    return NextResponse.json({ error: "ESPN fetch failed" }, { status: 502 });
  }

  const [matchupData, metaData] = await Promise.all([matchupRes.json(), metaRes.json()]);
  const scored = scoreTeams(raw);

  const currentMatchupPeriod: number = metaData.status?.currentMatchupPeriod ?? 99;

  // Build teamId -> team name (from mTeam which always has this)
  const teamNameById: Record<number, string> = {};
  for (const t of metaData.teams ?? []) teamNameById[t.id] = t.name;

  // Build team name -> scored team
  const teamByName = new Map(scored.map((t) => [t.team, t]));

  // Determine how many scoring days each matchup period spans
  const periodDays: Record<number, number> = {};
  for (const matchup of matchupData.schedule ?? []) {
    const pid: number = matchup.matchupPeriodId;
    const days = Object.keys(matchup.home?.pointsByScoringPeriod ?? {}).length;
    periodDays[pid] = Math.max(periodDays[pid] ?? 0, days);
  }

  // Valid for "high score" prop: completed (< currentMatchupPeriod), not period 1, exactly 7 days
  const validPeriods = new Set(
    Object.entries(periodDays)
      .filter(([pid, days]) => Number(pid) > 1 && Number(pid) < currentMatchupPeriod && days === 7)
      .map(([pid]) => Number(pid))
  );

  // Collect all weekly scores from valid periods
  type WeekScore = { team: string; manager: string; week: number; points: number };
  const weeklyScores: WeekScore[] = [];

  for (const matchup of matchupData.schedule ?? []) {
    if (!validPeriods.has(matchup.matchupPeriodId)) continue;
    for (const side of ["home", "away"] as const) {
      const team = matchup[side];
      if (!team || !team.totalPoints) continue;
      const teamName = teamNameById[team.teamId];
      if (!teamName) continue;
      weeklyScores.push({
        team: teamName,
        manager: teamByName.get(teamName)?.manager ?? "",
        week: matchup.matchupPeriodId,
        points: team.totalPoints,
      });
    }
  }

  weeklyScores.sort((a, b) => b.points - a.points);
  const weeklyTop3 = weeklyScores.slice(0, 3);

  // HR leaders (season total)
  const hrRanked = [...scored].sort((a, b) => b.raw.HR - a.raw.HR);

  // Pitcher K leaders (season total)
  const kRanked = [...scored].sort((a, b) => b.raw.K_P - a.raw.K_P);

  // Bad luck: PA_rank + PF_rank - W%_rank (lowest score = most bad luck)
  const n = scored.length;
  const paRank = [...scored]
    .sort((a, b) => b.pointsAgainst - a.pointsAgainst)
    .reduce<Record<string, number>>((acc, t, i) => { acc[t.team] = i + 1; return acc; }, {});

  const pfRank = [...scored]
    .sort((a, b) => b.pointsFor - a.pointsFor)
    .reduce<Record<string, number>>((acc, t, i) => { acc[t.team] = i + 1; return acc; }, {});

  const wPctRank = [...scored]
    .sort((a, b) => {
      const wa = a.raw.matchupWins / Math.max(1, a.raw.matchupWins + a.raw.matchupLosses);
      const wb = b.raw.matchupWins / Math.max(1, b.raw.matchupWins + b.raw.matchupLosses);
      return wb - wa; // rank 1 = best record
    })
    .reduce<Record<string, number>>((acc, t, i) => { acc[t.team] = i + 1; return acc; }, {});

  const badLuck = scored
    .map((t) => ({
      team: t.team,
      manager: t.manager,
      record: t.record,
      pointsFor: t.pointsFor,
      pointsAgainst: t.pointsAgainst,
      paRank: paRank[t.team],
      pfRank: pfRank[t.team],
      wPctRank: wPctRank[t.team],
      badLuckScore: paRank[t.team] + pfRank[t.team] - wPctRank[t.team],
    }))
    .sort((a, b) => a.badLuckScore - b.badLuckScore); // lowest = most bad luck

  return NextResponse.json({
    n,
    hrTop3: hrRanked.slice(0, 3).map((t) => ({ team: t.team, manager: t.manager, value: t.raw.HR })),
    kTop3: kRanked.slice(0, 3).map((t) => ({ team: t.team, manager: t.manager, value: t.raw.K_P })),
    weeklyTop3,
    badLuck,
  });
}
