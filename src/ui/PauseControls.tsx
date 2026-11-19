import { useEffect, useState } from 'react';
import type { Repo } from '../data/repo';
import type { Kid } from '../engine/models';
import { isPaused, msLeft, pauseOf, untilFor, type PauseChoice } from '../engine/pause';
import { reportFailure } from './failures';
import { serverClock, syncServerClock } from './pauseClock';

const CHOICES: { id: Exclude<PauseChoice, 'resume'>; label: string }[] = [
  { id: 'open', label: 'Until I resume' },
  { id: 15, label: '15 minutes' },
  { id: 30, label: '30 minutes' },
  { id: 60, label: '60 minutes' },
  { id: 'morning', label: 'Until tomorrow, 7 AM' },
];

/** The server clock for this device, or the device clock when no estimate exists yet. */
function parentNow(): number {
  return serverClock.now() ?? Date.now();
}

/** Writes the pause. True when it was written (a failed write shows its own toast and returns false). */
async function writePause(repo: Repo, ids: string[], choice: PauseChoice): Promise<boolean> {
  await syncServerClock();
  const run = async () => {
    if (choice === 'resume') return repo.setKidPause(ids, null);
    const until = untilFor(choice, Date.now(), serverClock.now());
    return repo.setKidPause(ids, until === undefined ? {} : { until });
  };
  try {
    await run();
    return true;
  } catch (e) {
    reportFailure(choice === 'resume' ? 'Could not resume.' : 'Could not pause.', e, run);
    return false;
  }
}

/**
 * Shown after a grown-up resumes play from a kid's break screen. The parent session must not carry on into kid play: the
 * answer defaults to yes, and the kid then signs in again with their own name and PIN.
 */
export function SignOutAsk({ onYes, onStay }: { onYes: () => void; onStay: () => void }) {
  return (
    <section className="panel" role="dialog" aria-label="Sign out grown-up?" data-testid="signout-ask">
      <h2 className="pixel">Sign out grown-up?</h2>
      <p>Play is back on. Sign out so the player can sign in again with their own name and PIN.</p>
      <div className="row">
        <button type="button" className="btn" autoFocus data-testid="signout-yes" onClick={onYes}>Yes, sign out</button>
        <button type="button" className="btn btn-ghost" data-testid="signout-stay" onClick={onStay}>Stay signed in</button>
      </div>
    </section>
  );
}

function ChoiceList({ onPick, onCancel, withResume }: { onPick: (c: PauseChoice) => void; onCancel: () => void; withResume?: boolean }) {
  return (
    <div className="pause-choices" role="group" aria-label="Pause for how long?">
      {CHOICES.map((c) => (
        <button key={String(c.id)} type="button" className="btn btn-small" onClick={() => onPick(c.id)}>{c.label}</button>
      ))}
      {withResume ? <button type="button" className="btn btn-small btn-ghost" onClick={() => onPick('resume')}>Resume everyone</button> : null}
      <button type="button" className="btn btn-small btn-ghost" onClick={onCancel}>Cancel</button>
    </div>
  );
}

/** "Pause everyone" in the parent header: one batch, every kid, a field-level `settings.pause` write. */
export function PauseEveryone({ repo, kids, onResumed }: { repo: Repo; kids: Kid[]; onResumed?: () => void }) {
  const [open, setOpen] = useState(false);
  if (!kids.length) return null;
  return (
    <>
      <button type="button" className="btn btn-small" data-testid="pause-everyone" onClick={() => setOpen((o) => !o)}>Pause everyone</button>
      {open ? (
        <ChoiceList
          withResume
          onCancel={() => setOpen(false)}
          onPick={(c) => {
            setOpen(false);
            void writePause(repo, kids.map((k) => k.id), c).then((ok) => ok && c === 'resume' && onResumed?.());
          }}
        />
      ) : null}
    </>
  );
}

/** One kid's pause: a Pause button with the choices, or a Paused badge with the time left and Resume. */
export function PauseCard({ repo, kid, onResumed }: { repo: Repo; kid: Kid; onResumed?: () => void }) {
  const [open, setOpen] = useState(false);
  const [, setTick] = useState(0);
  const pause = pauseOf(kid.settings);
  useEffect(() => {
    void syncServerClock().then(() => setTick((t) => t + 1));
  }, [repo]);
  // The time left moves; redraw every 15 seconds while a timed pause shows.
  useEffect(() => {
    if (!pause || pause.until === undefined) return;
    const id = setInterval(() => setTick((t) => t + 1), 15_000);
    return () => clearInterval(id);
  }, [pause?.until, pause?.setAt]);
  const now = parentNow();
  const on = isPaused(pause, now);
  const left = msLeft(pause, now);
  return (
    <section className="panel pause-card" data-testid="pause-card">
      {on ? (
        <div className="row">
          <span className="badge badge-paused" data-testid="paused-badge">
            Paused{left !== null ? ` · ${Math.max(1, Math.ceil(left / 60_000))} min left` : ' · until you resume'}
          </span>
          <button type="button" className="btn btn-small" data-testid="resume-kid" onClick={() => void writePause(repo, [kid.id], 'resume').then((ok) => ok && onResumed?.())}>Resume</button>
        </div>
      ) : open ? (
        <ChoiceList
          onCancel={() => setOpen(false)}
          onPick={(c) => {
            setOpen(false);
            void writePause(repo, [kid.id], c);
          }}
        />
      ) : (
        <button type="button" className="btn btn-small" data-testid="pause-kid" onClick={() => setOpen(true)}>Pause {kid.name}</button>
      )}
    </section>
  );
}
