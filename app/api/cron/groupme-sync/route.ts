import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { getSupabase } from "@/lib/supabase";
import { fetchAllHistory, fetchNewMessages, type GroupMeMessage } from "@/lib/groupme";

const client = new Anthropic();

const LORE_EXTRACTION_BATCH_SIZE = 300;

const EXTRACTION_SYSTEM_PROMPT = `You maintain a running "league lore" doc for a fantasy baseball league's GroupMe chat. You'll be given the current lore doc (may be empty) and a batch of new chat messages. Update the doc:

- Keep everything from the current doc that's still accurate and relevant.
- Add newly-evidenced recurring jokes, nicknames, running bits, feuds, memorable events, or strong opinions — but only things that are clearly recurring or load-bearing in the chat, not one-off remarks.
- Don't invent anything not evidenced in the messages. If nothing new and noteworthy shows up, return the doc unchanged.
- Keep it concise and organized under short headers (like "Nicknames", "Running Jokes", "Notable Events"), similar in spirit to a wiki page other people would want to read.
- Return ONLY the updated doc text — no preamble, no commentary about what you changed.`;

function formatMessages(messages: GroupMeMessage[]): string {
  return messages
    .filter((m) => !m.system && m.text && m.text.trim().length > 0)
    .map((m) => `${m.name}: ${m.text}`)
    .join("\n");
}

async function extractLore(currentLore: string, batch: GroupMeMessage[]): Promise<string> {
  const formatted = formatMessages(batch);
  if (!formatted) return currentLore;

  const response = await client.messages.create({
    model: "claude-sonnet-5",
    max_tokens: 4096,
    system: EXTRACTION_SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Current lore doc:\n${currentLore || "(empty — nothing recorded yet)"}\n\nNew messages:\n${formatted}`,
      },
    ],
  });

  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text"
  );
  return textBlock?.text ?? currentLore;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const groupId = process.env.GROUPME_GROUP_ID;
  const token = process.env.GROUPME_ACCESS_TOKEN;
  if (!groupId || !token) {
    return NextResponse.json(
      { error: "Missing GROUPME_GROUP_ID or GROUPME_ACCESS_TOKEN" },
      { status: 500 }
    );
  }

  try {
    const supabase = getSupabase();

    const { data: syncState } = await supabase
      .from("groupme_sync_state")
      .select("last_message_id")
      .eq("id", 1)
      .maybeSingle();

    const lastMessageId = syncState?.last_message_id as string | null;

    const fetched = lastMessageId
      ? await fetchNewMessages(groupId, token, lastMessageId)
      : await fetchAllHistory(groupId, token);

    const messages = [...fetched].sort((a, b) => a.created_at - b.created_at);

    if (messages.length === 0) {
      return NextResponse.json({ ok: true, newMessages: 0 });
    }

    // Persist raw messages in chunks (upsert to tolerate re-runs / overlap)
    const rows = messages.map((m) => ({
      id: m.id,
      sender_name: m.name,
      text: m.text,
      created_at: new Date(m.created_at * 1000).toISOString(),
    }));
    for (let i = 0; i < rows.length; i += 500) {
      const chunk = rows.slice(i, i + 500);
      const { error } = await supabase
        .from("groupme_messages")
        .upsert(chunk, { onConflict: "id" });
      if (error) throw new Error(`Supabase insert error: ${error.message}`);
    }

    // Fold new messages into the lore doc in manageable batches
    const { data: loreRow } = await supabase
      .from("league_lore")
      .select("content")
      .eq("id", 1)
      .maybeSingle();

    let lore = (loreRow?.content as string) ?? "";
    for (let i = 0; i < messages.length; i += LORE_EXTRACTION_BATCH_SIZE) {
      const batch = messages.slice(i, i + LORE_EXTRACTION_BATCH_SIZE);
      lore = await extractLore(lore, batch);
    }

    const { error: loreError } = await supabase
      .from("league_lore")
      .upsert({ id: 1, content: lore, updated_at: new Date().toISOString() }, { onConflict: "id" });
    if (loreError) throw new Error(`Supabase lore upsert error: ${loreError.message}`);

    const newLastId = messages[messages.length - 1].id;
    const { error: stateError } = await supabase
      .from("groupme_sync_state")
      .upsert(
        { id: 1, last_message_id: newLastId, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      );
    if (stateError) throw new Error(`Supabase state upsert error: ${stateError.message}`);

    return NextResponse.json({ ok: true, newMessages: messages.length });
  } catch (error) {
    console.error("GroupMe sync error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Sync failed" },
      { status: 500 }
    );
  }
}
