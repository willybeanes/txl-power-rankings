import { NextResponse } from "next/server";
import { DRAFT_PICKS } from "@/lib/draft";

const ESPN_API_BASE =
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2026/segments/0/leagues";

// ESPN stat ID → TXL hitting multiplier
const HITTING_MULTS: Record<string, number> = {
  "20": 1,   // R
  "7":  1,   // 1B
  "3":  2,   // 2B
  "4":  3,   // 3B
  "5":  4,   // HR
  "8":  1,   // TB
  "21": 1,   // RBI
  "10": 1,   // BB
  "27": -1,  // K
  "12": 1,   // HBP
  "23": 1,   // SB
  "24": -1,  // CS
  "30": 5,   // CYC
};

// ESPN stat ID → TXL pitching multiplier
const PITCHING_MULTS: Record<string, number> = {
  "34": 1,   // Outs (IP)
  "37": -1,  // H
  "45": -1,  // ER
  "39": -1,  // BB
  "42": -1,  // HB
  "48": 2,   // K
  "63": 5,   // QS
  "62": 5,   // CG
  "64": 10,  // SO (shutout)
  "53": 3,   // W
  "54": -3,  // L
  "57": 3,   // SV
  "58": -2,  // BS
  "60": 1,   // HD
};

// ESPN defaultPositionId → display label
const POSITION_LABELS: Record<number, string> = {
  1: "SP", 2: "C", 3: "1B", 4: "2B", 5: "3B",
  6: "SS", 7: "OF", 8: "DH", 9: "OF", 10: "OF",
  11: "RP", 12: "P",
};

const PITCHER_POSITION_IDS = new Set([1, 11, 12]);

function calcScore(stats: Record<string, number>, mults: Record<string, number>): number {
  return Object.entries(mults).reduce((sum, [id, mult]) => sum + (stats[id] ?? 0) * mult, 0);
}

export interface PlayerEntry {
  name: string;
  team: string;       // fantasy team name
  manager: string;
  position: string;
  type: "hitter" | "pitcher";
  txlScore: number;
  draftRound: number | null;  // null = undrafted (FA/waiver pickup)
  keeper: boolean;
}

export async function GET() {
  const leagueId = process.env.ESPN_LEAGUE_ID;
  const espnS2 = process.env.ESPN_S2;
  const swid = process.env.ESPN_SWID;
  if (!leagueId || !espnS2 || !swid) {
    return NextResponse.json({ error: "Missing ESPN env vars" }, { status: 500 });
  }

  const cookie = `espn_s2=${espnS2}; SWID=${swid}`;

  const [res, draftRes] = await Promise.all([
    fetch(`${ESPN_API_BASE}/${leagueId}?view=mRoster&view=mTeam`,
      { headers: { Cookie: cookie }, next: { revalidate: 300 } }),
    fetch(`${ESPN_API_BASE}/${leagueId}?view=mDraftDetail`,
      { headers: { Cookie: cookie }, next: { revalidate: 86400 } }),
  ]);
  if (!res.ok) return NextResponse.json({ error: `ESPN error ${res.status}` }, { status: 502 });

  const data = await res.json();

  // Build playerId → round map from ESPN draft detail
  const draftRoundByPlayerId: Record<number, number> = {};
  if (draftRes.ok) {
    const draftData = await draftRes.json();
    for (const pick of draftData.draftDetail?.picks ?? []) {
      draftRoundByPlayerId[pick.playerId] = pick.roundId;
    }
  }

  // Build keeper set from the authoritative hardcoded draft list (ESPN's keeper flag is unreliable)
  const keeperNames = new Set(
    DRAFT_PICKS.filter((p) => p.isKeeper).map((p) => p.player)
  );

  // Build member ID → manager name
  const memberNames: Record<string, string> = {};
  for (const m of data.members ?? []) {
    memberNames[m.id] = `${m.firstName} ${m.lastName}`.trim();
  }

  const players: PlayerEntry[] = [];

  for (const team of data.teams ?? []) {
    const manager = memberNames[team.primaryOwner] ?? team.abbrev;
    const teamName: string = team.name ?? team.abbrev;

    for (const entry of team.roster?.entries ?? []) {
      const player = entry.playerPoolEntry?.player;
      if (!player) continue;

      const positionId: number = player.defaultPositionId ?? 0;
      const isPitcher = PITCHER_POSITION_IDS.has(positionId);
      const position = POSITION_LABELS[positionId] ?? "?";

      // Season total stats (statSourceId=0, statSplitTypeId=0, scoringPeriodId=0)
      const seasonStat = (player.stats ?? []).find(
        (s: { statSourceId: number; statSplitTypeId: number; scoringPeriodId: number; seasonId: number }) =>
          s.statSourceId === 0 &&
          s.statSplitTypeId === 0 &&
          s.scoringPeriodId === 0 &&
          s.seasonId === 2026
      );

      if (!seasonStat?.stats) continue;

      const stats: Record<string, number> = seasonStat.stats;

      // Always compute both — stat IDs don't overlap, so two-way players
      // (Ohtani etc.) get credit for both; single-way players are unaffected.
      const hittingScore = calcScore(stats, HITTING_MULTS);
      const pitchingScore = calcScore(stats, PITCHING_MULTS);
      const txlScore = hittingScore + pitchingScore;

      // Skip players with zero contribution
      if (txlScore === 0) continue;

      // Show "2-WAY" if the player has meaningful contributions on both sides
      const isTwoWay = hittingScore > 50 && pitchingScore > 50;
      const displayPosition = isTwoWay ? "2-WAY" : position;
      const type = pitchingScore > hittingScore ? "pitcher" : "hitter";

      players.push({
        name: player.fullName,
        team: teamName,
        manager,
        position: displayPosition,
        type,
        txlScore: Math.round(txlScore),
        draftRound: draftRoundByPlayerId[player.id] ?? null,
        keeper: keeperNames.has(player.fullName),
      });
    }
  }

  // Sort all players by TXL score descending
  players.sort((a, b) => b.txlScore - a.txlScore);

  return NextResponse.json({ players });
}
