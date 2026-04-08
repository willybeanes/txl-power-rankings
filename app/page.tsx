"use client";

import { useState, useEffect, useMemo } from "react";
import { type TeamScored } from "@/lib/data";

type SortKey = "rank" | "team" | "hittingScore" | "pitchingScore" | "totalScore" | "era" | "moves" | "ops";
type SortDir = "asc" | "desc";

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

function CumulativeChart({ teamName, snapshots }: { teamName: string; snapshots: SnapshotDay[] }) {
  const data = useMemo(() => {
    let cum = 0;
    return snapshots.map((snap) => {
      const team = snap.teams.find((t) => t.team === teamName);
      cum += team?.dailyPoints ?? 0;
      return { date: snap.snapshot_date, cumulative: cum, daily: team?.dailyPoints ?? 0 };
    });
  }, [teamName, snapshots]);

  if (data.length === 0) return <p className="text-text-muted text-sm">No snapshot data available</p>;

  const maxY = Math.max(...data.map((d) => d.cumulative), 1);
  const W = 600;
  const H = 200;
  const padL = 50;
  const padR = 16;
  const padT = 20;
  const padB = 32;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const x = (i: number) => padL + (i / (data.length - 1)) * plotW;
  const y = (val: number) => padT + plotH - (val / maxY) * plotH;

  const linePath = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.cumulative).toFixed(1)}`).join(" ");

  // Y-axis ticks
  const yTicks = 4;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) => Math.round((maxY / yTicks) * i));

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-[600px]" style={{ minWidth: 400 }}>
        {/* Grid lines */}
        {yTickVals.map((v) => (
          <g key={v}>
            <line x1={padL} x2={W - padR} y1={y(v)} y2={y(v)} stroke="#d8dce3" strokeWidth={0.5} />
            <text x={padL - 6} y={y(v) + 3} textAnchor="end" fontSize={9} fill="#8892a4">{v}</text>
          </g>
        ))}

        {/* Line */}
        <path d={linePath} fill="none" stroke="#3b82f6" strokeWidth={2} strokeLinejoin="round" />

        {/* Area fill */}
        <path
          d={`${linePath} L${x(data.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`}
          fill="rgba(59, 130, 246, 0.08)"
        />

        {/* Dots */}
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.cumulative)} r={3} fill="#3b82f6" />
        ))}

        {/* Value on last point */}
        <text x={x(data.length - 1)} y={y(data[data.length - 1].cumulative) - 8} textAnchor="middle" fontSize={10} fontWeight={600} fill="#1a1d24">
          {data[data.length - 1].cumulative.toLocaleString()}
        </text>

        {/* X-axis labels */}
        {data.map((d, i) => {
          // Show every 3rd label to avoid crowding, plus first and last
          if (i !== 0 && i !== data.length - 1 && i % 3 !== 0) return null;
          const label = d.date.slice(5); // MM-DD
          return (
            <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize={8} fill="#8892a4">{label}</text>
          );
        })}
      </svg>
    </div>
  );
}

/** Returns a background color. Default: high=red, low=blue. Pass reverse=true for high=blue, low=red. */
function heatColor(value: number, min: number, max: number, reverse = false): string {
  if (max === min) return "transparent";
  let t = (value - min) / (max - min); // 0 → 1
  if (reverse) t = 1 - t;
  if (t >= 0.5) {
    // upper half: white → red
    const strength = (t - 0.5) * 2; // 0 → 1
    const alpha = strength * 0.35;
    return `rgba(239, 68, 68, ${alpha})`;
  } else {
    // lower half: blue → white
    const strength = (0.5 - t) * 2; // 0 → 1
    const alpha = strength * 0.35;
    return `rgba(59, 130, 246, ${alpha})`;
  }
}

function TeamRow({ team, hittingRange, pitchingRange, eraRange, opsRange, snapshots }: { team: TeamScored; hittingRange: [number, number]; pitchingRange: [number, number]; eraRange: [number, number]; opsRange: [number, number]; snapshots: SnapshotDay[] | null }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        onClick={() => setExpanded(!expanded)}
        className="cursor-pointer hover:bg-surface-2/50 transition-colors border-t border-border/50"
      >
        <td className="py-3 pl-4 pr-2 tabular-nums text-text-muted font-semibold text-center w-10">
          {team.rank}
        </td>
        <td className="py-3 pr-3">
          <div className="flex flex-col">
            <span className="font-semibold text-text-primary text-sm">
              {team.team}
            </span>
            <span className="text-text-muted text-xs">{team.manager}</span>
          </div>
        </td>
        <td className="py-3 pr-3 text-center text-sm tabular-nums text-text-secondary">
          {team.record}
        </td>
        <td className="py-3 pr-3 text-right text-sm tabular-nums text-text-secondary" style={{ backgroundColor: heatColor(team.hittingScore, hittingRange[0], hittingRange[1]) }}>
          {team.hittingScore.toLocaleString()}
        </td>
        <td className="py-3 pr-3 text-right text-sm tabular-nums text-text-secondary" style={{ backgroundColor: heatColor(team.pitchingScore, pitchingRange[0], pitchingRange[1]) }}>
          {team.pitchingScore.toLocaleString()}
        </td>
        <td className="py-3 pr-3 text-right text-sm tabular-nums font-bold text-text-primary">
          {team.totalScore.toLocaleString()}
        </td>
        <td className="py-3 pr-3 text-right text-sm tabular-nums text-text-secondary" style={{ backgroundColor: heatColor(team.era, eraRange[0], eraRange[1], true) }}>
          {team.era.toFixed(2)}
        </td>
        <td className="py-3 pr-3 text-right text-sm tabular-nums text-text-secondary" style={{ backgroundColor: heatColor(team.ops, opsRange[0], opsRange[1]) }}>
          {team.ops.toFixed(3).replace(/^0/, "")}
        </td>
        <td className="py-3 pr-4 text-center">
          <StreakBadge streak={team.streak} />
        </td>
        <td className="py-3 pr-4 text-center text-xs text-text-muted tabular-nums">
          {team.moves}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} className="bg-surface-2/30 px-4 py-4">
            <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
              Cumulative Points
            </h4>
            {snapshots ? (
              <CumulativeChart teamName={team.team} snapshots={snapshots} />
            ) : (
              <p className="text-text-muted text-sm">Loading chart data...</p>
            )}
          </td>
        </tr>
      )}
    </>
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

    fetch("/api/snapshots?from=2026-03-25")
      .then((res) => res.json())
      .then((data) => setSnapshots(data.snapshots))
      .catch(() => {}); // Non-critical — chart just won't show
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
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-bold text-text-primary">
            TXL Power Rankings
          </h1>
          <p className="text-text-secondary mt-1">2026 Season</p>
        </div>

        {!rankings ? (
          <LoadingSkeleton />
        ) : (
          <>
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
                        i === 0
                          ? "text-amber"
                          : i === 1
                            ? "text-text-secondary"
                            : "text-amber/60"
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
                  </tr>
                </thead>
                <tbody>
                  {sorted!.map((team) => (
                    <TeamRow key={team.team} team={team} hittingRange={hittingRange} pitchingRange={pitchingRange} eraRange={eraRange} opsRange={opsRange} snapshots={snapshots} />
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-text-muted text-xs mt-6 text-center">
              Live data from ESPN Fantasy Baseball &middot; Click any team for points graph
              {updatedAt && (
                <>
                  <br />
                  Last updated {new Date(updatedAt).toLocaleString()}
                </>
              )}
            </p>
          </>
        )}
      </div>
    </main>
  );
}
