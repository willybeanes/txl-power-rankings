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

  // Build member ID -> display name from live API data
  const memberNames: Record<string, string> = {};
  for (const m of data.members ?? []) {
    memberNames[m.id] = `${m.firstName} ${m.lastName}`.trim();
  }

  // Build manager display name -> current player full names
  const rosters: Record<string, string[]> = {};
  for (const team of data.teams ?? []) {
    const manager = memberNames[team.primaryOwner] ?? team.abbrev;
    const players: string[] = [];
    for (const entry of team.roster?.entries ?? []) {
      const name: string | undefined = entry.playerPoolEntry?.player?.fullName;
      if (name) players.push(name);
    }
    rosters[manager] = players;
  }

  return NextResponse.json({ rosters });
}
