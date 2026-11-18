import { useCallback, useEffect, useRef, useState } from 'react';
import { HeroFigure } from '../../ui/HeroFigure';
import { learnerParams } from '../../engine/models';
import type { Feedback, SessionRunner } from '../../engine/session';
import { finishRun } from '../../ui/finishRun';
import { loadRunner } from '../../ui/runShared';
import { HoldButton } from '../../ui/early/HoldButton';
import { MONSTERS, Sprite, UiIcon } from '../../ui/sprites';
import { QuestionPanel } from '../QuestionPanel';
import type { GameModeProps } from './types';

/** The Dungeon run for readers: monsters in blocks of questions, a boss at the end. Questions come from QuestionPanel. */
export function DungeonMode({ repo, kid, onDone, onExit, onSynced }: GameModeProps) {
  const BLOCK = learnerParams('reader').blockSize;
  const runnerRef = useRef<SessionRunner | null>(null);
  const startedAt = useRef(Date.now());
  const finishing = useRef(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const [, setTick] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [hits, setHits] = useState(0);
  const [shake, setShake] = useState(false);

  const rerender = () => setTick((t) => t + 1);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

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

  const finish = useCallback(async () => {
    const r = runnerRef.current;
    if (!r || finishing.current) return;
    finishing.current = true;
    // Whatever the save does, the kid leaves the run.
    await finishRun({ repo, kid, runner: r, startedAt: startedAt.current, onSynced, onDone, onExit });
  }, [kid, repo, onDone, onExit, onSynced]);

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

  const onAnswered = useCallback((fb: Feedback) => {
    setFeedback(fb);
    if (fb.verdict === 'correct') {
      setHits((h) => h + 1);
    } else {
      setShake(true);
      timers.current.push(setTimeout(() => setShake(false), 450));
    }
  }, []);

  const onResolved = useCallback(
    (fb: Feedback | null) => {
      if (fb === null) rerender(); // a teach card was read
      else next();
    },
    [next],
  );

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
          <p>{kid.game.lastPlayedDay ? 'That is everything for today. Come back tomorrow for more.' : 'Nothing to practice yet. Ask a parent to turn on a math track.'}</p>
          <button type="button" className="btn" onClick={onExit}>Back</button>
        </div>
      </div>
    );
  }

  const monster =
    runner.position >= runner.length - BLOCK ? 'boss' : MONSTERS[Math.floor(runner.position / BLOCK) % MONSTERS.length]!;
  const progress = runner.progress();
  const hp = Math.max(0, 1 - hits / BLOCK);
  const panel = (
    <QuestionPanel
      key={entry.id}
      runner={runner}
      entry={entry}
      kid={kid}
      repo={repo}
      learner="reader"
      display="inline"
      onAnswered={onAnswered}
      onResolved={onResolved}
    />
  );

  if (entry.kind === 'teach') {
    return (
      <div className="screen run">
        <RunTop progress={progress} combo={0} onQuit={finish} />
        {panel}
      </div>
    );
  }

  return (
    <div className="screen run">
      <RunTop progress={progress} combo={feedback?.combo ?? 0} onQuit={finish} />
      <div className="arena">
        <HeroFigure game={kid.game} size={110} className="hero-sprite" strike={feedback?.verdict === 'correct'} cheer={feedback?.verdict === 'correct' && (feedback?.combo ?? 0) >= 5} />
        <div className={`monster ${shake ? 'shake' : ''} ${feedback?.verdict === 'correct' ? 'hit' : ''}`}>
          <div className="hp"><div className="hp-fill" style={{ width: `${hp * 100}%` }} /></div>
          <Sprite name={monster} size={monster === 'boss' ? 150 : 120} />
        </div>
      </div>
      {panel}
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
