export interface TeamRawStats {
  team: string;
  manager: string;
  R: number;
  "1B": number;
  "2B": number;
  "3B": number;
  HR: number;
  TB: number;
  RBI: number;
  BB: number;
  K: number;
  HBP: number;
  SB: number;
  CS: number;
  CYC: number;
  Outs: number;
  H_P: number;
  ER: number;
  BB_P: number;
  HB: number;
  K_P: number;
  QS: number;
  CG: number;
  SO: number;
  NH: number;
  PG: number;
  W: number;
  L: number;
  SV: number;
  BS: number;
  HD: number;
  STRK: string;
  MOVES: number;
  matchupWins: number;
  matchupLosses: number;
}

export interface TeamScored {
  rank: number;
  team: string;
  manager: string;
  record: string;
  hittingScore: number;
  pitchingScore: number;
  totalScore: number;
  streak: string;
  moves: number;
  raw: TeamRawStats;
  hittingBreakdown: Record<string, { raw: number; mult: number; pts: number }>;
  pitchingBreakdown: Record<string, { raw: number; mult: number; pts: number }>;
  era: number;
  ops: number;
  playoffPct: number;
}

export interface ScheduleEntry {
  matchupPeriodId: number;
  homeTeam: string;
  awayTeam: string;
}

export interface ScheduleData {
  entries: ScheduleEntry[];
  currentMatchupPeriod: number;
}

export function calcHitting(t: TeamRawStats) {
  const breakdown: Record<string, { raw: number; mult: number; pts: number }> = {
    R:    { raw: t.R, mult: 1, pts: t.R },
    "1B": { raw: t["1B"], mult: 1, pts: t["1B"] },
    "2B": { raw: t["2B"], mult: 2, pts: t["2B"] * 2 },
    "3B": { raw: t["3B"], mult: 3, pts: t["3B"] * 3 },
    HR:   { raw: t.HR, mult: 4, pts: t.HR * 4 },
    TB:   { raw: t.TB, mult: 1, pts: t.TB },
    RBI:  { raw: t.RBI, mult: 1, pts: t.RBI },
    BB:   { raw: t.BB, mult: 1, pts: t.BB },
    K:    { raw: t.K, mult: -1, pts: -t.K },
    HBP:  { raw: t.HBP, mult: 1, pts: t.HBP },
    SB:   { raw: t.SB, mult: 1, pts: t.SB },
    CS:   { raw: t.CS, mult: -1, pts: -t.CS },
    CYC:  { raw: t.CYC, mult: 5, pts: t.CYC * 5 },
  };
  const total = Object.values(breakdown).reduce((s, v) => s + v.pts, 0);
  return { breakdown, total };
}

export function calcPitching(t: TeamRawStats) {
  const breakdown: Record<string, { raw: number; mult: number; pts: number }> = {
    Outs: { raw: t.Outs, mult: 1, pts: t.Outs },
    H:    { raw: t.H_P, mult: -1, pts: -t.H_P },
    ER:   { raw: t.ER, mult: -1, pts: -t.ER },
    BB:   { raw: t.BB_P, mult: -1, pts: -t.BB_P },
    HB:   { raw: t.HB, mult: -1, pts: -t.HB },
    K:    { raw: t.K_P, mult: 2, pts: t.K_P * 2 },
    QS:   { raw: t.QS, mult: 5, pts: t.QS * 5 },
    CG:   { raw: t.CG, mult: 5, pts: t.CG * 5 },
    SO:   { raw: t.SO, mult: 10, pts: t.SO * 10 },
    NH:   { raw: t.NH, mult: 0, pts: 0 },
    PG:   { raw: t.PG, mult: 0, pts: 0 },
    W:    { raw: t.W, mult: 3, pts: t.W * 3 },
    L:    { raw: t.L, mult: -3, pts: -t.L * 3 },
    SV:   { raw: t.SV, mult: 3, pts: t.SV * 3 },
    BS:   { raw: t.BS, mult: -2, pts: -t.BS * 2 },
    HD:   { raw: t.HD, mult: 1, pts: t.HD },
  };
  const total = Object.values(breakdown).reduce((s, v) => s + v.pts, 0);
  return { breakdown, total };
}

function sampleNormal(mean: number, std: number): number {
  // Box-Muller transform
  const u1 = Math.random() || 1e-10;
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(0, mean + std * z);
}

