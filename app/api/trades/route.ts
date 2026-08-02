import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import type { Trade } from "@/lib/trades";

export async function GET() {
  try {
    const { data, error } = await getSupabase()
      .from("trades")
      .select("source_message_id, traded_at, summary, raw, transfers")
      .order("traded_at", { ascending: false });

    if (error) throw new Error(error.message);

    const trades: Trade[] = (data ?? []).map((row) => ({
      sourceMessageId: row.source_message_id,
      date: row.traded_at,
      summary: row.summary,
      raw: row.raw,
      transfers: row.transfers,
    }));

    return NextResponse.json({ trades });
  } catch (error) {
    console.error("Trades fetch error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load trades" },
      { status: 500 }
    );
  }
}
