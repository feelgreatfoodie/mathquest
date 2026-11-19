import { useCallback, useEffect, useRef, useState } from 'react';
import { LIGHTNING, LightningRound, buildDeck, type LightningCard, type RoundResult } from '../../engine/lightning';
import { learnerOf, type Kid, type Learner } from '../../engine/models';
import { answerText, type Problem } from '../../engine/problems';
import { HoldButton } from '../../ui/early/HoldButton';
import { chime, softTone, unlockSounds } from '../../ui/early/sounds';
import { speak, stopSpeaking, unlockSpeech } from '../../ui/early/useSpeech';
import { Keypad } from '../../ui/Keypad';
import { MathView } from '../../ui/MathView';
import { MuteButton, useMute } from '../../ui/MuteButton';
import { PixelButton, PixelFrame, PixelIcon, TorchRow } from '../../ui/pixel';
import { SpeakButton } from '../../ui/SpeakButton';
import { usePauseStop } from '../../ui/usePause';
import { saveLightning } from './lightningWrite';
import { cardLabel } from '../../engine/modules';
import type { GameModeProps } from './types';

/** What the voice reads for a card: the problem's own speech, else the tokens ("seven times eight" reads as "7 times 8"). */
export function speechOf(p: Problem): string {
  if (p.speech) return p.speech;
  return p.tokens.map((t) => (t.t === 'num' ? String(t.v) : t.t === 'op' ? (t.v === '×' ? 'times' : t.v === '+' ? 'plus' : 'minus') : t.t === 'blank' ? 'what' : `${t.n} over ${t.d}`)).join(' ');
}

/** Pre-readers get 3 choices: the answer and 2 close ones from the problem's own choices, smallest first. */
export function threeChoices(p: Problem): number[] {
  const answer = p.answer.kind === 'int' ? p.answer.value : 0;
  const others = (p.choices ?? []).filter((c) => c !== answer);
  const picked = others.slice(0, 2);
  for (let extra = 1; picked.length < 2; extra++) {
    const c = answer + extra;
    if (c !== answer && !picked.includes(c)) picked.push(c);
  }
  return [answer, ...picked].sort((a, b) => a - b);
}

const sec = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

type View = { kind: 'loading' } | { kind: 'empty' } | { kind: 'play' } | { kind: 'end'; result: RoundResult; gems: number };

/** Lightning Round: practice only. Taped problems with a shrinking reveal, mixed 1 unknown to 9 known. */
export function LightningMode(props: GameModeProps) {
  const [run, setRun] = useState(0);
  return <LightningRoundScreen key={run} {...props} onAgain={() => setRun((r) => r + 1)} />;
}

