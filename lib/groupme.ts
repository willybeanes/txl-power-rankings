const GROUPME_API = "https://api.groupme.com/v3";
const PAGE_LIMIT = 100;

export interface GroupMeMessage {
  id: string;
  name: string;
  text: string | null;
  created_at: number; // unix seconds
  system: boolean;
}

async function fetchPage(
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
 * Full history backfill, paging backwards from the most recent message.
 * Only used when there's no prior sync state.
 */
export async function fetchAllHistory(
  groupId: string,
  token: string
): Promise<GroupMeMessage[]> {
  const all: GroupMeMessage[] = [];
  let beforeId: string | undefined;
  while (true) {
    const page = await fetchPage(groupId, token, beforeId ? { before_id: beforeId } : {});
    if (page.length === 0) break;
    all.push(...page);
    beforeId = page[page.length - 1].id;
    if (page.length < PAGE_LIMIT) break;
  }
  return all;
}

/**
 * Fetch only messages newer than lastMessageId, paging forward.
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
