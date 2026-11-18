import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { cardLevel } from '../../engine/mastery';
import { learnerParams, paceOf, type Kid, type KidGame } from '../../engine/models';
import { word } from '../../engine/modules/early';
import type { Token, Visual } from '../../engine/problems';
import type { Feedback, RunSummary } from '../../engine/session';
import type { SessionRunner } from '../../engine/session';
import type { Repo } from '../../data/repo';
import { reportFailure } from '../failures';
import { loadRunner, saveRun } from '../runShared';
import { MONSTERS, Sprite, UiIcon } from '../sprites';
import { ChoiceButtons } from './ChoiceButtons';
import { displayModeFor, type DisplayMode } from './displayMode';
import { ObjectGroups } from './ObjectGroups';
import { chime, softTone, tick, unlockSounds } from './sounds';
import { TenFrame } from './TenFrame';
import { speak, stopSpeaking, unlockSpeech } from './useSpeech';

interface Props {
  repo: Repo;
  kid: Kid;
  onDone: (summary: RunSummary, kid: Kid) => void;
  /** The stored game after a Try again succeeds. */
  onSynced?: (game: KidGame) => void;
  onExit: () => void;
}

const PATH_DOTS = 10;
const HOLD_MS = 2000;
const CORRECT_PAUSE_MS = 1200;
/** Used only for card levels: pre-reader bars do not depend on the facts baseline. */
const BASELINE = 3500;

/** A button that acts only after a 2 s hold, so a small finger cannot leave by accident. */
export function HoldButton({ onHold, label = 'Hold to leave', children }: { onHold: () => void; label?: string; children: React.ReactNode }) {
  const [holding, setHolding] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stop = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const start = () => {
    stop();
    setHolding(true);
    timer.current = setTimeout(() => {
      stop();
      onHold();
    }, HOLD_MS);
  };
  useEffect(() => stop, []);
  return (
    <button
      type="button"
      className={`hold-btn ${holding ? 'is-holding' : ''}`}
      aria-label={label}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) start(); }}
      onKeyUp={stop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
      <span className="hold-ring" aria-hidden="true" />
    </button>
  );
}

function PathDots({ done }: { done: number }) {
  return (
    <div className="path-dots" role="img" aria-label={`${done} of ${PATH_DOTS}`}>
      {Array.from({ length: PATH_DOTS }, (_, i) => (
        <span key={i} className={`path-dot ${i < done ? 'is-done' : i === done ? 'is-here' : ''}`} />
      ))}
    </div>
  );
}

function numeral(t: Token): string | number {
  return t.t === 'frac' ? '' : t.v;
}

