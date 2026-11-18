import { useEffect, useState, type FocusEvent } from 'react';
import { FACT_GROUPS, SKILL_CARDS, factId } from '../../engine/content';
import { HEROES, levelFor } from '../../engine/game';
import { itemById } from '../../game/shop/catalog';
import { gemHistory } from '../../engine/gemHistory';
import { GEM_SPEEDS, earnedTodayOf, gemFullRateOf, gemSpeedOf, gemTier } from '../../engine/gems';
import { factBaseline, factThresholds } from '../../engine/grading';
import { LEVEL_LABELS, cardLevel, groupFloor, moduleCoverage, unlockedFactGroups, type Level } from '../../engine/mastery';
import { makeKid } from '../../engine/newKid';
import { learnerOf, modulesOf, paceOf, shop2On, withModule, type CardMap, type Family, type Kid, type KidSettings, type Learner, type PurchaseLog, type SessionLog } from '../../engine/models';
import { MODULES, type ModuleId } from '../../engine/modules';
import { addId, subId } from '../../engine/modules/early';
import { median } from '../../engine/scheduler';
import { hashPin, type Repo } from '../../data/repo';
import { outbox, type ParkedRun } from '../../data/outbox';
import { dataMode, kidLockStatus, setKidPin, unlockKidSignIn, type KidLockStatus } from '../../firebase';
import { reportFailure } from '../failures';
import { buildLabel, entryText, recentChanges } from '../../whatsnew';
import { PinPad } from '../PinPad';
import { Sprite } from '../sprites';

export { makeKid };

