import { getSupabase } from "@/lib/supabase";
import { fetchTradeTransactions, type ESPNTradeTransaction } from "@/lib/espn";

/** How far apart a GroupMe announcement and an ESPN trade transaction can be and still be considered a match. */
const MATCH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** ESPN league history is only queried for these seasons. */
const SEASONS = [2024, 2025, 2026];

/**
 * Best-effort scan for "2027 3rd round pick" / "2027 R3" / "2028 5th rd" style
 * mentions — a hint for the reviewer, not authoritative. Anchors on a year
 * token, then looks for a round designator nearby. Purely informal shorthand
 * with no "round"/"rd"/"R" marker at all (e.g. "2025 2nd for 2026 4th") won't
 * be caught — the reviewer still sees the raw text either way.
 */
const YEAR_RE = /20[2-3]\d/g;
const ROUND_RE =
  /\b(?:R|Rd\.?|Round)\s*(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:rounder|round|rd\.?)\b/gi;

function findPickMentions(text: string): string[] {
  const mentions = new Set<string>();
  for (const y of text.matchAll(YEAR_RE)) {
    const yearStr = y[0];
    const yearIdx = y.index ?? 0;
    const window = text.slice(Math.max(0, yearIdx - 30), Math.min(text.length, yearIdx + yearStr.length + 30));
    ROUND_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ROUND_RE.exec(window)) !== null) {
      const round = m[1] ?? m[2];
      if (round) mentions.add(`${yearStr} R${round}`);
    }
  }
  return [...mentions];
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function csvRow(values: string[]): string {
  return values.map(csvCell).join(",") + "\n";
}

interface TradeMessageRow {
  id: string;
  sender_name: string | null;
  text: string | null;
  created_at: string;
}

export async function GET(request: Request) {
  const secret = new URL(request.url).searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const supabase = getSupabase();

    const [{ data: messages, error: msgError }, { data: existingTrades, error: tradeError }] =
      await Promise.all([
        supabase
          .from("trade_messages")
          .select("id, sender_name, text, created_at")
          .order("created_at", { ascending: true }),
        supabase.from("trades").select("source_message_id"),
      ]);
    if (msgError) throw new Error(`Supabase trade_messages error: ${msgError.message}`);
    if (tradeError) throw new Error(`Supabase trades error: ${tradeError.message}`);

    const alreadyStructured = new Set((existingTrades ?? []).map((t) => t.source_message_id as string));
    const pending = ((messages ?? []) as TradeMessageRow[]).filter(
      (m) => !alreadyStructured.has(m.id) && m.text && m.text.trim().length > 0
    );

    const espnResults = await Promise.allSettled(SEASONS.map((s) => fetchTradeTransactions(s)));
    const espnTrades: ESPNTradeTransaction[] = espnResults.flatMap((r) =>
      r.status === "fulfilled" ? r.value : []
    );
    const espnFetchErrors = espnResults
      .map((r, i) => (r.status === "rejected" ? `${SEASONS[i]}: ${r.reason}` : null))
      .filter((x): x is string => x !== null);

    if (new URL(request.url).searchParams.get("debug") === "1") {
      return Response.json({
        pendingMessageCount: pending.length,
        perSeason: SEASONS.map((s, i) => ({
          season: s,
          status: espnResults[i].status,
          count: espnResults[i].status === "fulfilled" ? (espnResults[i] as PromiseFulfilledResult<ESPNTradeTransaction[]>).value.length : null,
          error: espnResults[i].status === "rejected" ? String((espnResults[i] as PromiseRejectedResult).reason) : null,
        })),
        sampleTrades: espnTrades.slice(0, 5),
      });
    }

    if (new URL(request.url).searchParams.get("debug") === "raw") {
      const leagueId = process.env.ESPN_LEAGUE_ID;
      const espnS2 = process.env.ESPN_S2;
      const swid = process.env.ESPN_SWID;
      const base = `https://lm-api-reads.fantasy.espn.com/apis/v3/games/flb/seasons/2026/segments/0/leagues/${leagueId}`;
      const res = await fetch(`${base}?view=mTransactions2`, {
        headers: { Cookie: `espn_s2=${espnS2}; SWID=${swid}` },
        cache: "no-store",
      });
      const data = await res.json();
      const all = Array.isArray(data.transactions) ? data.transactions : [];
      const trade = all.find((t: Record<string, unknown>) => typeof t.type === "string" && t.type.includes("TRADE"));
      return Response.json({ totalTransactions: all.length, sampleKeys: all[0] ? Object.keys(all[0]) : [], firstTradeRecord: trade ?? null });
    }

    let csv = csvRow([
      "source_message_id",
      "posted_at",
      "sender",
      "raw_text",
      "espn_teams_involved",
      "espn_players_moved",
      "text_pick_mentions",
      "approved (Y/N)",
      "corrections / notes",
    ]);

    for (const m of pending) {
      const postedAt = new Date(m.created_at).getTime();
      const nearbyTrades = espnTrades.filter((t) => Math.abs(t.processDate - postedAt) <= MATCH_WINDOW_MS);

      const teams = [...new Set(nearbyTrades.flatMap((t) => t.teamNames))].join("; ");
      const players = nearbyTrades
        .flatMap((t) => t.items)
        .map((it) => `${it.playerName}: ${it.fromTeam ?? "?"} -> ${it.toTeam ?? "?"}`)
        .join("; ");
      const pickMentions = findPickMentions(m.text ?? "").join("; ");

      csv += csvRow([
        m.id,
        m.created_at,
        m.sender_name ?? "",
        m.text ?? "",
        teams,
        players,
        pickMentions,
        "",
        "",
      ]);
    }

    if (espnFetchErrors.length > 0) {
      csv += csvRow([
        "",
        "",
        "",
        `Note: ESPN data unavailable for season(s): ${espnFetchErrors.join(" | ")}`,
        "",
        "",
        "",
        "",
        "",
      ]);
    }

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="trade-review-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    console.error("Trade review sheet error:", error);
    return new Response(error instanceof Error ? error.message : "Failed to build review sheet", {
      status: 500,
    });
  }
}
