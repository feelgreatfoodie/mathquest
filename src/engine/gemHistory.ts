import type { PurchaseLog, SessionLog } from './models';

export interface GemChange {
  kind: 'run' | 'purchase';
  /** Epoch ms: when the run ended or the hero was bought. */
  at: number;
  /** Positive for a run, negative for a purchase. */
  gems: number;
  heroId?: string;
}

/** Runs that earned gems (+) and purchases (-), merged, newest first, at most `max` of them. */
export function gemHistory(sessions: SessionLog[], purchases: PurchaseLog[], max = 20): GemChange[] {
  const runs: GemChange[] = sessions.filter((s) => s.gems > 0).map((s) => ({ kind: 'run', at: s.endedAt, gems: s.gems }));
  const buys: GemChange[] = purchases.map((p) => ({ kind: 'purchase', at: p.at, gems: -p.cost, heroId: p.heroId }));
  return [...runs, ...buys].sort((a, b) => b.at - a.at).slice(0, max);
}