/** First run: set the parent PIN, then add the first kid. */
export function Setup({ repo, salt, onDone }: { repo: Repo; salt: string; onDone: (family: Family, kids: Kid[]) => void }) {
  const [step, setStep] = useState<'pin' | 'confirm' | 'kid'>('pin');
  const [first, setFirst] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [family, setFamily] = useState<Family | null>(null);

  if (step === 'pin')
    return <PinPad title="Make a parent PIN" subtitle="4 digits. It keeps kids out of the parent area." onComplete={(p) => { setFirst(p); setErr(null); setStep('confirm'); }} />;
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
          onAdd={async (name, type) => {
            const kid = makeKid(name, type);
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

function AddKidForm({ onAdd, existing = [] }: { onAdd: (name: string, type: Learner) => Promise<void> | void; existing?: string[] }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<Learner>('reader');
  const taken = !!name.trim() && existing.some((n) => nameKey(n) === nameKey(name));
  return (
    <form
      className="add-kid"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim() || taken) return;
        await onAdd(name, type);
        setName('');
        setType('reader');
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
            {name(r.kidId)}, {new Date(r.sessionLog.endedAt ?? r.savedAt).toLocaleString()}: {r.gameDelta.xp ?? 0} XP, {r.gameDelta.gems ?? 0} gems
            {' '}
            <button type="button" className="btn btn-ghost btn-small" onClick={() => void outbox.removeParked(r.runId).then(() => setParked((p) => p.filter((x) => x.runId !== r.runId)))}>Dismiss</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ParentArea({ repo, salt, kids, onKids, onFamily, onExit, onSignOut }: ParentProps) {
  const [selected, setSelected] = useState<string | 'add'>(kids[0]?.id ?? 'add');
  const [changingPin, setChangingPin] = useState(false);
  const kid = kids.find((k) => k.id === selected);

  if (changingPin)
    return (
      <PinPad
        title="New parent PIN"
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
    <div className="screen parent" onFocus={keepFocusVisible}>
      <header className="parent-head">
        <h1 className="pixel">Parent area</h1>
        <div className="row">
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setChangingPin(true)}>Change PIN</button>
          {onSignOut ? <button type="button" className="btn btn-ghost btn-small" onClick={onSignOut}>Sign out</button> : null}
          <button type="button" className="btn btn-small" onClick={onExit}>Back to game</button>
        </div>
      </header>
      <LockBanner />
      <ParkedRounds kids={kids} />
      <nav className="tabs" aria-label="Players">
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
            onAdd={async (name, type) => {
              const k = makeKid(name, type);
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
          onSettings={async (settings) => {
            const save = async () => {
              await repo.saveKidSettings(kid.id, settings);
              onKids(kids.map((x) => (x.id === kid.id ? { ...x, settings } : x)));
            };
            try {
              await save();
            } catch (e) {
              reportFailure('The settings were not saved.', e, save);
            }
          }}
          onPinSet={async () => {
            const save = async () => {
              await repo.setKidFlags(kid.id, { hasPin: true });
              onKids(kids.map((x) => (x.id === kid.id ? { ...x, hasPin: true } : x)));
            };
            try {
              await save();
            } catch (e) {
              reportFailure('The PIN setting was not saved.', e, save);
            }
          }}
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
function KidPinPanel({ kid, onSet }: { kid: Kid; onSet: () => Promise<void> }) {
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (dataMode !== 'firestore') return null;
  return (
    <section className="panel">
      <h2>Sign-in PIN for {kid.name}</h2>
      <p className="muted">
        {kid.name} signs in on any device with the name "{nameKey(kid.name)}" (capitalization does not matter) and this 4-digit PIN.
        {kid.hasPin ? ' A PIN is set.' : ' No PIN yet, so this player cannot sign in on their own.'} It must differ from the parent PIN.
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

function signed(n: number): string {
  return `${n > 0 ? '+' : '−'}${Math.abs(n)}`;
}

function GemHistory({ changes }: { changes: ReturnType<typeof gemHistory> }) {
  return (
    <section className="panel">
      <h2>Gem history</h2>
      {changes.length ? (
        <ul className="gem-history">
          {changes.map((c, i) => (
            <li key={`${c.kind}-${c.at}-${i}`} className={c.gems > 0 ? 'gain' : 'spend'}>
              <span className="gem-delta">{signed(c.gems)}</span>
              <span>{c.kind === 'run' ? 'Quest finished' : `Bought ${HEROES.find((h) => h.id === c.heroId)?.name ?? itemById(c.heroId ?? '')?.name ?? c.heroId}`}</span>
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

function KidDetail({ repo, kid: kidProp, onSettings, onPinSet, onDelete }: { repo: Repo; kid: Kid; onSettings: (s: KidSettings) => Promise<void>; onPinSet: () => Promise<void>; onDelete: () => Promise<void> }) {
  const [cards, setCards] = useState<CardMap | null>(null);
  const [sessions, setSessions] = useState<SessionLog[]>([]);
  const [purchases, setPurchases] = useState<PurchaseLog[]>([]);
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
    void Promise.all([repo.loadCards(kid.id), repo.listSessions(kid.id, 20), purchasesRead]).then(([c, s, p]) => {
      if (!alive) return;
      setCards(c);
      setSessions(s);
      setPurchases(p);
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
      <section className="panel summary-row">
        <div className="stat stat-xp">
          <span className="stat-value">{kid.game.xp}</span>
          <span className="stat-label">xp</span>
          <div className="progress" role="img" aria-label={`${lv.into} of ${lv.span} xp to the next level`}><div className="progress-fill xp" style={{ width: `${(lv.into / lv.span) * 100}%` }} /></div>
        </div>
        <div className="stat stat-gems"><span className="stat-value">{kid.game.gems}</span><span className="stat-label">gems</span></div>
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
        <div className="legend">
          {([0, 1, 2, 3, 4] as Level[]).map((l) => (
            <span key={l} className="legend-item"><span className={`swatch ${LEVEL_CLASS[l]}`} />{LEVEL_LABELS[l]}</span>
          ))}
          <span className="legend-item"><span className="swatch lv1 leech" />Missed 3+ times</span>
        </div>
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

      <section className="panel">
        <h2>Recent runs</h2>
        {sessions.length ? (
          <table className="table">
            <thead>
              <tr><th scope="col">When</th><th scope="col" className="num">Questions</th><th scope="col" className="num">Correct</th><th scope="col" className="num">Fast</th><th scope="col" className="num">New</th><th scope="col" className="num">Minutes</th></tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id}>
                  <td data-label="When">{new Date(s.startedAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
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

      <KidPinPanel kid={kid} onSet={onPinSet} />

      <section className="panel settings">
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
  { value: 2, label: '2x: more time' },
  { value: 1.5, label: '1.5x: a little extra time' },
  { value: 1, label: '1x: original speed bars (strictest)' },
];

function GridLegend() {
  return (
    <div className="legend">
      {([0, 1, 2, 3, 4] as Level[]).map((l) => (
        <span key={l} className="legend-item"><span className={`swatch ${LEVEL_CLASS[l]}`} />{LEVEL_LABELS[l]}</span>
      ))}
      <span className="legend-item"><span className="swatch lv1 leech" />Missed 3+ times</span>
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
