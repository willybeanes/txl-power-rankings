import { type TeamRawStats } from "./data";

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

// ESPN member ID -> manager display name
const OWNER_NAMES: Record<string, string> = {
  "{0417CF3C-8AF1-40C3-92E5-0E6FD2B493F5}": "Charley Tauer",
  "{13B3CBFC-C1F8-44D7-84E7-EC900E9F4528}": "Mike Porter",
  "{76464928-80D5-4B80-AE27-74EDFB7AB662}": "Will Harris",
  "{A19FD63E-E2B7-4D41-B1BB-DBFBA59F8B3A}": "Kevin Katsuda",
  "{E18CBE56-AAB9-4DD7-8C50-FA1A63476BCC}": "Patrick Harvey",
  "{24F2A7B2-10EF-4F23-A5A5-C7E6BD3F0C6B}": "Stephan Mattke",
  "{C31AFCB3-DA5A-4AE1-BE52-C2E61F8BCE34}": "Mike Kyne",
  "{6CF476C6-4F45-4FC9-B9C3-C14D78CFBC78}": "Austin Brennen",
  "{36FD9B7C-E96F-4F2F-AF20-95C5C9A55BD5}": "Andrew Bergoine",
  "{C879FF95-A9FF-43B3-96B5-DB35FDC4C56F}": "Artie Arredondo",
  "{3B56FC65-50D2-4B2C-BF3E-D31218C0DEC1}": "Darren Cook",
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

  // Build member ID -> name lookup from API response, fallback to hardcoded
  const memberNames: Record<string, string> = { ...OWNER_NAMES };
  for (const m of data.members) {
    memberNames[m.id] = `${m.firstName} ${m.lastName}`;
  }

  return data.teams.map((t) => {
    const stats = t.valuesByStat;
    const overall = t.record.overall;
    const streakPrefix = overall.streakType === "WIN" ? "W" : overall.streakType === "LOSS" ? "L" : "";
    const streak = streakPrefix ? `${streakPrefix}${overall.streakLength}` : "-";

    const moves = t.transactionCounter
      ? t.transactionCounter.acquisitions + t.transactionCounter.trades
      : 0;

    const manager = memberNames[t.primaryOwner] || t.abbrev;

    const raw: TeamRawStats = {
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
    };

    return raw;
  });
}
