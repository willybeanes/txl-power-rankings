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

function StatBreakdownTable({
  breakdown,
  label,
  total,
}: {
  breakdown: Record<string, { raw: number; mult: number; pts: number }>;
  label: string;
  total: number;
}) {
  return (
    <div>
      <h4 className="text-xs font-semibold text-text-secondary uppercase tracking-wider mb-2">
        {label}{" "}
        <span className="text-text-primary font-bold">
          {total.toLocaleString()}
        </span>
      </h4>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-text-muted">
              <th className="text-left pr-3 pb-1">Stat</th>
              <th className="text-right pr-3 pb-1">Raw</th>
              <th className="text-right pr-3 pb-1">Mult</th>
              <th className="text-right pb-1">Pts</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(breakdown).map(([stat, { raw, mult, pts }]) => (
              <tr key={stat} className="border-t border-border/50">
                <td className="pr-3 py-0.5 font-medium text-text-secondary">
                  {stat}
                </td>
                <td className="text-right pr-3 py-0.5 text-text-primary tabular-nums">
                  {raw}
                </td>
                <td className="text-right pr-3 py-0.5 text-text-muted tabular-nums">
                  {mult > 0 ? `+${mult}x` : `${mult}x`}
                </td>
                <td
                  className={`text-right py-0.5 font-semibold tabular-nums ${
                    pts > 0
                      ? "text-green"
                      : pts < 0
                        ? "text-brand-red"
                        : "text-text-muted"
                  }`}
                >
                  {pts > 0 ? "+" : ""}
                  {pts.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
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

function TeamRow({ team, hittingRange, pitchingRange, eraRange, opsRange }: { team: TeamScored; hittingRange: [number, number]; pitchingRange: [number, number]; eraRange: [number, number]; opsRange: [number, number] }) {
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
          {team.ops.toFixed(3)}
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
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-3xl">
              <StatBreakdownTable
                breakdown={team.hittingBreakdown}
                label="Hitting"
                total={team.hittingScore}
              />
              <StatBreakdownTable
                breakdown={team.pitchingBreakdown}
                label="Pitching"
                total={team.pitchingScore}
              />
            </div>
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
                    <TeamRow key={team.team} team={team} hittingRange={hittingRange} pitchingRange={pitchingRange} eraRange={eraRange} opsRange={opsRange} />
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-text-muted text-xs mt-6 text-center">
              Live data from ESPN Fantasy Baseball &middot; Click any team for stat breakdown
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