export function computePlayoffOdds(
  teams: TeamScored[],
  scheduleData: ScheduleData,
  playoffSpots: number = 8,
  numSims: number = 5000
): Record<string, number> {
  const { entries, currentMatchupPeriod } = scheduleData;
  const remaining = entries.filter((e) => e.matchupPeriodId >= currentMatchupPeriod);

  // Compute raw weekly averages, then shrink toward league mean.
  // With few games played, teams look nearly equal (appropriate uncertainty);
  // as the season progresses, actual performance weight increases.
  // PRIOR_GAMES controls regression speed — higher = more shrinkage early on.
  const PRIOR_GAMES = 6;
  const rawAvgs = teams.map((t) => {
    const games = t.raw.matchupWins + t.raw.matchupLosses;
    return games > 0 ? t.totalScore / games : t.totalScore;
  });
  const leagueAvg = rawAvgs.reduce((s, v) => s + v, 0) / rawAvgs.length;

  const avgPts: Record<string, number> = {};
  for (let i = 0; i < teams.length; i++) {
    const t = teams[i];
    const games = t.raw.matchupWins + t.raw.matchupLosses;
    avgPts[t.team] = (games * rawAvgs[i] + PRIOR_GAMES * leagueAvg) / (games + PRIOR_GAMES);
  }

  const playoffCounts: Record<string, number> = Object.fromEntries(teams.map((t) => [t.team, 0]));

  for (let sim = 0; sim < numSims; sim++) {
    const wins: Record<string, number> = {};
    const pts: Record<string, number> = {};
    for (const t of teams) {
      wins[t.team] = t.raw.matchupWins;
      pts[t.team] = t.totalScore;
    }

    for (const m of remaining) {
      const meanH = avgPts[m.homeTeam] ?? 100;
      const meanA = avgPts[m.awayTeam] ?? 100;
      const ptsH = sampleNormal(meanH, meanH * 0.25);
      const ptsA = sampleNormal(meanA, meanA * 0.25);
      pts[m.homeTeam] = (pts[m.homeTeam] ?? 0) + ptsH;
      pts[m.awayTeam] = (pts[m.awayTeam] ?? 0) + ptsA;
      if (ptsH >= ptsA) {
        wins[m.homeTeam] = (wins[m.homeTeam] ?? 0) + 1;
      } else {
        wins[m.awayTeam] = (wins[m.awayTeam] ?? 0) + 1;
      }
    }

    const sorted = Object.keys(wins).sort((a, b) =>
      wins[b] !== wins[a] ? wins[b] - wins[a] : pts[b] - pts[a]
    );
    for (let i = 0; i < Math.min(playoffSpots, sorted.length); i++) {
      playoffCounts[sorted[i]]++;
    }
  }

  return Object.fromEntries(
    Object.entries(playoffCounts).map(([team, count]) => [team, (count / numSims) * 100])
  );
}

export function scoreTeams(
  teams: TeamRawStats[],
  trackedAbPa?: Record<string, { ab: number; pa: number }>,
  scheduleData?: ScheduleData,
  playoffSpots: number = 8
): TeamScored[] {
  const scored = teams.map((t) => {
    const hitting = calcHitting(t);
    const pitching = calcPitching(t);
    const h = t["1B"] + t["2B"] + t["3B"] + t.HR;
    const abPa = trackedAbPa?.[t.team];
    const ab = abPa?.ab ?? 0;
    const pa = abPa?.pa ?? 0;
    const obp = pa > 0 ? (h + t.BB + t.HBP) / pa : 0;
    const slg = ab > 0 ? t.TB / ab : 0;
    return {
      rank: 0,
      team: t.team,
      manager: t.manager,
      record: `${t.matchupWins}-${t.matchupLosses}`,
      hittingScore: hitting.total,
      pitchingScore: pitching.total,
      totalScore: hitting.total + pitching.total,
      streak: t.STRK,
      moves: t.MOVES,
      raw: t,
      hittingBreakdown: hitting.breakdown,
      pitchingBreakdown: pitching.breakdown,
      era: t.Outs > 0 ? (t.ER / (t.Outs / 3)) * 9 : 0,
      ops: obp + slg,
      playoffPct: 0,
    };
  });
  scored.sort((a, b) => b.totalScore - a.totalScore);
  scored.forEach((t, i) => (t.rank = i + 1));

  if (scheduleData) {
    const odds = computePlayoffOdds(scored, scheduleData, playoffSpots);
    for (const t of scored) {
      t.playoffPct = odds[t.team] ?? 0;
      // Andrew historically quits around the halfway point
      if (t.manager === "Andrew Bergoine") t.playoffPct *= 0.5;
    }
  }

  return scored;
}
