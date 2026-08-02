import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "@/lib/supabase";
import { DRAFT_MANAGERS } from "@/lib/draft";
import {
  fetchPage,
  fetchBackfillChunk,
  fetchNewMessages,
  type GroupMeMessage,
} from "@/lib/groupme";
import type { Trade, TradeTransfer } from "@/lib/trades";

const client = new Anthropic();

const EXTRACTION_BATCH_SIZE = 50;

/** How many GroupMe pages (100 msgs each) of older history to pull per cron run. */
const BACKFILL_PAGES_PER_RUN = 10;

/** Trade history only goes back this far. */
const BACKFILL_CUTOFF_UNIX = Math.floor(new Date("2024-01-01T00:00:00Z").getTime() / 1000);

const ROSTER = DRAFT_MANAGERS.map((m) => m.fullName).join(", ");

const EXTRACTION_SYSTEM_PROMPT = `You extract completed fantasy baseball trades from a batch of GroupMe messages posted in this league's trade-announcement channel. The 12 managers in this league are: ${ROSTER}.

For each message that announces an ALREADY-COMPLETED trade (not a proposal, offer, rumor, or reaction), call record_trades with one trade entry per completed trade announced. For every asset that changed hands, record:
- type "player" with playerName, or type "pick" with pickYear and pickRound (the draft round number, e.g. 3 for a 3rd-round pick)
- from: the manager who gave up the asset
- to: the manager who received it

Use each manager's exact full name from the roster above (normalize nicknames/GroupMe display names to the closest roster match). Ignore messages that aren't trade announcements — jokes, chatter, reactions, unaccepted offers, or draft reminders. If a batch has no trade announcements, call record_trades with an empty trades array.`;

const EXTRACTION_TOOL: Anthropic.Tool = {
  name: "record_trades",
  description: "Record zero or more completed trades found in this batch of messages.",
  input_schema: {
    type: "object" as const,
    properties: {
      trades: {
        type: "array",
        items: {
          type: "object",
          properties: {
            source_message_id: {
              type: "string",
              description: "The id of the message that announced this trade",
            },
            date: { type: "string", description: "ISO date (YYYY-MM-DD) the trade was announced" },
            summary: {
              type: "string",
              description: "One sentence human-readable summary of the trade",
            },
            transfers: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["player", "pick"] },
                  player_name: { type: "string" },
                  pick_year: { type: "integer" },
                  pick_round: { type: "integer" },
                  from_manager: { type: "string" },
                  to_manager: { type: "string" },
                },
                required: ["type", "from_manager", "to_manager"],
              },
            },
          },
          required: ["source_message_id", "date", "summary", "transfers"],
        },
      },
    },
    required: ["trades"],
  },
};

interface ExtractedTradeInput {
  source_message_id: string;
  date: string;
  summary: string;
  transfers: {
    type: "player" | "pick";
    player_name?: string;
    pick_year?: number;
    pick_round?: number;
    from_manager: string;
    to_manager: string;
  }[];
}

function formatMessages(messages: GroupMeMessage[]): string {
  return messages
    .filter((m) => !m.system && m.text && m.text.trim().length > 0)
    .map((m) => `[id=${m.id}] ${m.name}: ${m.text}`)
    .join("\n");
}

async function extractTrades(
  batch: GroupMeMessage[],
  rawById: Map<string, string>
): Promise<Trade[]> {
  const formatted = formatMessages(batch);
  if (!formatted) return [];

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    system: EXTRACTION_SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: "tool", name: "record_trades" },
    messages: [{ role: "user", content: formatted }],
  });

  const toolUse = response.content.find(
    (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
  );
  const input = toolUse?.input as { trades?: ExtractedTradeInput[] } | undefined;
  const extracted = input?.trades ?? [];

  return extracted
    .filter((t) => rawById.has(t.source_message_id))
    .map((t) => ({
      sourceMessageId: t.source_message_id,
      date: t.date,
      summary: t.summary,
      raw: rawById.get(t.source_message_id)!,
      transfers: t.transfers.map(
        (tr): TradeTransfer => ({
          type: tr.type,
          playerName: tr.player_name,
          pickYear: tr.pick_year,
          pickRound: tr.pick_round,
          from: tr.from_manager,
          to: tr.to_manager,
        })
      ),
    }));
}

