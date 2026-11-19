import type { PurchaseLog, SessionLog } from './models';

export interface GemChange {
  kind: 'run' | 'purchase';
  /** Epoch ms: when the run ended or the hero was bought. */
  at: number;
  /** Positive for a run, negative for a purchase. */
  gems: number;
  heroId?: string;
}

/** One line for a row of the gem history: what happened and what it did to the gem count. A free purchase says free. */
export function gemChangeLabel(c: GemChange, name?: string): string {
  if (c.kind === 'run') return 'Quest finished';
  const what = `Bought ${name ?? c.heroId ?? 'an item'}`;
  return c.gems === 0 ? `${what} (free)` : `${what} (-${Math.abs(c.gems)} gems)`;
}

/** The number cell of a history row: +5, −25 (a real minus sign), or free (never −0). */
export function gemDeltaText(c: GemChange): string {
  if (c.gems === 0) return 'free';
  return `${c.gems > 0 ? '+' : '−'}${Math.abs(c.gems)}`;
}

/** Runs that earned gems (+) and purchases (-), merged, newest first, at most `max` of them. */
export function gemHistory(sessions: SessionLog[], purchases: PurchaseLog[], max = 20): GemChange[] {
  const runs: GemChange[] = sessions.filter((s) => s.gems > 0).map((s) => ({ kind: 'run', at: s.endedAt, gems: s.gems }));
  const buys: GemChange[] = purchases.map((p) => ({ kind: 'purchase', at: p.at, gems: -p.cost, heroId: p.heroId ?? p.itemId }));
  return [...runs, ...buys].sort((a, b) => b.at - a.at).slice(0, max);
}
