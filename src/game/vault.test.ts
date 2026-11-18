import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_RATES, PAY_CHUNK, VAULT_MAX_ACTIVE, VAULT_MIN, VAULT_TERMS, bonusFor, daysLeft, depositProblem, looksReady, maturesAtOf, owedOf, payChunks, payoutOf, rateOf, vaultBalance, vaultOn, type VaultDeposit } from './vault';

const dep = (over: Partial<VaultDeposit> = {}): VaultDeposit => ({ id: 'd', amount: 50, termDays: 7, ratePer10: 3, bonus: 15, status: 'active', paid: 0, createdAt: 0, ...over });
const DAY = 86_400_000;

describe('bonus math', () => {
  it('matches the examples: 30 in 3 days gives 33, 50 in 7 days gives 65, 100 in 14 days gives 170', () => {
    expect(30 + bonusFor(30, DEFAULT_RATES[3])).toBe(33);
    expect(50 + bonusFor(50, DEFAULT_RATES[7])).toBe(65);
    expect(100 + bonusFor(100, DEFAULT_RATES[14])).toBe(170);
  });
  it('rounds down per full 10: 19 saves 1 x rate, 9 saves nothing', () => {
    expect(bonusFor(19, 7)).toBe(7);
    expect(bonusFor(9, 7)).toBe(0);
    expect(bonusFor(10, 1)).toBe(1);
  });
  it('terms are 3, 7 and 14; at most 3 active; the minimum deposit is 10', () => {
    expect([...VAULT_TERMS]).toEqual([3, 7, 14]);
    expect(VAULT_MAX_ACTIVE).toBe(3);
    expect(VAULT_MIN).toBe(10);
  });
});

describe('payouts', () => {
  it('collected pays amount + bonus, broken pays the amount only', () => {
    expect(payoutOf(dep({ status: 'active' }))).toBe(65);
    expect(payoutOf(dep({ status: 'collected' }))).toBe(65);
    expect(payoutOf(dep({ status: 'broken' }))).toBe(50);
  });
  it('splits into chunks of at most 10 that add up to the payout', () => {
    expect(payChunks(65)).toEqual([10, 10, 10, 10, 10, 10, 5]);
    expect(payChunks(10)).toEqual([10]);
    expect(payChunks(0)).toEqual([]);
    expect(payChunks(170).reduce((a, b) => a + b, 0)).toBe(170);
    expect(PAY_CHUNK).toBe(10);
  });
  it('owed is the payout less what was paid', () => {
    expect(owedOf(dep({ status: 'collected', paid: 30 }))).toBe(35);
  });
});

describe('balance and time labels', () => {
  it('the vault balance is active amounts plus what closed deposits still owe', () => {
    expect(vaultBalance([dep(), dep({ id: 'e', amount: 30, bonus: 3, status: 'collected', paid: 20 }), dep({ id: 'f', status: 'broken', paid: 50 })])).toBe(50 + 13);
  });
  it('matures at createdAt plus the term in calendar days; looks ready only past it and only when active', () => {
    const d = dep({ createdAt: 1000 });
    expect(maturesAtOf(d)).toBe(1000 + 7 * DAY);
    expect(looksReady(d, 1000 + 7 * DAY - 1)).toBe(false);
    expect(looksReady(d, 1000 + 7 * DAY)).toBe(true);
    expect(looksReady({ ...d, status: 'collected' }, 1000 + 9 * DAY)).toBe(false);
    expect(daysLeft(d, 1000 + 5 * DAY + 1)).toBe(2);
    expect(daysLeft(d, 1000 + 20 * DAY)).toBe(0);
  });
});

describe('settings and checks', () => {
  it('a missing or bad rate reads as the default; a parent rate wins; off by default', () => {
    expect(rateOf(undefined, 7)).toBe(3);
    expect(rateOf({ vault: { d7: 5 } }, 7)).toBe(5);
    expect(rateOf({ vault: { d7: -1 } }, 7)).toBe(3);
    expect(rateOf({ vault: { d7: 2.5 } }, 7)).toBe(3);
    expect(rateOf({ vault: { d3: 0 } }, 3)).toBe(0);
    expect(vaultOn(undefined)).toBe(false);
    expect(vaultOn({ vault: {} })).toBe(false);
    expect(vaultOn({ vault: { on: true } })).toBe(true);
  });
  it('depositProblem refuses under 10, over the gems, and a fourth active deposit', () => {
    expect(depositProblem(10, 50, 0)).toBeNull();
    expect(depositProblem(9, 50, 0)).not.toBeNull();
    expect(depositProblem(60, 50, 0)).not.toBeNull();
    expect(depositProblem(10, 50, 3)).not.toBeNull();
    expect(depositProblem(10.5, 50, 0)).not.toBeNull();
  });
});

describe('rules and code agree', () => {
  const rules = readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8');
  it('the default rates and the payout chunk in firestore.rules equal the ones here', () => {
    expect(rules).toMatch(/get\('d3', 1\)/);
    expect(rules).toMatch(/get\('d7', 3\)/);
    expect(rules).toMatch(/get\('d14', 7\)/);
    expect(rules).toMatch(/chunk <= 10/);
  });
  it('no vault rule reads the device clock and nothing in the vault rules is random', () => {
    const vaultPart = rules.slice(rules.indexOf('function vaultPath'));
    expect(vaultPart).toMatch(/request\.time/);
    expect(vaultPart).not.toMatch(/Date\.now|random/i);
  });
});
