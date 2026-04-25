import { NextResponse } from "next/server";

const ESPN_API_BASE =
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2026/segments/0/leagues";

export async function GET() {
  const leagueId = process.env.ESPN_LEAGUE_ID;
  const espnS2 = process.env.ESPN_S2;
  const swid = process.env.ESPN_SWID;

  if (!leagueId || !espnS2 || !swid) {
    return NextResponse.json({ error: "Missing ESPN env vars" }, { status: 500 });
  }

  const res = await fetch(
    `${ESPN_API_BASE}/${leagueId}?view=mRoster&view=mTeam`,
    {
      headers: { Cookie: `espn_s2=${espnS2}; SWID=${swid}` },
      next: { revalidate: 300 },
    }
  );

  if (!res.ok) {
    return NextResponse.json({ error: `ESPN error ${res.status}` }, { status: 502 });
  }

  const data = await res.json();

  // Build member ID -> display name
  const memberNames: Record<string, string> = {};
  for (const m of data.members ?? []) {
    memberNames[m.id] = `${m.firstName} ${m.lastName}`.trim();
  }

  // Build manager name -> current player list
  // AND player name -> 2026 season total fantasy points
  const rosters: Record<string, string[]> = {};
  const playerPoints: Record<string, number> = {};
  const teamNames: Record<string, string> = {};

  for (const team of data.teams ?? []) {
    const manager = memberNames[team.primaryOwner] ?? team.abbrev;
    const espnTeamName: string = team.name ?? team.abbrev;
    teamNames[manager] = espnTeamName;
    const players: string[] = [];

    for (const entry of team.roster?.entries ?? []) {
      const player = entry.playerPoolEntry?.player;
      if (!player) continue;

      const name: string = player.fullName;
      players.push(name);

      // Season total: actual stats (source=0), full-season split (split=0),
      // no specific scoring period (period=0), current season (2026)
      const seasonStat = (player.stats ?? []).find(
        (s: { statSourceId: number; statSplitTypeId: number; scoringPeriodId: number; seasonId: number }) =>
          s.statSourceId === 0 &&
          s.statSplitTypeId === 0 &&
          s.scoringPeriodId === 0 &&
          s.seasonId === 2026
      );

      if (seasonStat != null) {
        playerPoints[name] = Math.round(seasonStat.appliedTotal);
      }
    }

    rosters[manager] = players;
  }

  return NextResponse.json({ rosters, playerPoints, teamNames });
}
