const GROUPME_API = "https://api.groupme.com/v3";
const PAGE_LIMIT = 100;

export interface GroupMeMessage {
  id: string;
  name: string;
  text: string | null;
  created_at: number; // unix seconds
  system: boolean;
}

export async function fetchPage(
  groupId: string,
  token: string,
  cursor: { before_id?: string; after_id?: string }
): Promise<GroupMeMessage[]> {
  const params = new URLSearchParams({
    token,
    limit: String(PAGE_LIMIT),
    ...cursor,
  });
  const res = await fetch(`${GROUPME_API}/groups/${groupId}/messages?${params}`);
  if (res.status === 304) return [];
  if (!res.ok) throw new Error(`GroupMe API error: ${res.status}`);
  const data = await res.json();
  return data.response?.messages ?? [];
}

/**
 * Fetch up to maxPages pages going backward in time from beforeId (or the most
 * recent messages if beforeId is unset). Returns the messages plus a cursor for
 * the next call and whether we've run out of older history to fetch.
 */
export async function fetchBackfillChunk(
  groupId: string,
  token: string,
  beforeId: string | undefined,
  maxPages: number
): Promise<{ messages: GroupMeMessage[]; nextBeforeId: string | undefined; exhausted: boolean }> {
  const all: GroupMeMessage[] = [];
  let cursor = beforeId;
  let exhausted = false;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(groupId, token, cursor ? { before_id: cursor } : {});
    if (page.length === 0) {
      exhausted = true;
      break;
    }
    all.push(...page);
    cursor = page[page.length - 1].id;
    if (page.length < PAGE_LIMIT) {
      exhausted = true;
      break;
    }
  }
  return { messages: all, nextBeforeId: cursor, exhausted };
}

/**
 * Fetch all messages newer than lastMessageId, paging forward. Meant for a
 * small daily catch-up, not a large backfill.
 */
export async function fetchNewMessages(
  groupId: string,
  token: string,
  lastMessageId: string
): Promise<GroupMeMessage[]> {
  const all: GroupMeMessage[] = [];
  let afterId = lastMessageId;
  while (true) {
    const page = await fetchPage(groupId, token, { after_id: afterId });
    if (page.length === 0) break;
    const sorted = [...page].sort((a, b) => a.created_at - b.created_at);
    all.push(...sorted);
    afterId = sorted[sorted.length - 1].id;
    if (page.length < PAGE_LIMIT) break;
  }
  return all;
}
