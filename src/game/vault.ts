// The gem vault: save gems for 3, 7 or 14 days and get a bonus back. Pure rules and shapes, no storage.
// Every time check on the server uses request.time and the server's createdAt (firestore.rules, vaultPayOk). The
// code here only decides what the screen shows. A device clock set forward changes a label, never a payout.

export const VAULT_TERMS = [3, 7, 14] as const;
export type VaultTerm = (typeof VAULT_TERMS)[number];

/** Bonus gems per full 10 saved, by term. A parent can change them (KidSettings.vault). */
export const DEFAULT_RATES: Readonly<Record<VaultTerm, number>> = { 3: 1, 7: 3, 14: 7 };
export const VAULT_MIN = 10;
export const VAULT_MAX_ACTIVE = 3;
/** Most gems one write moves out of the vault. Equals the kid-write raise bound in firestore.rules. */
export const PAY_CHUNK = 10;
export const RATE_MAX = 20;

/** The stored parent setting. A missing value reads as off with the default rates. */
export interface VaultSettings {
  on?: boolean;
  d3?: number;
  d7?: number;
  d14?: number;
}

export type VaultStatus = 'active' | 'collected' | 'broken';

/** One deposit. `createdAt` is the server's time (epoch ms). A term runs from it in calendar days. */
export interface VaultDeposit {
  id: string;
  amount: number;
  termDays: VaultTerm;
  ratePer10: number;
  bonus: number;
  status: VaultStatus;
  /** Gems already paid back out of this deposit. */
  paid: number;
  createdAt: number;
  collectedAt?: number;
}

/** The kid doc's `vault` map: pointers the rules read. Not a balance. */
export interface VaultPointer {
  active: number;
  lastId?: string;
  closedId?: string;
}

export const vaultOn = (settings: { vault?: VaultSettings } | undefined | null): boolean => settings?.vault?.on === true;

export function rateOf(settings: { vault?: VaultSettings } | undefined | null, term: VaultTerm): number {
  const v = settings?.vault?.[`d${term}` as 'd3' | 'd7' | 'd14'];
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= RATE_MAX ? v : DEFAULT_RATES[term];
}

/** Bonus rounds down per full 10 saved. */
export function bonusFor(amount: number, ratePer10: number): number {
  return Math.floor(amount / 10) * ratePer10;
}

/** What a deposit pays when collected, and what it pays when broken. */
export const payoutOf = (d: Pick<VaultDeposit, 'amount' | 'bonus' | 'status'>): number => (d.status === 'broken' ? d.amount : d.amount + d.bonus);

/** Gems still owed to the kid by this deposit: all of it while active (as a collect), the unpaid rest once closed. */
export const owedOf = (d: Pick<VaultDeposit, 'amount' | 'bonus' | 'status' | 'paid'>): number => payoutOf(d) - d.paid;

/** The server time the term ends. Display only: the rules compute it from createdAt and request.time. */
export const maturesAtOf = (d: Pick<VaultDeposit, 'createdAt' | 'termDays'>): number => d.createdAt + d.termDays * 86_400_000;

/** For the glow on the chest: true when `now` is past the end of the term. `now` is the device clock, so a label at most. */
export const looksReady = (d: Pick<VaultDeposit, 'createdAt' | 'termDays' | 'status'>, now: number): boolean => d.status === 'active' && now >= maturesAtOf(d);

/** Gems in the vault: active deposits at their amount, plus what a closed deposit has not yet paid out. */
export function vaultBalance(deposits: readonly VaultDeposit[]): number {
  let total = 0;
  for (const d of deposits) total += d.status === 'active' ? d.amount : Math.max(0, owedOf(d));
  return total;
}

/** Whole days left (rounded up) until the term ends, never below 0. */
export const daysLeft = (d: Pick<VaultDeposit, 'createdAt' | 'termDays'>, now: number): number => Math.max(0, Math.ceil((maturesAtOf(d) - now) / 86_400_000));

/** The chunks one payout takes: PAY_CHUNK gems at a time, the last one smaller. */
export function payChunks(owed: number): number[] {
  const out: number[] = [];
  for (let left = owed; left > 0; left -= PAY_CHUNK) out.push(Math.min(PAY_CHUNK, left));
  return out;
}

/** Why a deposit cannot be made, or null. */
export function depositProblem(amount: number, gems: number, activeCount: number): string | null {
  if (!Number.isInteger(amount) || amount < VAULT_MIN) return `Put in at least ${VAULT_MIN} gems.`;
  if (amount > gems) return 'Not enough gems.';
  if (activeCount >= VAULT_MAX_ACTIVE) return `The vault holds ${VAULT_MAX_ACTIVE} deposits at a time.`;
  return null;
}

/** The pre-reader vault: one deposit of 10 gems for 3 days, shown as dots. */
export const PREREADER_AMOUNT = 10;
export const PREREADER_TERM: VaultTerm = 3;