function LightningRoundScreen({ repo, kid, onExit, onSynced, onAgain }: GameModeProps & { onAgain: () => void }) {
  const learner = learnerOf(kid.settings);
  const roundRef = useRef<LightningRound | null>(null);
  const kidRef = useRef<Kid>(kid);
  kidRef.current = kid;
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const ringTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startedCard = useRef<string | null>(null);
  const cardStart = useRef(0);
  const finishing = useRef(false);
  const savedSig = useRef('');
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const [flash, setFlash] = useState(false);
  const [shake, setShake] = useState(false);
  const mute = useMute(kid);
  const rerender = () => setTick((t) => t + 1);
  const later = (fn: () => void, ms: number) => timers.current.push(setTimeout(fn, ms));

  // ---- saving: every 10 answers, on pagehide, visibilitychange hidden and unmount (the Adventure checkpoint path) ----
  const checkpoint = useCallback(() => {
    const r = roundRef.current;
    if (!r || finishing.current) return;
    const sig = `${r.answered}:${r.changedCards().length}`;
    if (r.answered === 0 || sig === savedSig.current) return;
    savedSig.current = sig;
    void saveLightning(repo, kidRef.current, r, { close: false, left: true });
  }, [repo]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === 'hidden') checkpoint();
    };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', checkpoint);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('pagehide', checkpoint);
      timers.current.forEach(clearTimeout);
      if (ringTimer.current) clearTimeout(ringTimer.current);
      stopSpeaking();
      checkpoint(); // unmount
    };
  }, [checkpoint]);

  // ---- load ----
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [cards, sessions] = await Promise.all([repo.loadCards(kid.id), repo.listSessions(kid.id, 80)]);
        if (!alive) return;
        const deck = buildDeck({ cards, sessions, settings: kid.settings, now: Date.now(), rng: Math.random });
        if (!deck.cards.length) return setView({ kind: 'empty' });
        roundRef.current = new LightningRound(deck, cards, kid.settings, Math.random, Date.now);
        setView({ kind: 'play' });
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, kid.id]);

  const finish = useCallback(async () => {
    const r = roundRef.current;
    if (!r || finishing.current) return;
    if (r.answered === 0) return onExit();
    finishing.current = true;
    timers.current.forEach(clearTimeout);
    if (ringTimer.current) clearTimeout(ringTimer.current);
    stopSpeaking();
    const result = r.result();
    const saved = await saveLightning(repo, kidRef.current, r, { close: true });
    if (saved.game) onSynced?.(saved.game);
    setView({ kind: 'end', result, gems: saved.gems });
  }, [repo, onExit, onSynced]);

  // A pause lets this card finish, then the round saves and ends.
  const pausedRef = usePauseStop(() => void finish());

  const round = roundRef.current;
  const card = view.kind === 'play' && round ? round.current() : null;

  const next = useCallback(() => {
    const r = roundRef.current;
    if (!r) return;
    r.advance();
    setFlash(false);
    if (r.over() || pausedRef.current) void finish();
    else rerender();
  }, [finish, pausedRef]);

  // Each new card: count it shown, say it, start the ring. The ring closing is a hint, never a fail: it reveals the answer.
  useEffect(() => {
    const r = roundRef.current;
    if (!r || !card || r.phase !== 'ask' || startedCard.current === card.id) return;
    startedCard.current = card.id;
    r.show();
    cardStart.current = performance.now();
    void speak(speechOf(card.problem));
    ringTimer.current = setTimeout(() => {
      if (r.phase !== 'ask') return;
      r.timeout();
      void speak(`${speechOf(card.problem)} is ${answerText(card.problem)}`);
      rerender();
    }, card.delayMs);
  });

  const submit = (card: LightningCard, value: number) => {
    const r = roundRef.current;
    if (!r || r.phase !== 'ask' || r.current()?.id !== card.id) return;
    if (ringTimer.current) clearTimeout(ringTimer.current);
    const res = r.answer({ kind: 'int', value }, performance.now() - cardStart.current);
    if (res.hit) {
      chime();
      setFlash(true);
      if (r.answered % 10 === 0) checkpoint();
      later(next, 380);
    } else {
      softTone();
      setShake(true);
      later(() => setShake(false), 400);
      void speak(`${speechOf(card.problem)} is ${answerText(card.problem)}`);
    }
    rerender();
  };

  const copy = (card: LightningCard, value: number) => {
    const r = roundRef.current;
    if (!r || r.phase !== 'miss' || r.current()?.id !== card.id) return;
    if (r.copy({ kind: 'int', value })) {
      chime();
      if (r.answered % 10 === 0) checkpoint();
      later(next, 450);
    } else {
      softTone();
      setShake(true);
      later(() => setShake(false), 400);
    }
    rerender();
  };

  // The progress bar follows the clock as well as the card count.
  useEffect(() => {
    if (view.kind !== 'play') return;
    const id = setInterval(rerender, 1000);
    return () => clearInterval(id);
  }, [view.kind]);

  if (error) {
    return (
      <div className="screen center">
        <PixelFrame className="panel lr-panel">
          <p className="error">Could not load Lightning Round: {error}</p>
          <PixelButton onClick={onExit}>Back</PixelButton>
        </PixelFrame>
      </div>
    );
  }
  if (view.kind === 'loading') return <div className="screen center"><p className="pixel blink">Loading…</p></div>;
  if (view.kind === 'empty') {
    return (
      <div className="screen center lr-screen" data-testid="lr-empty">
        <PixelFrame tone="stone" className="panel lr-panel">
          <PixelIcon name="bolt" size={64} />
          <p>{learner === 'prereader' ? 'Play a few rounds first.' : 'Nothing needs work yet. Play a Dungeon run first, then come back to practice the tricky facts.'}</p>
          <PixelButton tone="gold" size={learner === 'prereader' ? 'prereader' : 'normal'} onClick={onExit} aria-label="Home"><PixelIcon name="house" size={learner === 'prereader' ? 64 : 32} /></PixelButton>
        </PixelFrame>
      </div>
    );
  }
  if (view.kind === 'end') {
    return <RoundEnd kid={kid} learner={learner} result={view.result} gems={view.gems} onAgain={onAgain} onHome={onExit} mute={mute} />;
  }
  if (!round || !card) return <div className="screen center"><p className="pixel blink">Loading…</p></div>;

  const phase = round.phase;
  const elapsed = Date.now() - round.startedAt;
  const progress = Math.min(1, Math.max(round.result().shown / LIGHTNING.maxCards, elapsed / LIGHTNING.maxMs));
  const answer = answerText(card.problem);
  const pre = learner === 'prereader';
  return (
    <div className={`screen run lr-screen ${pre ? 'lr-pre' : ''}`} data-testid="lightning" data-phase={phase} data-delay={card.delayMs}>
      <div className="run-top">
        <HoldButton onHold={() => void finish()}><PixelIcon name="house" size={44} label="Home" /></HoldButton>
        <TorchRow done={Math.floor(progress * 10 + 1e-9)} label={`${Math.round(progress * 100)}% through the round`} />
        <MuteButton muted={mute.muted} locked={mute.locked} onToggle={mute.toggle} chimesOnly={mute.chimesOnly} big={pre} />
      </div>
      <PixelFrame tone="stone" className={`panel question lr-card ${shake ? 'shake' : ''}`}>
        <div className="lr-ring-wrap" aria-hidden="true">
          <svg className={`lr-ring ${phase === 'ask' ? 'is-running' : phase === 'hit' ? 'is-hit' : 'is-miss'}`} viewBox="0 0 100 100" width="96" height="96" style={{ ['--lr-ms' as string]: `${card.delayMs}ms` }} key={`${card.id}:${phase === 'ask' ? 'a' : 'b'}`}>
            <circle className="lr-ring-bg" cx="50" cy="50" r="44" />
            <circle className="lr-ring-fg" cx="50" cy="50" r="44" pathLength="100" />
          </svg>
          <span className={`lr-bolt ${flash ? 'is-flash' : ''}`}><PixelIcon name="bolt" size={48} /></span>
        </div>
        <MathView tokens={card.problem.tokens} answer={phase === 'miss' ? <span data-testid="lr-answer">{answer}</span> : '?'} />
        {phase === 'miss' ? (
          <p className="lr-copy" data-testid="lr-copy">{pre ? '' : 'Type the answer again'}</p>
        ) : null}
        <SpeakButton text={speechOf(card.problem)} size={pre ? 64 : 36} />
      </PixelFrame>
      {pre ? (
        <div className="lr-choices" role="group" aria-label="Answers">
          {threeChoices(card.problem).map((v) => {
            const isAnswer = String(v) === answer;
            const live = phase === 'ask' || (phase === 'miss' && isAnswer);
            return (
              <PixelButton
                key={v}
                size="prereader"
                tone={phase === 'miss' && isAnswer ? 'gold' : 'neutral'}
                className={`lr-choice ${phase === 'miss' && isAnswer ? 'is-guide' : ''}`}
                data-answer={isAnswer ? 'true' : 'false'}
                aria-label={String(v)}
                aria-disabled={!live}
                onClick={() => {
                  if (!live) return;
                  unlockSounds();
                  unlockSpeech();
                  if (phase === 'ask') submit(card, v);
                  else copy(card, v);
                }}
              >
                <span className="lr-choice-num">{v}</span>
              </PixelButton>
            );
          })}
        </div>
      ) : (
        <TypedAnswer key={`${card.id}:${phase}`} answer={answer} disabled={phase === 'hit'} onSubmit={(v) => (phase === 'ask' ? submit(card, v) : copy(card, v))} />
      )}
    </div>
  );
}

