import { useCallback, useEffect, useRef, useState } from 'react';
import { cardLabel, getCardDef } from '../../engine/modules';
import { learnerOf, learnerParams, type Kid } from '../../engine/models';
import type { AnswerInput } from '../../engine/problems';
import { SessionRunner, type Feedback, type RunSummary } from '../../engine/session';
import type { Repo } from '../../data/repo';
import { HoldButton } from '../early/HoldButton';
import { PrereaderRun } from '../early/PrereaderRun';
import { loadRunner, saveRun } from '../runShared';
import { Keypad, type Field } from '../Keypad';
import { FracView, MathView } from '../MathView';
import { MONSTERS, Sprite, UiIcon } from '../sprites';

interface RunProps {
  repo: Repo;
  kid: Kid;
  onDone: (summary: RunSummary, kid: Kid) => void;
  onExit: () => void;
}

type Mixed = { w: string; n: string; d: string };
const EMPTY_MIXED: Mixed = { w: '', n: '', d: '' };

/** Picks the screen by who is playing. Both drive the same SessionRunner. */
export function Run(props: RunProps) {
  return learnerOf(props.kid.settings) === 'prereader' ? <PrereaderRun {...props} /> : <ReaderRun {...props} />;
}

function ReaderRun({ repo, kid, onDone, onExit }: RunProps) {
  const BLOCK = learnerParams('reader').blockSize;
  const runnerRef = useRef<SessionRunner | null>(null);
  const startedAt = useRef(Date.now());
  const shownAt = useRef(0);
  const finishing = useRef(false);
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [intVal, setIntVal] = useState('');
  const [mixed, setMixed] = useState<Mixed>(EMPTY_MIXED);
  const [field, setField] = useState<Field>('n');
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [hits, setHits] = useState(0);
  const [shake, setShake] = useState(false);

  const rerender = () => setTick((t) => t + 1);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { runner: r, startedAt: at } = await loadRunner(repo, kid);
        if (!alive) return;
        runnerRef.current = r;
        startedAt.current = at;
        setLoading(false);
      } catch (e) {
        setError((e as Error).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [repo, kid]);

  const runner = runnerRef.current;
  const entry = runner?.current() ?? null;
  const isFraction = entry?.problem.answer.kind === 'mixed';

  // Reset the input and start the clock whenever a new question appears.
  useEffect(() => {
    if (!entry) return;
    setIntVal('');
    setMixed(EMPTY_MIXED);
    setField(entry.problem.tokens.some((t) => t.t === 'frac' && t.w) ? 'w' : 'n');
    shownAt.current = performance.now();
  }, [entry]);

  const finish = useCallback(async () => {
    const r = runnerRef.current;
    if (!r || finishing.current) return;
    finishing.current = true;
    // Whatever the save does, the player leaves the run.
    let left = false;
    try {
      const done = await saveRun(repo, kid, r, startedAt.current);
      if (done) {
        left = true;
        onDone(done.summary, done.updated);
      }
    } catch (e) {
      console.error('Leaving the run: saving threw.', e);
    } finally {
      if (!left) onExit();
    }
  }, [kid, repo, onDone, onExit]);

  const next = useCallback(() => {
    const r = runnerRef.current;
    if (!r) return;
    const before = Math.floor(r.position / BLOCK);
    r.advance();
    setFeedback(null);
    if (Math.floor(r.position / BLOCK) !== before) setHits(0);
    if (r.done()) void finish();
    else rerender();
  }, [finish]);

  const submit = useCallback(() => {
    const r = runnerRef.current;
    const e = r?.current();
    if (!r || !e || feedback) return;
    const ms = performance.now() - shownAt.current;
    const toNum = (s: string) => (s === '' ? null : Number(s));
    const input: AnswerInput = isFraction
      ? { kind: 'mixed', value: { w: toNum(mixed.w), n: toNum(mixed.n), d: toNum(mixed.d) } }
      : { kind: 'int', value: toNum(intVal) };
    const fb = r.answer(input, ms);
    setFeedback(fb);
    const card = r.getCard(e.cardId);
    if (card) void repo.saveCards(kid.id, [card]).catch(() => undefined);
    if (fb.verdict === 'correct') {
      setHits((h) => h + 1);
      setTimeout(next, fb.fast ? 550 : 800);
    } else {
      setShake(true);
      setTimeout(() => setShake(false), 450);
    }
  }, [feedback, isFraction, mixed, intVal, repo, kid.id, next]);

  const onDigit = useCallback(
    (d: number) => {
      if (feedback) return;
      if (!isFraction) setIntVal((v) => (v.length >= 4 ? v : v === '0' ? String(d) : v + d));
      else setMixed((m) => ({ ...m, [field]: m[field].length >= 2 ? m[field] : m[field] + d }));
    },
    [feedback, isFraction, field],
  );

  const onBack = useCallback(() => {
    if (feedback) return;
    if (!isFraction) setIntVal((v) => v.slice(0, -1));
    else setMixed((m) => ({ ...m, [field]: m[field].slice(0, -1) }));
  }, [feedback, isFraction, field]);

  const canSubmit = isFraction ? mixed.w !== '' || (mixed.n !== '' && mixed.d !== '') : intVal !== '';

  if (error) {
    return (
      <div className="screen center">
        <div className="panel">
          <p className="error">Could not load your quest: {error}</p>
          <button type="button" className="btn" onClick={onExit}>Back</button>
        </div>
      </div>
    );
  }
  if (loading || !runner) return <div className="screen center"><p className="pixel blink">Loading dungeon…</p></div>;
  if (!entry) {
    return (
      <div className="screen center">
        <div className="panel">
          <p>Nothing to practice yet. Ask a parent to turn on a math track.</p>
          <button type="button" className="btn" onClick={onExit}>Back</button>
        </div>
      </div>
    );
  }

  const def = getCardDef(entry.cardId)!;
  const monster =
    runner.position >= runner.length - BLOCK ? 'boss' : MONSTERS[Math.floor(runner.position / BLOCK) % MONSTERS.length]!;
  const progress = Math.min(1, runner.position / Math.max(1, runner.length));
  const hp = Math.max(0, 1 - hits / BLOCK);

  if (entry.kind === 'teach') {
    return (
      <div className="screen run">
        <RunTop progress={progress} combo={0} onQuit={finish} />
        <div className="panel teach">
          <p className="pixel tag">New skill!</p>
          <h2>{cardLabel(entry.cardId)}</h2>
          {def.kind === 'skill' ? <p className="strategy">{def.strategy}</p> : null}
          <div className="example">
            <p className="muted">Example</p>
            <MathView tokens={entry.problem.tokens} answer={<AnswerView problem={entry.problem} />} />
            <p className="hint">{entry.problem.hint}</p>
          </div>
          <button type="button" className="btn btn-big" onClick={() => { runner.acknowledge(); rerender(); }}>
            Let me try one!
          </button>
        </div>
      </div>
    );
  }

  const answerDisplay = isFraction ? (
    <span className="mixed-entry">
      <EntryBox value={mixed.w} active={field === 'w'} onClick={() => setField('w')} label="whole" big />
      <span className="frac">
        <EntryBox value={mixed.n} active={field === 'n'} onClick={() => setField('n')} label="top" />
        <span className="frac-line" />
        <EntryBox value={mixed.d} active={field === 'd'} onClick={() => setField('d')} label="bottom" />
      </span>
    </span>
  ) : (
    <span className={`int-entry ${intVal ? '' : 'is-empty'}`}>{intVal || '?'}</span>
  );

  return (
    <div className="screen run">
      <RunTop progress={progress} combo={feedback?.combo ?? 0} onQuit={finish} />
      <div className="arena">
        <Sprite name={kid.game.hero} size={110} className="hero-sprite" />
        <div className={`monster ${shake ? 'shake' : ''} ${feedback?.verdict === 'correct' ? 'hit' : ''}`}>
          <div className="hp"><div className="hp-fill" style={{ width: `${hp * 100}%` }} /></div>
          <Sprite name={monster} size={monster === 'boss' ? 150 : 120} />
        </div>
      </div>
      <div className={`panel question ${entry.kind === 'practice' ? 'is-practice' : ''}`}>
        {entry.kind === 'practice' ? <p className="pixel tag">Try again!</p> : null}
        <MathView tokens={entry.problem.tokens} answer={answerDisplay} />
        {feedback ? <FeedbackView fb={feedback} onContinue={next} /> : null}
      </div>
      <Keypad
        onDigit={onDigit}
        onBack={onBack}
        onSubmit={submit}
        canSubmit={canSubmit && !feedback}
        field={isFraction ? field : undefined}
        onField={isFraction ? setField : undefined}
        disabled={!!feedback}
      />
    </div>
  );
}

