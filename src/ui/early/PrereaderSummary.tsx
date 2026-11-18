import { useEffect, useMemo, useRef, useState } from 'react';
import { HeroFigure } from '../HeroFigure';
import type { GameDelta } from '../../engine/game';
import type { CardMap, Kid } from '../../engine/models';
import { getCardDef } from '../../engine/modules';
import { word } from '../../engine/modules/early';
import { summaryCounts } from '../../engine/runLabel';
import type { RunSummary } from '../../engine/session';
import { levelStep, mapRows } from '../../engine/summaryView';
import { HeroShop } from '../HeroShop';
import type { RunInfo } from '../runShared';
import { Sprite, UiIcon } from '../sprites';
import { chime, unlockSounds } from './sounds';
import { speak, unlockSpeech } from './useSpeech';

/** One step of the end screen lasts this long. A tap jumps to the last step. */
export const STEP_MS = 1500;
const MAX_FLAMES = 7;
/** Taps this soon after the screen opens are the last answer's double tap, not a skip. */
const TAP_GUARD_MS = 700;

type StepId = 'stars' | 'gems' | 'xp' | 'learned' | 'map' | 'streak' | 'fail';

interface Props {
  kid: Kid;
  summary: RunSummary;
  info: RunInfo;
  loadCards: () => Promise<CardMap>;
  onGame: (d: GameDelta) => Promise<boolean>;
  onAgain: () => void;
  onHome: () => void;
}

