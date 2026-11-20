import { useEffect, useRef, useState, type FocusEvent } from 'react';
import { FACT_GROUPS, SKILL_CARDS, factId } from '../../engine/content';
import { HEROES, levelFor } from '../../engine/game';
import { itemById } from '../../game/shop/catalog';
import { gemChangeLabel, gemDeltaText, gemHistory } from '../../engine/gemHistory';
import { PixelIcon, readTheme, writeTheme, type Theme } from '../pixel';
import { GEM_SPEEDS, earnedTodayOf, gemFullRateOf, gemSpeedOf, gemTier } from '../../engine/gems';
import { factBaseline, factThresholds } from '../../engine/grading';
import { LEVEL_LABELS, cardLevel, groupFloor, moduleCoverage, unlockedFactGroups, type Level } from '../../engine/mastery';
import { makeKid } from '../../engine/newKid';
import { RATE_MAX, VAULT_TERMS, maturesAtOf, owedOf, payoutOf, rateOf, vaultBalance, vaultOn, type VaultDeposit, type VaultTerm } from '../../game/vault';
import { PauseCard, PauseEveryone, SignOutAsk } from '../PauseControls';
import { AVATAR_COLORS, AVATAR_HEROES, avatarOf, bossTimerOf, bossTimerPreOn, learnerOf, modesOnOf, modulesOf, paceOf, shop2On, shopMathOn, soundsOf, voiceOf, withModule, type BossTimer, type CardMap, type Family, type Kid, type KidAvatar, type KidSettings, type Learner, type PurchaseLog, type SessionLog } from '../../engine/models';
import { MODULES, type ModuleId } from '../../engine/modules';
import { addId, subId } from '../../engine/modules/early';
import { median } from '../../engine/scheduler';
import { hashPin, type Repo } from '../../data/repo';
import { outbox, type ParkedRun } from '../../data/outbox';
import { dataMode, kidLockStatus, setKidPicturePin, setKidPin, unlockKidSignIn, type KidLockStatus } from '../../firebase';
import { PICTURE_LENGTH, pictureCode } from '../../data/deviceKids';
import { PicturePad, PictureIcon } from '../early/PicturePad';
import { reportFailure } from '../failures';
import { buildLabel, entryText, recentChanges } from '../../whatsnew';
import { AvatarPicker } from '../AvatarPicker';
import { InsightsPanel, clearInsightsCache } from '../InsightsPanel';
import { adventureLine, fillLine, isOldBuild, runLabel } from '../../engine/runLabel';
import { BUILD } from '../../version';
import { UiIcon } from '../sprites';
import { PinPad } from '../PinPad';
import { Sprite } from '../sprites';
import { Tour, TourOffer } from '../tour/Tour';

export { makeKid };

/** First run: set the parent PIN, then add the first kid. */
export function Setup({ repo, salt, onDone }: { repo: Repo; salt: string; onDone: (family: Family, kids: Kid[]) => void }) {
  const [step, setStep] = useState<'pin' | 'confirm' | 'kid'>('pin');
  const [first, setFirst] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [family, setFamily] = useState<Family | null>(null);

  if (step === 'pin')
    return <PinPad title="Make a Grown-up PIN" subtitle="4 digits. It keeps kids out of the Grown-ups area." onComplete={(p) => { setFirst(p); setErr(null); setStep('confirm'); }} />;
  if (step === 'confirm')
    return (
      <PinPad
        title="Type it again"
        error={err}
        onComplete={async (p) => {
          if (p !== first) {
            setErr('Those did not match. Start over.');
            setStep('pin');
            return;
          }
          const f: Family = { pinHash: await hashPin(salt, p), createdAt: Date.now() };
          try {
            await repo.saveFamily(f);
          } catch (e) {
            reportFailure('The PIN was not saved.', e);
            setStep('pin');
            return;
          }
          setFamily(f);
          setStep('kid');
        }}
      />
    );
  return (
    <div className="screen center">
      <div className="panel">
        <h2 className="pixel">Add a player</h2>
        <AddKidForm
          onAdd={async (name, type, avatar) => {
            const kid = makeKid(name, type, avatar);
            try {
              await repo.createKid(kid);
            } catch (e) {
              reportFailure('The player was not added.', e);
              return;
            }
            onDone(family!, [kid]);
          }}
        />
      </div>
    </div>
  );
}

/** The same normalization the kidSignIn function uses, so a clash shows up before the PIN step. */
export function nameKey(name: string): string {
  return name.trim().normalize('NFC').toLowerCase();
}

/** A new player starts with a hero and color that the other players do not have yet, so two kids never look the same. */
function freshAvatar(taken: KidAvatar[]): KidAvatar {
  const used = new Set(taken.map((a) => `${a.hero}/${a.color}`));
  for (let i = 0; i < AVATAR_HEROES.length * AVATAR_COLORS.length; i++) {
    const a = { hero: AVATAR_HEROES[i % AVATAR_HEROES.length]!, color: AVATAR_COLORS[Math.floor(i / AVATAR_HEROES.length) % AVATAR_COLORS.length]! };
    if (!used.has(`${a.hero}/${a.color}`) && !taken.some((t) => t.hero === a.hero)) return a;
  }
  return { hero: AVATAR_HEROES[taken.length % AVATAR_HEROES.length]!, color: AVATAR_COLORS[taken.length % AVATAR_COLORS.length]! };
}

function AddKidForm({ onAdd, existing = [], taken: takenAvatars = [] }: { onAdd: (name: string, type: Learner, avatar: KidAvatar) => Promise<void> | void; existing?: string[]; taken?: KidAvatar[] }) {
  const [avatar, setAvatar] = useState<KidAvatar>(() => freshAvatar(takenAvatars));
  const [name, setName] = useState('');
  const [type, setType] = useState<Learner>('reader');
  const taken = !!name.trim() && existing.some((n) => nameKey(n) === nameKey(name));
  return (
    <form
      className="add-kid"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim() || taken) return;
        await onAdd(name, type, avatar);
        setName('');
        setType('reader');
        setAvatar(freshAvatar([...takenAvatars, avatar]));
      }}
    >
      <label htmlFor="kid-name">Player name</label>
      <input id="kid-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoComplete="off" />
      <fieldset className="player-type">
        <legend>Player type</legend>
        <label className="check">
          <input type="radio" name="player-type" checked={type === 'reader'} onChange={() => setType('reader')} />
          Reader (7+)
        </label>
        <label className="check">
          <input type="radio" name="player-type" checked={type === 'prereader'} onChange={() => setType('prereader')} />
          Pre-reader (4–6)
        </label>
        <p className="muted">
          {type === 'prereader'
            ? 'Pictures, a voice and big buttons. Starts with addition within 10, 10 questions a run.'
            : 'Times tables, multi-digit multiplication and fractions, with a keypad.'}
        </p>
      </fieldset>
      <AvatarPicker value={avatar} onChange={setAvatar} />
      {taken ? <p className="error">Another player already has that name. Names are how kids sign in, so each needs its own.</p> : null}
      <button type="submit" className="btn" disabled={!name.trim() || taken}>Add player</button>
    </form>
  );
}

