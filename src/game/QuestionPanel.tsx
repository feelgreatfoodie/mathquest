import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { Repo } from '../data/repo';
import { cardLevel } from '../engine/mastery';
import { paceOf, type Kid } from '../engine/models';
import { cardLabel, getCardDef } from '../engine/modules';
import { word } from '../engine/modules/early';
import type { AnswerInput, Problem, Visual } from '../engine/problems';
import type { Entry, Feedback, SessionRunner } from '../engine/session';
import { Keypad, type Field } from '../ui/Keypad';
import { FracView, MathView } from '../ui/MathView';
import { ChoiceButtons } from '../ui/early/ChoiceButtons';
import { displayModeFor, type DisplayMode } from '../ui/early/displayMode';
import { ObjectGroups } from '../ui/early/ObjectGroups';
import { chime, softTone, tick, unlockSounds } from '../ui/early/sounds';
import { TenFrame } from '../ui/early/TenFrame';
import { speak, stopSpeaking } from '../ui/early/useSpeech';
import { UiIcon } from '../ui/sprites';
import { reportFailure } from '../ui/failures';

/**
 * The one place a question is shown and answered. It renders the problem, takes the input (keypad,
 * fraction fields or picture choices), times the answer, grades through `runner.answer()`, saves the card,
 * and shows the feedback. A mode decides when it opens and what happens around it.
 *
 * The clock starts when the panel mounts (the question is visible), never earlier: a mode that lets the
 * kid walk to a question mounts the panel on arrival, so walking time is never graded.
 * Mount it with `key={entry.id}`: a new entry is a new panel with fresh input and a fresh clock.
 */
export interface QuestionPanelHandle {
  /** Stops speech and any count-up; the mode calls it before it leaves the run. */
  stop(): void;
}

export interface QuestionPanelProps {
  runner: SessionRunner;
  entry: Entry;
  kid: Kid;
  repo: Repo;
  learner: 'reader' | 'prereader';
  /** 'inline' sits in the mode's own screen; 'modal' floats over a world that pauses behind it. */
  display: 'inline' | 'modal';
  /** The answer was graded. The mode updates its own scene (monster, hearts, combo). */
  onAnswered?(feedback: Feedback): void;
  /** The panel is finished with this entry. `null` means a teach card was read. The mode moves on. */
  onResolved(feedback: Feedback | null): void;
  handleRef?: Ref<QuestionPanelHandle>;
}

