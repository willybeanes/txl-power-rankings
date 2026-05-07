import { NextResponse } from "next/server";

const ESPN_API_BASE =
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2026/segments/0/leagues";

// TXL hitting multipliers (stat ID → multiplier)
const HITTING_MULTIPLIERS: Record<string, number> = {
  "20": 1,   // R
  "7": 1,    // 1B
  "3": 2,    // 2B
  "4": 3,    // 3B
  "5": 4,    // HR
  "8": 1,    // TB
  "21": 1,   // RBI
  "10": 1,   // BB
  "27": -1,  // K
  "12": 1,   // HBP
  "23": 1,   // SB
  "24": -1,  // CS
  "30": 5,   // CYC
};

function calcTxlScore(stats: Record<string, number>): number {
  return Object.entries(HITTING_MULTIPLIERS).reduce(
    (sum, [id, mult]) => sum + (stats[id] ?? 0) * mult,
    0
  );
}

const PLAYERS = ["Munetaka Murakami", "Vinnie Pasquantino"] as const;
const TRADE_DATE = "2026-04-26";

export async function GET() {
  const leagueId = process.env.ESPN_LEAGUE_ID;
  const espnS2 = process.env.ESPN_S2;
  const swid = process.env.ESPN_SWID;
  if (!leagueId || !espnS2 || !swid) {
    return NextResponse.json({ error: "Missing ESPN env vars" }, { status: 500 });
  }

  const cookie = `espn_s2=${espnS2}; SWID=${swid}`;

  // Get current scoring period from meta
  const metaRes = await fetch(`${ESPN_API_BASE}/${leagueId}?view=mTeam`, {
    headers: { Cookie: cookie },
  });
  if (!metaRes.ok) return NextResponse.json({ error: "ESPN meta failed" }, { status: 502 });
  const meta = await metaRes.json();
  const currentPeriod: number = meta.scoringPeriodId;

  // Determine which scoring period April 26 corresponds to
  const tradeDay = new Date(TRADE_DATE + "T12:00:00Z");
  const now = new Date();
  now.setUTCHours(12, 0, 0, 0);
  const daysSinceTrade = Math.floor((now.getTime() - tradeDay.getTime()) / 86400000);
  // currentPeriod is today; work backwards
  const startPeriod = currentPeriod - daysSinceTrade;

  // Fetch each period's roster data in parallel (historical periods are static → cache long)
  const periods = Array.from(
    { length: currentPeriod - startPeriod },
    (_, i) => startPeriod + i
  );

  const periodResults = await Promise.all(
    periods.map(async (period) => {
      const res = await fetch(
        `${ESPN_API_BASE}/${leagueId}?view=mMatchup&view=mMatchupScore&scoringPeriodId=${period}`,
        {
          headers: { Cookie: cookie },
          next: { revalidate: period < currentPeriod - 1 ? 86400 : 300 },
        }
      );
      if (!res.ok) return { period, data: null };
      return { period, data: await res.json() };
    })
  );

  // Accumulate per-player per-period TXL scores
  const rawScores: Record<string, number[]> = {
    "Munetaka Murakami": new Array(periods.length).fill(0),
    "Vinnie Pasquantino": new Array(periods.length).fill(0),
  };

  for (const { period, data } of periodResults) {
    if (!data) continue;
    const idx = period - startPeriod;

    for (const matchup of data.schedule ?? []) {
      for (const side of ["home", "away"] as const) {
        const team = matchup[side];
        const entries = team?.rosterForCurrentScoringPeriod?.entries ?? [];

        for (const entry of entries) {
          const player = entry.playerPoolEntry?.player;
          if (!player) continue;

          const name: string = player.fullName;
          if (!PLAYERS.includes(name as typeof PLAYERS[number])) continue;

          const stats: Array<{
            statSplitTypeId: number;
            scoringPeriodId: number;
            stats: Record<string, number>;
          }> = player.stats ?? [];

          const periodStats = stats.find(
            (s) => s.statSplitTypeId === 5 && s.scoringPeriodId === period
          );
          if (periodStats?.stats) {
            rawScores[name][idx] = calcTxlScore(periodStats.stats);
          }
        }
      }
    }
  }

  // Build cumulative series
  let cumMurakami = 0;
  let cumPasquantino = 0;
  const series = periods.map((_, i) => {
    const date = new Date(tradeDay);
    date.setUTCDate(date.getUTCDate() + i);
    cumMurakami += rawScores["Munetaka Murakami"][i];
    cumPasquantino += rawScores["Vinnie Pasquantino"][i];
    return {
      date: date.toISOString().split("T")[0],
      murakami: cumMurakami,
      pasquantino: cumPasquantino,
    };
  });

  return NextResponse.json({ series });
}
