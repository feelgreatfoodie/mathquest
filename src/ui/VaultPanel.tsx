import { useEffect, useRef, useState } from 'react';
import type { Kid } from '../engine/models';
import {
  PREREADER_AMOUNT, PREREADER_TERM, VAULT_MAX_ACTIVE, VAULT_MIN, VAULT_TERMS, bonusFor, daysLeft, depositProblem, looksReady, owedOf, rateOf, vaultBalance,
  type VaultDeposit, type VaultTerm,
} from '../game/vault';
import { chime } from './early/sounds';
import { speak } from './early/useSpeech';
import { UiIcon } from './sprites';
import { useResume, type VaultApi } from './vaultApi';

interface Props {
  kid: Kid;
  vault: VaultApi;
  deposits: VaultDeposit[];
  refresh: () => Promise<void>;
}

const SHOWER_MS = 1700;

/** A short burst of gems after a collect. Decoration: aria-hidden, no input. */
function CoinShower() {
  return (
    <div className="coin-shower" aria-hidden="true" data-testid="coin-shower">
      {Array.from({ length: 14 }, (_, i) => (
        <span key={i} className="coin" style={{ left: `${4 + i * 6.7}%`, animationDelay: `${(i % 5) * 90}ms` }}><UiIcon name="gem" size={36} /></span>
      ))}
    </div>
  );
}

function useShower() {
  const [shower, setShower] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  const fire = () => {
    setShower(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setShower(false), SHOWER_MS);
  };
  return { shower, fire };
}

/** Deposits that still hold gems for the kid: active, or closed with gems left to pay. */
const open = (d: VaultDeposit) => d.status === 'active' || owedOf(d) > 0;
const activeCount = (ds: readonly VaultDeposit[]) => ds.filter((d) => d.status === 'active').length;

// ---------------------------------------------------------------- reader

