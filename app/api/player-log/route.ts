import { NextResponse } from "next/server";

const ESPN_API_BASE =
  "https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2026/segments/0/leagues";

export async function GET(request: Request) {
  const leagueId = process.env.ESPN_LEAGUE_ID;
  const espnS2 = process.env.ESPN_S2;
  const swid = process.env.ESPN_SWID;
  if (!leagueId || !espnS2 || !swid) {
    return NextResponse.json({ error: "Missing ESPN env vars" }, { status: 500 });
  }

  const { searchParams } = new URL(request.url);
  const playerName = searchParams.get("player") ?? "Luis García Jr.";
  const sinceDate = searchParams.get("since") ?? "2026-06-26";

  const cookie = `espn_s2=${espnS2}; SWID=${swid}`;

  const metaRes = await fetch(`${ESPN_API_BASE}/${leagueId}?view=mTeam`, {
    headers: { Cookie: cookie },
  });
  if (!metaRes.ok)
    return NextResponse.json({ error: "ESPN meta failed" }, { status: 502 });
  const meta = await metaRes.json();

  const currentPeriod: number = meta.scoringPeriodId;

  const sinceDay = new Date(sinceDate + "T12:00:00Z");
  const now = new Date();
  now.setUTCHours(12, 0, 0, 0);
  const daysSince = Math.floor(
    (now.getTime() - sinceDay.getTime()) / 86400000
  );
  const startPeriod = currentPeriod - daysSince;

  const periods = Array.from(
    { length: currentPeriod - startPeriod + 1 },
    (_, i) => startPeriod + i
  );

  const BATCH_SIZE = 10;
  const periodResults: Array<{ period: number; data: unknown }> = [];

  for (let i = 0; i < periods.length; i += BATCH_SIZE) {
    const batch = periods.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (period) => {
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
    periodResults.push(...results);
  }

  const normalizeForMatch = (s: string) =>
    s
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase();

  const targetNorm = normalizeForMatch(playerName);

  const log: Array<{
    date: string;
    scoringPeriod: number;
    points: number;
  }> = [];
  let totalPoints = 0;

  for (const { period, data } of periodResults) {
    if (!data) continue;
    const idx = period - startPeriod;
    const date = new Date(sinceDay);
    date.setUTCDate(date.getUTCDate() + idx);
    const dateStr = date.toISOString().split("T")[0];

    let foundPoints = 0;
    let found = false;

    for (const matchup of (data as { schedule?: unknown[] }).schedule ?? []) {
      for (const side of ["home", "away"] as const) {
        const team = (matchup as Record<string, unknown>)[side] as
          | Record<string, unknown>
          | undefined;
        if (!team) continue;
        const entries =
          ((
            team.rosterForCurrentScoringPeriod as
              | Record<string, unknown>
              | undefined
          )?.entries as unknown[]) ?? [];

        for (const entry of entries) {
          const player = (
            (entry as Record<string, unknown>).playerPoolEntry as
              | Record<string, unknown>
              | undefined
          )?.player as Record<string, unknown> | undefined;
          if (!player) continue;

          const fullName = player.fullName as string;
          if (normalizeForMatch(fullName) !== targetNorm) continue;

          found = true;

          const stats = (player.stats ?? []) as Array<{
            statSplitTypeId: number;
            scoringPeriodId: number;
            appliedTotal?: number;
          }>;

          const periodStats = stats.find(
            (s) =>
              s.statSplitTypeId === 5 && s.scoringPeriodId === period
          );

          foundPoints = periodStats?.appliedTotal ?? 0;
        }
      }
    }

    if (found) {
      log.push({ date: dateStr, scoringPeriod: period, points: foundPoints });
      totalPoints += foundPoints;
    }
  }

  return NextResponse.json({
    player: playerName,
    since: sinceDate,
    totalPoints: Math.round(totalPoints * 100) / 100,
    gamesLogged: log.length,
    log,
  });
}
