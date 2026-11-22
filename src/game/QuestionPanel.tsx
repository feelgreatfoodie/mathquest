import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import type { Repo } from '../data/repo';
import { type Kid } from '../engine/models';
import { cardLabel, getCardDef, moduleOfCard } from '../engine/modules';
import { word } from '../engine/modules/early';
import { promptTokens, type AnswerInput, type Problem, type Visual } from '../engine/problems';
import type { Entry, Feedback, SessionRunner } from '../engine/session';
import { Keypad, type Field } from '../ui/Keypad';
import { FracView, MathView } from '../ui/MathView';
import { ChoiceButtons } from '../ui/early/ChoiceButtons';
import { NumberPad } from '../ui/early/NumberPad';
import { GapFrame, StrategyCueView } from '../ui/early/StrategyCue';
import { strategyCue } from '../engine/support';
import { ObjectGroups } from '../ui/early/ObjectGroups';
import { chime, hit, softTone, tick, unlockSounds } from '../ui/early/sounds';
import { speak, stopSpeaking } from '../ui/early/useSpeech';
import { SpeakButton } from '../ui/SpeakButton';
import { goAction, wholeAllowed } from '../engine/fractionInput';
import { UiIcon } from '../ui/sprites';
import { PixelIcon } from '../ui/pixel';
import { reportFailure } from '../ui/failures';

