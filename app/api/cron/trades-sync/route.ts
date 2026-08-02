import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import {
  fetchPage,
  fetchBackfillChunk,
  fetchNewMessages,
  type GroupMeMessage,
} from "@/lib/groupme";

/** How many GroupMe pages (100 msgs each) of older history to pull per cron run. */
const BACKFILL_PAGES_PER_RUN = 10;

/** Trade history only goes back this far. */
const BACKFILL_CUTOFF_UNIX = Math.floor(new Date("2024-01-01T00:00:00Z").getTime() / 1000);

interface SyncState {
  live_after_id: string | null;
  backfill_before_id: string | null;
  backfill_done: boolean;
}

/**
 * Archives raw messages from the trade-announcements GroupMe group into
 * trade_messages. No LLM parsing happens here — turning a batch of raw
 * messages into structured rows in the `trades` table is a manual/on-request
 * step, not something the deployed app pays for on a schedule.
 */
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
    });
  } catch (error) {
    console.error("Trades sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}