/** The keypad and the typed digits. It submits when the typed digits match the length of the answer, so no tap is spent on GO. */
function TypedAnswer({ answer, disabled, onSubmit }: { answer: string; disabled: boolean; onSubmit: (value: number) => void }) {
  const [typed, setTyped] = useState('');
  const send = (text: string) => {
    if (text === '') return;
    onSubmit(Number(text));
    setTyped('');
  };
  return (
    <div className="lr-typed">
      <div className="lr-typed-box" data-testid="lr-typed" aria-live="polite">{typed || ' '}</div>
      <Keypad
        disabled={disabled}
        canSubmit={typed.length > 0}
        onSubmit={() => send(typed)}
        onBack={() => setTyped((t) => t.slice(0, -1))}
        onDigit={(d) => {
          unlockSounds();
          unlockSpeech();
          const t = (typed + String(d)).slice(0, 4);
          setTyped(t);
          if (t.length >= answer.length) send(t);
        }}
      />
    </div>
  );
}

function RoundEnd({ kid, learner, result, gems, onAgain, onHome, mute }: { kid: Kid; learner: Learner; result: RoundResult; gems: number; onAgain: () => void; onHome: () => void; mute: ReturnType<typeof useMute> }) {
  const pre = learner === 'prereader';
  useEffect(() => {
    if (pre) void speak(result.hits > 0 ? `You got ${result.hits} ${result.hits === 1 ? 'bolt' : 'bolts'}!` : 'Good try!');
    return () => stopSpeaking();
  }, [pre, result.hits]);
  const chest = <div className="px-treasure" aria-hidden="true"><PixelIcon name="chest" size={96} /><PixelIcon name="bolt" size={64} /><PixelIcon name="gem" size={48} /><PixelIcon name="key" size={36} /></div>;
  if (pre) {
    const bolts = Math.min(10, result.hits);
    return (
      <div className="screen center px-treasure-screen lr-screen lr-pre lr-end" data-testid="lr-end" data-kid={kid.id}>
        <div className="run-top lr-end-top"><MuteButton muted={mute.muted} locked={mute.locked} onToggle={mute.toggle} chimesOnly={mute.chimesOnly} big /></div>
        {chest}
        <div className="panel summary px-frame px-neutral lr-panel">
          <div className="lr-bolts" role="img" aria-label={`${result.hits} bolts`}>
            {Array.from({ length: 10 }, (_, i) => <span key={i} className={i < bolts ? 'is-lit' : 'is-dim'}><PixelIcon name="bolt" size={56} /></span>)}
          </div>
          {gems > 0 ? (
            <div className="lr-gems" role="img" aria-label={`${gems} gems`}>
              {Array.from({ length: gems }, (_, i) => <PixelIcon key={i} name="gem" size={72} />)}
            </div>
          ) : null}
        </div>
        <div className="lr-end-buttons">
          <PixelButton tone="gold" size="prereader" aria-label="Again" onClick={() => { unlockSounds(); unlockSpeech(); onAgain(); }}><PixelIcon name="bolt" size={80} /></PixelButton>
          <PixelButton size="prereader" aria-label="Home" onClick={onHome}><PixelIcon name="house" size={80} /></PixelButton>
        </div>
      </div>
    );
  }
  const stat = (label: string, value: string | number, id?: string) => (
    <div className="stat"><span className="stat-value" data-testid={id}>{value}</span><span className="stat-label">{label}</span></div>
  );
  return (
    <div className="screen center px-treasure-screen lr-screen lr-end" data-testid="lr-end" data-kid={kid.id}>
      {chest}
      <div className="panel summary px-frame px-neutral lr-panel">
        <p className="pixel tag">Round over!</p>
        <div className="stats">
          {stat('bolts', result.hits, 'lr-hits')}
          {stat('fastest streak', result.bestStreak, 'lr-streak')}
          {stat('XP', `+${result.xp}`)}
          {stat('gems', gems, 'lr-gems')}
        </div>
        {result.faster.length ? (
          <section aria-label="Faster this round">
            <h2>Got faster</h2>
            <ul className="lr-faster">
              {result.faster.map((f) => <li key={f.cardId} data-testid="lr-faster">{f.label}: {sec(f.beforeMs)} to {sec(f.afterMs)}</li>)}
            </ul>
          </section>
        ) : null}
        {result.focus.length ? <p data-testid="lr-focus">Next round: {result.focus.map(cardLabel).join(', ')}</p> : null}
        <div className="lr-end-buttons">
          <PixelButton tone="gold" size="big" onClick={() => { unlockSounds(); unlockSpeech(); onAgain(); }}>Again</PixelButton>
          <PixelButton size="big" onClick={onHome}>Home</PixelButton>
        </div>
      </div>
    </div>
  );
}