interface ParentProps {
  repo: Repo;
  salt: string;
  kids: Kid[];
  onKids: (kids: Kid[]) => void;
  onFamily: (f: Family) => void;
  onExit: () => void;
  onSignOut?: () => void;
  /** The grown-up came from a kid's break screen (a kid session cannot resume itself). Resume then asks to sign out, and Back is a sign-out. */
  afterPause?: boolean;
  /** A kid with no PIN was picked on this device: open on that kid's tab at the PIN panel, and hand the kid to the PIN pad once it is set. */
  setPinFor?: string;
  onKidPinSet?: (kidId: string) => void;
}

/** Rounds the server refused 3 times. They stay on this device, are never retried, and the parent sees their date and values. */
export function ParkedRounds({ kids }: { kids: Kid[] }) {
  const [parked, setParked] = useState<ParkedRun[]>([]);
  useEffect(() => {
    let live = true;
    outbox.listParked().then((p) => live && setParked(p)).catch((e) => console.error('Could not read the parked rounds.', e));
    return () => {
      live = false;
    };
  }, []);
  if (parked.length === 0) return null;
  const name = (id: string) => kids.find((k) => k.id === id)?.name ?? 'A player';
  return (
    <section className="panel" role="alert">
      <h2 className="pixel">{parked.length === 1 ? "1 round couldn't be saved" : `${parked.length} rounds couldn't be saved`}</h2>
      <ul>
        {parked.map((r) => (
          <li key={r.runId}>
            {name(r.kidId)}, {new Date(r.sessionLog?.endedAt ?? r.savedAt).toLocaleString()}: {r.gameDelta.xp ?? 0} XP, {r.gameDelta.gems ?? 0} gems
            {' '}
            <button type="button" className="btn btn-ghost btn-small" onClick={() => void outbox.removeParked(r.runId).then(() => setParked((p) => p.filter((x) => x.runId !== r.runId)))}>Dismiss</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ParentArea({ repo, salt, kids, onKids, onFamily, onExit, onSignOut, afterPause, setPinFor, onKidPinSet }: ParentProps) {
  const [askSignOut, setAskSignOut] = useState(false);
  // The light theme is each parent's own choice, kept on this device. It recolors the Grown-ups area only.
  const parentKey = repo.parentKey ?? 'local';
  const [theme, setTheme] = useState<Theme>(() => readTheme(parentKey));
  const resumed = afterPause && onSignOut ? () => setAskSignOut(true) : undefined;
  const [selected, setSelected] = useState<string | 'add'>(setPinFor && kids.some((k) => k.id === setPinFor) ? setPinFor : kids[0]?.id ?? 'add');
  const [changingPin, setChangingPin] = useState(false);
  const kid = kids.find((k) => k.id === selected);
  // The Grown-ups tour: offered once on this account (tourSeen on the family doc), replayed by the Tour button.
  const [tour, setTour] = useState<'off' | 'offer' | 'on'>('off');
  const tourButton = useRef<HTMLButtonElement>(null);
  const hasKids = kids.length > 0;
  useEffect(() => {
    if (afterPause || !hasKids) return;
    let live = true;
    void repo.getFamily().then((f) => {
      if (!live || !f || f.tourSeen) return;
      setTour('offer');
      void repo.markTourSeen().catch(() => undefined);
    }).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [repo, afterPause, hasKids]);
  const closeTour = () => {
    setTour('off');
    window.setTimeout(() => tourButton.current?.focus(), 0);
  };
  // The learning-progress reads are kept while the parent area is open and dropped when it closes.
  useEffect(() => clearInsightsCache, []);
  // Learning progress reads fresh when the area opens and whenever the kid tab changes, so a trip checkpointed since is never missing.
  useEffect(() => {
    clearInsightsCache();
  }, [selected]);

  if (changingPin)
    return (
      <PinPad
        title="New Grown-up PIN"
        onCancel={() => setChangingPin(false)}
        onComplete={async (p) => {
          const f: Family = { pinHash: await hashPin(salt, p), createdAt: Date.now() };
          try {
            await repo.saveFamily(f);
          } catch (e) {
            reportFailure('The new PIN was not saved.', e);
            return;
          }
          onFamily(f);
          setChangingPin(false);
        }}
      />
    );

  return (
    <div className="screen parent" data-theme={theme} onFocus={keepFocusVisible}>
      <header className="parent-head">
        <h1 className="pixel">Grown-ups area</h1>
        <div className="row">
          <button
            type="button"
            className="btn btn-ghost btn-small theme-toggle"
            data-testid="theme-toggle"
            aria-pressed={theme === 'light'}
            onClick={() => {
              const next: Theme = theme === 'light' ? 'dark' : 'light';
              setTheme(next);
              writeTheme(parentKey, next);
            }}
          >
            Light theme: {theme === 'light' ? 'On' : 'Off'}
          </button>
          <button type="button" ref={tourButton} className="btn btn-ghost btn-small tour-button" data-testid="tour-button" onClick={() => setTour('on')}><span className="tour-q" aria-hidden="true">?</span> Tour</button>
          <PauseEveryone repo={repo} kids={kids} {...(resumed ? { onResumed: resumed } : {})} />
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setChangingPin(true)}>Change PIN</button>
          {onSignOut ? <button type="button" className="btn btn-ghost btn-small" onClick={onSignOut}>Sign out</button> : null}
          {afterPause && onSignOut ? (
            <button type="button" className="btn btn-small" data-testid="back-to-kid-signin" onClick={onSignOut}>Back to kid sign-in</button>
          ) : (
            <button type="button" className="btn btn-small" onClick={onExit}>Back to game</button>
          )}
        </div>
      </header>
      {tour === 'offer' && kid ? <TourOffer onStart={() => setTour('on')} onDismiss={closeTour} /> : null}
      {tour === 'on' ? <Tour onClose={closeTour} /> : null}
      {askSignOut && onSignOut ? <SignOutAsk onYes={onSignOut} onStay={() => setAskSignOut(false)} /> : null}
      <LockBanner />
      <ParkedRounds kids={kids} />
      <nav className="tabs" aria-label="Players" data-tour="kids">
        {kids.map((k) => (
          <button key={k.id} type="button" className={`tab ${selected === k.id ? 'is-active' : ''}`} onClick={() => setSelected(k.id)}>
            {k.name}
          </button>
        ))}
        <button type="button" className={`tab ${selected === 'add' ? 'is-active' : ''}`} onClick={() => setSelected('add')}>+ Add player</button>
      </nav>
      {selected === 'add' || !kid ? (
        <section className="panel">
          <AddKidForm
            existing={kids.map((x) => x.name)}
            taken={kids.map(avatarOf)}
            onAdd={async (name, type, avatar) => {
              const k = makeKid(name, type, avatar);
              try {
                await repo.createKid(k);
              } catch (e) {
                reportFailure('The player was not added.', e);
                return;
              }
              onKids([...kids, k]);
              setSelected(k.id);
            }}
          />
        </section>
      ) : (
        <KidDetail
          key={kid.id}
          repo={repo}
          kid={kid}
          {...(resumed ? { onResumed: resumed } : {})}
          onSettings={async (settings) => {
            const save = async () => {
              await repo.saveKidSettings(kid.id, settings);
              // The stored pause is not the settings screen's to change: keep the copy this list already has.
              onKids(kids.map((x) => (x.id === kid.id ? { ...x, settings: x.settings.pause ? { ...settings, pause: x.settings.pause } : (({ pause: _p, ...rest }) => rest)(settings) } : x)));
            };
            try {
              await save();
            } catch (e) {
              reportFailure('The settings were not saved.', e, save);
            }
          }}
          onAvatar={async (avatar) => {
            const save = async () => {
              await repo.setKidFlags(kid.id, { avatar });
              onKids(kids.map((x) => (x.id === kid.id ? { ...x, avatar } : x)));
            };
            try {
              await save();
            } catch (e) {
              reportFailure('The picture was not saved.', e, save);
            }
          }}
          onAudio={async (audio) => {
            const save = async () => {
              await repo.setKidAudio(kid.id, audio);
              onKids(kids.map((x) => (x.id === kid.id ? { ...x, settings: { ...x.settings, ...audio } } : x)));
            };
            try {
              await save();
            } catch (e) {
              reportFailure('The sound setting was not saved.', e, save);
            }
          }}
          onLightningFloor={async (ms) => {
            const save = async () => {
              await repo.setKidLightningFloor(kid.id, ms);
              onKids(kids.map((x) => {
                if (x.id !== kid.id) return x;
                const { lightningFloorMs: _old, ...rest } = x.settings;
                return { ...x, settings: ms === null ? rest : { ...rest, lightningFloorMs: ms } };
              }));
            };
            try {
              await save();
            } catch (e) {
              reportFailure('The Lightning Round setting was not saved.', e, save);
            }
          }}
          onPinSet={async () => {
            const save = async () => {
              await repo.setKidFlags(kid.id, { hasPin: true });
              onKids(kids.map((x) => (x.id === kid.id ? { ...x, hasPin: true } : x)));
              if (kid.id === setPinFor) onKidPinSet?.(kid.id);
            };
            try {
              await save();
            } catch (e) {
              reportFailure('The PIN setting was not saved.', e, save);
            }
          }}
          focusPin={kid.id === setPinFor && !kid.hasPin}
          onPicturePinSet={() => onKids(kids.map((x) => (x.id === kid.id ? { ...x, hasPicturePin: true } : x)))}
          onDelete={async () => {
            try {
              await repo.deleteKid(kid.id);
            } catch (e) {
              reportFailure('The player was not removed.', e);
              return;
            }
            const rest = kids.filter((x) => x.id !== kid.id);
            onKids(rest);
            setSelected(rest[0]?.id ?? 'add');
          }}
        />
      )}
      <VersionFooter />
    </div>
  );
}

/** Which build is live, and what changed in the last 10 merged changes. */
function VersionFooter() {
  const [open, setOpen] = useState(false);
  return (
    <footer className="version-footer">
      <p className="muted version-line">{buildLabel()}</p>
      <button type="button" className="btn btn-small btn-ghost" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {open ? 'Hide what\u2019s new' : 'What\u2019s new'}
      </button>
      {open ? (
        <ol className="whatsnew" aria-label="What's new">
          {recentChanges().map((e) => <li key={e.pr}>{entryText(e)}</li>)}
        </ol>
      ) : null}
    </footer>
  );
}

/** Shows when kid PIN sign-in is locked after wrong PINs, with an Unlock button. */
function LockBanner() {
  const [status, setStatus] = useState<KidLockStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (dataMode !== 'firestore') return;
    let alive = true;
    kidLockStatus().then((s) => alive && setStatus(s)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  if (!status || (!status.locked && status.failures === 0)) return null;
  return (
    <section className="panel lock-banner">
      <p>
        {status.locked
          ? `Kid sign-in locked after ${status.failures} wrong PINs.`
          : `${status.failures} wrong kid PIN${status.failures === 1 ? '' : 's'} in the last hour. Sign-in is still open.`}
        {err ? <span className="error"> {err}</span> : null}
      </p>
      <button
        type="button"
        className="btn btn-small"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            await unlockKidSignIn();
            setStatus({ locked: false, failures: 0, lockedUntil: 0, lockedPlayers: [] });
          } catch (e) {
            setErr((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        Unlock
      </button>
    </section>
  );
}

/** Set or change one kid's sign-in PIN. The PIN goes to the setKidPin function and is never stored client-side. */
function KidPinPanel({ kid, onSet, focus }: { kid: Kid; onSet: () => Promise<void>; focus?: boolean }) {
  const [pin, setPin] = useState('');
  const panel = useRef<HTMLElement>(null);
  // Sent here to set this kid's first PIN: bring the panel into view and put the cursor in the PIN box.
  useEffect(() => {
    if (!focus) return;
    panel.current?.scrollIntoView?.({ block: 'center' });
    panel.current?.querySelector('input')?.focus();
  }, [focus]);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (dataMode !== 'firestore') return null;
  return (
    <section className="panel" ref={panel} data-testid="kid-pin-panel">
      <h2>Sign-in PIN for {kid.name}</h2>
      <p className="muted">
        {kid.name} signs in on any device with the name "{nameKey(kid.name)}" (capitalization does not matter) and this 4-digit PIN.
        {kid.hasPin ? ' A PIN is set.' : ' No PIN yet, so this player cannot sign in on their own.'} It must differ from the Grown-up PIN.
      </p>
      <form
        className="pin-set"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setMsg(null);
          try {
            await setKidPin(kid.id, pin);
            await onSet();
            setPin('');
            setMsg({ ok: true, text: 'PIN saved.' });
          } catch (err) {
            console.error('Setting the kid PIN failed.', err);
            setMsg({ ok: false, text: (err as Error).message });
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          {kid.hasPin ? 'New PIN' : 'PIN'}
          <input
            type="password"
            inputMode="numeric"
            pattern="[0-9]{4}"
            maxLength={4}
            autoComplete="off"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
          />
        </label>
        <button type="submit" className="btn btn-small" disabled={busy || pin.length !== 4}>{kid.hasPin ? 'Change PIN' : 'Set PIN'}</button>
        {msg ? <span className={msg.ok ? 'muted' : 'error'}>{msg.text}</span> : null}
      </form>
    </section>
  );
}

/**
 * Set or change one kid's picture PIN (4 of 9 animal pictures, repeats allowed). It goes to the setKidPicturePin function,
 * which hashes it like the digit PIN, and is never stored client-side. Off for a kid until it is set; the digit PIN keeps working.
 */
function KidPicturePinPanel({ kid, onSet }: { kid: Kid; onSet: () => void }) {
  const [code, setCode] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  if (dataMode !== 'firestore' || !kid.hasPin) return null;
  return (
    <section className="panel picture-set" data-testid="picture-pin-panel">
      <h2>Picture PIN for {kid.name}</h2>
      <p className="muted">
        For players who cannot read digits yet: {kid.name} taps the face on the Kid tab, then 4 pictures. {kid.hasPicturePin ? 'A picture PIN is set.' : 'No picture PIN yet.'} The digit PIN still works. Same wrong-try limits as the digit PIN.
      </p>
      {open ? (
        <>
          <PicturePad
            compact
            onComplete={(c) => {
              setCode(c);
              return true;
            }}
          />
          {code ? (
            <div className="row" aria-label="Chosen pictures">
              {[...code].map((ch, i) => <PictureIcon key={i} n={ch.charCodeAt(0) - 97} size={28} />)}
            </div>
          ) : null}
          <button
            type="button"
            className="btn btn-small"
            disabled={busy || !code || code.length !== PICTURE_LENGTH}
            onClick={async () => {
              if (!code) return;
              setBusy(true);
              setMsg(null);
              try {
                await setKidPicturePin(kid.id, pictureCode([...code].map((c) => c.charCodeAt(0) - 97)));
                onSet();
                setMsg({ ok: true, text: 'Picture PIN saved.' });
                setCode(null);
                setOpen(false);
              } catch (err) {
                console.error('Setting the picture PIN failed.', err);
                setMsg({ ok: false, text: (err as Error).message });
              } finally {
                setBusy(false);
              }
            }}
          >
            Save picture PIN
          </button>
        </>
      ) : (
        <button type="button" className="btn btn-small" onClick={() => setOpen(true)}>{kid.hasPicturePin ? 'Change picture PIN' : 'Set a picture PIN'}</button>
      )}
      {msg ? <span className={msg.ok ? 'muted' : 'error'}>{msg.text}</span> : null}
    </section>
  );
}

/** The iOS keyboard covers the lower half of the screen. After it opens, bring the focused field to the middle. */
function keepFocusVisible(e: FocusEvent<HTMLElement>) {
  const t = e.target;
  if (!(t instanceof HTMLInputElement || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement)) return;
  setTimeout(() => t.scrollIntoView?.({ block: 'center', behavior: 'smooth' }), 300);
}

/** Tapping a grid square shows its fact and level in a sheet at the bottom. Squares are too small to hold a tooltip. */
function useCellSheet() {
  const [tip, setTip] = useState<string | null>(null);
  const sheet = tip ? (
    <div className="hm-sheet" role="status">
      <span>{tip}</span>
      <button type="button" className="btn btn-small btn-ghost" onClick={() => setTip(null)}>Close</button>
    </div>
  ) : null;
  return { setTip, sheet };
}

const LEVEL_CLASS: Record<Level, string> = { 0: 'lv0', 1: 'lv1', 2: 'lv2', 3: 'lv3', 4: 'lv4' };

function fmtSec(ms: number): string {
  return Number.isFinite(ms) && ms > 0 ? `${(ms / 1000).toFixed(1)}s` : '–';
}

/**
 * The stored kid while the parent area shows them: a live subscription that starts on mount and stops on
 * unmount (tab switch or leaving the area), so the numbers follow a run finished on another device.
 */
function useLiveKid(repo: Repo, kid: Kid): Kid {
  const [live, setLive] = useState<Kid>(kid);
  useEffect(() => {
    setLive(kid);
    return repo.watchKid(kid.id, (k) => { if (k) setLive(k); }, { onError: (e) => reportFailure('Could not load the latest player data.', e) });
    // Subscribe once per kid. `kid` is only the first paint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, kid.id]);
  return live;
}

function GemHistory({ changes }: { changes: ReturnType<typeof gemHistory> }) {
  return (
    <section className="panel">
      <h2><PixelIcon name="gem" size={24} className="head-icon" /> Gem history</h2>
      {changes.length ? (
        <ul className="gem-history">
          {changes.map((c, i) => (
            <li key={`${c.kind}-${c.at}-${i}`} className={c.gems > 0 ? 'gain' : c.gems < 0 ? 'spend' : 'free'}>
              <span className="gem-delta">{gemDeltaText(c)}</span>
              <span>{gemChangeLabel(c, HEROES.find((h) => h.id === c.heroId)?.name ?? itemById(c.heroId ?? '')?.name ?? c.heroId)}</span>
              <span className="muted">{new Date(c.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">No gem changes yet.</p>
      )}
    </section>
  );
}

const fmtDay = (ms: number) => new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' });

/** Every deposit, newest first: amount, term, the bonus it earns, and where it stands. Dates come from the server's createdAt. */
function VaultHistory({ deposits }: { deposits: VaultDeposit[] }) {
  return (
    <section className="panel vault-history" aria-label="Vault history" data-testid="vault-history">
      <h2><PixelIcon name="vault" size={24} className="head-icon" /> Vault</h2>
      <ul>
        {deposits.map((d) => (
          <li key={d.id} data-status={d.status}>
            {fmtDay(d.createdAt)}: {d.amount} gems for {d.termDays as VaultTerm} days at {d.ratePer10} per 10 ·{' '}
            {d.status === 'active' ? `pays ${payoutOf({ ...d, status: 'collected' })} on ${fmtDay(maturesAtOf(d))}` : d.status === 'collected' ? `collected ${payoutOf(d)}` : d.status === 'collecting' ? `paying out ${payoutOf(d)}` : d.status === 'breaking' ? `broken early, paying back ${d.amount}` : `broken early, ${d.amount} returned`}
            {d.status !== 'active' && owedOf(d) > 0 ? ` (${owedOf(d)} still to pay)` : ''}
          </li>
        ))}
      </ul>
    </section>
  );
}

function KidDetail({ repo, kid: kidProp, onResumed, onSettings, onAvatar, onAudio, onLightningFloor, onPinSet, onPicturePinSet, onDelete, focusPin }: { focusPin?: boolean; repo: Repo; kid: Kid; onResumed?: () => void; onSettings: (s: KidSettings) => Promise<void>; onAvatar: (a: KidAvatar) => Promise<void>; onAudio: (a: { voice?: 'on' | 'off' | 'kid'; sounds?: 'on' | 'off' }) => Promise<void>; onLightningFloor: (ms: number | null) => Promise<void>; onPinSet: () => Promise<void>; onPicturePinSet: () => void; onDelete: () => Promise<void> }) {
  const [cards, setCards] = useState<CardMap | null>(null);
  const [sessions, setSessions] = useState<SessionLog[]>([]);
  // The live build: this bundle's, or a newer one a log shows. A log older than it came from a device still on an old bundle.
  const liveBuild = Math.max(BUILD, ...sessions.map((s) => s.build ?? 0));
  const [purchases, setPurchases] = useState<PurchaseLog[]>([]);
  const [deposits, setDeposits] = useState<VaultDeposit[]>([]);
  const [world, setWorld] = useState<unknown>(null);
  const kid = useLiveKid(repo, kidProp);
  const [settings, setSettings] = useState<KidSettings>(kid.settings);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let alive = true;
    // Reads exact subcollection paths only (cards, sessions, purchases under this kid), never a collection group.
    const purchasesRead = repo.listPurchases(kid.id, 20).catch((e) => {
      reportFailure('Could not load the gem history.', e);
      return [] as PurchaseLog[];
    });
    const vaultRead = repo.listVault(kid.id, 30).catch((e) => {
      reportFailure('Could not load the vault history.', e);
      return [] as VaultDeposit[];
    });
    const worldRead = repo.loadWorld(kid.id).catch(() => null); // world/main by its exact path; a missing or unreadable save is no Adventure line
    void Promise.all([repo.loadCards(kid.id), repo.listSessions(kid.id, 20), purchasesRead, vaultRead, worldRead]).then(([c, s, p, v, w]) => {
      if (!alive) return;
      setWorld(w);
      setCards(c);
      setSessions(s);
      setPurchases(p);
      setDeposits(v);
    });
    return () => {
      alive = false;
    };
    // A finished run or a purchase changes xp, gems or the hero list, so the logs are read again.
  }, [repo, kid.id, kid.game.xp, kid.game.gems, kid.game.heroes.length]);

  if (!cards) return <p className="pixel blink">Loading…</p>;

  const lv = levelFor(kid.game.xp);
  const heroName = HEROES.find((h) => h.id === kid.game.hero)?.name ?? kid.game.hero;
  const baseline = factBaseline(cards);
  const pace = paceOf(kid.settings);
  const fastBar = factThresholds(baseline, pace).fastMs;
  const groups = unlockedFactGroups(cards, kid.settings);
  const on = modulesOf(kid.settings);
  const learner = learnerOf(kid.settings);
  const earnedToday = earnedTodayOf(kid.game, Date.now());
  const tier = gemTier(earnedToday, learner, kid.settings);
  const factStates = Object.values(cards).filter((c) => c.id.startsWith('mul:'));
  const leeches = factStates.filter((c) => c.fsrs.lapses >= 3).sort((a, b) => b.fsrs.lapses - a.fsrs.lapses);
  const slow = factStates
    .filter((c) => c.recentMs.length >= 2 && median(c.recentMs) > fastBar)
    .sort((a, b) => median(b.recentMs) - median(a.recentMs));
  const week = sessions.filter((s) => s.startedAt > Date.now() - 7 * 86_400_000);
  const minutes = Math.round(week.reduce((t, s) => t + (s.endedAt - s.startedAt), 0) / 60_000);

  const setModule = (id: ModuleId, value: boolean) => setSettings((s) => withModule(s, id, value));
  /** 1 clears the key, so a kid with no floor keeps a settings map with no groupsUnlocked. */
  const setGroupFloor = (id: ModuleId, n: number) =>
    setSettings((s) => {
      const next = { ...(s.groupsUnlocked ?? {}) };
      if (n <= 1) delete next[id];
      else next[id] = n;
      const { groupsUnlocked: _drop, ...rest } = s;
      return Object.keys(next).length ? { ...rest, groupsUnlocked: next } : rest;
    });
  const bands = [...new Set(MODULES.filter((m) => m.status === 'live').map((m) => m.gradeBand))];

  return (
    <div className="detail">
      <PauseCard repo={repo} kid={kid} {...(onResumed ? { onResumed } : {})} />
      <section className="panel summary-row" data-tour="stats">
        <div className="stat stat-xp">
          <span className="stat-value">{kid.game.xp}</span>
          <span className="stat-label">xp</span>
          <div className="progress" role="img" aria-label={`${lv.into} of ${lv.span} xp to the next level`}><div className="progress-fill xp" style={{ width: `${(lv.into / lv.span) * 100}%` }} /></div>
        </div>
        <div className="stat stat-gems"><span className="stat-value">{kid.game.gems}</span><span className="stat-label">gems</span></div>
        {vaultOn(kid.settings) || deposits.length ? <div className="stat stat-vault" data-testid="parent-vault-balance"><span className="stat-value">{vaultBalance(deposits)}</span><span className="stat-label">in the vault</span></div> : null}
        <div className="stat stat-earned">
          <span className="stat-value">{earnedToday}</span>
          <span className="stat-label">earned today · {TIER_LABELS[tier]}</span>
        </div>
        <div className="stat stat-hero">
          <Sprite name={kid.game.hero} size={48} />
          <span className="stat-label">hero · {heroName} · {kid.game.heroes.length} of {HEROES.length}</span>
        </div>
        <div className="stat"><span className="stat-value">{lv.level}</span><span className="stat-label">level</span></div>
        <div className="stat"><span className="stat-value">{kid.game.streakDays}</span><span className="stat-label">day streak</span></div>
        <div className="stat"><span className="stat-value">{week.length}</span><span className="stat-label">runs this week</span></div>
        <div className="stat"><span className="stat-value">{minutes}</span><span className="stat-label">minutes this week</span></div>
        {on.facts || learner === 'reader' ? <div className="stat"><span className="stat-value">{fmtSec(baseline)}</span><span className="stat-label">typical fact time</span></div> : null}
      </section>

      <section className="panel">
        <AvatarPicker value={avatarOf(kid)} onChange={(a) => void onAvatar(a)} />
      </section>

      <InsightsPanel repo={repo} kid={kid} cards={cards} />

      <ul className="coverage" aria-label="Coverage">
        {MODULES.filter((m) => on[m.id] && m.groups).map((m) => {
          const c = moduleCoverage(m, cards);
          return (
            <li key={m.id} data-coverage={m.id}>
              {m.name}: seen {c.seen} of {c.total}
              {c.untouched.length ? ` · ${c.untouched.join(', ')} not started` : ''}
            </li>
          );
        })}
      </ul>

      <GemHistory changes={gemHistory(sessions, purchases, 20)} />
      {deposits.length ? <VaultHistory deposits={deposits} /> : null}

      {on.add10 ? (
        <section className="panel">
          <h2>Addition within 10</h2>
          <p className="muted">Each square is one sum. Rows and columns are the two numbers; the square shows the answer.</p>
          <TriangleGrid
            label="Addition within 10 mastery"
            cards={cards}
            baseline={baseline}
            pace={pace}
            cell={(a, b) => (a + b <= 10 ? { id: addId(a, b), shown: a + b, tip: `${a} + ${b} = ${a + b}` } : null)}
          />
          <GridLegend />
        </section>
      ) : null}

      {on.sub10 ? (
        <section className="panel">
          <h2>Subtraction within 10</h2>
          <p className="muted">Rows are the number you start with, columns the number taken away. The square shows what is left.</p>
          <TriangleGrid
            label="Subtraction within 10 mastery"
            cards={cards}
            baseline={baseline}
            pace={pace}
            cell={(a, b) => (b <= a ? { id: subId(a, b), shown: a - b, tip: `${a} − ${b} = ${a - b}` } : null)}
          />
          <GridLegend />
        </section>
      ) : null}

      {on.facts || learner === 'reader' ? (
      <section className="panel">
        <h2>Times tables</h2>
        <p className="muted">
          Open groups: {FACT_GROUPS.slice(0, groups).map((g) => g.label).join(' · ')}. "Fluent" means solid and answered in
          under {fmtSec(fastBar)}. Pace {pace}x.
        </p>
        <Heatmap cards={cards} baseline={baseline} pace={pace} />
        <GridLegend />
        <div className="two-col">
          <div>
            <h3>Keeps slipping</h3>
            {leeches.length ? leeches.slice(0, 10).map((c) => <span key={c.id} className="chip bad">{c.id.slice(4).replace('x', ' × ')} ({c.fsrs.lapses})</span>) : <p className="muted">None yet.</p>}
          </div>
          <div>
            <h3>Right but slow</h3>
            {slow.length ? slow.slice(0, 10).map((c) => <span key={c.id} className="chip">{c.id.slice(4).replace('x', ' × ')} {fmtSec(median(c.recentMs))}</span>) : <p className="muted">None yet.</p>}
          </div>
        </div>
      </section>
      ) : null}

      <section className="panel">
        <h2>Skills</h2>
        <table className="table">
          <thead>
            <tr><th scope="col">Skill</th><th scope="col">Status</th><th scope="col" className="num">Accuracy</th><th scope="col" className="num">Typical time</th></tr>
          </thead>
          <tbody>
            {SKILL_CARDS.filter((s) => on[s.track]).map((s) => {
              const c = cards[s.id];
              return (
                <tr key={s.id}>
                  <td data-label="Skill">{s.label}</td>
                  <td data-label="Status">{c ? LEVEL_LABELS[cardLevel(c, baseline, pace)] : 'Locked or not started'}</td>
                  <td className="num" data-label="Accuracy">{c?.attempts ? `${Math.round((c.correct / c.attempts) * 100)}%` : '–'}</td>
                  <td className="num" data-label="Typical time">{c ? fmtSec(median(c.recentMs)) : '–'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section className="panel" data-tour="runs">
        <h2>Recent runs</h2>
        {adventureLine(world as never) ? <p className="muted" data-testid="adventure-line">{adventureLine(world as never)}</p> : null}
        {sessions.length ? (
          <table className="table">
            <thead>
              <tr><th scope="col">When</th><th scope="col">Mode</th><th scope="col" className="num">Questions</th><th scope="col" className="num">Correct</th><th scope="col" className="num">Fast</th><th scope="col" className="num">New</th><th scope="col" className="num">Minutes</th></tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td data-label="When">{new Date(s.startedAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                  <td data-label="Mode" data-testid="run-mode" data-mode={runLabel(s, learnerOf(kid.settings)).mode}>
                    {runLabel(s, learnerOf(kid.settings)).mode === 'overworld' ? <UiIcon name="map" size={18} /> : runLabel(s, learnerOf(kid.settings)).mode === 'lightning' ? <UiIcon name="bolt" size={18} /> : null} {runLabel(s, learnerOf(kid.settings)).text}
                    {fillLine(s) ? <div className="muted" data-testid="run-counts">{fillLine(s)}</div> : null}
                    {isOldBuild(s, liveBuild) ? <div className="muted" data-testid="run-old-build">old app version</div> : null}
                  </td>
                  <td className="num" data-label="Questions">{s.graded}</td>
                  <td className="num" data-label="Correct">{s.graded ? `${Math.round((s.correct / s.graded) * 100)}%` : '–'}</td>
                  <td className="num" data-label="Fast">{s.fast}</td>
                  <td className="num" data-label="New">{s.newLearned}</td>
                  <td className="num" data-label="Minutes">{Math.max(1, Math.round((s.endedAt - s.startedAt) / 60_000))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No runs yet.</p>
        )}
      </section>

      <KidPinPanel kid={kid} onSet={onPinSet} focus={focusPin} />
      <KidPicturePinPanel kid={kid} onSet={onPicturePinSet} />

      <section className="panel settings" data-tour="settings">
        <h2>Settings for {kid.name}</h2>
        <label>
          Player type
          <select value={learnerOf(settings)} onChange={(e) => setSettings({ ...settings, learner: e.target.value as Learner })}>
            <option value="reader">Reader (7+)</option>
            <option value="prereader">Pre-reader (4–6)</option>
          </select>
          {learnerOf(settings) !== learnerOf(kid.settings) ? (
            <span className="muted learner-note">This only changes how the game looks. Progress is kept.</span>
          ) : null}
        </label>
        <fieldset>
          <legend>Modules</legend>
          {bands.map((band) => (
            <div key={band} className="module-band">
              <p className="muted band-label">Grade {band}</p>
              {MODULES.filter((m) => m.status === 'live' && m.gradeBand === band).map((m) => (
                <label key={m.id} className="check">
                  <input type="checkbox" checked={modulesOf(settings)[m.id]} onChange={(e) => setModule(m.id, e.target.checked)} />
                  {m.name}
                </label>
              ))}
            </div>
          ))}
        </fieldset>
        <label>
          Questions per run
          <select value={settings.sessionSize} onChange={(e) => setSettings({ ...settings, sessionSize: Number(e.target.value) })}>
            {[10, 15, 20, 30, 40, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>
          Most new cards per run
          <select value={settings.maxNew} onChange={(e) => setSettings({ ...settings, maxNew: Number(e.target.value) })}>
            {[3, 4, 5, 8, 12].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>
          Pace
          <select value={paceOf(settings)} onChange={(e) => setSettings({ ...settings, paceMultiplier: Number(e.target.value) })}>
            {PACE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={shop2On(settings)} onChange={(e) => setSettings({ ...settings, shop2: e.target.checked })} />
          Item shop (weapons, gear, pets, adventure items, camp)
          <span className="hint">Fixed prices, no random rewards. Turn it on after every device has updated.</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={shopMathOn(settings)} onChange={(e) => setSettings({ ...settings, shopMath: e.target.checked })} />
          Shop math card (needs the item shop)
          <span className="hint">A practice sum with the player's own gems and savings goal. A right first answer earns a 1-gem tip, up to 3 a day. It never changes the review schedule.</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={modesOnOf(settings).overworld}
            data-testid="setting-adventure"
            onChange={(e) => setSettings({ ...settings, modes: { ...settings.modes, overworld: e.target.checked } })}
          />
          Game modes: Adventure (walk a map, meet monsters and chests, fight a boss)
          <span className="hint">On by default. {learnerOf(settings) === 'prereader' ? 'Picture Run stays. Adventure adds a second button on Home; questions are the same picture questions with 3 big choices.' : 'The Dungeon run stays. Adventure adds a second choice on Home.'} Questions come from the same review schedule.</span>
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={modesOnOf(settings).lightning}
            data-testid="setting-lightning"
            onChange={(e) => setSettings({ ...settings, modes: { ...settings.modes, lightning: e.target.checked } })}
          />
          Lightning Round (taped-problem flashcards for the facts that need work)
          <span className="hint">On by default. About 3 minutes: the fact is shown and read, the player answers before a ring closes, and the ring gets shorter as a fact gets easy. About 1 new fact for every 9 known ones. Practice only: it never changes the review schedule or the daily limit. At most 3 gems a round.</span>
        </label>
        <details className="advanced" data-testid="lightning-advanced">
          <summary>Advanced: Lightning Round delay floor</summary>
          <label>
            Shortest reveal delay
            <select
              value={settings.lightningFloorMs ?? ''}
              data-testid="setting-lightning-floor"
              onChange={(e) => {
                const ms = e.target.value === '' ? null : Number(e.target.value);
                setSettings(ms === null ? (({ lightningFloorMs: _f, ...rest }) => rest)(settings) : { ...settings, lightningFloorMs: ms });
                void onLightningFloor(ms);
              }}
            >
              <option value="">Default ({learnerOf(settings) === 'prereader' ? '2' : '1'} s)</option>
              {[1000, 1500, 2000, 3000, 4000].map((n) => <option key={n} value={n}>{n / 1000} s</option>)}
            </select>
            <span className="hint">The shortest time a fact shows before its answer. Saves as soon as you pick. Pre-readers never go below 2 s.</span>
          </label>
        </details>
        <label>
          Voice
          <select
            value={voiceOf(settings)}
            data-testid="setting-voice"
            onChange={(e) => {
              const voice = e.target.value as 'on' | 'off' | 'kid';
              setSettings({ ...settings, voice });
              void onAudio({ voice });
            }}
          >
            <option value="kid">Player's choice (default)</option>
            <option value="on">On (always on; the mute button silences the chimes only)</option>
            <option value="off">Off (silent, the player cannot turn it on)</option>
          </select>
          <span className="hint">The voice that reads questions aloud. Saves as soon as you pick. Player's choice: the mute button in the top bar silences the voice and the chimes, and Hear it speaks a question once. On: the voice always speaks, and the mute button silences the chimes only. Off: no voice and no Hear it.</span>
        </label>
        <label>
          Sounds
          <select
            value={soundsOf(settings)}
            data-testid="setting-sounds"
            onChange={(e) => {
              const sounds = e.target.value as 'on' | 'off';
              setSettings({ ...settings, sounds });
              void onAudio({ sounds });
            }}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
          <span className="hint">Chimes, ticks and hit sounds. Saves as soon as you pick.</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={vaultOn(settings)} data-testid="setting-vault" onChange={(e) => setSettings({ ...settings, vault: { ...settings.vault, on: e.target.checked } })} />
          Gem vault (save gems for 3, 7 or 14 days for a bonus)
          <span className="hint">Fixed bonus, no random rewards. Breaking early returns every gem put in and loses the bonus. Deposits already made keep their rate and pay out even if you turn it off.</span>
        </label>
        {vaultOn(settings) ? (
          <div className="vault-rates" data-testid="vault-rates">
            {VAULT_TERMS.map((t) => (
              <label key={t}>
                {t} days: extra gems per 10 saved
                <select value={rateOf(settings, t)} data-testid={`vault-rate-${t}`} onChange={(e) => setSettings({ ...settings, vault: { ...settings.vault, [`d${t}`]: Number(e.target.value) } })}>
                  {Array.from({ length: RATE_MAX + 1 }, (_, n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            ))}
          </div>
        ) : null}
        <label>
          Gem speed
          <select value={gemSpeedOf(settings)} onChange={(e) => setSettings({ ...settings, gemSpeed: Number(e.target.value) })}>
            {GEM_SPEEDS.map((v) => <option key={v} value={v}>{GEM_SPEED_LABELS[v]}</option>)}
          </select>
        </label>
        <label>
          Full-rate gems per day
          <select value={gemFullRateOf(learner, settings)} onChange={(e) => setSettings({ ...settings, gemFullRate: Number(e.target.value) })}>
            {gemRateOptions(gemFullRateOf(learner, settings)).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <span className="hint">After {gemFullRateOf(learner, settings)} gems today, new gems come at half speed. After {2 * gemFullRateOf(learner, settings)}, a quarter. Runs always earn at least 1.</span>
        </label>
        <label>
          Boss timer
          <select value={bossTimerOf(settings)} data-testid="setting-boss-timer" onChange={(e) => setSettings({ ...settings, bossTimer: e.target.value as BossTimer })}>
            <option value="easier">Easier (50% more time)</option>
            <option value="normal">Normal</option>
            <option value="harder">Harder (25% less time)</option>
          </select>
          <span className="hint">How long a lair boss fight lasts. Answer 5 of 6 before time runs out to win. A lost fight sends the player back to the lair door.</span>
        </label>
        {learner === 'prereader' ? (
          <label className="check">
            <input type="checkbox" checked={bossTimerPreOn(settings)} data-testid="setting-boss-timer-pre" onChange={(e) => setSettings({ ...settings, bossTimerPre: e.target.checked })} />
            Boss timer for picture players
            <span className="hint">Off: the boss always ends in a win after 6 answers. On: twice the time, and 4 of 6 wins.</span>
          </label>
        ) : null}
        {MODULES.filter((m) => m.status === 'live' && m.groups && m.id !== 'facts' && modulesOf(settings)[m.id]).map((m) => (
          <label key={m.id}>
            Start {m.name} at
            <select value={groupFloor(m, settings)} onChange={(e) => setGroupFloor(m.id, Number(e.target.value))}>
              {m.groups!.map((g, i) => <option key={g.id} value={i + 1}>{`${i + 1} · ${g.label}`}</option>)}
            </select>
          </label>
        ))}
        <label>
          Start times tables at
          <select value={settings.factGroupsUnlocked} onChange={(e) => setSettings({ ...settings, factGroupsUnlocked: Number(e.target.value) })}>
            {FACT_GROUPS.map((g, i) => <option key={g.id} value={i + 1}>{i === 0 ? g.label : `Through ${g.label}`}</option>)}
          </select>
        </label>
        <div className="row">
          <button
            type="button"
            className="btn"
            disabled={saveState === 'saving'}
            onClick={async () => {
              const save = async () => {
                await onSettings(settings);
              };
              setSaveState('saving');
              try {
                await save();
                setSaveState('saved');
                setTimeout(() => setSaveState('idle'), 1500);
              } catch (e) {
                setSaveState('failed');
                reportFailure('Settings were not saved.', e, async () => {
                  await save();
                  setSaveState('saved');
                  setTimeout(() => setSaveState('idle'), 1500);
                });
              }
            }}
          >
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'failed' ? 'Not saved. Try again' : 'Save settings'}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            onClick={async () => {
              if (!confirmDelete) {
                setConfirmDelete(true);
                setTimeout(() => setConfirmDelete(false), 4000);
                return;
              }
              await onDelete();
            }}
          >
            {confirmDelete ? `Tap again to remove ${kid.name}` : 'Remove player'}
          </button>
        </div>
      </section>
    </div>
  );
}

const TIER_LABELS = { full: 'full rate', half: 'half rate', quarter: 'quarter rate' } as const;
const GEM_SPEED_LABELS: Record<(typeof GEM_SPEEDS)[number], string> = { 0.5: 'Slow (0.5x)', 1: 'Normal (1x)', 1.5: 'Fast (1.5x)' };
/** The full-rate choices, plus the stored value when it is not one of them. */
const gemRateOptions = (current: number) => [...new Set([5, 10, 15, 20, 25, 30, 40, 50, 75, 100, current])].sort((a, b) => a - b);

const PACE_OPTIONS = [
  { value: 3, label: '3x: most time (default)' },
  { value: 2.5, label: '2.5x: a bit less time' },
  { value: 2, label: '2x: more time' },
  { value: 1.5, label: '1.5x: a little extra time' },
  { value: 1, label: '1x: original speed bars (strictest)' },
];

function GridLegend() {
  return (
    <div className="legend" data-testid="grid-legend">
      <span className="legend-item"><span className="swatch leech" />Missed 3+ times</span>
      {([1, 2, 3, 4, 0] as Level[]).map((l) => (
        <span key={l} className="legend-item"><span className={`swatch ${LEVEL_CLASS[l]}`} />{LEVEL_LABELS[l]}</span>
      ))}
    </div>
  );
}

/** A 0 to 10 grid where only the squares that are real cards are drawn. */
function TriangleGrid({
  label,
  cards,
  baseline,
  pace,
  cell,
}: {
  label: string;
  cards: CardMap;
  baseline: number;
  pace: number;
  cell: (a: number, b: number) => { id: string; shown: number; tip: string } | null;
}) {
  const nums = Array.from({ length: 11 }, (_, i) => i);
  const { setTip, sheet } = useCellSheet();
  return (
    <>
    <div className="heatmap triangle" role="table" aria-label={label}>
      <div className="hm-row" role="row">
        <span className="hm-head" role="columnheader" />
        {nums.map((b) => <span key={b} className="hm-head" role="columnheader">{b}</span>)}
      </div>
      {nums.map((a) => (
        <div key={a} className="hm-row" role="row">
          <span className="hm-head" role="rowheader">{a}</span>
          {nums.map((b) => {
            const c = cell(a, b);
            if (!c) return <span key={b} className="hm-cell hm-gap" role="cell" aria-hidden="true" />;
            const st = cards[c.id];
            const lv = cardLevel(st, baseline, pace);
            const tip = `${c.tip}: ${LEVEL_LABELS[lv]}${st?.recentMs.length ? `, ${fmtSec(median(st.recentMs))}` : ''}${st?.fsrs.lapses ? `, missed ${st.fsrs.lapses}×` : ''}`;
            return (
              <span key={b} role="cell" title={tip} aria-label={tip} data-card={c.id} onClick={() => setTip(tip)} className={`hm-cell ${LEVEL_CLASS[lv]} ${st && st.fsrs.lapses >= 3 ? 'leech' : ''}`}>
                {c.shown}
              </span>
            );
          })}
        </div>
      ))}
    </div>
    {sheet}
    </>
  );
}

function Heatmap({ cards, baseline, pace }: { cards: CardMap; baseline: number; pace: number }) {
  const nums = Array.from({ length: 13 }, (_, i) => i);
  const { setTip, sheet } = useCellSheet();
  return (
    <>
    <div className="heatmap" role="table" aria-label="Times table mastery, 0 to 12">
      <div className="hm-row" role="row">
        <span className="hm-head" role="columnheader">×</span>
        {nums.map((b) => <span key={b} className="hm-head" role="columnheader">{b}</span>)}
      </div>
      {nums.map((a) => (
        <div key={a} className="hm-row" role="row">
          <span className="hm-head" role="rowheader">{a}</span>
          {nums.map((b) => {
            const c = cards[factId(a, b)];
            const lv = cardLevel(c, baseline, pace);
            const tip = `${a} × ${b} = ${a * b}: ${LEVEL_LABELS[lv]}${c?.recentMs.length ? `, ${fmtSec(median(c.recentMs))}` : ''}${c?.fsrs.lapses ? `, missed ${c.fsrs.lapses}×` : ''}`;
            return (
              <span key={b} role="cell" title={tip} aria-label={tip} onClick={() => setTip(tip)} className={`hm-cell ${LEVEL_CLASS[lv]} ${c && c.fsrs.lapses >= 3 ? 'leech' : ''}`}>
                {a * b}
              </span>
            );
          })}
        </div>
      ))}
    </div>
    {sheet}
    </>
  );
}