/** A number that counts from `from` to `to` over about 900 ms. */
function useCountUp(from: number, to: number, active: boolean): number {
  const [v, setV] = useState(from);
  useEffect(() => {
    if (!active) return;
    if (from === to) {
      setV(to);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 900);
      setV(Math.round(from + (to - from) * k));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [from, to, active]);
  return v;
}

function Dots({ n }: { n: number }) {
  return <span className="sum-dots" aria-hidden="true">{Array.from({ length: n }, (_, i) => <i key={i} />)}</span>;
}

/** A fact as a picture: the numerals with a dot group under each. */
function DotCard({ id, faster }: { id: string; faster: boolean }) {
  const def = getCardDef(id);
  if (!def || def.kind !== 'fact') return null;
  const op = def.track === 'sub10' ? '−' : '+';
  return (
    <div className="sum-dotcard" aria-label={`${def.a} ${op} ${def.b}`}>
      <div className="sum-dotcard-n">{def.a} {op} {def.b}</div>
      <div className="sum-dotcard-d"><Dots n={def.a} /><Dots n={def.b} /></div>
      {faster ? <span className="sum-bolt"><UiIcon name="bolt" size={44} /></span> : null}
    </div>
  );
}

const CONFETTI = Array.from({ length: 18 }, (_, i) => i);

export function PrereaderSummary({ kid, summary, info, loadCards, onGame, onAgain, onHome }: Props) {
  const [saved, setSaved] = useState(info.saved);
  const [retrying, setRetrying] = useState(false);
  const [shop, setShop] = useState(false);
  const [cards, setCards] = useState<CardMap | null>(null);

  const counts = summaryCounts(summary);
  const stars = counts.right;
  const total = Math.max(counts.total, stars);
  const gemsAfter = kid.game.gems;
  const gemsBefore = saved ? info.before.gems : gemsAfter;
  const lv = useMemo(() => levelStep(info.before.xp, kid.game.xp), [info.before.xp, kid.game.xp]);
  const learned = info.newIds.filter((id) => getCardDef(id)?.kind === 'fact');
  const faster = new Set(summary.faster);

  const loadRef = useRef(loadCards);
  loadRef.current = loadCards;
  useEffect(() => {
    let live = true;
    void loadRef.current().then((c) => live && setCards(c)).catch(() => live && setCards({}));
    return () => {
      live = false;
    };
  }, []);

  const steps: StepId[] = useMemo(
    () => (saved ? ['stars', 'gems', 'xp', ...(learned.length ? (['learned'] as StepId[]) : []), 'map', 'streak'] : ['stars', 'fail']),
    [saved, learned.length],
  );
  const last = steps.length - 1;
  const [at, setAt] = useState(0);
  const openedAt = useRef(Date.now());
  const step = steps[Math.min(at, last)]!;

  // Auto-advance, one step per STEP_MS.
  useEffect(() => {
    if (at >= last) return;
    const t = setTimeout(() => setAt((a) => Math.min(a + 1, last)), STEP_MS);
    return () => clearTimeout(t);
  }, [at, last]);
  // When a retry turns the failure into a save, start over from the stars.
  const wasSaved = useRef(info.saved);
  useEffect(() => {
    if (saved && !wasSaved.current) setAt(0);
    wasSaved.current = saved;
  }, [saved]);

  // The voice, once per step.
  useEffect(() => {
    let line = '';
    if (step === 'stars') {
      chime();
      line = stars > 0 ? `${counts.practiceOnly ? 'Great practice' : 'Great job'}! You got ${word(stars)} ${stars === 1 ? 'star' : 'stars'}!` : "Nice try! Let's play again!";
    } else if (step === 'gems') line = `You have ${gemsAfter} gems!`;
    else if (step === 'xp') line = lv.levelUp ? `Level ${lv.levelAfter}!` : `Level ${lv.levelAfter}`;
    else if (step === 'learned') line = `You learned ${learned.length} new ${learned.length === 1 ? 'one' : 'ones'}!`;
    else if (step === 'map') line = 'Here is your map!';
    else if (step === 'streak') line = kid.game.streakDays > 0 ? `${kid.game.streakDays} ${kid.game.streakDays === 1 ? 'day' : 'days'} in a row!` : '';
    else if (step === 'fail') line = 'Oops! Tap the arrows.';
    if (line) void speak(line, { queue: step !== 'stars' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const gemsShown = useCountUp(gemsBefore, gemsAfter, step === 'gems');
  const [wrapped, setWrapped] = useState(false);
  useEffect(() => {
    if (step !== 'xp' || !lv.levelUp) return;
    const t = setTimeout(() => setWrapped(true), 600);
    return () => clearTimeout(t);
  }, [step, lv.levelUp]);
  const onXp = step === 'xp';
  // Before the xp step the bar sits at its old fill; after it, at the new one.
  const barFrac = onXp && !at ? lv.fromFrac : onXp && lv.levelUp ? (wrapped ? lv.toFrac : 1) : lv.toFrac;
  const badge = onXp && lv.levelUp && !wrapped ? lv.levelBefore : lv.levelAfter;

  if (shop) return <HeroShop kid={kid} learner="prereader" onGame={onGame} onClose={() => setShop(false)} />;

  const rows = cards ? mapRows(cards, kid.settings) : [];
  const flames = Math.min(MAX_FLAMES, kid.game.streakDays);
  const done = at >= last;

  const retry = async () => {
    if (!info.retry || retrying) return;
    setRetrying(true);
    try {
      await info.retry();
      setSaved(true);
    } catch {
      // The failure toast stays; the arrows stay.
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="screen center early-summary sum" data-step={step} onPointerDown={(e) => {
      if ((e.target as HTMLElement).closest('button') || Date.now() - openedAt.current < TAP_GUARD_MS) return;
      setAt(last);
    }}>
      <div className="big-stars" role="img" aria-label={`${stars} of ${total} stars`}>
        {Array.from({ length: total }, (_, i) => (
          <svg key={i} width="64" height="64" viewBox="0 0 24 24" aria-hidden="true" className={i < stars ? 'star on' : 'star'}>
            <path d="M12 2l3 6.5 7 .8-5.2 4.8 1.4 7L12 17.6 5.8 21.1l1.4-7L2 9.3l7-.8z" />
          </svg>
        ))}
      </div>

      {step === 'fail' ? (
        <div className="sum-panel sum-fail" data-testid="sum-fail">
          <span className="sum-fail-text">Couldn't save</span>
          <button type="button" className="sum-btn" aria-label="Try again" disabled={retrying} onClick={() => void retry()}>
            <UiIcon name="refresh" size={72} />
          </button>
        </div>
      ) : null}

      {saved && at >= 1 ? (
        <div className="sum-panel sum-gems" data-testid="sum-gems">
          <div className="sum-fly" aria-hidden="true">
            {Array.from({ length: Math.min(6, summary.gems) }, (_, i) => <span key={i} style={{ animationDelay: `${i * 120}ms` }}><UiIcon name="gem" size={44} /></span>)}
          </div>
          <UiIcon name="chest" size={120} />
          <span className="sum-total"><UiIcon name="gem" size={64} /><span className="tally-num" data-testid="sum-gem-total">{step === 'gems' ? gemsShown : gemsAfter}</span></span>
        </div>
      ) : null}

      {saved && at >= 2 ? (
        <div className="sum-panel sum-xp" data-testid="sum-xp">
          <div className="sum-hero">
            <HeroFigure game={kid.game} size={130} className="bob" />
            <span className="sum-badge" data-testid="sum-level">{badge}</span>
          </div>
          <div className="sum-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(barFrac * 100)}>
            <div className={`sum-bar-fill${lv.levelUp && wrapped ? ' no-anim' : ''}`} style={{ width: `${barFrac * 100}%` }} />
          </div>
          <span className="sum-xp-num">{kid.game.xp}</span>
          {lv.levelUp && step === 'xp' ? (
            <div className="sum-confetti" data-testid="sum-levelup" aria-hidden="true">
              {CONFETTI.map((i) => <i key={i} style={{ left: `${(i * 37) % 100}%`, animationDelay: `${(i % 6) * 90}ms`, background: ['#facc15', '#38bdf8', '#fb923c', '#4ade80'][i % 4] }} />)}
            </div>
          ) : null}
        </div>
      ) : null}

      {saved && learned.length && step === 'learned' ? (
        <div className="sum-panel sum-learned" data-testid="sum-learned">
          {learned.slice(0, 4).map((id) => <DotCard key={id} id={id} faster={faster.has(id)} />)}
        </div>
      ) : null}

      {saved && at >= steps.indexOf('map') && steps.includes('map') ? (
        <div className="sum-panel sum-map" data-testid="sum-map">
          {rows.map((row) => (
            <div key={row.moduleId} className="sum-trail" data-module={row.moduleId}>
              <span className="sum-op" aria-hidden="true">{row.moduleId === 'sub10' ? '−' : '+'}</span>
              {row.stones.map((s) => (
                <div key={s.groupId} className={`sum-stone ${s.state}`} data-state={s.state} data-seen={s.seen}>
                  {s.state === 'current' ? <Sprite name={kid.game.hero} size={64} className="sum-stone-hero" /> : null}
                  <div className="sum-stone-dots" aria-hidden="true">
                    {Array.from({ length: s.total }, (_, i) => <i key={i} className={i < s.seen ? 'on' : ''} />)}
                  </div>
                  {s.state === 'locked' ? (
                    <span className="sum-lock"><UiIcon name="lock" size={44} />{s.gap ? <b>{s.gap}</b> : null}</span>
                  ) : s.state === 'done' ? <span className="sum-lock"><UiIcon name="check" size={40} /></span> : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : null}

      {saved && at >= last && steps.includes('streak') ? (
        <div className="flames sum-streak" role="img" aria-label={`${kid.game.streakDays} day streak`}>
          {Array.from({ length: flames }, (_, i) => <UiIcon key={i} name="flame" size={56} />)}
          {kid.game.streakDays > MAX_FLAMES ? <span className="flame-count">{kid.game.streakDays}</span> : null}
        </div>
      ) : null}

      {done ? (
        <div className="row sum-buttons" data-testid="sum-buttons">
          <button type="button" className="sum-btn sum-play" aria-label="Play again" onClick={() => { unlockSounds(); unlockSpeech(); onAgain(); }}>
            <UiIcon name="play" size={80} />
          </button>
          <button type="button" className="sum-btn" aria-label="Hero shop" onClick={() => { unlockSounds(); unlockSpeech(); setShop(true); }}>
            <UiIcon name="chest" size={80} />
          </button>
          <button type="button" className="sum-btn" aria-label="Home" onClick={onHome}><UiIcon name="house" size={80} /></button>
        </div>
      ) : null}
    </div>
  );
}
