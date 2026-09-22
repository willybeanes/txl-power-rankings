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
  const teamIdByName: Record<string, number> = {};
  for (const t of metaData.teams ?? []) {
    teamNameById[t.id] = t.name;
    teamIdByName[t.name] = t.id;
  }

  // Build team name -> scored team
  const teamByName = new Map(scored.map((t) => [t.team, t]));

  // Regular season = matchup periods 1–18; playoffs = 19–21.
  // ESPN's mTeam valuesByStat include playoffs, so we rebuild HR, K, pointsFor,
  // pointsAgainst, and W/L from the per-matchup cumulativeScore.scoreByStat data.
  const RS_LAST_PERIOD = 18;
  type RSEntry = { hr: number; k: number; pf: number; pa: number; w: number; l: number };
  const rsStats: Record<number, RSEntry> = {};

  for (const matchup of matchupData.schedule ?? []) {
    const pid: number = matchup.matchupPeriodId;
    if (pid > RS_LAST_PERIOD) continue;
    for (const [side, opp] of [["home", "away"], ["away", "home"]] as [string, string][]) {
      const team = matchup[side as "home" | "away"];
      const oppTeam = matchup[opp as "home" | "away"];
      if (!team) continue;
      const tid: number = team.teamId;
      if (!rsStats[tid]) rsStats[tid] = { hr: 0, k: 0, pf: 0, pa: 0, w: 0, l: 0 };
      const entry = rsStats[tid];
      entry.hr += team.cumulativeScore?.scoreByStat?.["5"]?.score ?? 0;
      entry.k += team.cumulativeScore?.scoreByStat?.["48"]?.score ?? 0;
      entry.pf += team.totalPoints ?? 0;
      entry.pa += oppTeam?.totalPoints ?? 0;
      const won = matchup.winner === side.toUpperCase();
      const lost =
        matchup.winner !== "UNDECIDED" && matchup.winner !== "TIE" && !won;
      if (won) entry.w++;
      if (lost) entry.l++;
    }
  }

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

  // HR leaders (regular season only, periods 1–18)
  const hrRanked = [...scored].sort((a, b) => {
    const aRS = rsStats[teamIdByName[a.team] ?? 0]?.hr ?? 0;
    const bRS = rsStats[teamIdByName[b.team] ?? 0]?.hr ?? 0;
    return bRS - aRS;
  });

  // Pitcher K leaders (regular season only, periods 1–18)
  const kRanked = [...scored].sort((a, b) => {
    const aRS = rsStats[teamIdByName[a.team] ?? 0]?.k ?? 0;
    const bRS = rsStats[teamIdByName[b.team] ?? 0]?.k ?? 0;
    return bRS - aRS;
  });

  // Dense ranking helper: ties share the same rank, next distinct value increments by 1
  type ScoredTeam = typeof scored[0];
  // Competition ranking ("1224"): tied teams share the lowest rank in their group;
  // the next group's rank skips past all tied positions (e.g. 1, 2, 2, 4, 4, 4, 7…)
  function competitionRank(
    items: ScoredTeam[],
    getValue: (t: ScoredTeam) => number,
    descending = true
  ): Record<string, number> {
    const sorted = [...items].sort((a, b) =>
      descending ? getValue(b) - getValue(a) : getValue(a) - getValue(b)
    );
    const result: Record<string, number> = {};
    let i = 0;
    while (i < sorted.length) {
      const val = getValue(sorted[i]);
      let j = i;
      // find end of tie group
      while (j < sorted.length && getValue(sorted[j]) === val) j++;
      // all items in [i, j) share rank (i + 1)
      for (let k = i; k < j; k++) result[sorted[k].team] = i + 1;
      i = j;
    }
    return result;
  }

  // Bad luck: PA_rank + PF_rank - W%_rank (lowest score = most bad luck)
  // Uses regular-season-only pointsFor, pointsAgainst, and W/L (periods 1–18).
  const n = scored.length;

  // Build RS-only versions of the scored array for ranking purposes
  type ScoredTeamRS = (typeof scored)[0] & {
    rsPF: number; rsPA: number; rsWins: number; rsLosses: number;
  };
  const scoredRS: ScoredTeamRS[] = scored.map((t) => {
    const rs = rsStats[teamIdByName[t.team] ?? 0] ?? { pf: 0, pa: 0, w: 0, l: 0 };
    return { ...t, rsPF: rs.pf, rsPA: rs.pa, rsWins: rs.w, rsLosses: rs.l };
  });

  const paRank = competitionRank(scoredRS, (t) => (t as ScoredTeamRS).rsPA);
  const pfRank = competitionRank(scoredRS, (t) => (t as ScoredTeamRS).rsPF);
  const wPctRank = competitionRank(
    scoredRS,
    (t) => {
      const tt = t as ScoredTeamRS;
      return tt.rsWins / Math.max(1, tt.rsWins + tt.rsLosses);
    }
  );

  const badLuck = scoredRS
    .map((t) => {
      const rsW = t.rsWins;
      const rsL = t.rsLosses;
      return {
        team: t.team,
        manager: t.manager,
        record: `${rsW}-${rsL}`,
        pointsFor: t.rsPF,
        pointsAgainst: t.rsPA,
        paRank: paRank[t.team],
        pfRank: pfRank[t.team],
        wPctRank: wPctRank[t.team],
        badLuckScore: paRank[t.team] + pfRank[t.team] - wPctRank[t.team],
      };
    })
    .sort((a, b) => a.badLuckScore - b.badLuckScore); // lowest = most bad luck

  return NextResponse.json({
    n,
    hrAll: hrRanked.map((t) => ({
      team: t.team,
      manager: t.manager,
      value: rsStats[teamIdByName[t.team] ?? 0]?.hr ?? 0,
    })),
    kAll: kRanked.map((t) => ({
      team: t.team,
      manager: t.manager,
      value: rsStats[teamIdByName[t.team] ?? 0]?.k ?? 0,
    })),
    weeklyTop10: weeklyScores.slice(0, 10),
    badLuck,
  });
}
