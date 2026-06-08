import { type TeamRawStats, type ScheduleEntry, type ScheduleData } from "./data";

const ESPN_API_BASE = "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2026/segments/0/leagues";

// ESPN stat ID -> our stat name mapping
const HITTING_STAT_MAP: Record<string, keyof TeamRawStats> = {
  "20": "R",
  "7": "1B",
  "3": "2B",
  "4": "3B",
  "5": "HR",
  "8": "TB",
  "21": "RBI",
  "10": "BB",
  "27": "K",
  "12": "HBP",
  "23": "SB",
  "24": "CS",
  "30": "CYC",
};

const PITCHING_STAT_MAP: Record<string, keyof TeamRawStats> = {
  "34": "Outs",
  "37": "H_P",
  "45": "ER",
  "39": "BB_P",
  "42": "HB",
  "48": "K_P",
  "63": "QS",
  "62": "CG",
  "64": "SO",
  "65": "NH",
  "66": "PG",
  "53": "W",
  "54": "L",
  "57": "SV",
  "58": "BS",
  "60": "HD",
};

// ESPN member ID -> manager display name (canonical names matching DRAFT_PICKS)
export const OWNER_NAMES: Record<string, string> = {
  "{0417CF3C-8AF1-40C3-92E5-0E6FD2B493F5}": "Charley Tauer",
  "{13B3CBFC-C1F8-44D7-84E7-EC900E9F4528}": "Mike Porter",
  "{76464928-80D5-4B80-AE27-74EDFB7AB662}": "Will Harris",
  "{2A241A3D-5A41-45D5-92D8-D8EE0B9CEDEC}": "Patrick Harvey",
  "{4C605B04-E018-4656-A05B-04E0181656D8}": "Josh Brooks",
  "{24C8E096-4CFD-4307-88E0-964CFD0307EE}": "Stephan Mattke",
  "{9E099A7C-57B3-45AA-80DB-336B4414A7EF}": "Mike Kyne",
  "{6A60FD67-F27A-4783-88B5-58BC500862BF}": "Austin Brennen",
  "{B43826C7-7812-4A45-889A-41757347E792}": "Andrew Bergoine",
  "{B2D3C5B3-052A-4539-8530-520974A0AC43}": "Artie Arredondo",
  "{89E53238-E581-40C0-85E5-68B5937136EB}": "Darren Cook",
  "{96F39564-A0FB-41BA-B395-64A0FBA1BABA}": "Kevin Katsuda",
};

interface ESPNTeam {
  id: number;
  name: string;
  abbrev: string;
  primaryOwner: string;
  owners?: string[];
  points: number;
  record: {
    overall: {
      wins: number;
      losses: number;
      streakLength: number;
      streakType: string;
      pointsFor?: number;
      pointsAgainst?: number;
    };
  };
  valuesByStat: Record<string, number>;
  transactionCounter?: {
    acquisitions: number;
    drops: number;
    trades: number;
    moveToActive: number;
    moveToIR: number;
  };
}

interface ESPNMember {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
}

interface ESPNResponse {
  teams: ESPNTeam[];
  members: ESPNMember[];
}

/**
 * Convert a parsed ESPN API response (teams + members arrays) into TeamRawStats[].
 * Shared by fetchESPNData and the backfill route.
 */