interface SyncState {
  live_after_id: string | null;
  backfill_before_id: string | null;
  backfill_done: boolean;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const groupId = process.env.GROUPME_TRADES_GROUP_ID;
  const token = process.env.GROUPME_ACCESS_TOKEN;
  if (!groupId || !token) {
    return NextResponse.json(
      { error: "Missing GROUPME_TRADES_GROUP_ID or GROUPME_ACCESS_TOKEN" },
      { status: 500 }
    );
  }

  try {
    const supabase = getSupabase();

    const { data: stateRow } = await supabase
      .from("trade_sync_state")
      .select("live_after_id, backfill_before_id, backfill_done")
      .eq("id", 1)
      .maybeSingle();

    const state: SyncState = stateRow ?? {
      live_after_id: null,
      backfill_before_id: null,
      backfill_done: false,
    };

    let liveMessages: GroupMeMessage[] = [];
    let newLiveAfterId = state.live_after_id;
    let newBackfillCursor = state.backfill_before_id;

    if (!state.live_after_id) {
      const seedPage = await fetchPage(groupId, token, {});
      if (seedPage.length > 0) {
        const sorted = [...seedPage].sort((a, b) => a.created_at - b.created_at);
        liveMessages = sorted;
        newLiveAfterId = sorted[sorted.length - 1].id;
        if (!state.backfill_before_id && !state.backfill_done) {
          newBackfillCursor = sorted[0].id;
        }
      }
    } else {
      liveMessages = await fetchNewMessages(groupId, token, state.live_after_id);
      if (liveMessages.length > 0) {
        newLiveAfterId = liveMessages[liveMessages.length - 1].id;
      }
    }

    let backfillMessages: GroupMeMessage[] = [];
    let backfillDone = state.backfill_done;

    if (!backfillDone) {
      const { messages, nextBeforeId, exhausted } = await fetchBackfillChunk(
        groupId,
        token,
        newBackfillCursor ?? undefined,
        BACKFILL_PAGES_PER_RUN
      );
      const inRange = messages.filter((m) => m.created_at >= BACKFILL_CUTOFF_UNIX);
      backfillMessages = [...inRange].sort((a, b) => a.created_at - b.created_at);
      newBackfillCursor = nextBeforeId ?? newBackfillCursor;
      if (exhausted || inRange.length < messages.length) {
        backfillDone = true;
      }
    }

    const allNew = [...backfillMessages, ...liveMessages];
    let tradesFound = 0;

    if (allNew.length > 0) {
      const rows = allNew.map((m) => ({
        id: m.id,
        sender_name: m.name,
        text: m.text,
        created_at: new Date(m.created_at * 1000).toISOString(),
      }));
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        const { error } = await supabase
          .from("trade_messages")
          .upsert(chunk, { onConflict: "id" });
        if (error) throw new Error(`Supabase insert error: ${error.message}`);
      }

      const rawById = new Map(allNew.map((m) => [m.id, `${m.name}: ${m.text}`]));
      const allTrades: Trade[] = [];
      for (let i = 0; i < allNew.length; i += EXTRACTION_BATCH_SIZE) {
        const batch = allNew.slice(i, i + EXTRACTION_BATCH_SIZE);
        const trades = await extractTrades(batch, rawById);
        allTrades.push(...trades);
      }

      if (allTrades.length > 0) {
        const tradeRows = allTrades.map((t) => ({
          source_message_id: t.sourceMessageId,
          traded_at: t.date,
          summary: t.summary,
          raw: t.raw,
          transfers: t.transfers,
        }));
        const { error } = await supabase
          .from("trades")
          .upsert(tradeRows, { onConflict: "source_message_id" });
        if (error) throw new Error(`Supabase trades upsert error: ${error.message}`);
        tradesFound = allTrades.length;
      }
    }

    const { error: stateError } = await supabase.from("trade_sync_state").upsert(
      {
        id: 1,
        live_after_id: newLiveAfterId,
        backfill_before_id: backfillDone ? null : newBackfillCursor,
        backfill_done: backfillDone,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );
    if (stateError) throw new Error(`Supabase state upsert error: ${stateError.message}`);

    return NextResponse.json({
      ok: true,
      liveCaughtUp: liveMessages.length,
      backfillProcessed: backfillMessages.length,
      backfillDone,
      tradesFound,
    });
  } catch (error) {
    console.error("Trades sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}
