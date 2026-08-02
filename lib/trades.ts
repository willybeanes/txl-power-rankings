export interface TradeTransfer {
  type: "player" | "pick";
  playerName?: string;
  pickYear?: number;
  pickRound?: number;
  from: string; // manager full name
  to: string; // manager full name
  // Optional hint from the announcement text (e.g. "13 (via Austin)") disambiguating
  // WHICH of a manager's same-year-round picks this is, when they hold more than one.
  viaHint?: string;
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
  // Managers who held the pick in between otherManager and the current
  // summary's manager, in order, when it changed hands more than once.
  viaPath: string[];
}

export interface ManagerPickSummary {
  manager: string;
  acquired: PickMovement[];
  given: PickMovement[];
}

/**
 * Picks for years at or before this are for a draft that's already happened —
 * excluded from the ledger since they're no longer live trade capital. Bump
 * this once a year, after that year's draft completes.
 */
export const MIN_RELEVANT_PICK_YEAR = 2027;

interface PickChain {
  path: string[]; // path[0] = original owner, path[path.length - 1] = current holder
}

/**
 * Replays every pick transfer in chronological order to determine, per manager,
 * which future draft-pick slots they've gained beyond their own and which of
 * their own slots they've given away.
 *
 * A pick's identity is NOT just (year, round) — every manager has their own
 * "2027 5th round pick", so (year, round) alone can collide across many
 * unrelated trades (e.g. Kevin's own 2027 R5 going to Porter, and separately
 * Austin's own 2027 R5 going to Andrew, are two completely independent
 * picks). Each (year, round) bucket tracks a *list* of active chains (an
 * ordered path of every manager who has held that specific pick); a transfer
 * continues whichever chain is currently held by its `from` manager, or
 * starts a new chain if `from` doesn't hold any chain in that bucket yet
 * (meaning they're moving their own still-untouched pick). If a manager
 * holds more than one chain for the same (year, round) at once — e.g. their
 * own plus one acquired earlier — `viaHint` (from an announcement like "13
 * (via Austin)") picks the right one; otherwise the oldest matching chain is
 * used as a fallback.
 */
export function computePickLedger(trades: Trade[]): ManagerPickSummary[] {
  const sorted = [...trades].sort((a, b) => a.date.localeCompare(b.date));

  const chainsByKey = new Map<string, PickChain[]>(); // "year-round" -> chains

  for (const trade of sorted) {
    for (const t of trade.transfers) {
      if (t.type !== "pick" || t.pickYear == null || t.pickRound == null) continue;
      if (t.pickYear <= MIN_RELEVANT_PICK_YEAR - 1) continue;
      const key = `${t.pickYear}-${t.pickRound}`;
      const chains = chainsByKey.get(key) ?? [];
      if (chains.length === 0) chainsByKey.set(key, chains);

      const candidates = chains.filter((c) => c.path[c.path.length - 1] === t.from);

      let chain: PickChain;
      if (candidates.length === 0) {
        chain = { path: [t.from] };
        chains.push(chain);
      } else if (candidates.length === 1) {
        chain = candidates[0];
      } else {
        chain =
          (t.viaHint ? candidates.find((c) => c.path[0] === t.viaHint) : undefined) ??
          candidates[0];
      }
      chain.path.push(t.to);
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

  for (const [key, chains] of chainsByKey) {
    const [yearStr, roundStr] = key.split("-");
    const year = Number(yearStr);
    const round = Number(roundStr);

    for (const { path } of chains) {
      const originalOwner = path[0];
      const currentHolder = path[path.length - 1];
      if (currentHolder === originalOwner) continue; // moved and came back — net no change

      const viaPath = path.slice(1, -1);
      getSummary(currentHolder).acquired.push({ year, round, otherManager: originalOwner, viaPath });
      getSummary(originalOwner).given.push({ year, round, otherManager: currentHolder, viaPath });
    }
  }

  return [...summaries.values()].sort((a, b) => a.manager.localeCompare(b.manager));
}
