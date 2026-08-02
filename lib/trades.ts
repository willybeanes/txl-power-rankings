export interface TradeTransfer {
  type: "player" | "pick";
  playerName?: string;
  pickYear?: number;
  pickRound?: number;
  from: string; // manager full name
  to: string; // manager full name
}

export interface Trade {
  sourceMessageId: string;
  date: string; // ISO date (YYYY-MM-DD) the trade was announced
  summary: string;
  raw: string;
  transfers: TradeTransfer[];
}

export interface PickMovement {
  year: number;
  round: number;
  // For an "acquired" entry: who the pick originally belonged to.
  // For a "given" entry: who currently holds the pick now.
  otherManager: string;
}

export interface ManagerPickSummary {
  manager: string;
  acquired: PickMovement[];
  given: PickMovement[];
}

/**
 * Replays every pick transfer in chronological order to determine, per manager,
 * which future draft-pick slots they've gained beyond their own and which of
 * their own slots they've given away. A pick slot's identity is (year, round);
 * its "original owner" is whoever first appears as the `from` manager for that
 * slot in the trade history.
 */
export function computePickLedger(trades: Trade[]): ManagerPickSummary[] {
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));

  const currentOwner = new Map<string, string>(); // "year-round" -> manager
  const originalOwner = new Map<string, string>(); // "year-round" -> manager

  for (const trade of sorted) {
    for (const t of trade.transfers) {
      if (t.type !== "pick" || t.pickYear == null || t.pickRound == null) continue;
      const key = `${t.pickYear}-${t.pickRound}`;
      if (!originalOwner.has(key)) originalOwner.set(key, t.from);
      currentOwner.set(key, t.to);
    }
  }

  const summaries = new Map<string, ManagerPickSummary>();
  const getSummary = (manager: string): ManagerPickSummary => {
    let s = summaries.get(manager);
    if (!s) {
      s = { manager, acquired: [], given: [] };
      summaries.set(manager, s);
    }
    return s;
  };

  for (const [key, holder] of currentOwner) {
    const origin = originalOwner.get(key)!;
    if (holder === origin) continue; // moved and came back — net no change

    const [yearStr, roundStr] = key.split("-");
    const year = Number(yearStr);
    const round = Number(roundStr);

    getSummary(holder).acquired.push({ year, round, otherManager: origin });
    getSummary(origin).given.push({ year, round, otherManager: holder });
  }

  return [...summaries.values()].sort((a, b) => a.manager.localeCompare(b.manager));
}