/** The screen for kids who cannot read yet: pictures, a voice, big buttons. Same SessionRunner as the reader screen. */
export function PrereaderRun({ repo, kid, onDone, onExit, onSynced }: Props) {
  const block = learnerParams('prereader').blockSize;
  const pace = paceOf(kid.settings);
  const runnerRef = useRef<SessionRunner | null>(null);
  const startedAt = useRef(Date.now());
  const shownAt = useRef(0);
  const finishing = useRef(false);
  const advancing = useRef(false);
  const countTurn = useRef(0);
  const alive = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [peeked, setPeeked] = useState(false);
  const [count, setCount] = useState(0);
  const [hits, setHits] = useState(0);
  const [shake, setShake] = useState(false);

  const rerender = () => setTick((t) => t + 1);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      countTurn.current++;
      timers.current.forEach(clearTimeout);
      stopSpeaking();
    };
  }, []);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const { runner, startedAt: at } = await loadRunner(repo, kid);
        if (!live) return;
        runnerRef.current = runner;
        startedAt.current = at;
        setLoading(false);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      live = false;
    };
  }, [repo, kid]);

  // The first tap anywhere unlocks audio on iOS.
  useEffect(() => {
    const unlock = () => {
      unlockSounds();
      unlockSpeech();
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    return () => window.removeEventListener('pointerdown', unlock);
  }, []);

  const runner = runnerRef.current;
  const entry = runner?.current() ?? null;

  // How the question is shown depends on the card's level when it appeared, so it cannot change mid-question.
  const mode = useMemo<DisplayMode>(() => {
    if (!entry || !runnerRef.current) return 'groups';
    return displayModeFor(cardLevel(runnerRef.current.getCard(entry.cardId), BASELINE, pace), entry.kind);
  }, [entry, pace]);

  // A new question: reset, say it, and start the clock when the voice finishes.
  useEffect(() => {
    if (!entry) return;
    setFeedback(null);
    setPicked(null);
    setPeeked(false);
    setCount(0);
    advancing.current = false;
    countTurn.current++;
    shownAt.current = performance.now();
    let current = true;
    void speak(entry.problem.speech ?? '').then(() => {
      if (current && !advancing.current) shownAt.current = performance.now();
    });
    return () => {
      current = false;
    };
  }, [entry]);

  const finish = useCallback(async () => {
    const r = runnerRef.current;
    if (!r || finishing.current) return;
    finishing.current = true;
    countTurn.current++;
    stopSpeaking();
    const saved = await saveRun(repo, kid, r, startedAt.current, onSynced);
    if (!saved) {
      onExit();
      return;
    }
    onDone(saved.summary, saved.updated);
  }, [kid, repo, onDone, onExit, onSynced]);

  const next = useCallback(() => {
    const r = runnerRef.current;
    if (!r || advancing.current) return;
    advancing.current = true;
    countTurn.current++;
    stopSpeaking();
    const before = Math.floor(r.position / block);
    r.advance();
    setFeedback(null);
    setPicked(null);
    if (Math.floor(r.position / block) !== before) setHits(0);
    if (r.done()) void finish();
    else rerender();
  }, [block, finish]);

  /** Counts the icons one by one, on screen and out loud, then says the whole sum. */
  const countUp = useCallback(async (visual: Visual, speech: string, answer: number) => {
    const turn = ++countTurn.current;
    const stale = () => turn !== countTurn.current || !alive.current;
    await speak(visual.op === '+' ? "Let's count them all." : "Let's take some away, then count what is left.");
    for (let i = 1; i <= answer; i++) {
      if (stale()) return;
      setCount(i);
      tick();
      await speak(word(i), { queue: true });
    }
    if (stale()) return;
    await speak(`${speech} is ${word(answer)}.`, { queue: true });
  }, []);

  const choose = useCallback(
    (value: number) => {
      const r = runnerRef.current;
      const e = r?.current();
      if (!r || !e || advancing.current) return;
      unlockSounds();
      const answer = e.problem.answer.kind === 'int' ? e.problem.answer.value : NaN;
      if (feedback) {
        // After a miss the only live button is the right one. Tapping it is ungraded practice: just go on.
        if (value === answer) next();
        return;
      }
      const ms = performance.now() - shownAt.current;
      const fb = r.answer({ kind: 'int', value }, ms, { peeked });
      setFeedback(fb);
      setPicked(value);
      const card = r.getCard(e.cardId);
      if (card) void repo.saveCards(kid.id, [card]).catch((e) => reportFailure('An answer was not saved.', e, () => repo.saveCards(kid.id, [card])));
      const speech = e.problem.speech ?? '';
      if (fb.verdict === 'correct') {
        chime();
        setHits((h) => h + 1);
        const t0 = performance.now();
        void speak(`Yes! ${speech} is ${word(answer)}.`).then(() => {
          const wait = Math.max(0, CORRECT_PAUSE_MS - (performance.now() - t0));
          timers.current.push(setTimeout(() => alive.current && next(), wait));
        });
      } else {
        softTone();
        setShake(true);
        timers.current.push(setTimeout(() => setShake(false), 450));
        if (e.problem.visual) void countUp(e.problem.visual, speech, answer);
      }
    },
    [feedback, peeked, repo, kid.id, next, countUp],
  );

  if (error) {
    return (
      <div className="screen center">
        <div className="panel">
          <p className="error">Could not load the quest: {error}</p>
          <button type="button" className="btn" onClick={onExit}>Back</button>
        </div>
      </div>
    );
  }
  if (loading || !runner) return <div className="screen center"><span className="blink"><UiIcon name="play" size={72} /></span></div>;
  if (!entry || !entry.problem.choices || !entry.problem.visual || entry.problem.answer.kind !== 'int') {
    return (
      <div className="screen center">
        <div className="panel">
          <p>Nothing to practice yet. A parent can turn on a module for this player.</p>
          <button type="button" className="btn" onClick={onExit}>Back</button>
        </div>
      </div>
    );
  }

  const p = entry.problem;
  const visual = p.visual!;
  const answer = p.answer.kind === 'int' ? p.answer.value : 0;
  const missed = !!feedback && feedback.verdict !== 'correct';
  const solved = feedback?.verdict === 'correct';
  const monster = runner.position >= runner.length - block ? 'boss' : MONSTERS[Math.floor(runner.position / block) % MONSTERS.length]!;
  const hp = Math.max(0, 1 - hits / block);
  const done = Math.min(PATH_DOTS, Math.round((runner.position / Math.max(1, runner.length)) * PATH_DOTS));
  const showPictures = mode === 'groups' || peeked || missed;
  const [a, op, b] = p.tokens;

  return (
    <div className="screen run early-run">
      <div className="run-top early-top">
        <HoldButton onHold={() => void finish()}><UiIcon name="house" size={44} /></HoldButton>
        <PathDots done={done} />
        <button
          type="button"
          className="icon-btn"
          aria-label="Say it again"
          disabled={solved}
          onClick={() => { unlockSounds(); unlockSpeech(); void speak(p.speech ?? ''); }}
        >
          <UiIcon name="speaker" size={44} />
        </button>
      </div>

      <div className="arena early-arena">
        <Sprite name={kid.game.hero} size={96} className="hero-sprite" />
        <div className={`monster ${shake ? 'shake' : ''} ${solved ? 'hit' : ''}`}>
          <div className="hp"><div className="hp-fill" style={{ width: `${hp * 100}%` }} /></div>
          <Sprite name={monster} size={monster === 'boss' ? 120 : 96} />
        </div>
      </div>

      <div className={`early-question ${entry.kind === 'practice' ? 'is-practice' : ''}`} data-mode={showPictures ? (mode === 'frame' && !peeked && !missed ? 'frame' : 'groups') : 'numerals'}>
        <div className="early-pictures">
          {showPictures && mode === 'frame' && !peeked && !missed ? (
            <div className="frame-row">
              <TenFrame n={visual.a} shape="circle" label={`${visual.a}`} />
              <span className="og-op" aria-hidden="true">{visual.op}</span>
              <TenFrame n={visual.b} shape="square" label={`${visual.b}`} />
            </div>
          ) : showPictures ? (
            <ObjectGroups visual={visual} count={missed ? count : 0} crossOut={missed} />
          ) : (
            <button type="button" className="peek-btn" aria-label="Look at the pictures" onClick={() => setPeeked(true)}>
              <UiIcon name="eye" size={56} />
            </button>
          )}
        </div>
        <div className="early-numerals" aria-live="polite">
          <span>{numeral(a!)}</span>
          <span className="math-op">{numeral(op!)}</span>
          <span>{numeral(b!)}</span>
          <span className="math-op">=</span>
          <span className="math-answer">{solved ? answer : '?'}</span>
          {solved ? <span className="early-check"><UiIcon name="check" size={56} /></span> : null}
        </div>
      </div>

      <ChoiceButtons choices={p.choices!} answer={answer} guide={missed} picked={picked} disabled={solved} onChoose={choose} />
    </div>
  );
}