export function parseESPNResponse(data: ESPNResponse): TeamRawStats[] {
  const memberNames: Record<string, string> = { ...OWNER_NAMES };
  for (const m of data.members ?? []) {
    memberNames[m.id] = `${m.firstName} ${m.lastName}`;
  }

  return (data.teams ?? []).map((t) => {
    const stats = t.valuesByStat ?? {};
    const overall = t.record?.overall ?? { wins: 0, losses: 0, streakType: "", streakLength: 0 };
    const streakPrefix = overall.streakType === "WIN" ? "W" : overall.streakType === "LOSS" ? "L" : "";
    const streak = streakPrefix ? `${streakPrefix}${overall.streakLength}` : "-";

    const moves = t.transactionCounter
      ? t.transactionCounter.acquisitions + t.transactionCounter.trades
      : 0;

    const manager = memberNames[t.primaryOwner] || t.abbrev;

    return {
      team: t.name,
      manager,
      R: stats["20"] ?? 0,
      "1B": stats["7"] ?? 0,
      "2B": stats["3"] ?? 0,
      "3B": stats["4"] ?? 0,
      HR: stats["5"] ?? 0,
      TB: stats["8"] ?? 0,
      RBI: stats["21"] ?? 0,
      BB: stats["10"] ?? 0,
      K: stats["27"] ?? 0,
      HBP: stats["12"] ?? 0,
      SB: stats["23"] ?? 0,
      CS: stats["24"] ?? 0,
      CYC: stats["30"] ?? 0,
      Outs: stats["34"] ?? 0,
      H_P: stats["37"] ?? 0,
      ER: stats["45"] ?? 0,
      BB_P: stats["39"] ?? 0,
      HB: stats["42"] ?? 0,
      K_P: stats["48"] ?? 0,
      QS: stats["63"] ?? 0,
      CG: stats["62"] ?? 0,
      SO: stats["64"] ?? 0,
      NH: stats["65"] ?? 0,
      PG: stats["66"] ?? 0,
      W: stats["53"] ?? 0,
      L: stats["54"] ?? 0,
      SV: stats["57"] ?? 0,
      BS: stats["58"] ?? 0,
      HD: stats["60"] ?? 0,
      STRK: streak,
      MOVES: moves,
      matchupWins: overall.wins,
      matchupLosses: overall.losses,
      pointsFor: overall.pointsFor ?? 0,
      pointsAgainst: overall.pointsAgainst ?? 0,
    } satisfies TeamRawStats;
  });
}

export async function fetchESPNData(): Promise<TeamRawStats[]> {
  const leagueId = process.env.ESPN_LEAGUE_ID;
  const espnS2 = process.env.ESPN_S2;
  const swid = process.env.ESPN_SWID;

  if (!leagueId || !espnS2 || !swid) {
    throw new Error("Missing ESPN environment variables");
  }

  const url = `${ESPN_API_BASE}/${leagueId}?view=mTeam&view=mStandings`;
  const res = await fetch(url, {
    headers: {
      Cookie: `espn_s2=${espnS2}; SWID=${swid}`,
    },
    next: { revalidate: 300 }, // cache for 5 minutes
  });

  if (!res.ok) {
    throw new Error(`ESPN API error: ${res.status}`);
  }

  const data: ESPNResponse = await res.json();
  return parseESPNResponse(data);
}

export async function fetchSchedule(): Promise<ScheduleData> {
  const leagueId = process.env.ESPN_LEAGUE_ID;
  const espnS2 = process.env.ESPN_S2;
  const swid = process.env.ESPN_SWID;
  if (!leagueId || !espnS2 || !swid) throw new Error("Missing ESPN env vars");
  const cookieHeader = `espn_s2=${espnS2}; SWID=${swid}`;
  const cacheOpts = { next: { revalidate: 300 } } as const;

  const [metaRes, matchupRes] = await Promise.all([
    fetch(`${ESPN_API_BASE}/${leagueId}?view=mTeam`, { headers: { Cookie: cookieHeader }, ...cacheOpts }),
    fetch(`${ESPN_API_BASE}/${leagueId}?view=mMatchup`, { headers: { Cookie: cookieHeader }, ...cacheOpts }),
  ]);
  if (!metaRes.ok || !matchupRes.ok) throw new Error("ESPN schedule fetch failed");
  const [metaData, matchupData] = await Promise.all([metaRes.json(), matchupRes.json()]);

  const currentMatchupPeriod: number = metaData.status?.currentMatchupPeriod ?? 1;

  const teamNames: Record<number, string> = {};
  for (const t of metaData.teams || []) teamNames[t.id] = t.name;

  const entries: ScheduleEntry[] = [];
  for (const matchup of matchupData.schedule || []) {
    if (!matchup.home || !matchup.away) continue;
    entries.push({
      matchupPeriodId: matchup.matchupPeriodId,
      homeTeam: teamNames[matchup.home.teamId] ?? `Team ${matchup.home.teamId}`,
      awayTeam: teamNames[matchup.away.teamId] ?? `Team ${matchup.away.teamId}`,
    });
  }

  return { entries, currentMatchupPeriod };
}

