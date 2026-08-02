import { getSupabase } from "@/lib/supabase";
import { fetchTradeActivity, type ESPNTradeActivity } from "@/lib/espn";

/** How far apart a GroupMe announcement and an ESPN trade action can be and still be considered a match. */
const MATCH_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

/** ESPN league history is only queried for these seasons. */
const SEASONS = [2024, 2025, 2026];

/**
 * Best-effort scan for draft-pick mentions — a hint for the reviewer, not
 * authoritative. This league almost always drops the word "round" entirely
 * (e.g. "Charley receives\n15th", "Andrew gets 2027 4", "Bergoine gets: |
 * 4th | 10th") rather than writing "3rd round pick"/"R3", so three patterns
 * are combined:
 *  - a year anchor with an explicit round word nearby ("2027 3rd round",
 *    "2028 5th rd", "R3") — the least common phrasing but still shows up
 *  - a bare ordinal/number alone on its own line (this league's asset-list
 *    format is one item per line under "[Manager] receives/gets")
 *  - a bare ordinal/number immediately after "receives"/"gets"/"get",
 *    optionally with a leading year ("Andrew receives 5", "gets 2027 4")
 */
const YEAR_RE = /20[2-3]\d/g;
const ROUND_WORD_RE =
  /\b(?:R|Rd\.?|Round)\s*(\d{1,2})\b|\b(\d{1,2})(?:st|nd|rd|th)?\s*(?:rounder|round|rd\.?)\b/gi;
const STANDALONE_LINE_RE = /^\s*(?:a\s+|my\s+)?(\d{1,2})(?:st|nd|rd|th)?\s*(?:pick)?\s*(?:\([^)]*\))?\s*$/i;
const INLINE_AFTER_VERB_RE =
  /\b(?:receives?|gets?)\s+(?:my\s+|a\s+)?(?:(20[2-3]\d)\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/gi;

function findPickMentions(text: string): string[] {
  const mentions = new Set<string>();

  for (const y of text.matchAll(YEAR_RE)) {
    const yearStr = y[0];
    const yearIdx = y.index ?? 0;
    const window = text.slice(Math.max(0, yearIdx - 30), Math.min(text.length, yearIdx + yearStr.length + 30));
    ROUND_WORD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = ROUND_WORD_RE.exec(window)) !== null) {
      const round = m[1] ?? m[2];
      if (round) mentions.add(`${yearStr} pick ${round}`);
    }
  }

  for (const line of text.split("\n")) {
    const m = STANDALONE_LINE_RE.exec(line.trim());
    if (m) mentions.add(`pick ${m[1]}`);
  }

  INLINE_AFTER_VERB_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_AFTER_VERB_RE.exec(text)) !== null) {
    mentions.add(m[1] ? `${m[1]} pick ${m[2]}` : `pick ${m[2]}`);
  }

  return [...mentions];
}

/**
 * This GroupMe channel is also used to run the annual slow draft: each pick
 * gets posted as a terse "PlayerName @NextManager" (or "@me") relay message
 * with no trade-ish language at all — hundreds of these per draft, no
 * "trade"/"receives"/etc. Filter them out so the review sheet isn't 30%+
 * draft noise. Real trade messages in this league consistently use trade
 * language (see TRADE_KEYWORDS below), so requiring its absence here is safe
 * — verified against known real trade announcements before shipping.
 */
const TRADE_KEYWORDS = /\b(trade|trading|traded|receives?|swap|deal|surplus)\b/i;
const TRAILING_MENTION_RE = /@\s?(\S+(\s\S+)?)\s*$|@me\s*$/i;
const DRAFT_RELAY_MAX_LENGTH = 60;

function isLikelyDraftRelay(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length > DRAFT_RELAY_MAX_LENGTH) return false;
  if (TRADE_KEYWORDS.test(trimmed)) return false;
  return TRAILING_MENTION_RE.test(trimmed);
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

const SUPABASE_PAGE_SIZE = 1000;

/** Supabase/PostgREST caps a single select at 1000 rows by default — page through everything. */
async function fetchAllTradeMessages(
  supabase: ReturnType<typeof getSupabase>
): Promise<TradeMessageRow[]> {
  const all: TradeMessageRow[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("trade_messages")
      .select("id, sender_name, text, created_at")
      .order("created_at", { ascending: true })
      .range(from, from + SUPABASE_PAGE_SIZE - 1);
    if (error) throw new Error(`Supabase trade_messages error: ${error.message}`);
    const page = (data ?? []) as TradeMessageRow[];
    all.push(...page);
    if (page.length < SUPABASE_PAGE_SIZE) break;
    from += SUPABASE_PAGE_SIZE;
  }
  return all;
}

export async function GET(request: Request) {
  const secret = new URL(request.url).searchParams.get("secret");
  if (secret !== process.env.CRON_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  try {
    const supabase = getSupabase();

    const [messages, { data: existingTrades, error: tradeError }] = await Promise.all([
      fetchAllTradeMessages(supabase),
      supabase.from("trades").select("source_message_id"),
    ]);
    if (tradeError) throw new Error(`Supabase trades error: ${tradeError.message}`);

    const alreadyStructured = new Set((existingTrades ?? []).map((t) => t.source_message_id as string));
    const pending = messages.filter(
      (m) =>
        !alreadyStructured.has(m.id) &&
        m.text &&
        m.text.trim().length > 0 &&
        !isLikelyDraftRelay(m.text)
    );

    const espnResults = await Promise.allSettled(SEASONS.map((s) => fetchTradeActivity(s)));
    const espnActivity: ESPNTradeActivity[] = espnResults.flatMap((r) =>
      r.status === "fulfilled" ? r.value : []
    );
    const espnFetchErrors = espnResults
      .map((r, i) => (r.status === "rejected" ? `${SEASONS[i]}: ${r.reason}` : null))
      .filter((x): x is string => x !== null);

    let csv = csvRow([
      "source_message_id",
      "posted_at",
      "sender",
      "raw_text",
      "espn_trade_activity_nearby",
      "text_pick_mentions",
      "approved (Y/N)",
      "corrections / notes",
    ]);

    for (const m of pending) {
      const postedAt = new Date(m.created_at).getTime();
      const nearby = espnActivity.filter((t) => Math.abs(t.processDate - postedAt) <= MATCH_WINDOW_MS);
      const activity = nearby.map((t) => `${t.manager} (${t.type})`).join("; ");
      const pickMentions = findPickMentions(m.text ?? "").join("; ");

      csv += csvRow([m.id, m.created_at, m.sender_name ?? "", m.text ?? "", activity, pickMentions, "", ""]);
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