export function QuestionPanel(props: QuestionPanelProps) {
  const body = props.learner === 'prereader' ? <PrereaderPanel {...props} /> : <ReaderPanel {...props} />;
  if (props.display === 'inline') return body;
  return (
    <div className="question-modal" role="dialog" aria-modal="true" aria-label="Question">
      {body}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Readers: the keypad run

type Mixed = { w: string; n: string; d: string };
const EMPTY_MIXED: Mixed = { w: '', n: '', d: '' };

function ReaderPanel({ runner, entry, kid, repo, onAnswered, onResolved, handleRef }: QuestionPanelProps) {
  const shownAt = useRef(0);
  const resolved = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const isFraction = entry.problem.answer.kind === 'mixed';
  const [intVal, setIntVal] = useState('');
  const [mixed, setMixed] = useState<Mixed>(EMPTY_MIXED);
  const [field, setField] = useState<Field>(entry.problem.tokens.some((t) => t.t === 'frac' && t.w) ? 'w' : 'n');
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  useImperativeHandle(handleRef, () => ({ stop() {} }), []);

  // The question is on screen: start the clock.
  useEffect(() => {
    shownAt.current = performance.now();
    return () => timers.current.forEach(clearTimeout);
  }, []);

  const resolve = useCallback(
    (fb: Feedback | null) => {
      if (resolved.current) return;
      resolved.current = true;
      onResolved(fb);
    },
    [onResolved],
  );

  const submit = useCallback(() => {
    if (feedback || resolved.current) return;
    const ms = performance.now() - shownAt.current;
    const toNum = (s: string) => (s === '' ? null : Number(s));
    const input: AnswerInput = isFraction
      ? { kind: 'mixed', value: { w: toNum(mixed.w), n: toNum(mixed.n), d: toNum(mixed.d) } }
      : { kind: 'int', value: toNum(intVal) };
    const fb = runner.answer(input, ms);
    setFeedback(fb);
    const card = runner.getCard(entry.cardId);
    if (card) void repo.saveCards(kid.id, [card]).catch((e) => reportFailure('An answer was not saved.', e, () => repo.saveCards(kid.id, [card])));
    onAnswered?.(fb);
    if (fb.verdict === 'correct') timers.current.push(setTimeout(() => resolve(fb), fb.fast ? 550 : 800));
  }, [feedback, isFraction, mixed, intVal, runner, entry.cardId, repo, kid.id, onAnswered, resolve]);

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

  if (entry.kind === 'teach') {
    const def = getCardDef(entry.cardId)!;
    return (
      <div className="panel teach">
        <p className="pixel tag">New skill!</p>
        <h2>{cardLabel(entry.cardId)}</h2>
        {def.kind === 'skill' ? <p className="strategy">{def.strategy}</p> : null}
        <div className="example">
          <p className="muted">Example</p>
          <MathView tokens={entry.problem.tokens} answer={<AnswerView problem={entry.problem} />} />
          <p className="hint">{entry.problem.hint}</p>
        </div>
        <button
          type="button"
          className="btn btn-big"
          onClick={() => {
            runner.acknowledge();
            resolve(null);
          }}
        >
          Let me try one!
        </button>
      </div>
    );
  }

  const canSubmit = isFraction ? mixed.w !== '' || (mixed.n !== '' && mixed.d !== '') : intVal !== '';
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
    <>
      <div className={`panel question ${entry.kind === 'practice' ? 'is-practice' : ''}`} data-preview={entry.preview ? 'true' : undefined}>
        {entry.kind === 'practice' ? <p className="pixel tag">Try again!</p> : null}
        {entry.preview ? <p className="pixel tag">A new one to try</p> : null}
        {entry.preview && !feedback ? <p className="hint preview-hint" data-testid="preview-hint">{entry.problem.hint}</p> : null}
        <MathView tokens={entry.problem.tokens} answer={answerDisplay} />
        {feedback ? <FeedbackView fb={feedback} onContinue={() => resolve(feedback)} /> : null}
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
    </>
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
      {value || ' '}
    </button>
  );
}

function AnswerView({ problem }: { problem: Problem }) {
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
    <div className={`feedback ${fb.verdict === 'almost' || fb.preview ? 'almost' : 'bad'}`} role="status">
      <p className="feedback-title">
        {fb.verdict === 'almost' ? 'Right amount! Now make a whole.' : fb.preview ? `Now you know: ${fb.correctAnswer}` : `The answer is ${fb.correctAnswer}`}
      </p>
      {fb.verdict === 'almost' ? <p>Best form: <strong>{fb.correctAnswer}</strong></p> : null}
      <p className="hint">{fb.hint}</p>
      <button type="button" className="btn btn-big" onClick={onContinue} autoFocus>
        Got it
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Pre-readers: pictures, a voice, big buttons

const CORRECT_PAUSE_MS = 1200;
/** Used only for card levels: pre-reader bars do not depend on the facts baseline. */
const BASELINE = 3500;

function numeral(t: Problem['tokens'][number]): string | number {
  return t.t === 'frac' ? '' : t.v;
}

function PrereaderPanel({ runner, entry, kid, repo, onAnswered, onResolved, handleRef }: QuestionPanelProps) {
  const pace = paceOf(kid.settings);
  const shownAt = useRef(0);
  const resolved = useRef(false);
  const countTurn = useRef(0);
  const alive = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [peeked, setPeeked] = useState(false);
  const [count, setCount] = useState(0);
  // How the question is shown depends on the card's level when it appeared, so it cannot change mid-question.
  const [mode] = useState<DisplayMode>(() => displayModeFor(cardLevel(runner.getCard(entry.cardId), BASELINE, pace), entry.kind));

  useImperativeHandle(
    handleRef,
    () => ({
      stop() {
        countTurn.current++;
        stopSpeaking();
      },
    }),
    [],
  );

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      countTurn.current++;
      timers.current.forEach(clearTimeout);
      stopSpeaking();
    };
  }, []);

  // The question is on screen: say it, and start the clock when the voice finishes.
  useEffect(() => {
    shownAt.current = performance.now();
    let current = true;
    void speak(entry.problem.speech ?? '').then(() => {
      if (current && !resolved.current) shownAt.current = performance.now();
    });
    return () => {
      current = false;
    };
  }, [entry]);

  const next = useCallback(
    (fb: Feedback | null) => {
      if (resolved.current) return;
      resolved.current = true;
      countTurn.current++;
      stopSpeaking();
      onResolved(fb);
    },
    [onResolved],
  );

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
      if (resolved.current) return;
      unlockSounds();
      const answer = entry.problem.answer.kind === 'int' ? entry.problem.answer.value : NaN;
      if (feedback) {
        // After a miss the only live button is the right one. Tapping it is ungraded practice: just go on.
        if (value === answer) next(feedback);
        return;
      }
      const ms = performance.now() - shownAt.current;
      const fb = runner.answer({ kind: 'int', value }, ms, { peeked });
      setFeedback(fb);
      setPicked(value);
      const card = runner.getCard(entry.cardId);
      if (card) void repo.saveCards(kid.id, [card]).catch((e) => reportFailure('An answer was not saved.', e, () => repo.saveCards(kid.id, [card])));
      const speech = entry.problem.speech ?? '';
      onAnswered?.(fb);
      if (fb.verdict === 'correct') {
        chime();
        const t0 = performance.now();
        void speak(`Yes! ${speech} is ${word(answer)}.`).then(() => {
          const wait = Math.max(0, CORRECT_PAUSE_MS - (performance.now() - t0));
          timers.current.push(setTimeout(() => alive.current && next(fb), wait));
        });
      } else {
        softTone();
        if (entry.problem.visual) void countUp(entry.problem.visual, speech, answer);
      }
    },
    [feedback, peeked, runner, entry, repo, kid.id, next, countUp, onAnswered],
  );

  const p = entry.problem;
  const visual = p.visual!;
  const answer = p.answer.kind === 'int' ? p.answer.value : 0;
  const missed = !!feedback && feedback.verdict !== 'correct';
  const solved = feedback?.verdict === 'correct';
  const showPictures = mode === 'groups' || peeked || missed || !!entry.preview;
  const [a, op, b] = p.tokens;

  return (
    <>
      <div data-preview={entry.preview ? 'true' : undefined} className={`early-question ${entry.kind === 'practice' ? 'is-practice' : ''}`} data-mode={showPictures ? (mode === 'frame' && !peeked && !missed ? 'frame' : 'groups') : 'numerals'}>
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
    </>
  );
}
