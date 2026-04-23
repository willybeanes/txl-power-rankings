"use client";

import { useState, useEffect, useMemo } from "react";
import { type TeamScored } from "@/lib/data";
import { DRAFT_PICKS, DRAFT_MANAGERS, type DraftPick } from "@/lib/draft";

type SortKey = "rank" | "team" | "hittingScore" | "pitchingScore" | "totalScore" | "era" | "moves" | "ops" | "playoffPct";
type SortDir = "asc" | "desc";
type Tab = "standings" | "graphs" | "draft";

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className={`inline-block ml-1 ${active ? "text-text-primary" : "text-text-muted/40"}`}>
      {active ? (dir === "desc" ? "\u25BC" : "\u25B2") : "\u25BC"}
    </span>
  );
}

function StreakBadge({ streak }: { streak: string }) {
  const isWin = streak.startsWith("W");
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${
        isWin
          ? "bg-green/10 text-green"
          : "bg-brand-red/10 text-brand-red"
      }`}
    >
      {streak}
    </span>
  );
}

interface SnapshotDay {
  snapshot_date: string;
  teams: { team: string; dailyPoints?: number }[];
}

const CHART_COLORS = [
  "#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6",
  "#1abc9c", "#e67e22", "#d63031", "#6c5ce7", "#00b894", "#fd79a8",
];

function AllTeamsChart({ snapshots, rankings }: { snapshots: SnapshotDay[]; rankings: TeamScored[] }) {
  const teamNames = rankings.map((t) => t.team);
  const managers = Object.fromEntries(rankings.map((t) => [t.team, t.manager]));

  const cumData: Record<string, number[]> = useMemo(() => {
    const result: Record<string, number[]> = {};
    for (const name of teamNames) {
      let cum = 0;
      result[name] = snapshots.map((snap) => {
        const t = snap.teams.find((s) => s.team === name);
        cum += t?.dailyPoints ?? 0;
        return cum;
      });
    }
    return result;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshots, rankings]);

  if (snapshots.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-text-muted text-sm">
        No snapshot data available yet
      </div>
    );
  }

  const maxY = Math.max(...Object.values(cumData).flatMap((arr) => arr), 1);

  const W = 780;
  const H = 340;
  const padL = 52;
  const padR = 190;
  const padT = 16;
  const padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const n = snapshots.length;
  const xPos = (i: number) => (n <= 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW);
  const yPos = (val: number) => padT + plotH - (val / maxY) * plotH;

  const yTicks = 5;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) =>
    Math.round((maxY / yTicks) * i)
  );

  const labelEvery = Math.ceil(n / 8);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 520 }}>
        {/* Y-axis grid + labels */}
        {yTickVals.map((v) => (
          <g key={v}>
            <line
              x1={padL} x2={padL + plotW}
              y1={yPos(v)} y2={yPos(v)}
              stroke="#e2e8f0" strokeWidth={0.6}
            />
            <text x={padL - 6} y={yPos(v) + 3.5} textAnchor="end" fontSize={9} fill="#8892a4">
              {v.toLocaleString()}
            </text>
          </g>
        ))}

        {/* Team lines */}
        {teamNames.map((name, ti) => {
          const pts = cumData[name];
          if (!pts || pts.length < 2) return null;
          const d = pts
            .map((v, i) => `${i === 0 ? "M" : "L"}${xPos(i).toFixed(1)},${yPos(v).toFixed(1)}`)
            .join(" ");
          return (
            <path
              key={name}
              d={d}
              fill="none"
              stroke={CHART_COLORS[ti % CHART_COLORS.length]}
              strokeWidth={1.8}
              strokeLinejoin="round"
              opacity={0.9}
            />
          );
        })}

        {/* X-axis labels */}
        {snapshots.map((snap, i) => {
          if (i !== 0 && i !== n - 1 && i % labelEvery !== 0) return null;
          return (
            <text
              key={i}
              x={xPos(i)}
              y={H - padB + 14}
              textAnchor="middle"
              fontSize={8}
              fill="#8892a4"
            >
              {snap.snapshot_date.slice(5)}
            </text>
          );
        })}

        {/* Legend */}
        {teamNames.map((name, ti) => {
          const lx = padL + plotW + 14;
          const ly = padT + ti * 26;
          const color = CHART_COLORS[ti % CHART_COLORS.length];
          const lastVal = cumData[name]?.[n - 1] ?? 0;
          return (
            <g key={name}>
              <rect x={lx} y={ly + 2} width={14} height={3} rx={1.5} fill={color} />
              <text x={lx + 18} y={ly + 7} fontSize={9} fill="#374151" fontWeight={500}>
                {managers[name] || name}
              </text>
              <text x={lx + 18} y={ly + 17} fontSize={8} fill="#8892a4">
                {lastVal.toLocaleString()} pts
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Returns a background color. Default: high=red, low=blue. Pass reverse=true for high=blue, low=red. */
function heatColor(value: number, min: number, max: number, reverse = false): string {
  if (max === min) return "transparent";
  let t = (value - min) / (max - min);
  if (reverse) t = 1 - t;
  if (t >= 0.5) {
    const strength = (t - 0.5) * 2;
    return `rgba(239, 68, 68, ${strength * 0.35})`;
  } else {
    const strength = (0.5 - t) * 2;
    return `rgba(59, 130, 246, ${strength * 0.35})`;
  }
}

function TeamRow({
  team,
  hittingRange,
  pitchingRange,
  eraRange,
  opsRange,
}: {
  team: TeamScored;
  hittingRange: [number, number];
  pitchingRange: [number, number];
  eraRange: [number, number];
  opsRange: [number, number];
}) {
  return (
    <tr className="border-t border-border/50 hover:bg-surface-2/40 transition-colors">
      <td className="py-3 pl-4 pr-2 tabular-nums text-text-muted font-semibold text-center w-10">
        {team.rank}
      </td>
      <td className="py-3 pr-3">
        <div className="flex flex-col">
          <span className="font-semibold text-text-primary text-sm">{team.team}</span>
          <span className="text-text-muted text-xs">{team.manager}</span>
        </div>
      </td>
      <td className="py-3 pr-3 text-center text-sm tabular-nums text-text-secondary">
        {team.record}
      </td>
      <td
        className="py-3 pr-3 text-right text-sm tabular-nums text-text-secondary"
        style={{ backgroundColor: heatColor(team.hittingScore, hittingRange[0], hittingRange[1]) }}
      >
        {team.hittingScore.toLocaleString()}
      </td>
      <td
        className="py-3 pr-3 text-right text-sm tabular-nums text-text-secondary"
        style={{ backgroundColor: heatColor(team.pitchingScore, pitchingRange[0], pitchingRange[1]) }}
      >
        {team.pitchingScore.toLocaleString()}
      </td>
      <td className="py-3 pr-3 text-right text-sm tabular-nums font-bold text-text-primary">
        {team.totalScore.toLocaleString()}
      </td>
      <td
        className="py-3 pr-3 text-right text-sm tabular-nums text-text-secondary"
        style={{ backgroundColor: heatColor(team.era, eraRange[0], eraRange[1], true) }}
      >
        {team.era.toFixed(2)}
      </td>
      <td
        className="py-3 pr-3 text-right text-sm tabular-nums text-text-secondary"
        style={{ backgroundColor: heatColor(team.ops, opsRange[0], opsRange[1]) }}
      >
        {team.ops.toFixed(3).replace(/^0/, "")}
      </td>
      <td className="py-3 pr-4 text-center">
        <StreakBadge streak={team.streak} />
      </td>
      <td className="py-3 pr-4 text-center text-xs text-text-muted tabular-nums">
        {team.moves}
      </td>
      <td className="py-3 pr-4 text-right text-sm tabular-nums text-text-secondary">
        {team.playoffPct.toFixed(1)}%
      </td>
    </tr>
  );
}

type DraftView = "board" | "roster";

/** Normalize a player name for fuzzy matching: lowercase, strip accents & punctuation */
function normName(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9 ]/g, "")
    .trim();
}

/** True if playerName appears in rosterList (accent/punctuation-insensitive) */
function onRoster(playerName: string, rosterList: string[]): boolean {
  const np = normName(playerName);
  return rosterList.some((r) => normName(r) === np);
}

/**
 * Map draft manager full name → ESPN API manager name.
 * ESPN returns names like "Joshua Brooks" while the draft stores "Josh Brooks".
 */
function rosterKey(managerFullName: string, rosterMap: Record<string, string[]>): string | null {
  // Exact match first
  if (rosterMap[managerFullName]) return managerFullName;
  // Last-name match as fallback (handles "Josh Brooks" ↔ "Joshua Brooks")
  const lastName = managerFullName.split(" ").pop()!.toLowerCase();
  const key = Object.keys(rosterMap).find(
    (k) => k.split(" ").pop()!.toLowerCase() === lastName
  );
  return key ?? null;
}

function DraftBoard() {
  const [view, setView] = useState<DraftView>("board");
  const [rosters, setRosters] = useState<Record<string, string[]> | null>(null);
  const [playerPoints, setPlayerPoints] = useState<Record<string, number>>({});

  useEffect(() => {
    fetch("/api/rosters")
      .then((r) => r.json())
      .then((d) => {
        setRosters(d.rosters ?? {});
        setPlayerPoints(d.playerPoints ?? {});
      })
      .catch(() => { setRosters({}); setPlayerPoints({}); });
  }, []);

  // Compute min/max of known player points for the heat scale
  const [ptMin, ptMax] = useMemo(() => {
    const vals = Object.values(playerPoints).filter((v) => v > 0);
    if (vals.length === 0) return [0, 1];
    return [Math.min(...vals), Math.max(...vals)];
  }, [playerPoints]);

  // Group picks for board view: round -> colOrder -> picks[]
  const grid = useMemo(() => {
    const g: Record<number, Record<number, DraftPick[]>> = {};
    for (const pick of DRAFT_PICKS) {
      if (!g[pick.round]) g[pick.round] = {};
      if (!g[pick.round][pick.colOrder]) g[pick.round][pick.colOrder] = [];
      g[pick.round][pick.colOrder].push(pick);
    }
    return g;
  }, []);

  // Group picks for roster view: manager -> picks[] sorted by round
  const rostersByManager = useMemo(() => {
    const r: Record<string, DraftPick[]> = {};
    for (const pick of DRAFT_PICKS) {
      if (!r[pick.manager]) r[pick.manager] = [];
      r[pick.manager].push(pick);
    }
    for (const key of Object.keys(r)) {
      r[key].sort((a, b) => a.round - b.round);
    }
    return r;
  }, []);

  const rounds = useMemo(
    () => Array.from(new Set(DRAFT_PICKS.map((p) => p.round))).sort((a, b) => a - b),
    []
  );

  const isDropped = (pick: DraftPick): boolean => {
    if (!rosters) return false;
    const key = rosterKey(pick.manager, rosters);
    if (!key) return false;
    return !onRoster(pick.player, rosters[key]);
  };

  /** Background color based on season points — high=red, low=blue, none if dropped */
  const ptsBg = (pick: DraftPick): string => {
    if (isDropped(pick)) return "";
    const pts = playerPoints[pick.player];
    if (pts == null) return "";
    if (ptMax === ptMin) return "";
    const t = Math.max(0, Math.min(1, (pts - ptMin) / (ptMax - ptMin)));
    if (t >= 0.5) {
      const a = ((t - 0.5) * 2 * 0.45).toFixed(2);
      return `rgba(239,68,68,${a})`;
    } else {
      const a = ((0.5 - t) * 2 * 0.35).toFixed(2);
      return `rgba(59,130,246,${a})`;
    }
  };

  const pickTextStyle = (pick: DraftPick) => {
    if (isDropped(pick)) return "text-text-muted/40 line-through";
    if (pick.isKeeper) return "text-[#0f6b6b] font-semibold";
    if (pick.isExtra) return "text-blue-700";
    return "text-text-primary";
  };

  return (
    <div>
      {/* Legend + view toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-4 text-xs text-text-secondary">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-[#ccf2f2] border border-[#0f6b6b]/20" />
            Keeper
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-blue-100 border border-blue-200" />
            Supplemental pick
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded-sm bg-surface-2/50 border border-border/50" />
            No pick (traded away)
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-14 h-3 rounded-sm bg-surface-2/30 border border-border/30 overflow-hidden">
              <span className="block text-[8px] text-text-muted/40 line-through leading-3 px-0.5">Player</span>
            </span>
            Dropped / traded
          </span>
        </div>
        <div className="flex rounded-lg border border-border overflow-hidden text-xs">
          {(["board", "roster"] as DraftView[]).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-3 py-1.5 font-medium transition-colors capitalize ${
                view === v
                  ? "bg-brand-red text-white"
                  : "text-text-muted hover:text-text-secondary hover:bg-surface-2/50"
              }`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === "board" ? (
        <div className="overflow-x-auto rounded-[14px] border border-border bg-surface">
          <table className="w-full text-[10.5px] border-collapse">
            <thead>
              <tr className="border-b border-border bg-surface-2/50">
                <th className="py-1.5 px-1.5 text-center text-text-muted font-semibold w-7 sticky left-0 bg-surface-2/50 z-10 border-r border-border">
                  Rd
                </th>
                {DRAFT_MANAGERS.map((mgr) => (
                  <th
                    key={mgr.colOrder}
                    className="py-1.5 px-1 text-center font-semibold text-text-secondary border-l border-border/50 whitespace-nowrap"
                  >
                    <div className="text-[11px]">{mgr.short}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rounds.map((round, ri) => {
                const isExtra = round > 25;
                const prevRound = rounds[ri - 1];
                const showSeparator = isExtra && prevRound && prevRound <= 25;
                return (
                  <>
                    {showSeparator && (
                      <tr key={`sep-${round}`}>
                        <td
                          colSpan={13}
                          className="py-1 px-3 text-[9px] text-text-muted uppercase tracking-widest bg-surface-2/70 border-y border-border/50 text-center"
                        >
                          Supplemental Picks
                        </td>
                      </tr>
                    )}
                    <tr
                      key={round}
                      className={`border-t border-border/30 ${isExtra ? "bg-blue-50/20" : "hover:bg-surface-2/30"}`}
                    >
                      <td
                        className={`py-1 px-1.5 text-center font-bold sticky left-0 z-10 border-r border-border/50 ${
                          isExtra
                            ? "text-blue-400 bg-blue-50/30"
                            : "text-text-muted bg-surface"
                        }`}
                      >
                        {round}
                      </td>
                      {DRAFT_MANAGERS.map((mgr) => {
                        const cellPicks = grid[round]?.[mgr.colOrder] ?? [];
                        return (
                          <td
                            key={mgr.colOrder}
                            className="py-0.5 px-0.5 border-l border-border/30 align-top"
                          >
                            {cellPicks.length === 0 ? (
                              <span className="text-text-muted/25 text-[10px]">—</span>
                            ) : (
                              <div className="flex flex-col gap-0.5">
                                {cellPicks.map((pick, i) => {
                                  const pts = isDropped(pick) ? null : (playerPoints[pick.player] ?? null);
                                  return (
                                    <span
                                      key={i}
                                      className={`inline-block leading-snug px-1 py-px rounded text-[10.5px] ${pickTextStyle(pick)}`}
                                      style={{ backgroundColor: ptsBg(pick) }}
                                    >
                                      {pick.player}
                                      {pts != null && (
                                        <span className="ml-1 text-[9px] opacity-70">({pts})</span>
                                      )}
                                    </span>
                                  );
                                })}
                              </div>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* Roster view */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {DRAFT_MANAGERS.map((mgr) => {
            const picks = rostersByManager[mgr.fullName] ?? [];
            const keepers = picks.filter((p) => p.isKeeper);
            return (
              <div
                key={mgr.colOrder}
                className="rounded-[14px] bg-surface border border-border overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-border bg-surface-2/40 flex items-center justify-between">
                  <div>
                    <p className="font-bold text-text-primary text-sm">{mgr.fullName}</p>
                    <p className="text-text-muted text-xs">{mgr.fullName}</p>
                  </div>
                  <span className="text-xs text-text-muted tabular-nums">
                    {picks.length} picks
                  </span>
                </div>
                <div className="divide-y divide-border/30">
                  {picks.map((pick, i) => {
                    const dropped = isDropped(pick);
                    const pts = dropped ? null : (playerPoints[pick.player] ?? null);
                    return (
                      <div
                        key={i}
                        className={`flex items-center justify-between px-4 py-1.5 text-xs ${dropped ? "opacity-40" : ""}`}
                        style={{ backgroundColor: ptsBg(pick) }}
                      >
                        <span className={pickTextStyle(pick)}>
                          {pick.player}
                          {pick.isKeeper && !dropped && (
                            <span className="ml-1 text-[9px] uppercase tracking-wide text-[#0f6b6b]/70">
                              keep
                            </span>
                          )}
                        </span>
                        <span className="tabular-nums ml-2 text-text-muted">
                          {pts != null ? pts : ""}
                          <span className="ml-1.5 opacity-50">R{pick.round}</span>
                        </span>
                      </div>
                    );
                  })}
                </div>
                {keepers.length > 0 && (
                  <div className="px-4 py-2 bg-[#ccf2f2]/20 border-t border-border/30 text-[10px] text-[#0f6b6b]">
                    Keepers: {keepers.map((p) => p.player).join(", ")}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-[14px] border border-border bg-surface h-32" />
        ))}
      </div>
      <div className="rounded-[14px] bg-surface border border-border p-4 space-y-4">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} className="h-10 bg-surface-2/50 rounded-lg" />
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [rankings, setRankings] = useState<TeamScored[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [snapshots, setSnapshots] = useState<SnapshotDay[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [activeTab, setActiveTab] = useState<Tab>("standings");

  // Sync tab with URL (?tab=standings|graphs|draft)
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("tab");
    if (param === "standings" || param === "graphs" || param === "draft") {
      setActiveTab(param);
    }
  }, []);

  const setTab = (tab: Tab) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", url.toString());
  };

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "team" ? "asc" : "desc");
    }
  };

  const sorted = useMemo(() => {
    if (!rankings) return null;
    const list = [...rankings];
    list.sort((a, b) => {
      let cmp: number;
      if (sortKey === "team") {
        cmp = a.team.localeCompare(b.team);
      } else {
        cmp = (a[sortKey] as number) - (b[sortKey] as number);
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [rankings, sortKey, sortDir]);

  const hittingRange = useMemo<[number, number]>(() => {
    if (!rankings) return [0, 0];
    const scores = rankings.map((t) => t.hittingScore);
    return [Math.min(...scores), Math.max(...scores)];
  }, [rankings]);

  const pitchingRange = useMemo<[number, number]>(() => {
    if (!rankings) return [0, 0];
    const scores = rankings.map((t) => t.pitchingScore);
    return [Math.min(...scores), Math.max(...scores)];
  }, [rankings]);

  const eraRange = useMemo<[number, number]>(() => {
    if (!rankings) return [0, 0];
    const scores = rankings.map((t) => t.era);
    return [Math.min(...scores), Math.max(...scores)];
  }, [rankings]);

  const opsRange = useMemo<[number, number]>(() => {
    if (!rankings) return [0, 0];
    const scores = rankings.map((t) => t.ops);
    return [Math.min(...scores), Math.max(...scores)];
  }, [rankings]);

  useEffect(() => {
    fetch("/api/rankings")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to fetch");
        return res.json();
      })
      .then((data) => {
        setRankings(data.rankings);
        setUpdatedAt(data.updatedAt);
      })
      .catch((err) => setError(err.message));

    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const toDate = yesterday.toISOString().split("T")[0];
    fetch(`/api/snapshots?from=2026-03-25&to=${toDate}`)
      .then((res) => res.json())
      .then((data) => setSnapshots(data.snapshots ?? []))
      .catch(() => setSnapshots([]));
  }, []);

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-brand-red text-lg font-semibold">Failed to load rankings</p>
          <p className="text-text-muted text-sm mt-1">{error}</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen py-8 px-4 sm:px-6">
      <div className={`mx-auto ${activeTab === "draft" ? "max-w-[1600px]" : "max-w-5xl"}`}>
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl sm:text-3xl font-bold text-text-primary">TXL Power Rankings</h1>
          <p className="text-text-secondary mt-1">2026 Season</p>
        </div>

        {/* Tabs */}
        <div className="flex gap-6 border-b border-border mb-6">
          {(["standings", "graphs", "draft"] as Tab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setTab(tab)}
              className={`pb-3 text-sm font-semibold capitalize border-b-2 -mb-px transition-colors ${
                activeTab === tab
                  ? "border-brand-red text-brand-red"
                  : "border-transparent text-text-muted hover:text-text-secondary"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {activeTab === "draft" ? (
          <div>
            <div className="mb-4">
              <h2 className="text-base font-bold text-text-primary">2026 Draft Board</h2>
              <p className="text-text-muted text-xs mt-0.5">
                12 teams · 25 rounds · snake draft · 3 keepers per team
              </p>
            </div>
            <DraftBoard />
          </div>
        ) : !rankings ? (
          <LoadingSkeleton />
        ) : activeTab === "standings" ? (
          <>
            {/* Podium */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              {rankings.slice(0, 3).map((team, i) => (
                <div
                  key={team.team}
                  className={`rounded-[14px] border p-4 ${
                    i === 0
                      ? "bg-amber/5 border-amber/30"
                      : i === 1
                        ? "bg-text-secondary/5 border-text-secondary/20"
                        : "bg-amber/3 border-amber/15"
                  }`}
                >
                  <div className="flex items-start justify-between mb-2">
                    <span
                      className={`text-2xl font-bold ${
                        i === 0 ? "text-amber" : i === 1 ? "text-text-secondary" : "text-amber/60"
                      }`}
                    >
                      #{i + 1}
                    </span>
                    <StreakBadge streak={team.streak} />
                  </div>
                  <h3 className="font-bold text-text-primary">{team.team}</h3>
                  <p className="text-text-muted text-xs mb-3">{team.manager}</p>
                  <div className="flex justify-between items-end">
                    <div className="flex gap-4 text-xs text-text-secondary">
                      <span>H: {team.hittingScore.toLocaleString()}</span>
                      <span>P: {team.pitchingScore.toLocaleString()}</span>
                    </div>
                    <span className="text-lg font-bold text-text-primary tabular-nums">
                      {team.totalScore.toLocaleString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {/* Table */}
            <div className="rounded-[14px] bg-surface border border-border overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="text-xs text-text-muted uppercase tracking-wider border-b border-border">
                    <th
                      className="py-3 pl-4 pr-2 text-center w-10 cursor-pointer select-none hover:text-text-secondary"
                      onClick={() => toggleSort("rank")}
                    >
                      #<SortIcon active={sortKey === "rank"} dir={sortDir} />
                    </th>
                    <th
                      className="py-3 pr-3 text-left cursor-pointer select-none hover:text-text-secondary"
                      onClick={() => toggleSort("team")}
                    >
                      Team<SortIcon active={sortKey === "team"} dir={sortDir} />
                    </th>
                    <th className="py-3 pr-3 text-center">Record</th>
                    <th
                      className="py-3 pr-3 text-right cursor-pointer select-none hover:text-text-secondary"
                      onClick={() => toggleSort("hittingScore")}
                    >
                      Hitting<SortIcon active={sortKey === "hittingScore"} dir={sortDir} />
                    </th>
                    <th
                      className="py-3 pr-3 text-right cursor-pointer select-none hover:text-text-secondary"
                      onClick={() => toggleSort("pitchingScore")}
                    >
                      Pitching<SortIcon active={sortKey === "pitchingScore"} dir={sortDir} />
                    </th>
                    <th
                      className="py-3 pr-3 text-right cursor-pointer select-none hover:text-text-secondary"
                      onClick={() => toggleSort("totalScore")}
                    >
                      Total<SortIcon active={sortKey === "totalScore"} dir={sortDir} />
                    </th>
                    <th
                      className="py-3 pr-3 text-right cursor-pointer select-none hover:text-text-secondary"
                      onClick={() => toggleSort("era")}
                    >
                      ERA<SortIcon active={sortKey === "era"} dir={sortDir} />
                    </th>
                    <th
                      className="py-3 pr-3 text-right cursor-pointer select-none hover:text-text-secondary"
                      onClick={() => toggleSort("ops")}
                    >
                      OPS<SortIcon active={sortKey === "ops"} dir={sortDir} />
                    </th>
                    <th className="py-3 pr-4 text-center">Streak</th>
                    <th
                      className="py-3 pr-4 text-center cursor-pointer select-none hover:text-text-secondary"
                      onClick={() => toggleSort("moves")}
                    >
                      Moves<SortIcon active={sortKey === "moves"} dir={sortDir} />
                    </th>
                    <th
                      className="py-3 pr-4 text-right cursor-pointer select-none hover:text-text-secondary"
                      onClick={() => toggleSort("playoffPct")}
                    >
                      Playoff%<SortIcon active={sortKey === "playoffPct"} dir={sortDir} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted!.map((team) => (
                    <TeamRow
                      key={team.team}
                      team={team}
                      hittingRange={hittingRange}
                      pitchingRange={pitchingRange}
                      eraRange={eraRange}
                      opsRange={opsRange}
                    />
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-text-muted text-xs mt-6 text-center">
              Live data from ESPN Fantasy Baseball
              {updatedAt && (
                <>
                  <br />
                  Last updated {new Date(updatedAt).toLocaleString()}
                </>
              )}
            </p>
          </>
        ) : (
          /* Graphs tab */
          <div className="rounded-[14px] bg-surface border border-border p-6">
            <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-4">
              Cumulative Points — Season to Date
            </h2>
            {snapshots === null ? (
              <div className="animate-pulse h-64 bg-surface-2/50 rounded-lg" />
            ) : (
              <AllTeamsChart snapshots={snapshots} rankings={rankings} />
            )}
            <p className="text-text-muted text-xs mt-4">
              Daily snapshots taken at ~11:55 PM ET · Each point represents one day&apos;s fantasy scoring
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