/**
 * The one place a question is shown and answered. It renders the problem, takes the input (keypad,
 * fraction fields or picture choices), times the answer, grades through `runner.answerEntry()` (the same grading as `answer()`), saves the card,
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
  // The Whole box shows only for a family whose answer can be a whole or mixed number.
  const showWhole = isFraction && wholeAllowed(entry.cardId);
  const [field, setField] = useState<Field>(showWhole && entry.problem.tokens.some((t) => t.t === 'frac' && t.w) ? 'w' : 'n');
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
    // Graded by entry id: a mode that lets the kid pick the order (the Overworld) has no "current" entry. In a run that
    // walks the queue in order, the entry is the current one, so this is the same grading as runner.answer().
    const fb = runner.answerEntry(entry.id, input, ms);
    setFeedback(fb);
    if (fb.verdict === 'correct') hit();
    else softTone();
    const card = runner.getCard(entry.cardId);
    if (card) void repo.saveCards(kid.id, [card]).catch((e) => reportFailure('An answer was not saved.', e, () => repo.saveCards(kid.id, [card])));
    onAnswered?.(fb);
    if (fb.verdict === 'correct') timers.current.push(setTimeout(() => resolve(fb), fb.fast ? 550 : 800));
  }, [feedback, isFraction, mixed, intVal, runner, entry.cardId, repo, kid.id, onAnswered, resolve]);

  const onDigit = useCallback(
    (d: number) => {
      if (feedback) return;
      unlockSounds();
      if (!isFraction) setIntVal((v) => (v.length >= 4 ? v : v === '0' ? String(d) : v + d));
      else setMixed((m) => ({ ...m, [field]: m[field].length >= 2 ? m[field] : m[field] + d }));
    },
    [feedback, isFraction, field],
  );

  // GO on a fraction jumps to the next empty box first, and submits once Top and Bottom are filled.
  const onGo = useCallback(() => {
    if (!isFraction) return submit();
    const step = goAction(mixed);
    if (step.kind === 'field') setField(step.field);
    else if (step.kind === 'submit') submit();
  }, [isFraction, mixed, submit]);

  const onBack = useCallback(() => {
    if (feedback) return;
    if (!isFraction) setIntVal((v) => v.slice(0, -1));
    else setMixed((m) => ({ ...m, [field]: m[field].slice(0, -1) }));
  }, [feedback, isFraction, field]);

  if (entry.kind === 'teach') {
    const def = getCardDef(entry.cardId)!;
    return (
      <div className="panel teach px-frame px-stone">
        <p className="pixel tag">New skill!</p>
        <h2>
          {cardLabel(entry.cardId)}
          <SpeakButton text={`${cardLabel(entry.cardId)}. ${def.kind === 'skill' ? def.strategy : ''} Example: ${entry.problem.hint}`} />
        </h2>
        {def.kind === 'skill' ? <p className="strategy">{def.strategy}</p> : null}
        <div className="example">
          <p className="muted">Example</p>
          <MathView tokens={entry.problem.tokens} answer={<AnswerView problem={entry.problem} />} />
          <p className="hint">{entry.problem.hint}</p>
        </div>
        <button
          type="button"
          className="btn btn-big px-frame px-btn px-big px-gold"
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

  const canSubmit = isFraction ? mixed.w !== '' || mixed.n !== '' || mixed.d !== '' : intVal !== '';
  const missed = !!feedback && feedback.verdict !== 'correct';
  // The kid's own answer, as typed, shown small and struck through next to the right one.
  const wasText = isFraction ? [mixed.w, mixed.n !== '' && mixed.d !== '' ? `${mixed.n}/${mixed.d}` : ''].filter(Boolean).join(' ') : intVal;
  const answerDisplay = missed ? (
    // After a miss the equation shows the right answer, large, with a check. The wrong number is small and struck through.
    <span className="answer-fixed">
      <AnswerView problem={entry.problem} />
      <span className="answer-check"><UiIcon name="check" size={44} /></span>
      {wasText ? <s className="answer-was" aria-label={`You said ${wasText}`}>{wasText}</s> : null}
    </span>
  ) : isFraction ? (
    <span className="mixed-entry">
      {showWhole ? <EntryBox value={mixed.w} active={field === 'w'} onClick={() => setField('w')} label="whole" big /> : null}
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
      <div className={`panel question px-frame px-stone ${entry.kind === 'practice' && !entry.fill && !entry.riddle ? 'is-practice' : ''}`} data-preview={entry.preview ? 'true' : undefined}>
        {entry.kind === 'practice' && !entry.fill && !entry.riddle ? <p className="pixel tag">Try again!</p> : null}
        {entry.riddle ? <p className="pixel tag" data-testid="riddle-tag">A riddle!</p> : null}
        {entry.problem.story ? <p className="story" data-testid="riddle-story">{entry.problem.story}</p> : null}
        {entry.preview ? <p className="pixel tag">A new one to try</p> : null}
        {entry.preview && !feedback ? <p className="hint preview-hint" data-testid="preview-hint">{entry.problem.hint}</p> : null}
        <MathView tokens={promptTokens(entry.problem)} answer={answerDisplay} />
        {feedback ? <FeedbackView fb={feedback} onContinue={() => resolve(feedback)} /> : null}
      </div>
      <Keypad
        onDigit={onDigit}
        onBack={onBack}
        onSubmit={onGo}
        canSubmit={canSubmit && !feedback}
        field={isFraction ? field : undefined}
        fields={showWhole ? ['w', 'n', 'd'] : ['n', 'd']}
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
  return <PixelIcon name="bolt" size={44} />;
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
      <p className="hint hint-big">
        <span>{fb.hint}</span>
        <SpeakButton text={fb.hint} className="hint-speaker" />
      </p>
      <button type="button" className="btn btn-big px-frame px-btn px-big px-go" onClick={onContinue} autoFocus>
        Got it
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Pre-readers: pictures, a voice, big buttons

const CORRECT_PAUSE_MS = 1200;

function numeral(t: Problem['tokens'][number]): string | number {
  return t.t === 'frac' ? '' : t.t === 'blank' ? '?' : t.v;
}

function PrereaderPanel({ runner, entry, kid, repo, onAnswered, onResolved, handleRef }: QuestionPanelProps) {
  const shownAt = useRef(0);
  const resolved = useRef(false);
  const countTurn = useRef(0);
  const alive = useRef(true);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [typed, setTyped] = useState<number | null>(null);
  const [count, setCount] = useState(0);
  // How much help the fact shows is fixed when the question appears: a fade step never changes a question in progress.
  const [level] = useState(() => (entry.preview ? 'dots' : runner.supportLevelOf(entry.cardId)));
  const cue = strategyCue(entry.problem);
  // What the pictures area shows: 0 nothing (numerals), 1 the strategy, 2 the full dots. A fact at 'dots' starts on its strategy,
  // or on the dots when none fits. Help moves one step on, strategy first. Going past the starting step makes the answer right-with-help.
  const startStep = entry.preview || level === 'dots' ? (cue && !entry.preview ? 1 : 2) : 0;
  const [viewStep, setViewStep] = useState(startStep);
  const helped = viewStep > startStep;

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

  /** Counts the icons (or the missing squares of a ten-frame) one by one, on screen and out loud, then says the whole sum. */
  const countUp = useCallback(async (visual: Visual, finalLine: string, answer: number, gap = false) => {
    const turn = ++countTurn.current;
    const stale = () => turn !== countTurn.current || !alive.current;
    await speak(gap ? "Let's count what is missing." : visual.op === '+' ? "Let's count them all." : "Let's take some away, then count what is left.");
    for (let i = 1; i <= answer; i++) {
      if (stale()) return;
      setCount(i);
      tick();
      await speak(word(i), { queue: true });
    }
    if (stale()) return;
    await speak(finalLine, { queue: true });
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
      const fb = runner.answerEntry(entry.id, { kind: 'int', value }, ms, { helped });
      setFeedback(fb);
      setPicked(value);
      const card = runner.getCard(entry.cardId);
      if (card) void repo.saveCards(kid.id, [card]).catch((e) => reportFailure('An answer was not saved.', e, () => repo.saveCards(kid.id, [card])));
      const speech = entry.problem.speech ?? '';
      onAnswered?.(fb);
      if (fb.verdict === 'correct') {
        chime();
        const t0 = performance.now();
        void speak(`Yes! ${entry.problem.confirm ?? `${speech} is ${word(answer)}`}.`).then(() => {
          const wait = Math.max(0, CORRECT_PAUSE_MS - (performance.now() - t0));
          timers.current.push(setTimeout(() => alive.current && next(fb), wait));
        });
      } else {
        softTone();
        const g = entry.problem.gap;
        if (entry.problem.visual) void countUp(entry.problem.visual, `${entry.problem.confirm ?? `${speech} is ${word(answer)}`}.`, answer, !!g);
      }
    },
    [feedback, helped, runner, entry, repo, kid.id, next, countUp, onAnswered],
  );

  /** A pad key: shows the number and says it (the voice obeys mute). */
  const onKey = useCallback((n: number) => {
    if (resolved.current || feedback) return;
    unlockSounds();
    setTyped(n);
    void speak(word(n));
  }, [feedback]);

  const onHelp = useCallback(() => {
    if (feedback) return;
    unlockSounds();
    const to = viewStep === 0 && cue ? 1 : 2;
    if (to === 1 && cue) void speak(cue.speech);
    setViewStep(to);
  }, [feedback, viewStep, cue]);

  const p = entry.problem;
  const visual = p.visual!;
  const answer = p.answer.kind === 'int' ? p.answer.value : 0;
  const missed = !!feedback && feedback.verdict !== 'correct';
  const solved = feedback?.verdict === 'correct';
  const [a, op, b] = p.tokens;
  const padMax = moduleOfCard(entry.cardId)?.padMax ?? 10;
  const view = missed || viewStep === 2 ? 'groups' : viewStep === 1 ? 'cue' : 'numerals';
  const usePad = level === 'pad' && !missed;
  const choices = missed && level === 'pad' ? [answer] : p.choices!;
  // The answer slot: the right answer once solved, the pad's number while typing, else a question mark.
  const shown = solved ? answer : usePad && typed !== null ? typed : '?';
  const showHelp = viewStep < 2 && !entry.preview && !feedback;

  return (
    <>
      <div data-preview={entry.preview ? 'true' : undefined} data-support={level} data-riddle={entry.riddle ? 'true' : undefined} className={`early-question ${entry.kind === 'practice' && !entry.fill && !entry.riddle ? 'is-practice' : ''}`} data-mode={view}>
        <div className="early-pictures">
          {view === 'cue' ? <StrategyCueView cue={cue!} visual={visual} icon={visual.icon} /> : null}
          {view === 'groups' ? (p.gap ? <GapFrame a={p.gap.a} total={p.gap.total} count={missed ? count : 0} fill={missed && count >= answer} /> : <ObjectGroups visual={visual} count={missed ? count : 0} crossOut={missed} size={Math.max(visual.a, visual.b) > 5 ? 52 : 64} />) : null}
          {showHelp ? (
            <button type="button" className="help-btn" aria-label="Help" data-testid="help" onClick={onHelp}>
              <UiIcon name="eye" size={64} />
            </button>
          ) : null}
        </div>
        <div className="early-numerals" aria-live="polite">
          <span>{numeral(a!)}</span>
          <span className="math-op">{numeral(op!)}</span>
          {p.gap ? <span className="math-answer">{shown}</span> : <span>{numeral(b!)}</span>}
          <span className="math-op">=</span>
          {p.gap ? <span>{p.gap.total}</span> : <span className="math-answer">{shown}</span>}
          {solved ? <span className="early-check"><UiIcon name="check" size={72} /></span> : null}
          {solved ? <span className="sparkles" aria-hidden="true">{[0, 1, 2, 3, 4].map((i) => <i key={i} style={{ ['--i' as string]: i }}><UiIcon name="sparkle" size={36} /></i>)}</span> : null}
        </div>
      </div>

      {usePad ? (
        <NumberPad max={padMax} value={typed} disabled={!!feedback} onKey={onKey} onClear={() => setTyped(null)} onOk={() => typed !== null && choose(typed)} />
      ) : (
        <ChoiceButtons choices={choices!} answer={answer} guide={missed} picked={picked} disabled={solved} dots={level === 'dots' || viewStep === 2 || missed} onChoose={choose} />
      )}
    </>
  );
}