function RunTop({ progress, combo, onQuit }: { progress: number; combo: number; onQuit: () => void }) {
  return (
    <div className="run-top">
      <HoldButton onHold={onQuit}><UiIcon name="house" size={44} /></HoldButton>
      <div className="progress" aria-label={`${Math.round(progress * 100)}% through the dungeon`}>
        <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
      </div>
      <span className={`combo pixel ${combo >= 3 ? 'is-hot' : ''}`}>{combo >= 3 ? `Combo ×${combo}` : ''}</span>
    </div>
  );
}

function EntryBox({ value, active, onClick, label, big }: { value: string; active: boolean; onClick: () => void; label: string; big?: boolean }) {
  return (
    <button
      type="button"
      className={`entry-box ${active ? 'is-active' : ''} ${big ? 'is-big' : ''}`}
      onClick={onClick}
      aria-label={`${label}: ${value || 'empty'}`}
    >
      {value || ' '}
    </button>
  );
}

function AnswerView({ problem }: { problem: SessionRunner['queue'][number]['problem'] }) {
  const a = problem.answer;
  if (a.kind === 'int') return <span>{a.value}</span>;
  if (a.value.n === 0) return <span>{a.value.w}</span>;
  return <FracView w={a.value.w || undefined} n={a.value.n} d={a.value.d} />;
}

function Bolt() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="#fde047" stroke="#a16207" strokeWidth="1.5" aria-hidden="true">
      <path d="M13 2L4 14h7l-1 8 9-12h-7z" />
    </svg>
  );
}

function FeedbackView({ fb, onContinue }: { fb: Feedback; onContinue: () => void }) {
  if (fb.verdict === 'correct') {
    return (
      <div className="feedback good" role="status">
        <span className="pixel">Hit!</span>
        {fb.fast ? <span className="fast"><Bolt /> FAST</span> : null}
        <span className="xp">+{fb.xp} XP</span>
      </div>
    );
  }
  return (
    <div className={`feedback ${fb.verdict === 'almost' ? 'almost' : 'bad'}`} role="status">
      <p className="feedback-title">
        {fb.verdict === 'almost' ? 'Right amount! Now make a whole.' : `The answer is ${fb.correctAnswer}`}
      </p>
      {fb.verdict === 'almost' ? <p>Best form: <strong>{fb.correctAnswer}</strong></p> : null}
      <p className="hint">{fb.hint}</p>
      <button type="button" className="btn btn-big" onClick={onContinue} autoFocus>
        Got it
      </button>
    </div>
  );
}
