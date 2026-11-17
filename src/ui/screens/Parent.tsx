import { useEffect, useState } from 'react';
import { FACT_GROUPS, SKILL_CARDS, factId, type Track } from '../../engine/content';
import { levelFor } from '../../engine/game';
import { factBaseline, factThresholds } from '../../engine/grading';
import { LEVEL_LABELS, cardLevel, unlockedFactGroups, type Level } from '../../engine/mastery';
import { DEFAULT_GAME, DEFAULT_SETTINGS, type CardMap, type Family, type Kid, type KidSettings, type SessionLog } from '../../engine/models';
import { median } from '../../engine/scheduler';
import { hashPin, newId, type Repo } from '../../data/repo';
import { PinPad } from '../PinPad';

export function makeKid(name: string): Kid {
  return { id: newId(), name: name.trim(), createdAt: Date.now(), settings: { ...DEFAULT_SETTINGS }, game: { ...DEFAULT_GAME } };
}

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
          await repo.saveFamily(f);
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
          onAdd={async (name) => {
            const kid = makeKid(name);
            await repo.saveKid(kid);
            onDone(family!, [kid]);
          }}
        />
      </div>
    </div>
  );
}

function AddKidForm({ onAdd }: { onAdd: (name: string) => Promise<void> | void }) {
  const [name, setName] = useState('');
  return (
    <form
      className="add-kid"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        await onAdd(name);
        setName('');
      }}
    >
      <label htmlFor="kid-name">Player name</label>
      <input id="kid-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={20} autoComplete="off" />
      <button type="submit" className="btn" disabled={!name.trim()}>Add player</button>
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
          await repo.saveFamily(f);
          onFamily(f);
          setChangingPin(false);
        }}
      />
    );

  return (
    <div className="screen parent">
      <header className="parent-head">
        <h1 className="pixel">Parent area</h1>
        <div className="row">
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setChangingPin(true)}>Change PIN</button>
          {onSignOut ? <button type="button" className="btn btn-ghost btn-small" onClick={onSignOut}>Sign out</button> : null}
          <button type="button" className="btn btn-small" onClick={onExit}>Back to game</button>
        </div>
      </header>
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
            onAdd={async (name) => {
              const k = makeKid(name);
              await repo.saveKid(k);
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
          onSave={async (k) => {
            await repo.saveKid(k);
            onKids(kids.map((x) => (x.id === k.id ? k : x)));
          }}
          onDelete={async () => {
            await repo.deleteKid(kid.id);
            const rest = kids.filter((x) => x.id !== kid.id);
            onKids(rest);
            setSelected(rest[0]?.id ?? 'add');
          }}
        />
      )}
    </div>
  );
}

const LEVEL_CLASS: Record<Level, string> = { 0: 'lv0', 1: 'lv1', 2: 'lv2', 3: 'lv3', 4: 'lv4' };

function fmtSec(ms: number): string {
  return Number.isFinite(ms) && ms > 0 ? `${(ms / 1000).toFixed(1)}s` : '–';
}

