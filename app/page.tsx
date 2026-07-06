"use client";

import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { type TeamScored } from "@/lib/data";
import { DRAFT_PICKS, DRAFT_MANAGERS, type DraftPick } from "@/lib/draft";

type SortKey = "rank" | "team" | "hittingScore" | "pitchingScore" | "totalScore" | "era" | "moves" | "ops" | "playoffPct";
type SortDir = "asc" | "desc";
type Tab = "standings" | "graphs" | "draft" | "props" | "players" | "chat";

type TradeSeriesPoint = { date: string; murakami: number; pasquantino: number };

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
  teams: { team: string; manager?: string; dailyPoints?: number; totalScore?: number }[];
}

const CHART_COLORS = [
  "#e74c3c", "#3498db", "#2ecc71", "#f39c12", "#9b59b6",
  "#1abc9c", "#e67e22", "#d63031", "#6c5ce7", "#00b894", "#fd79a8",
];

function AllTeamsChart({ snapshots, rankings }: { snapshots: SnapshotDay[]; rankings: TeamScored[] }) {
  const teamNames = rankings.map((t) => t.team);
  const managers = Object.fromEntries(rankings.map((t) => [t.team, t.manager]));
  const liveByTeam = Object.fromEntries(rankings.map((t) => [t.team, t.totalScore]));

  // Build data series: historical snapshots + live "now" point, normalized to
  // start at 0 so the chart shows points accumulated within the visible window.
  const { labels, cumData } = useMemo(() => {
    const snapshotLabels = snapshots.map((s) => s.snapshot_date.slice(5));
    const allLabels = [...snapshotLabels, "Live"];

    const result: Record<string, number[]> = {};
    for (const name of teamNames) {
      const manager = managers[name];
      const historical = snapshots.map((snap) => {
        // Match by manager first (stable across renames), fall back to team name
        const t = snap.teams.find((s) => s.manager === manager) ??
                  snap.teams.find((s) => s.team === name);
        return t?.totalScore ?? 0;
      });
      const raw = [...historical, liveByTeam[name] ?? 0];
      const baseline = raw[0] ?? 0;
      result[name] = raw.map((v) => v - baseline);
    }
    return { labels: allLabels, cumData: result };
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

  const n = labels.length;
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
        {labels.map((label, i) => {
          if (i !== 0 && i !== n - 1 && i % labelEvery !== 0) return null;
          const isLive = label === "Live";
          return (
            <text
              key={i}
              x={xPos(i)}
              y={H - padB + 14}
              textAnchor="middle"
              fontSize={8}
              fill={isLive ? "#dc2f1f" : "#8892a4"}
              fontWeight={isLive ? 700 : 400}
            >
              {label}
            </text>
          );
        })}

        {/* Legend — sorted by window point total, colour stays tied to line */}
        {[...teamNames]
          .sort((a, b) => (cumData[b]?.[n - 1] ?? 0) - (cumData[a]?.[n - 1] ?? 0))
          .map((name, ti) => {
            const originalIdx = teamNames.indexOf(name);
            const lx = padL + plotW + 14;
            const ly = padT + ti * 26;
            const color = CHART_COLORS[originalIdx % CHART_COLORS.length];
            const windowVal = cumData[name]?.[n - 1] ?? 0;
            return (
              <g key={name}>
                <rect x={lx} y={ly + 2} width={14} height={3} rx={1.5} fill={color} />
                <text x={lx + 18} y={ly + 7} fontSize={9} fill="#374151" fontWeight={500}>
                  {managers[name] || name}
                </text>
                <text x={lx + 18} y={ly + 17} fontSize={8} fill="#8892a4">
                  {windowVal.toLocaleString()} pts
                </text>
              </g>
            );
          })}
      </svg>
    </div>
  );
}

function TradeChart({ series }: { series: TradeSeriesPoint[] }) {
  if (series.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-text-muted text-sm">
        No data available
      </div>
    );
  }

  const W = 820;
  const H = 360; // taller chart = more room for separation
  const padL = 52;
  const padR = 170;
  const padT = 50;
  const padB = 36;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const R = 22;
  const MIN_GAP = R * 2 + 50; // guaranteed space between circle centres

  const n = series.length;
  const maxY = Math.max(...series.map((p) => Math.max(p.murakami, p.pasquantino)), 1);
  const xPos = (i: number) => (n <= 1 ? padL + plotW / 2 : padL + (i / (n - 1)) * plotW);
  const yPos = (v: number) => padT + plotH - (v / maxY) * plotH;

  const yTicks = 4;
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) =>
    Math.round((maxY / yTicks) * i)
  );
  const labelEvery = Math.ceil(n / 8);

  const mPath = series
    .map((p, i) => `${i === 0 ? "M" : "L"}${xPos(i).toFixed(1)},${yPos(p.murakami).toFixed(1)}`)
    .join(" ");
  const pPath = series
    .map((p, i) => `${i === 0 ? "M" : "L"}${xPos(i).toFixed(1)},${yPos(p.pasquantino).toFixed(1)}`)
    .join(" ");

  const mFinal = series[n - 1].murakami;
  const pFinal = series[n - 1].pasquantino;

  // Line endpoints
  const endX = xPos(n - 1);
  const mEndY = yPos(mFinal);
  const pEndY = yPos(pFinal);

  // Symmetric spread: higher-value player floats UP, lower floats DOWN.
  // If spread exceeds bounds, shift both together (gap is always preserved).
  const topBound = padT + R + 4;
  const botBound = padT + plotH - R - 4;
  const mid = (mEndY + pEndY) / 2;
  // higher score = smaller Y pixel = goes up (negative direction)
  let mAnnY = mFinal >= pFinal ? mid - MIN_GAP / 2 : mid + MIN_GAP / 2;
  let pAnnY = pFinal >= mFinal ? mid - MIN_GAP / 2 : mid + MIN_GAP / 2;
  // shift both together if either overflows bounds (gap stays intact)
  const over = topBound - Math.min(mAnnY, pAnnY);
  if (over > 0) { mAnnY += over; pAnnY += over; }
  const under = Math.max(mAnnY, pAnnY) - botBound;
  if (under > 0) { mAnnY -= under; pAnnY -= under; }

  const annX = endX + 28 + R;

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 500 }}>
        <defs>
          <clipPath id="tc-clip-m">
            <circle cx={annX} cy={mAnnY} r={R} />
          </clipPath>
          <clipPath id="tc-clip-p">
            <circle cx={annX} cy={pAnnY} r={R} />
          </clipPath>
        </defs>

        {/* Y-axis grid */}
        {yTickVals.map((v) => (
          <g key={v}>
            <line x1={padL} x2={padL + plotW} y1={yPos(v)} y2={yPos(v)} stroke="#e2e8f0" strokeWidth={0.6} />
            <text x={padL - 6} y={yPos(v) + 3.5} textAnchor="end" fontSize={9} fill="#8892a4">
              {v.toLocaleString()}
            </text>
          </g>
        ))}

        {/* Data lines — Murakami=black, Pasquantino=blue */}
        <path d={mPath} fill="none" stroke="#111827" strokeWidth={2.5} strokeLinejoin="round" />
        <path d={pPath} fill="none" stroke="#3b82f6" strokeWidth={2.5} strokeLinejoin="round" />

        {/* Leader lines: endpoint → annotation centre */}
        <line
          x1={endX} y1={mEndY} x2={annX - R} y2={mAnnY}
          stroke="#111827" strokeWidth={1} strokeDasharray="3 2" opacity={0.5}
        />
        <line
          x1={endX} y1={pEndY} x2={annX - R} y2={pAnnY}
          stroke="#3b82f6" strokeWidth={1} strokeDasharray="3 2" opacity={0.5}
        />

        {/* Murakami annotation */}
        <image
          href="/headshots/Murakami.png"
          x={annX - R} y={mAnnY - R} width={R * 2} height={R * 2}
          clipPath="url(#tc-clip-m)"
          preserveAspectRatio="xMidYMid slice"
        />
        <circle cx={annX} cy={mAnnY} r={R} fill="none" stroke="#111827" strokeWidth={1.5} />
        <text x={annX + R + 5} y={mAnnY - 4} fontSize={9} fill="#111827" fontWeight={700}>
          {mFinal.toLocaleString()} pts
        </text>
        <text x={annX + R + 5} y={mAnnY + 8} fontSize={8} fill="#8892a4">
          Murakami
        </text>

        {/* Pasquantino annotation */}
        <image
          href="/headshots/Pasquantino.jpg"
          x={annX - R} y={pAnnY - R} width={R * 2} height={R * 2}
          clipPath="url(#tc-clip-p)"
          preserveAspectRatio="xMidYMid slice"
        />
        <circle cx={annX} cy={pAnnY} r={R} fill="none" stroke="#3b82f6" strokeWidth={1.5} />
        <text x={annX + R + 5} y={pAnnY - 4} fontSize={9} fill="#3b82f6" fontWeight={700}>
          {pFinal.toLocaleString()} pts
        </text>
        <text x={annX + R + 5} y={pAnnY + 8} fontSize={8} fill="#8892a4">
          Pasquantino
        </text>

        {/* X-axis labels */}
        {series.map((p, i) => {
          if (i !== 0 && i !== n - 1 && i % labelEvery !== 0) return null;
          return (
            <text key={i} x={xPos(i)} y={H - padB + 14} textAnchor="middle" fontSize={8} fill="#8892a4">
              {p.date.slice(5)}
            </text>
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

// Keyed by normalized last name for resilience against ESPN casing/spacing quirks
const HEADSHOTS_BY_LAST: Record<string, string> = {
  "bergoine": "/headshots/Andrew.jpg",
  "arredondo": "/headshots/Artie.jpeg",
  "brennen":  "/headshots/Austin.jpg",
  "tauer":    "/headshots/Charley.jpg",
  "cook":     "/headshots/Darren.jpg",
  "brooks":   "/headshots/Josh.jpg",
  "katsuda":  "/headshots/Kevin Katsuda.jpg",
  "kyne":     "/headshots/Mike Kyne.jpg",
  "porter":   "/headshots/Michael Porter.jpg",
  "harvey":   "/headshots/Patrick.jpg",
  "mattke":   "/headshots/Stephan.jpg",
  "harris":   "/headshots/Will.jpg",
};

function getHeadshot(manager: string): string | undefined {
  const lastName = manager.trim().split(/\s+/).pop()?.toLowerCase() ?? "";
  return HEADSHOTS_BY_LAST[lastName];
}

function PFPAScatter({ rankings }: { rankings: TeamScored[] }) {
  const [hovered, setHovered] = useState<string | null>(null);
  const R = 26; // headshot circle radius

  const pfVals = rankings.map((t) => t.pointsFor);
  const paVals = rankings.map((t) => t.pointsAgainst);
  const pfMin = Math.min(...pfVals);
  const pfMax = Math.max(...pfVals);
  const paMin = Math.min(...paVals);
  const paMax = Math.max(...paVals);

  // Pad the axis range by 8% so headshots don't clip the edge
  const pad = 0.08;
  const pfRange = pfMax - pfMin || 1;
  const paRange = paMax - paMin || 1;
  const xMin = pfMin - pfRange * pad;
  const xMax = pfMax + pfRange * pad;
  const yMin = paMin - paRange * pad;
  const yMax = paMax + paRange * pad;

  const W = 680, H = 380;
  const padL = 58, padR = 20, padT = 20, padB = 44;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const xPos = (pf: number) => padL + ((pf - xMin) / (xMax - xMin)) * plotW;
  const yPos = (pa: number) => padT + plotH - ((pa - yMin) / (yMax - yMin)) * plotH;

  // Nice axis ticks
  const xTicks = 5;
  const yTicks = 5;
  const xTickVals = Array.from({ length: xTicks + 1 }, (_, i) =>
    Math.round(pfMin + (pfRange / xTicks) * i)
  );
  const yTickVals = Array.from({ length: yTicks + 1 }, (_, i) =>
    Math.round(paMin + (paRange / yTicks) * i)
  );

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ minWidth: 520 }}>
        <defs>
          {rankings.map((t) => (
            <clipPath key={t.manager} id={`clip-${t.manager.replace(/\s+/g, "-")}`}>
              <circle cx={xPos(t.pointsFor)} cy={yPos(t.pointsAgainst)} r={R} />
            </clipPath>
          ))}
        </defs>

        {/* Grid lines */}
        {yTickVals.map((v) => (
          <line key={`yg-${v}`} x1={padL} x2={padL + plotW} y1={yPos(v)} y2={yPos(v)}
            stroke="var(--border)" strokeWidth={0.7} />
        ))}
        {xTickVals.map((v) => (
          <line key={`xg-${v}`} x1={xPos(v)} x2={xPos(v)} y1={padT} y2={padT + plotH}
            stroke="var(--border)" strokeWidth={0.7} />
        ))}

        {/* Axes */}
        <line x1={padL} x2={padL + plotW} y1={padT + plotH} y2={padT + plotH}
          stroke="var(--border)" strokeWidth={1} />
        <line x1={padL} x2={padL} y1={padT} y2={padT + plotH}
          stroke="var(--border)" strokeWidth={1} />

        {/* Y tick labels */}
        {yTickVals.map((v) => (
          <text key={`yt-${v}`} x={padL - 6} y={yPos(v) + 3.5}
            textAnchor="end" fontSize={9} fill="var(--text-muted)">
            {v.toLocaleString()}
          </text>
        ))}

        {/* X tick labels */}
        {xTickVals.map((v) => (
          <text key={`xt-${v}`} x={xPos(v)} y={padT + plotH + 14}
            textAnchor="middle" fontSize={9} fill="var(--text-muted)">
            {v.toLocaleString()}
          </text>
        ))}

        {/* Axis labels */}
        <text x={padL + plotW / 2} y={H - 2} textAnchor="middle" fontSize={10} fontWeight={600}
          fill="var(--text-secondary)">
          Points For
        </text>
        <text x={12} y={padT + plotH / 2} textAnchor="middle" fontSize={10} fontWeight={600}
          fill="var(--text-secondary)"
          transform={`rotate(-90, 12, ${padT + plotH / 2})`}>
          Points Against
        </text>

        {/* Headshot circles — draw hovered last so it's on top */}
        {[...rankings]
          .sort((a, b) => (a.manager === hovered ? 1 : b.manager === hovered ? -1 : 0))
          .map((t) => {
            const cx = xPos(t.pointsFor);
            const cy = yPos(t.pointsAgainst);
            const clipId = `clip-${t.manager.replace(/\s+/g, "-")}`;
            const isHovered = hovered === t.manager;
            const imgSrc = getHeadshot(t.manager);
            return (
              <g key={t.manager}
                onMouseEnter={() => setHovered(t.manager)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: "pointer" }}>
                {/* Shadow / border ring */}
                <circle cx={cx} cy={cy} r={R + 2}
                  fill={isHovered ? "var(--brand-red, #dc2f1f)" : "var(--border)"}
                  opacity={isHovered ? 1 : 0.8} />
                {/* Headshot image clipped to circle */}
                {imgSrc ? (
                  <image href={imgSrc} x={cx - R} y={cy - R} width={R * 2} height={R * 2}
                    clipPath={`url(#${clipId})`}
                    preserveAspectRatio="xMidYMid slice" />
                ) : (
                  <circle cx={cx} cy={cy} r={R} fill="var(--surface-2)" />
                )}
                {/* Tooltip on hover */}
                {isHovered && (
                  <g>
                    <rect
                      x={cx + R + 4} y={cy - 28}
                      width={148} height={56}
                      rx={6} fill="var(--surface)"
                      stroke="var(--border)" strokeWidth={1}
                    />
                    <text x={cx + R + 12} y={cy - 12} fontSize={10} fontWeight={700}
                      fill="var(--text-primary)">{t.team}</text>
                    <text x={cx + R + 12} y={cy + 2} fontSize={9}
                      fill="var(--text-muted)">{t.manager}</text>
                    <text x={cx + R + 12} y={cy + 16} fontSize={9}
                      fill="var(--text-secondary)">
                      PF {t.pointsFor.toFixed(1)} · PA {t.pointsAgainst.toFixed(1)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
      </svg>
    </div>
  );
}

// ─── Players Tab ─────────────────────────────────────────────────────────────

interface PlayerEntry {
  name: string; team: string; manager: string;
  position: string; type: "hitter" | "pitcher"; txlScore: number;
  draftRound: number | null; keeper: boolean; acquisitionType: "DRAFT" | "ADD" | "TRADE";
}

const POSITION_ORDER = ["SP", "RP", "2-WAY", "C", "1B", "2B", "3B", "SS", "OF", "DH"];

function PlayersTab() {
  const [players, setPlayers] = useState<PlayerEntry[] | null>(null);
  const [filterManager, setFilterManager] = useState<string | null>(null);
  const [filterPosition, setFilterPosition] = useState<string | null>(null);
  const [tagFilters, setTagFilters] = useState<Partial<Record<"KEEPER" | "TRADE" | "ADD", "include" | "exclude">>>({});

  function cycleTag(tag: "KEEPER" | "TRADE" | "ADD") {
    setTagFilters((prev) => {
      const cur = prev[tag];
      if (!cur) return { ...prev, [tag]: "include" };
      if (cur === "include") return { ...prev, [tag]: "exclude" };
      const next = { ...prev }; delete next[tag]; return next;
    });
  }

  useEffect(() => {
    fetch("/api/player-leaderboard")
      .then((r) => r.json())
      .then((d) => { setPlayers(d.players ?? []); })
      .catch(() => { setPlayers([]); });
  }, []);

  // Unique managers sorted alphabetically by team name
  const managers = useMemo(() => {
    if (!players) return [];
    const seen = new Set<string>();
    return players
      .map((p) => ({ manager: p.manager, team: p.team }))
      .filter(({ manager }) => seen.has(manager) ? false : (seen.add(manager), true))
      .sort((a, b) => a.team.localeCompare(b.team));
  }, [players]);

  // Unique positions present in data, sorted by canonical order
  const positions = useMemo(() => {
    if (!players) return [];
    const present = new Set(players.map((p) => p.position));
    return POSITION_ORDER.filter((pos) => present.has(pos));
  }, [players]);

  const visiblePlayers = useMemo(() => {
    if (!players) return players;
    return players.filter((p) =>
      (!filterManager || p.manager === filterManager) &&
      (!filterPosition || (
        filterPosition === "Hitters" ? p.type === "hitter" :
        filterPosition === "Pitchers" ? p.type === "pitcher" :
        p.position === filterPosition
      )) &&
      (() => {
        const includes = (Object.entries(tagFilters) as ["KEEPER"|"TRADE"|"ADD", "include"|"exclude"][]).filter(([,v]) => v === "include");
        const excludes = (Object.entries(tagFilters) as ["KEEPER"|"TRADE"|"ADD", "include"|"exclude"][]).filter(([,v]) => v === "exclude");
        const matchTag = (tag: "KEEPER"|"TRADE"|"ADD") => tag === "KEEPER" ? p.keeper : p.acquisitionType === tag;
        if (includes.length > 0 && !includes.some(([t]) => matchTag(t))) return false;
        if (excludes.some(([t]) => matchTag(t))) return false;
        return true;
      })()
    );
  }, [players, filterManager, filterPosition, tagFilters]);

  return (
    <div className="space-y-3">
      {/* Team filter pills */}
      {players && players.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-text-muted text-xs font-semibold w-10 shrink-0">Team</span>
          <button
            onClick={() => setFilterManager(null)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              filterManager === null
                ? "bg-brand-red text-white"
                : "bg-surface-2 text-text-muted hover:text-text-primary"
            }`}
          >
            All
          </button>
          {managers.map(({ manager, team }) => (
            <button
              key={manager}
              onClick={() => setFilterManager(filterManager === manager ? null : manager)}
              className={`flex items-center gap-1.5 pl-1.5 pr-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                filterManager === manager
                  ? "bg-brand-red text-white"
                  : "bg-surface-2 text-text-muted hover:text-text-primary"
              }`}
            >
              {getHeadshot(manager) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={getHeadshot(manager)} alt={manager}
                  className="w-4 h-4 rounded-full object-cover flex-shrink-0" />
              )}
              {team}
            </button>
          ))}
        </div>
      )}

      {/* Tag filter pills */}
      {players && players.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-text-muted text-xs font-semibold w-10 shrink-0">Tag</span>
          <button
            onClick={() => setTagFilters({})}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              Object.keys(tagFilters).length === 0 ? "bg-brand-red text-white" : "bg-surface-2 text-text-muted hover:text-text-primary"
            }`}
          >
            All
          </button>
          {(["KEEPER", "TRADE", "ADD"] as const).map((tag) => {
            const state = tagFilters[tag];
            const label = tag === "ADD" ? "FA" : tag;
            const style =
              tag === "KEEPER"
                ? state === "include" ? "bg-amber-500 text-white"
                : state === "exclude" ? "bg-amber-500/10 text-amber-400/40 line-through"
                : "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25"
              : tag === "TRADE"
                ? state === "include" ? "bg-blue-500 text-white"
                : state === "exclude" ? "bg-blue-500/10 text-blue-400/40 line-through"
                : "bg-blue-500/15 text-blue-400 hover:bg-blue-500/25"
                : state === "include" ? "bg-surface-2 text-text-primary border border-border"
                : state === "exclude" ? "bg-surface-2 text-text-muted/40 line-through"
                : "bg-surface-2 text-text-muted hover:text-text-primary";
            return (
              <button
                key={tag}
                onClick={() => cycleTag(tag)}
                className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${style}`}
              >
                {label}
              </button>
            );
          })}
        </div>
      )}

      {/* Position filter pills */}
      {positions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-text-muted text-xs font-semibold w-10 shrink-0">Pos</span>
          <button
            onClick={() => setFilterPosition(null)}
            className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              filterPosition === null
                ? "bg-brand-red text-white"
                : "bg-surface-2 text-text-muted hover:text-text-primary"
            }`}
          >
            All
          </button>
          {(["Hitters", "Pitchers"] as const).map((type) => (
            <button
              key={type}
              onClick={() => setFilterPosition(filterPosition === type ? null : type)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                filterPosition === type
                  ? "bg-brand-red text-white"
                  : "bg-surface-2 text-text-muted hover:text-text-primary"
              }`}
            >
              {type}
            </button>
          ))}
          <span className="text-border text-xs">·</span>
          {positions.map((pos) => (
            <button
              key={pos}
              onClick={() => setFilterPosition(filterPosition === pos ? null : pos)}
              className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                filterPosition === pos
                  ? "bg-brand-red text-white"
                  : "bg-surface-2 text-text-muted hover:text-text-primary"
              }`}
            >
              {pos}
            </button>
          ))}
        </div>
      )}

      <div className="rounded-[14px] bg-surface border border-border overflow-hidden">
        {visiblePlayers === null ? (
          <div className="space-y-px p-2">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="h-12 bg-surface-2/50 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : visiblePlayers.length === 0 ? (
          <p className="text-text-muted text-sm p-6">No data available.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-text-muted text-xs border-b border-border bg-surface-2/40">
                <th className="text-left py-2.5 pl-4 pr-2 font-semibold w-8">#</th>
                <th className="text-left py-2.5 px-2 font-semibold">Player</th>
                <th className="text-left py-2.5 px-2 font-semibold hidden sm:table-cell">Pos</th>
                <th className="text-left py-2.5 px-2 font-semibold hidden sm:table-cell">Rd</th>
                {!filterManager && <th className="text-left py-2.5 px-2 font-semibold">Team</th>}
                <th className="text-right py-2.5 px-4 font-semibold">TXL Pts</th>
              </tr>
            </thead>
            <tbody>
              {visiblePlayers.map((p) => {
                const globalRank = players!.indexOf(p) + 1;
                return (
                <tr key={`${p.name}-${p.team}`}
                  className="border-t border-border/30 transition-colors hover:bg-surface-2/30">
                  <td className="py-2.5 pl-4 pr-2 tabular-nums text-text-muted text-xs font-semibold">
                    {globalRank}
                  </td>
                  <td className="py-2.5 px-2 font-semibold text-text-primary">{p.name}</td>
                  <td className="py-2.5 px-2 text-text-muted text-xs hidden sm:table-cell">{p.position}</td>
                  <td className="py-2.5 px-2 text-xs hidden sm:table-cell">
                    <div className="flex items-center gap-1.5">
                      <span className="text-text-muted">
                        {p.draftRound != null ? `Rd ${p.draftRound}` : <span className="text-text-muted/50">—</span>}
                      </span>
                      {p.keeper && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-400 leading-none">
                          KEEPER
                        </span>
                      )}
                      {p.acquisitionType === "TRADE" && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-blue-500/15 text-blue-400 leading-none">
                          TRADE
                        </span>
                      )}
                      {p.acquisitionType === "ADD" && (
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface-2 text-text-muted leading-none">
                          FA
                        </span>
                      )}
                    </div>
                  </td>
                  {!filterManager && (
                    <td className="py-2.5 px-2">
                      <div className="flex items-center gap-2">
                        {getHeadshot(p.manager) && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={getHeadshot(p.manager)} alt={p.manager}
                            className="w-6 h-6 rounded-full object-cover border border-border flex-shrink-0" />
                        )}
                        <span className="text-text-secondary text-xs truncate max-w-[120px]">{p.team}</span>
                      </div>
                    </td>
                  )}
                  <td className="py-2.5 px-4 text-right tabular-nums font-bold text-text-primary">
                    {p.txlScore.toLocaleString()}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Props Tab ───────────────────────────────────────────────────────────────

interface PropTeam { team: string; manager: string; value: number }
interface WeeklyScore { team: string; manager: string; week: number; points: number }
interface BadLuckEntry {
  team: string; manager: string; record: string;
  pointsFor: number; pointsAgainst: number;
  paRank: number; pfRank: number; wPctRank: number; badLuckScore: number;
}
interface PropsData {
  n: number;
  hrAll: PropTeam[];
  kAll: PropTeam[];
  weeklyTop10: WeeklyScore[];
  badLuck: BadLuckEntry[];
}

function PropRankedList({
  teams,
  statLabel,
  format = (v: number) => v.toString(),
}: {
  teams: PropTeam[];
  statLabel: string;
  format?: (v: number) => string;
}) {
  const medals = ["🥇", "🥈", "🥉"];
  return (
    <div className="space-y-1.5">
      {teams.map((t, i) => (
        <div key={t.team} className={`flex items-center gap-3 rounded-xl px-3 py-2 ${i === 0 ? "bg-amber/8 border border-amber/20" : "bg-surface-2/30"}`}>
          <span className={`w-6 text-center flex-shrink-0 ${i < 3 ? "text-lg" : "text-xs font-bold text-text-muted"}`}>
            {i < 3 ? medals[i] : `#${i + 1}`}
          </span>
          {getHeadshot(t.manager) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={getHeadshot(t.manager)} alt={t.manager}
              className="w-8 h-8 rounded-full object-cover border border-border flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-text-primary truncate">{t.team}</p>
            <p className="text-xs text-text-muted truncate">{t.manager}</p>
          </div>
          <span className="text-sm font-bold tabular-nums text-text-primary flex-shrink-0">
            {format(t.value)}
            <span className="text-xs font-normal text-text-muted ml-1">{statLabel}</span>
          </span>
        </div>
      ))}
    </div>
  );
}

function PropsTab() {
  const [data, setData] = useState<PropsData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/props")
      .then((r) => r.json())
      .then((d) => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {[0,1,2,3].map((i) => (
          <div key={i} className="animate-pulse rounded-[14px] bg-surface border border-border h-56" />
        ))}
      </div>
    );
  }

  if (!data) return <p className="text-text-muted text-sm">Failed to load props data.</p>;

  const badLuckWinner = data.badLuck[0];

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

      {/* Home Run Kings */}
      <div className="rounded-[14px] bg-surface border border-border p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">💣</span>
          <div>
            <h2 className="font-bold text-text-primary text-base">Home Run Kings</h2>
            <p className="text-xs text-text-muted">Most HR by hitters — season total</p>
          </div>
        </div>
        <PropRankedList teams={data.hrAll} statLabel="HR" />
      </div>

      {/* Strikeout Artists */}
      <div className="rounded-[14px] bg-surface border border-border p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">🔥</span>
          <div>
            <h2 className="font-bold text-text-primary text-base">Strikeout Artists</h2>
            <p className="text-xs text-text-muted">Most K by pitchers — season total</p>
          </div>
        </div>
        <PropRankedList teams={data.kAll} statLabel="K" />
      </div>

      {/* Single-Week High Score */}
      <div className="rounded-[14px] bg-surface border border-border p-5">
        <div className="flex items-center gap-2 mb-4">
          <span className="text-2xl">🚀</span>
          <div>
            <h2 className="font-bold text-text-primary text-base">Single-Week Record</h2>
            <p className="text-xs text-text-muted">Highest score in a 7-day matchup week (excl. Week 1)</p>
          </div>
        </div>
        <div className="space-y-2">
          {data.weeklyTop10.map((w, i) => {
            const medals = ["🥇", "🥈", "🥉"];
            return (
              <div key={`${w.team}-${w.week}`}
                className={`flex items-center gap-3 rounded-xl px-3 py-2 ${i === 0 ? "bg-amber/8 border border-amber/20" : "bg-surface-2/30"}`}>
                <span className={`w-6 text-center flex-shrink-0 ${i < 3 ? "text-lg" : "text-xs font-bold text-text-muted"}`}>
                  {i < 3 ? medals[i] : `#${i + 1}`}
                </span>
                {getHeadshot(w.manager) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={getHeadshot(w.manager)} alt={w.manager}
                    className="w-9 h-9 rounded-full object-cover border border-border flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-text-primary truncate">{w.team}</p>
                  <p className="text-xs text-text-muted">Week {w.week} · {w.manager}</p>
                </div>
                <span className="text-sm font-bold tabular-nums text-text-primary flex-shrink-0">
                  {w.points.toFixed(1)}
                  <span className="text-xs font-normal text-text-muted ml-1">pts</span>
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Bad Luck Trophy */}
      <div className="rounded-[14px] bg-surface border border-border p-5">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">🍀</span>
          <div>
            <h2 className="font-bold text-text-primary text-base">Bad Luck Trophy</h2>
            <p className="text-xs text-text-muted">No one knows how it works</p>
          </div>
        </div>

        {/* Winner callout */}
        <div className="flex items-center gap-3 rounded-xl px-3 py-2.5 bg-brand-red/5 border border-brand-red/20 mb-3 mt-3">
          {getHeadshot(badLuckWinner.manager) && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={getHeadshot(badLuckWinner.manager)} alt={badLuckWinner.manager}
              className="w-10 h-10 rounded-full object-cover border-2 border-brand-red/40 flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-text-primary truncate">{badLuckWinner.team}</p>
            <p className="text-xs text-text-muted">{badLuckWinner.manager} · {badLuckWinner.record}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-lg font-bold text-brand-red tabular-nums">{badLuckWinner.badLuckScore}</p>
            <p className="text-[10px] text-text-muted">score</p>
          </div>
        </div>

        {/* Full table */}
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-text-muted border-b border-border/50">
                <th className="text-left py-1.5 pr-2 font-semibold">Team</th>
                <th className="text-center py-1.5 px-1 font-semibold" title="Points Against rank (1=most PA)">PA Rk</th>
                <th className="text-center py-1.5 px-1 font-semibold" title="Points For rank (1=most PF)">PF Rk</th>
                <th className="text-center py-1.5 px-1 font-semibold" title="Win% rank (1=best record)">W% Rk</th>
                <th className="text-right py-1.5 pl-1 font-semibold">Score</th>
              </tr>
            </thead>
            <tbody>
              {data.badLuck.map((t, i) => (
                <tr key={t.team} className={`border-t border-border/30 ${i === 0 ? "bg-brand-red/5 font-semibold" : ""}`}>
                  <td className="py-1.5 pr-2">
                    <span className="text-text-primary">{t.team}</span>
                    <span className="text-text-muted ml-1.5 font-normal">{t.record}</span>
                  </td>
                  <td className="text-center py-1.5 px-1 tabular-nums text-text-secondary">{t.paRank}</td>
                  <td className="text-center py-1.5 px-1 tabular-nums text-text-secondary">{t.pfRank}</td>
                  <td className="text-center py-1.5 px-1 tabular-nums text-text-secondary">{t.wPctRank}</td>
                  <td className={`text-right py-1.5 pl-1 tabular-nums font-bold ${i === 0 ? "text-brand-red" : "text-text-primary"}`}>
                    {t.badLuckScore}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

    </div>
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
  const [teamNames, setTeamNames] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch("/api/rosters")
      .then((r) => r.json())
      .then((d) => {
        setRosters(d.rosters ?? {});
        setPlayerPoints(d.playerPoints ?? {});
        setTeamNames(d.teamNames ?? {});
      })
      .catch(() => { setRosters({}); setPlayerPoints({}); setTeamNames({}); });
  }, []);

  // Normalized points lookup: strips accents/punctuation so "Andrés Muñoz" matches ESPN's "Andres Munoz"
  const normalizedPts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const [name, pts] of Object.entries(playerPoints)) {
      m[normName(name)] = pts;
    }
    return m;
  }, [playerPoints]);

  const getPts = (playerName: string): number | undefined => {
    const direct = playerPoints[playerName];
    if (direct !== undefined) return direct;
    return normalizedPts[normName(playerName)];
  };

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
    const pts = getPts(pick.player);
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
                    {getHeadshot(mgr.fullName) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={getHeadshot(mgr.fullName)}
                        alt={mgr.fullName}
                        className="w-7 h-7 rounded-full object-cover border border-border mx-auto mb-0.5"
                      />
                    )}
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
                                  const pts = isDropped(pick) ? null : (getPts(pick.player) ?? null);
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
                    <p className="font-bold text-text-primary text-sm">
                      {(() => {
                        const key = rosters ? rosterKey(mgr.fullName, rosters) : null;
                        return (key && teamNames[key]) ? teamNames[key] : mgr.fullName;
                      })()}
                    </p>
                    <p className="text-text-muted text-xs">{mgr.fullName}</p>
                  </div>
                  <span className="text-xs text-text-muted tabular-nums">
                    {picks.length} picks
                  </span>
                </div>
                <div className="divide-y divide-border/30">
                  {picks.map((pick, i) => {
                    const dropped = isDropped(pick);
                    const pts = dropped ? null : (getPts(pick.player) ?? null);
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

type ChatMessage = { role: "user" | "assistant"; text: string };

function renderMarkdown(text: string) {
  const parts: (string | React.ReactElement)[] = [];
  let key = 0;
  const lines = text.split("\n");
  for (let li = 0; li < lines.length; li++) {
    if (li > 0) parts.push(<br key={`br-${key++}`} />);
    const line = lines[li];
    const regex = /(\*\*\*(.+?)\*\*\*|\*\*(.+?)\*\*|\*(.+?)\*)/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(line)) !== null) {
      if (match.index > lastIndex) parts.push(line.slice(lastIndex, match.index));
      if (match[2]) {
        parts.push(<strong key={key}><em>{match[2]}</em></strong>);
      } else if (match[3]) {
        parts.push(<strong key={key}>{match[3]}</strong>);
      } else if (match[4]) {
        parts.push(<em key={key}>{match[4]}</em>);
      }
      key++;
      lastIndex = regex.lastIndex;
    }
    if (lastIndex < line.length) parts.push(line.slice(lastIndex));
  }
  return parts;
}

function ChatTab() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", text }]);
    setLoading(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text }),
      });
      const data = await res.json();
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: data.reply ?? data.error ?? "Something went wrong." },
      ]);
    } catch {
      setMessages((prev) => [...prev, { role: "assistant", text: "Failed to reach the server." }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading]);

  if (messages.length === 0 && !loading) {
    return (
      <div className="text-center mt-8 space-y-6">
        <div className="space-y-2">
          <p className="text-lg font-semibold text-text-secondary">Ask TXL Bot anything</p>
          <p className="text-text-muted text-sm">Player stats, team standings, scoring trends, and more.</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-center">
          {["Who's #1 right now?", "Top 5 hitters by TXL score?", "Who's the GOAT country artist?", "What's Steph's worst trade?"].map((q) => (
            <button
              key={q}
              onClick={() => setInput(q)}
              className="px-3 py-1.5 rounded-full text-xs border border-border bg-surface hover:bg-surface-2 text-text-secondary transition-colors"
            >
              {q}
            </button>
          ))}
        </div>
        <div className="flex gap-2 max-w-lg mx-auto">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
            placeholder="Ask about players, standings, stats..."
            className="flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-red/30 focus:border-brand-red"
          />
          <button
            onClick={send}
            disabled={!input.trim()}
            className="rounded-xl bg-brand-red hover:bg-brand-red-hover text-white px-5 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Send
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 mt-6">
      <div ref={scrollRef} className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                msg.role === "user"
                  ? "bg-brand-red text-white rounded-br-md"
                  : "bg-surface border border-border text-text-primary rounded-bl-md"
              }`}
            >
              {msg.role === "assistant" ? renderMarkdown(msg.text) : msg.text}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-surface border border-border rounded-2xl rounded-bl-md px-4 py-2.5 text-sm text-text-muted">
              <span className="inline-flex gap-1">
                <span className="animate-bounce" style={{ animationDelay: "0ms" }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: "150ms" }}>.</span>
                <span className="animate-bounce" style={{ animationDelay: "300ms" }}>.</span>
              </span>
            </div>
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && send()}
          placeholder="Ask about players, standings, stats..."
          disabled={loading}
          className="flex-1 rounded-xl border border-border bg-surface px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-red/30 focus:border-brand-red disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={loading || !input.trim()}
          className="rounded-xl bg-brand-red hover:bg-brand-red-hover text-white px-5 py-2.5 text-sm font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Send
        </button>
      </div>
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
  const [chartFrom, setChartFrom] = useState<string>(""); // YYYY-MM-DD or ""
  const [chartTo, setChartTo] = useState<string>("");     // YYYY-MM-DD or ""
  const [tradeChart, setTradeChart] = useState<TradeSeriesPoint[] | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("rank");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [activeTab, setActiveTab] = useState<Tab>("standings");

  // Sync tab with URL (?tab=standings|graphs|draft)
  useEffect(() => {
    const param = new URLSearchParams(window.location.search).get("tab");
    if (param === "standings" || param === "graphs" || param === "draft" || param === "props" || param === "players" || param === "chat") {
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

    fetch("/api/player-chart")
      .then((res) => res.json())
      .then((data) => setTradeChart(data.series ?? []))
      .catch(() => setTradeChart([]));
  }, []);

  const filteredSnapshots = useMemo(() => {
    if (!snapshots) return snapshots;
    return snapshots.filter((s) => {
      if (chartFrom && s.snapshot_date < chartFrom) return false;
      if (chartTo && s.snapshot_date > chartTo) return false;
      return true;
    });
  }, [snapshots, chartFrom, chartTo]);

  const applyPreset = (days: number | null) => {
    if (days === null) {
      setChartFrom("");
      setChartTo("");
    } else {
      const d = new Date();
      d.setDate(d.getDate() - days);
      setChartFrom(d.toISOString().split("T")[0]);
      setChartTo("");
    }
  };

  if (error && activeTab !== "chat") {
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
    <main className="min-h-screen px-4 sm:px-6">
      {/* Sticky header + tabs */}
      <div className="sticky top-0 z-20 bg-[var(--bg)] border-b border-border">
        <div className={`mx-auto ${activeTab === "draft" ? "max-w-[1600px]" : "max-w-5xl"} transition-none`}>
          <div className="pt-6 pb-0">
            <h1 className="text-2xl sm:text-3xl font-bold text-text-primary">TXL Power Rankings</h1>
            <p className="text-text-secondary mt-0.5 text-sm">2026 Season</p>
          </div>
          <div className="flex gap-6 mt-3">
            {(["standings", "graphs", "draft", "props", "players", "chat"] as Tab[]).map((tab) => (
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
        </div>
      </div>

      <div className={`mx-auto ${activeTab === "chat" ? "pt-0 pb-0" : "pt-6 pb-8"} ${activeTab === "draft" ? "max-w-[1600px]" : "max-w-5xl"}`}>
        {activeTab === "chat" ? (
          <ChatTab />
        ) : activeTab === "players" ? (
          <div>
            <div className="mb-6">
              <h2 className="text-base font-bold text-text-primary">Player Leaderboard</h2>
              <p className="text-text-muted text-xs mt-0.5">
                Individual TXL points — season total
              </p>
            </div>
            <PlayersTab />
          </div>
        ) : activeTab === "props" ? (
          <div>
            <div className="mb-6">
              <h2 className="text-base font-bold text-text-primary">Season Props</h2>
              <p className="text-text-muted text-xs mt-0.5">
                Live season-long awards · updates daily
              </p>
            </div>
            <PropsTab />
          </div>
        ) : activeTab === "draft" ? (
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
                  <div className="flex items-start justify-between mb-3">
                    <span
                      className={`text-2xl font-bold ${
                        i === 0 ? "text-amber" : i === 1 ? "text-text-secondary" : "text-amber/60"
                      }`}
                    >
                      #{i + 1}
                    </span>
                    <StreakBadge streak={team.streak} />
                  </div>
                  <div className="flex items-center gap-3 mb-2">
                    {getHeadshot(team.manager) && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={getHeadshot(team.manager)}
                        alt={team.manager}
                        className="w-12 h-12 rounded-full object-cover border-2 border-border flex-shrink-0"
                      />
                    )}
                    <div>
                      <h3 className="font-bold text-text-primary leading-tight">{team.team}</h3>
                      <p className="text-text-muted text-xs">{team.manager}</p>
                    </div>
                  </div>
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
          <div className="space-y-6">
            <div className="rounded-[14px] bg-surface border border-border p-6">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider">
                  {(() => {
                    if (!chartFrom && !chartTo) return "Cumulative Points — Season to Date";
                    if (chartFrom && !chartTo) {
                      const days = Math.round((Date.now() - new Date(chartFrom).getTime()) / 86400000);
                      if (days === 7) return "Cumulative Points — Last 7 Days";
                      if (days === 14) return "Cumulative Points — Last 14 Days";
                      if (days === 30) return "Cumulative Points — Last 30 Days";
                      return `Cumulative Points — Since ${chartFrom.slice(5).replace("-", "/")}`;
                    }
                    return `Cumulative Points — ${chartFrom.slice(5).replace("-", "/")} to ${chartTo.slice(5).replace("-", "/")}`;
                  })()}
                </h2>
                {/* Date filter controls */}
                <div className="flex flex-wrap items-center gap-2">
                  {([["All", null], ["30d", 30], ["14d", 14], ["7d", 7]] as [string, number | null][]).map(([label, days]) => {
                    const active = days === null ? (!chartFrom && !chartTo) : (() => {
                      if (!chartFrom || chartTo) return false;
                      const d = new Date(); d.setDate(d.getDate() - (days as number));
                      return chartFrom === d.toISOString().split("T")[0];
                    })();
                    return (
                      <button
                        key={label}
                        onClick={() => applyPreset(days)}
                        className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
                          active
                            ? "bg-brand-red text-white"
                            : "bg-surface-2 text-text-muted hover:text-text-primary"
                        }`}
                      >
                        {label}
                      </button>
                    );
                  })}
                  <div className="flex items-center gap-1.5 ml-1">
                    <input
                      type="date"
                      value={chartFrom}
                      min="2026-03-25"
                      max={chartTo || new Date().toISOString().split("T")[0]}
                      onChange={(e) => setChartFrom(e.target.value)}
                      className="bg-surface-2 border border-border rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-brand-red"
                    />
                    <span className="text-text-muted text-xs">–</span>
                    <input
                      type="date"
                      value={chartTo}
                      min={chartFrom || "2026-03-25"}
                      max={new Date().toISOString().split("T")[0]}
                      onChange={(e) => setChartTo(e.target.value)}
                      className="bg-surface-2 border border-border rounded-lg px-2 py-1 text-xs text-text-primary focus:outline-none focus:border-brand-red"
                    />
                  </div>
                </div>
              </div>
              {filteredSnapshots === null ? (
                <div className="animate-pulse h-64 bg-surface-2/50 rounded-lg" />
              ) : (
                <AllTeamsChart snapshots={filteredSnapshots} rankings={rankings} />
              )}
              <p className="text-text-muted text-xs mt-4">
                Daily snapshots taken at ~11:55 PM ET · Each point represents one day&apos;s fantasy scoring
              </p>
            </div>

            <div className="rounded-[14px] bg-surface border border-border p-6">
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-1">
                Points For vs. Points Against
              </h2>
              <p className="text-text-muted text-xs mb-4">
                Based on ESPN H&amp;H matchup scoring · Hover a photo for details
              </p>
              <PFPAScatter rankings={rankings} />
            </div>

            <div className="rounded-[14px] bg-surface border border-border p-6">
              <h2 className="text-sm font-semibold text-text-secondary uppercase tracking-wider mb-1">
                The Trade — Murakami vs. Pasquantino
              </h2>
              <p className="text-text-muted text-xs mb-4">
                Cumulative points since April 26th
              </p>
              {tradeChart === null ? (
                <div className="animate-pulse h-48 bg-surface-2/50 rounded-lg" />
              ) : (
                <TradeChart series={tradeChart} />
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
