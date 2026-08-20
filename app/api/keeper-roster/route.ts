import { NextResponse } from "next/server";
import { DRAFT_PICKS } from "@/lib/draft";
import { OWNER_NAMES } from "@/lib/espn";

const ESPN_API_BASE =
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2026/segments/0/leagues";

// August 9, 2026 = scoringPeriodId 137 (sp1 = March 26)
const ROSTER_LOCK_SCORING_PERIOD = 137;

const HITTING_MULTS: Record<string, number> = {
  "20": 1, "7": 1, "3": 2, "4": 3, "5": 4, "8": 1, "21": 1,
  "10": 1, "27": -1, "12": 1, "23": 1, "24": -1, "30": 5,
};

const PITCHING_MULTS: Record<string, number> = {
  "34": 1, "37": -1, "45": -1, "39": -1, "42": -1, "48": 2,
  "63": 5, "62": 5, "64": 10, "53": 3, "54": -3, "57": 3, "58": -2, "60": 1,
};

const POSITION_LABELS: Record<number, string> = {
  1: "SP", 2: "C", 3: "1B", 4: "2B", 5: "3B",
  6: "SS", 7: "OF", 8: "OF", 9: "OF", 10: "DH", 11: "RP", 12: "P",
};

const PITCHER_POSITION_IDS = new Set([1, 11, 12]);

function calcScore(stats: Record<string, number>, mults: Record<string, number>): number {
  return Object.entries(mults).reduce((sum, [id, mult]) => sum + (stats[id] ?? 0) * mult, 0);
}

export interface KeeperPlayer {
  name: string;
  position: string;
  type: "hitter" | "pitcher";
  txlScore: number;
  draftRound: number | null;
  keeper: boolean;
  acquisitionType: "DRAFT" | "ADD" | "TRADE";
  keeperRound2027: number | "FA";
}

export interface KeeperTeam {
  teamName: string;
  manager: string;
  players: KeeperPlayer[];
}

export async function GET() {
  const leagueId = process.env.ESPN_LEAGUE_ID;
  const espnS2 = process.env.ESPN_S2;
  const swid = process.env.ESPN_SWID;
  if (!leagueId || !espnS2 || !swid) {
    return NextResponse.json({ error: "Missing ESPN env vars" }, { status: 500 });
  }

  const cookie = `espn_s2=${espnS2}; SWID=${swid}`;

  const res = await fetch(
    `${ESPN_API_BASE}/${leagueId}?view=mRoster&view=mTeam&scoringPeriodId=${ROSTER_LOCK_SCORING_PERIOD}`,
    { headers: { Cookie: cookie }, next: { revalidate: 3600 } }
  );
  if (!res.ok) return NextResponse.json({ error: `ESPN error ${res.status}` }, { status: 502 });

  const data = await res.json();

  const draftRoundByName: Record<string, number> = {};
  const keeperNames = new Set<string>();
  const draftManagerByName: Record<string, string> = {};
  for (const pick of DRAFT_PICKS) {
    draftRoundByName[pick.player] = pick.round;
    draftManagerByName[pick.player] = pick.manager;
    if (pick.isKeeper) keeperNames.add(pick.player);
  }

  const memberNames: Record<string, string> = { ...OWNER_NAMES };
  for (const m of data.members ?? []) {
    if (!memberNames[m.id]) memberNames[m.id] = `${m.firstName} ${m.lastName}`.trim();
  }

  const teams: KeeperTeam[] = [];

  for (const team of data.teams ?? []) {
    const manager = memberNames[team.primaryOwner] ?? team.abbrev;
    const teamName: string = team.name ?? team.abbrev;
    const players: KeeperPlayer[] = [];

    for (const entry of team.roster?.entries ?? []) {
      const ppe = entry.playerPoolEntry;
      const player = ppe?.player;
      if (!player) continue;

      const draftedBy = draftManagerByName[player.fullName];
      const acquisitionType: "DRAFT" | "ADD" | "TRADE" =
        entry.acquisitionType === "ADD"
          ? "ADD"
          : draftedBy && draftedBy === manager
          ? "DRAFT"
          : entry.acquisitionType === "TRADE"
          ? "TRADE"
          : "ADD";

      // keeperValueFuture === 0 means the player was dropped at some point this season
      // (ESPN tracks this internally). This catches ADD players AND "dropped then traded" players.
      const wasEverDropped = !ppe.keeperValueFuture;
      const draftRound = draftRoundByName[player.fullName] ?? null;
      const keeperRound2027: number | "FA" = wasEverDropped || draftRound === null
        ? "FA"
        : Math.max(1, draftRound - 3);

      const positionId: number = player.defaultPositionId ?? 0;
      const isPitcher = PITCHER_POSITION_IDS.has(positionId);
      const position = POSITION_LABELS[positionId] ?? "?";

      const seasonStat = (player.stats ?? []).find(
        (s: { statSourceId: number; statSplitTypeId: number; scoringPeriodId: number; seasonId: number }) =>
          s.statSourceId === 0 &&
          s.statSplitTypeId === 0 &&
          s.scoringPeriodId === 0 &&
          s.seasonId === 2026
      );

      const stats: Record<string, number> = seasonStat?.stats ?? {};
      const hittingScore = calcScore(stats, HITTING_MULTS);
      const pitchingScore = calcScore(stats, PITCHING_MULTS);
      const txlScore = hittingScore + pitchingScore;

      const isTwoWay = hittingScore > 50 && pitchingScore > 50;
      const displayPosition = isTwoWay ? "2-WAY" : position;
      const type = pitchingScore > hittingScore ? "pitcher" : "hitter";

      players.push({
        name: player.fullName,
        position: displayPosition,
        type,
        txlScore: Math.round(txlScore),
        draftRound,
        keeper: keeperNames.has(player.fullName),
        acquisitionType,
        keeperRound2027,
      });
    }

    // Sort players by TXL score descending
    players.sort((a, b) => b.txlScore - a.txlScore);
    teams.push({ teamName, manager, players });
  }

  // Sort teams by manager name
  teams.sort((a, b) => a.manager.localeCompare(b.manager));

  return NextResponse.json({ teams, lockDate: "2026-08-09" });
}