function KidDetail({ repo, kid, onSave, onDelete }: { repo: Repo; kid: Kid; onSave: (k: Kid) => Promise<void>; onDelete: () => Promise<void> }) {
  const [cards, setCards] = useState<CardMap | null>(null);
  const [sessions, setSessions] = useState<SessionLog[]>([]);
  const [settings, setSettings] = useState<KidSettings>(kid.settings);
  const [saved, setSaved] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    let alive = true;
    void Promise.all([repo.loadCards(kid.id), repo.listSessions(kid.id, 20)]).then(([c, s]) => {
      if (!alive) return;
      setCards(c);
      setSessions(s);
    });
    return () => {
      alive = false;
    };
  }, [repo, kid.id]);

  if (!cards) return <p className="pixel blink">Loading…</p>;

  const baseline = factBaseline(cards);
  const fastBar = factThresholds(baseline).fastMs;
  const groups = unlockedFactGroups(cards, kid.settings);
  const factStates = Object.values(cards).filter((c) => c.id.startsWith('mul:'));
  const leeches = factStates.filter((c) => c.fsrs.lapses >= 3).sort((a, b) => b.fsrs.lapses - a.fsrs.lapses);
  const slow = factStates
    .filter((c) => c.recentMs.length >= 2 && median(c.recentMs) > fastBar)
    .sort((a, b) => median(b.recentMs) - median(a.recentMs));
  const week = sessions.filter((s) => s.startedAt > Date.now() - 7 * 86_400_000);
  const minutes = Math.round(week.reduce((t, s) => t + (s.endedAt - s.startedAt), 0) / 60_000);

  const setTrack = (t: Track, on: boolean) => setSettings((s) => ({ ...s, tracks: { ...s.tracks, [t]: on } }));

  return (
    <div className="detail">
      <section className="panel summary-row">
        <div className="stat"><span className="stat-value">{levelFor(kid.game.xp).level}</span><span className="stat-label">level</span></div>
        <div className="stat"><span className="stat-value">{kid.game.streakDays}</span><span className="stat-label">day streak</span></div>
        <div className="stat"><span className="stat-value">{week.length}</span><span className="stat-label">runs this week</span></div>
        <div className="stat"><span className="stat-value">{minutes}</span><span className="stat-label">minutes this week</span></div>
        <div className="stat"><span className="stat-value">{fmtSec(baseline)}</span><span className="stat-label">typical fact time</span></div>
      </section>

      <section className="panel">
        <h2>Times tables</h2>
        <p className="muted">
          Open groups: {FACT_GROUPS.slice(0, groups).map((g) => g.label).join(' · ')}. "Fluent" means solid and answered in
          under {fmtSec(fastBar)}.
        </p>
        <Heatmap cards={cards} baseline={baseline} />
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

      <section className="panel">
        <h2>Skills</h2>
        <table className="table">
          <thead>
            <tr><th scope="col">Skill</th><th scope="col">Status</th><th scope="col" className="num">Accuracy</th><th scope="col" className="num">Typical time</th></tr>
          </thead>
          <tbody>
            {SKILL_CARDS.filter((s) => kid.settings.tracks[s.track]).map((s) => {
              const c = cards[s.id];
              return (
                <tr key={s.id}>
                  <td>{s.label}</td>
                  <td>{c ? LEVEL_LABELS[cardLevel(c, baseline)] : 'Locked or not started'}</td>
                  <td className="num">{c?.attempts ? `${Math.round((c.correct / c.attempts) * 100)}%` : '–'}</td>
                  <td className="num">{c ? fmtSec(median(c.recentMs)) : '–'}</td>
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
                  <td>{new Date(s.startedAt).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                  <td className="num">{s.graded}</td>
                  <td className="num">{s.graded ? `${Math.round((s.correct / s.graded) * 100)}%` : '–'}</td>
                  <td className="num">{s.fast}</td>
                  <td className="num">{s.newLearned}</td>
                  <td className="num">{Math.max(1, Math.round((s.endedAt - s.startedAt) / 60_000))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="muted">No runs yet.</p>
        )}
      </section>

      <section className="panel settings">
        <h2>Settings for {kid.name}</h2>
        <fieldset>
          <legend>Tracks</legend>
          {(['facts', 'multidigit', 'fractions'] as Track[]).map((t) => (
            <label key={t} className="check">
              <input type="checkbox" checked={settings.tracks[t]} onChange={(e) => setTrack(t, e.target.checked)} />
              {t === 'facts' ? 'Times tables' : t === 'multidigit' ? 'Multi-digit multiplication' : 'Fractions'}
            </label>
          ))}
        </fieldset>
        <label>
          Questions per run
          <select value={settings.sessionSize} onChange={(e) => setSettings({ ...settings, sessionSize: Number(e.target.value) })}>
            {[15, 20, 30, 40, 50].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label>
          Most new cards per run
          <select value={settings.maxNew} onChange={(e) => setSettings({ ...settings, maxNew: Number(e.target.value) })}>
            {[3, 5, 8, 12].map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
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
            onClick={async () => {
              await onSave({ ...kid, settings });
              setSaved(true);
              setTimeout(() => setSaved(false), 1500);
            }}
          >
            {saved ? 'Saved' : 'Save settings'}
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

function Heatmap({ cards, baseline }: { cards: CardMap; baseline: number }) {
  const nums = Array.from({ length: 13 }, (_, i) => i);
  return (
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
            const lv = cardLevel(c, baseline);
            const tip = `${a} × ${b} = ${a * b}: ${LEVEL_LABELS[lv]}${c?.recentMs.length ? `, ${fmtSec(median(c.recentMs))}` : ''}${c?.fsrs.lapses ? `, missed ${c.fsrs.lapses}×` : ''}`;
            return (
              <span key={b} role="cell" title={tip} aria-label={tip} className={`hm-cell ${LEVEL_CLASS[lv]} ${c && c.fsrs.lapses >= 3 ? 'leech' : ''}`}>
                {a * b}
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}
