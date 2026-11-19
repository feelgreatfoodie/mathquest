import { HearButton, MuteButton, useMute } from '../../ui/MuteButton';
import { useCallback, useEffect, useRef, useState } from 'react';
import { HeroFigure } from '../../ui/HeroFigure';
import { learnerParams } from '../../engine/models';
import type { Feedback, SessionRunner } from '../../engine/session';
import { HoldButton } from '../../ui/early/HoldButton';
import { unlockSounds } from '../../ui/early/sounds';
import { stopSpeaking, unlockSpeech } from '../../ui/early/useSpeech';
import { finishRun } from '../../ui/finishRun';
import { usePauseStop } from '../../ui/usePause';
import { loadRunner } from '../../ui/runShared';
import { MONSTERS, Sprite, UiIcon } from '../../ui/sprites';
import { QuestionPanel, type QuestionPanelHandle } from '../QuestionPanel';
import type { GameModeProps } from './types';

const PATH_DOTS = 10;

function PathDots({ done }: { done: number }) {
  return (
    <div className="path-dots" role="img" aria-label={`${done} of ${PATH_DOTS}`}>
      {Array.from({ length: PATH_DOTS }, (_, i) => (
        <span key={i} className={`path-dot ${i < done ? 'is-done' : i === done ? 'is-here' : ''}`} />
      ))}
    </div>
  );
}

/** The run for kids who cannot read yet: pictures, a voice, big buttons. Questions come from QuestionPanel. */
export function PrereaderMode({ repo, kid, onDone, onExit, onSynced }: GameModeProps) {
  const block = learnerParams('prereader').blockSize;
  const mute = useMute(kid); // the kid's mute and the parent's voice and sounds settings drive the voice and the chimes
  const runnerRef = useRef<SessionRunner | null>(null);
  const startedAt = useRef(Date.now());
  const finishing = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const panelRef = useRef<QuestionPanelHandle | null>(null);
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [hits, setHits] = useState(0);
  const [shake, setShake] = useState(false);

  const rerender = () => setTick((t) => t + 1);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

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

  const finish = useCallback(async () => {
    const r = runnerRef.current;
    if (!r || finishing.current) return;
    finishing.current = true;
    panelRef.current?.stop();
    stopSpeaking();
    setSaved(true);
    // Whatever the save does, the kid leaves the run.
    await finishRun({ repo, kid, runner: r, startedAt: startedAt.current, onSynced, onDone, onExit, extra: { mode: 'prereader' } });
  }, [kid, repo, onDone, onExit, onSynced]);

  // A pause lets this question finish, then the run saves through finishRun and the break screen takes over.
  const pausedRef = usePauseStop(() => void finish());

  const next = useCallback(() => {
    const r = runnerRef.current;
    if (!r) return;
    const before = Math.floor(r.position / block);
    r.advance();
    setFeedback(null);
    if (Math.floor(r.position / block) !== before) setHits(0);
    if (r.done() || pausedRef.current) void finish();
    else rerender();
  }, [pausedRef, block, finish]);

  const onAnswered = useCallback((fb: Feedback) => {
    setFeedback(fb);
    if (fb.verdict === 'correct') {
      setHits((h) => h + 1);
    } else {
      setShake(true);
      timers.current.push(setTimeout(() => setShake(false), 450));
    }
  }, []);

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
          {kid.game.lastPlayedDay ? <p aria-label="All done for today"><UiIcon name="check" size={96} /></p> : <p>Nothing to practice yet. A parent can turn on a module for this player.</p>}
          <button type="button" className="btn" onClick={onExit}>Back</button>
        </div>
      </div>
    );
  }

  const solved = feedback?.verdict === 'correct';
  const monster = runner.position >= runner.length - block ? 'boss' : MONSTERS[Math.floor(runner.position / block) % MONSTERS.length]!;
  const hp = Math.max(0, 1 - hits / block);
  const done = Math.min(PATH_DOTS, Math.round(runner.progress() * PATH_DOTS));

  return (
    <div className="screen run early-run">
      <div className="run-top early-top">
        <HoldButton onHold={() => void finish()}><UiIcon name="house" size={44} /></HoldButton>
        {saved ? <div className="saved-toast" role="status"><UiIcon name="check" size={32} /> Saved!</div> : null}
        <PathDots done={done} />
        <div className="early-top-right">
          <HearButton text={entry.problem.speech ?? ''} muted={mute.voiceMuted} disabled={solved} big />
          <MuteButton muted={mute.muted} locked={mute.locked} onToggle={mute.toggle} big chimesOnly={mute.chimesOnly} />
        </div>
      </div>

      <div className="arena early-arena">
        <HeroFigure game={kid.game} size={96} className={`hero-sprite ${solved ? 'hop' : ''}`} strike={solved} cheer={false} />
        <div className={`monster ${shake ? 'shake' : ''} ${solved ? 'hit' : ''}`}>
          {solved ? <span className="star-burst" key={`b${entry.id}`} aria-hidden="true">{[0, 1, 2, 3, 4, 5].map((i) => <i key={i} style={{ ['--a' as string]: `${i * 60}deg` }} />)}</span> : null}
          <div className="hp"><div className="hp-fill" style={{ width: `${hp * 100}%` }} /></div>
          <Sprite name={monster} size={monster === 'boss' ? 120 : 96} />
        </div>
      </div>

      <QuestionPanel
        key={entry.id}
        handleRef={panelRef}
        runner={runner}
        entry={entry}
        kid={kid}
        repo={repo}
        learner="prereader"
        display="inline"
        onAnswered={onAnswered}
        onResolved={next}
      />
    </div>
  );
}