export interface TeamDailyDetails {
  teamId: number;
  teamName: string;
  dailyPoints: number;
  trackedAB: number;
  trackedPA: number;
}

/** Active batter lineup slot IDs (C, 1B, 2B, 3B, SS, OF, UTIL) */
const ACTIVE_BATTER_SLOTS = new Set([0, 1, 2, 3, 4, 5, 12]);

export async function fetchDailyDetails(): Promise<TeamDailyDetails[]> {
  const leagueId = process.env.ESPN_LEAGUE_ID;
  const espnS2 = process.env.ESPN_S2;
  const swid = process.env.ESPN_SWID;

  if (!leagueId || !espnS2 || !swid) {
    throw new Error("Missing ESPN environment variables");
  }

  // First get the current scoring period
  const metaUrl = `${ESPN_API_BASE}/${leagueId}?view=mTeam`;
  const metaRes = await fetch(metaUrl, {
    headers: { Cookie: `espn_s2=${espnS2}; SWID=${swid}` },
  });
  if (!metaRes.ok) throw new Error(`ESPN meta error: ${metaRes.status}`);
  const metaData = await metaRes.json();

  const scoringPeriodId: number = metaData.scoringPeriodId;
  const currentMatchupPeriod: number = metaData.status?.currentMatchupPeriod;

  // Fetch matchup data with rosters for today's scoring period
  const url = `${ESPN_API_BASE}/${leagueId}?view=mMatchup&view=mMatchupScore&scoringPeriodId=${scoringPeriodId}`;
  const res = await fetch(url, {
    headers: { Cookie: `espn_s2=${espnS2}; SWID=${swid}` },
  });
  if (!res.ok) throw new Error(`ESPN matchup error: ${res.status}`);
  const data = await res.json();

  // Also build a teamId -> teamName lookup from metaData.teams
  const teamNames: Record<number, string> = {};
  for (const t of metaData.teams || []) {
    teamNames[t.id] = t.name;
  }

  const results: TeamDailyDetails[] = [];
  const schedule = data.schedule || [];

  for (const matchup of schedule) {
    if (matchup.matchupPeriodId !== currentMatchupPeriod) continue;

    for (const side of ["home", "away"] as const) {
      const team = matchup[side];
      if (!team) continue;

      const dailyPoints = team.pointsByScoringPeriod?.[scoringPeriodId] ?? 0;

      // Sum tracked AB/PA from active batter slots
      let trackedAB = 0;
      let trackedPA = 0;
      const roster = team.rosterForCurrentScoringPeriod?.entries || [];
      for (const entry of roster) {
        if (!ACTIVE_BATTER_SLOTS.has(entry.lineupSlotId)) continue;
        const stats = entry.playerPoolEntry?.player?.stats || [];
        const dayStats = stats.find(
          (s: { statSplitTypeId: number; scoringPeriodId: number }) =>
            s.statSplitTypeId === 5 && s.scoringPeriodId === scoringPeriodId
        );
        if (dayStats?.stats) {
          trackedAB += dayStats.stats["0"] || 0;
          trackedPA += dayStats.stats["16"] || 0;
        }
      }

      results.push({
        teamId: team.teamId,
        teamName: teamNames[team.teamId] || `Team ${team.teamId}`,
        dailyPoints,
        trackedAB,
        trackedPA,
      });
    }
  }

  return results;
}
