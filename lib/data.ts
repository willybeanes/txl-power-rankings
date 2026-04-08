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

export function scoreTeams(
  teams: TeamRawStats[],
  trackedAbPa?: Record<string, { ab: number; pa: number }>
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
    };
  });
  scored.sort((a, b) => b.totalScore - a.totalScore);
  scored.forEach((t, i) => (t.rank = i + 1));
  return scored;
}