/** The vault for a reader: deposit builder, one card per deposit, a picture-free confirm for breaking early. */
export function ReaderVault({ kid, vault, deposits, refresh }: Props) {
  const [term, setTerm] = useState<VaultTerm>(7);
  const [amount, setAmount] = useState(VAULT_MIN);
  const [breaking, setBreaking] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { shower, fire } = useShower();
  useResume(vault, deposits, refresh);
  const gems = kid.game.gems;
  const active = activeCount(deposits);
  const rate = rateOf(kid.settings, term);
  const bonus = bonusFor(amount, rate);
  const problem = depositProblem(amount, gems, active);
  const step = (delta: number) => setAmount((a) => Math.max(VAULT_MIN, Math.min(Math.max(VAULT_MIN, gems), a + delta)));

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const doDeposit = () =>
    run(async () => {
      setNote(null);
      if (await vault.deposit(amount, term)) {
        chime();
        setNote(`${amount} gems are in the vault for ${term} days. They come back as ${amount + bonus}.`);
      }
    });

  const doPay = (d: VaultDeposit, mode: 'collect' | 'break') =>
    run(async () => {
      setNote(null);
      setBreaking(null);
      const r = await vault.pay(d.id, mode);
      if (r === 'done') {
        if (mode === 'collect') {
          fire();
          chime();
          setNote(`Your ${d.amount} gems grew to ${d.amount + d.bonus}!`);
          void speak(`Your ${d.amount} gems grew to ${d.amount + d.bonus}!`);
        } else setNote(`Your ${d.amount} gems are back.`);
      } else if (r === 'early') setNote('Not ready yet. The vault keeps its own clock, so it opens when the days are up.');
      else setNote('That did not finish saving. Tap Finish to try again.');
    });

  const now = Date.now();
  const shown = deposits.filter(open);
  return (
    <section className="vault" aria-label="Vault" data-testid="vault">
      <p className="muted">Put gems in for a few days and they come back with extra. Break early and you get your gems back without the extra.</p>
      <p className="vault-balance" data-testid="vault-balance"><UiIcon name="chest" size={28} /> In the vault: <strong>{vaultBalance(deposits)}</strong> gems</p>
      {note ? <p className="vault-note" role="status" data-testid="vault-note">{note}</p> : null}
      {shower ? <CoinShower /> : null}
      <div className="vault-list">
        {shown.map((d) => {
          const ready = looksReady(d, now);
          const closed = d.status !== 'active';
          return (
            <div key={d.id} className={`vault-card ${ready ? 'is-ready' : ''}`} data-deposit={d.id} data-status={d.status} data-ready={ready}>
              <span className="vault-sum"><strong>{d.amount}</strong> gems in, <strong>{d.amount + d.bonus}</strong> back</span>
              <span className="muted">{closed ? 'Paying out' : ready ? 'Ready to collect' : `${daysLeft(d, now)} more ${daysLeft(d, now) === 1 ? 'day' : 'days'} of ${d.termDays}`}</span>
              {breaking === d.id ? (
                <span className="confirm-row">
                  <span className="vault-warn">Break early? You get {d.amount} back. The {d.bonus} extra is lost.</span>
                  <button type="button" className="btn btn-small shop-btn-48" disabled={busy} onClick={() => void doPay(d, 'break')}>Break it</button>
                  <button type="button" className="btn btn-small btn-ghost shop-btn-48" onClick={() => setBreaking(null)}>Keep saving</button>
                </span>
              ) : closed ? (
                <button type="button" className="btn btn-small shop-btn-48" disabled={busy} onClick={() => void doPay(d, d.status === 'breaking' ? 'break' : 'collect')}>Finish</button>
              ) : (
                <span className="row">
                  <button type="button" className="btn btn-small shop-btn-48 vault-collect" disabled={busy} onClick={() => void doPay(d, 'collect')}>Collect {d.amount + d.bonus}</button>
                  <button type="button" className="btn btn-small btn-ghost shop-btn-48 vault-break" disabled={busy} onClick={() => setBreaking(d.id)}>Break early</button>
                </span>
              )}
            </div>
          );
        })}
        {!shown.length ? <p className="muted">Nothing in the vault yet.</p> : null}
      </div>
      <div className="vault-new" data-testid="vault-new">
        <h3>Put gems in</h3>
        <div className="vault-terms" role="radiogroup" aria-label="Days to save">
          {VAULT_TERMS.map((t) => (
            <button key={t} type="button" role="radio" aria-checked={term === t} data-term={t} className={`btn btn-small shop-btn-48 ${term === t ? 'is-on' : 'btn-ghost'}`} onClick={() => setTerm(t)}>
              {t} days<small>{rateOf(kid.settings, t)} extra per 10</small>
            </button>
          ))}
        </div>
        <div className="vault-amount">
          <button type="button" className="btn btn-small shop-btn-48" aria-label="Less" disabled={amount <= VAULT_MIN} onClick={() => step(-10)}>−10</button>
          <span className="vault-amount-n" data-testid="vault-amount">{amount}</span>
          <button type="button" className="btn btn-small shop-btn-48" aria-label="More" disabled={amount + 10 > gems} onClick={() => step(10)}>+10</button>
        </div>
        <p className="vault-example" data-testid="vault-example">{amount} in for {term} days, {rate} extra for every 10: you get back <strong>{amount + bonus}</strong>.</p>
        <button type="button" className="btn shop-btn-48" data-testid="vault-deposit" disabled={busy || problem !== null} onClick={() => void doDeposit()}>Put in {amount}</button>
        {problem && gems >= VAULT_MIN ? <p className="muted">{problem}</p> : null}
        <p className="muted">Up to {VAULT_MAX_ACTIVE} deposits at a time, at least {VAULT_MIN} gems each.</p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- pre-reader

/** Ten gems in two rows of five, then `extra` more in a third row. Dots instead of numerals for the idea of "more". */
function Dots({ count, tint }: { count: number; tint?: 'new' }) {
  return (
    <span className={`pv-dots ${tint ? 'is-new' : ''}`} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => <UiIcon key={i} name="gem" size={30} />)}
    </span>
  );
}

type PreStep = { kind: 'deposit' } | { kind: 'break'; id: string };

/**
 * The vault for a pre-reader. No words: gems as dots, chests, a check and a cross, and the voice. One deposit shape
 * (10 gems for 3 days). A ready chest glows and collects on a tap with the coin shower. A chest that is not ready asks
 * "take your gems back?" with a check and a cross. Every target is at least 120 px.
 */
export function PrereaderVault({ kid, vault, deposits, refresh }: Props) {
  const [step, setStep] = useState<PreStep | null>(null);
  const [busy, setBusy] = useState(false);
  const { shower, fire } = useShower();
  useResume(vault, deposits, refresh);
  const rate = rateOf(kid.settings, PREREADER_TERM);
  const bonus = bonusFor(PREREADER_AMOUNT, rate);
  const gems = kid.game.gems;
  const canPut = depositProblem(PREREADER_AMOUNT, gems, activeCount(deposits)) === null;
  const now = Date.now();
  const shown = deposits.filter(open);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const collect = (d: VaultDeposit) =>
    run(async () => {
      const r = await vault.pay(d.id, d.status === 'breaking' ? 'break' : 'collect');
      if (r === 'done') {
        fire();
        chime();
        void speak(`Your ${d.amount} gems grew to ${d.amount + d.bonus}!`);
      } else if (r === 'early') void speak('Not yet!');
      else void speak('Oops! Tap the chest again.');
    });

  const tapChest = (d: VaultDeposit) => {
    if (busy) return;
    if (d.status !== 'active') return void collect(d);
    if (looksReady(d, now)) return void collect(d);
    const left = daysLeft(d, now);
    void speak(`Your gems are growing! ${left} more ${left === 1 ? 'sleep' : 'sleeps'}.`);
    setStep({ kind: 'break', id: d.id });
  };

  if (step) {
    const d = step.kind === 'break' ? deposits.find((x) => x.id === step.id) : null;
    const give = step.kind === 'deposit' ? PREREADER_AMOUNT : d?.amount ?? 0;
    return (
      <section className="pvault pvault-confirm" aria-label={step.kind === 'deposit' ? 'Put gems in' : 'Take gems back'} data-testid="pvault-confirm" data-step={step.kind}>
        <Dots count={give} />
        {step.kind === 'deposit' ? (
          <>
            <UiIcon name="arrow-down" size={64} />
            <Dots count={PREREADER_AMOUNT + bonus} tint="new" />
          </>
        ) : (
          <span className="pv-lost" aria-hidden="true"><UiIcon name="gem" size={44} /><span className="pv-x"><UiIcon name="close" size={44} /></span></span>
        )}
        <div className="row pshop-actions">
          <button
            type="button"
            className="pshop-btn pshop-buy pv-yes"
            aria-label={step.kind === 'deposit' ? 'Put in' : 'Take back'}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                if (step.kind === 'deposit') {
                  if (await vault.deposit(PREREADER_AMOUNT, PREREADER_TERM)) {
                    chime();
                    void speak(`Put in ${PREREADER_AMOUNT}. Get back ${PREREADER_AMOUNT + bonus} in ${PREREADER_TERM} sleeps!`);
                  }
                } else if (d) {
                  const r = await vault.pay(d.id, 'break');
                  if (r === 'done') void speak(`You got your ${d.amount} back.`);
                  else if (r === 'failed') void speak('Oops! Tap the chest again.');
                }
                setStep(null);
              })
            }
          >
            <UiIcon name="check" size={84} /><UiIcon name="gem" size={64} />
          </button>
          <button type="button" className="pshop-btn pshop-cancel pv-no" aria-label="Cancel" onClick={() => setStep(null)}>
            <UiIcon name="close" size={64} />
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="pvault" aria-label="Vault" data-testid="pvault">
      {shower ? <CoinShower /> : null}
      <button
        type="button"
        className="pv-new"
        aria-label="Put gems in the vault"
        data-testid="pvault-new"
        disabled={!canPut || busy}
        onClick={() => {
          void speak(`Put in ${PREREADER_AMOUNT}. Get back ${PREREADER_AMOUNT + bonus} in ${PREREADER_TERM} sleeps!`);
          setStep({ kind: 'deposit' });
        }}
      >
        <Dots count={PREREADER_AMOUNT} />
        <UiIcon name="arrow-down" size={48} />
        <Dots count={PREREADER_AMOUNT + bonus} tint="new" />
      </button>
      <div className="pv-chests">
        {shown.map((d) => {
          const ready = d.status !== 'active' || looksReady(d, now);
          return (
            <button
              key={d.id}
              type="button"
              className={`pv-chest ${ready ? 'is-ready' : ''}`}
              data-deposit={d.id}
              data-status={d.status}
              data-ready={ready}
              aria-label={ready ? 'Collect' : 'Growing'}
              disabled={busy}
              onClick={() => tapChest(d)}
            >
              <UiIcon name="chest" size={84} />
              {ready ? <span className="pv-glow" aria-hidden="true"><UiIcon name="sparkle" size={44} /><UiIcon name="sparkle" size={32} /></span> : <span className="pv-days" aria-hidden="true">{Array.from({ length: Math.max(1, daysLeft(d, now)) }, (_, i) => <i key={i} />)}</span>}
            </button>
          );
        })}
      </div>
    </section>
  );
}
