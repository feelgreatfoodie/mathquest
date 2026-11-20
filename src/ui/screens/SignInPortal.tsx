import { useEffect, useRef, useState } from 'react';
import { MODULES } from '../../engine/modules';
import { makeKid, settingsFor } from '../../engine/newKid';
import { AVATAR_COLORS, AVATAR_HEROES, modulesOf, withModule, type DeviceRecord, type Family, type Kid, type KidAvatar, type KidSettings, type Learner } from '../../engine/models';
import type { Repo } from '../../data/repo';
import { pictureCode } from '../../data/deviceKids';
import { signin2Active } from '../../data/signin2';
import { checkUsername, dataMode, fetchSigninMode, kidLockStatus, setKidPicturePin, setKidPin, setUsername, suggestUsername, unlockKidSignIn, type KidLockStatus, type UsernameVerdict } from '../../firebase';
import { AvatarPicker, AVATAR_SWATCH } from '../AvatarPicker';
import { reportFailure } from '../failures';
import { PinPad } from '../PinPad';
import { PicturePad } from '../early/PicturePad';
import { Sprite } from '../sprites';

// L3, the grown-up's side of the two-door sign-in (behind config/app.signin2): the player wizard, the username editor for a player
// who already exists, the printable sign-in card, and the portal's Sign-in tab (school mode, devices, lockouts).
// Nothing here reads or writes XP, gems, cards, sessions or the world.

type Fresh = <T>(run: () => Promise<T>) => Promise<T>;

/** True once the first-screen switch (config/app.signin2) says this device uses the two-door sign-in. Off while unknown and on any failure. */
export function useSignin2(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (dataMode !== 'firestore') return;
    let live = true;
    fetchSigninMode().then(
      (m) => live && setOn(signin2Active(m)),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return on;
}

const SHAPE = /^[a-z0-9_]{3,20}$/;
export const cleanUsername = (s: string) => s.trim().toLowerCase();

export function verdictText(v: UsernameVerdict): string {
  if (v.free) return 'That username is free.';
  return v.reason === 'taken' ? 'That username is taken. Pick another one.' : v.reason === 'reserved' ? "That username isn't allowed. Pick another one." : 'A username is 3 to 20 letters, digits or _.';
}

const errText = (e: unknown, fallback: string) => ((e as { message?: string }).message?.trim() ? (e as { message: string }).message : fallback);

/**
 * The username box with the suggestion button and the free-or-taken check. `onFree` reports the name once the server said it is free,
 * and null again as soon as the text changes. The server checks again when the name is saved, so this answer is only a courtesy.
 */
function UsernameField({ value, onChange, kidId, onFree }: { value: string; onChange: (v: string) => void; kidId?: string; onFree: (name: string | null) => void }) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [verdict, setVerdict] = useState<{ name: string; v: UsernameVerdict } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const name = cleanUsername(value);
  const shown = verdict && verdict.name === name ? verdict.v : null;

  const check = async (n: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const v = await checkUsername(n, kidId);
      setVerdict({ name: n, v });
      onFree(v.free ? n : null);
    } catch (e) {
      setMsg(errText(e, 'Could not check the username. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="username-field" data-testid="username-field">
      <label htmlFor="player-username">Username</label>
      <input
        id="player-username"
        value={value}
        maxLength={20}
        autoComplete="off"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          onFree(null);
          setMsg(null);
        }}
      />
      <p className="muted">3 to 20 letters, digits or _. The player types it to sign in. It is not secret, and it is not their name.</p>
      <div className="row">
        <button
          type="button"
          className="btn btn-small btn-ghost"
          data-testid="username-suggest"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setMsg(null);
            try {
              setSuggestions(await suggestUsername());
            } catch (e) {
              setMsg(errText(e, 'Could not suggest a username. Try again.'));
            } finally {
              setBusy(false);
            }
          }}
        >
          Suggest a username
        </button>
        <button type="button" className="btn btn-small" data-testid="username-check" disabled={busy || !SHAPE.test(name)} onClick={() => void check(name)}>
          Check it
        </button>
      </div>
      {suggestions.length ? (
        <div className="row" role="group" aria-label="Suggested usernames">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              className="btn btn-small btn-ghost"
              data-testid="username-suggestion"
              onClick={() => {
                onChange(s);
                setVerdict({ name: s, v: { free: true } });
                onFree(s);
              }}
            >
              {s}
            </button>
          ))}
        </div>
      ) : null}
      {msg ? <p className="error" role="alert">{msg}</p> : shown ? <p className={shown.free ? 'muted' : 'error'} role="status" data-testid="username-verdict">{verdictText(shown)}</p> : null}
    </div>
  );
}

/** The sign-in card a grown-up prints: the username and the hero, never the passcode and never the player's name. */
export function SignInCard({ username, avatar }: { username: string; avatar: KidAvatar }) {
  return (
    <div className="signin-card" data-testid="signin-card" style={{ ['--kid-color' as string]: AVATAR_SWATCH[avatar.color] }}>
      <Sprite name={avatar.hero} size={96} />
      <p className="signin-card-label">Username</p>
      <p className="signin-card-username" data-testid="signin-card-username">{username}</p>
      <p className="signin-card-note">Your grown-up knows your passcode.</p>
    </div>
  );
}

function PrintCard({ username, avatar }: { username: string; avatar: KidAvatar }) {
  return (
    <>
      <SignInCard username={username} avatar={avatar} />
      <button type="button" className="btn btn-small" data-testid="card-print" onClick={() => window.print()}>Print the card</button>
    </>
  );
}

// ---------- the wizard ----------

type Step = 'welcome' | 'who' | 'username' | 'passcode' | 'start' | 'card';
type Pass = { kind: 'digits' | 'pictures'; sub: 'pick' | 'pics1' | 'pics2' | 'digits1' | 'digits2' };

const freshAvatar = (taken: KidAvatar[]): KidAvatar => {
  const used = new Set(taken.map((a) => `${a.hero}/${a.color}`));
  for (let i = 0; i < AVATAR_HEROES.length * AVATAR_COLORS.length; i++) {
    const a = { hero: AVATAR_HEROES[i % AVATAR_HEROES.length]!, color: AVATAR_COLORS[Math.floor(i / AVATAR_HEROES.length) % AVATAR_COLORS.length]! };
    if (!used.has(`${a.hero}/${a.color}`) && !taken.some((t) => t.hero === a.hero)) return a;
  }
  return { hero: AVATAR_HEROES[taken.length % AVATAR_HEROES.length]!, color: AVATAR_COLORS[taken.length % AVATAR_COLORS.length]! };
};

const normalizeName = (n: string) => n.trim().normalize('NFC').toLowerCase();

/**
 * Add a player, one question at a time (PDR 4.11): welcome, name and hero, username (with a suggestion), a passcode typed twice
 * (digits, or pictures), the starting point, then the printable card and "Add another". Teachers use it to add a class in a row.
 * The server wants a 4-digit PIN under every picture passcode (the picture is an extra way in), so a picture choice asks for both.
 * Steps run in an order that can be resumed: the player is created once, then the PIN, the pictures and the username each save
 * once. A failure leaves the saved ones saved and shows the step to fix.
 */
export function PlayerWizard({ repo, kids, fresh, onAdded, onOpen }: { repo: Repo; kids: Kid[]; fresh: Fresh; onAdded: (kid: Kid) => void; onOpen: (kidId: string) => void }) {
  const [step, setStep] = useState<Step>('welcome');
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState<KidAvatar>(() => freshAvatar(kids.map((k) => k.avatar).filter((a): a is KidAvatar => !!a)));
  const [typed, setTyped] = useState('');
  const [free, setFree] = useState<string | null>(null);
  const [pass, setPass] = useState<Pass>({ kind: 'digits', sub: 'pick' });
  const [digits, setDigits] = useState('');
  const [pics, setPics] = useState('');
  const [passErr, setPassErr] = useState<string | null>(null);
  const [learner, setLearner] = useState<Learner>('reader');
  const [settings, setSettings] = useState<KidSettings>(() => settingsFor('reader'));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Kid | null>(null);
  // What this run already saved, so a retry never repeats it.
  const saved = useRef<{ kid: Kid | null; pinned: boolean; pictured: boolean; named: string | null }>({ kid: null, pinned: false, pictured: false, named: null });

  const clash = !!name.trim() && kids.some((k) => normalizeName(k.name) === normalizeName(name));

  const reset = () => {
    saved.current = { kid: null, pinned: false, pictured: false, named: null };
    setStep('welcome');
    setName('');
    setTyped('');
    setFree(null);
    setPass({ kind: 'digits', sub: 'pick' });
    setDigits('');
    setPics('');
    setPassErr(null);
    setLearner('reader');
    setSettings(settingsFor('reader'));
    setErr(null);
    setDone(null);
    setAvatar(freshAvatar([...kids.map((k) => k.avatar).filter((a): a is KidAvatar => !!a), avatar]));
  };

  const finish = async () => {
    setBusy(true);
    setErr(null);
    const s = saved.current;
    try {
      if (!s.kid) {
        const kid = { ...makeKid(name, learner, avatar), settings };
        await repo.createKid(kid);
        s.kid = kid;
      }
      const kid = s.kid;
      if (!s.pinned) {
        try {
          await fresh(() => setKidPin(kid.id, digits));
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code === 'functions/already-exists') {
            // The display name is taken in another family. The half-made player has nothing in it: remove it and ask for another name.
            await repo.deleteKid(kid.id).catch(() => undefined);
            s.kid = null;
            setErr(errText(e, 'That name is taken.'));
            setStep('who');
            return;
          }
          if (code === 'functions/invalid-argument') {
            setPassErr(errText(e, 'Pick a different PIN.'));
            setDigits('');
            setPass({ kind: pass.kind, sub: pass.kind === 'pictures' ? 'pics1' : 'digits1' });
            setStep('passcode');
            return;
          }
          throw e;
        }
        s.pinned = true;
      }
      if (pass.kind === 'pictures' && !s.pictured) {
        await fresh(() => setKidPicturePin(kid.id, pictureCode([...pics].map((c) => c.charCodeAt(0) - 97))));
        s.pictured = true;
      }
      if (!s.named) {
        try {
          s.named = await fresh(() => setUsername(kid.id, typed));
        } catch (e) {
          const code = (e as { code?: string }).code;
          if (code === 'functions/already-exists' || code === 'functions/invalid-argument') {
            setFree(null);
            setErr(errText(e, 'Pick another username.'));
            setStep('username');
            return;
          }
          throw e;
        }
      }
      const final: Kid = { ...kid, hasPin: true, ...(s.pictured ? { hasPicturePin: true } : {}), username: s.named };
      onAdded(final);
      setDone(final);
      setStep('card');
    } catch (e) {
      console.error('The player wizard failed.', e);
      setErr(errText(e, 'The player was not saved. Try again.'));
    } finally {
      setBusy(false);
    }
  };

  const crumbs: Step[] = ['who', 'username', 'passcode', 'start'];
  const head = (title: string) => (
    <>
      <h2 className="pixel">{title}</h2>
      {crumbs.includes(step) ? <p className="muted" data-testid="wizard-progress">Step {crumbs.indexOf(step) + 1} of {crumbs.length}</p> : null}
    </>
  );

  if (step === 'welcome') {
    return (
      <div className="wizard" data-testid="wizard-welcome">
        {head('Add a player')}
        <p>
          A name and a hero, a username, a passcode and a printable sign-in card. It takes about a minute, and you can add one player after another.
        </p>
        <button type="button" className="btn btn-big" data-testid="wizard-start" onClick={() => setStep('who')}>Start</button>
      </div>
    );
  }

  if (step === 'who') {
    return (
      <div className="wizard add-kid" data-testid="wizard-who">
        {head('Who is playing?')}
        <label htmlFor="wizard-name">Player name</label>
        <input id="wizard-name" value={name} onChange={(e) => { setName(e.target.value); setErr(null); }} maxLength={20} autoComplete="off" />
        <p className="muted">Only you and the player see this name. It is never shown before sign-in.</p>
        <AvatarPicker value={avatar} onChange={setAvatar} />
        {clash ? <p className="error">Another player already has that name. Each player needs their own.</p> : null}
        {err ? <p className="error" role="alert">{err}</p> : null}
        <div className="row">
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setStep('welcome')}>Back</button>
          <button type="button" className="btn" data-testid="wizard-next" disabled={!name.trim() || clash} onClick={() => { setErr(null); setStep('username'); }}>Next</button>
        </div>
      </div>
    );
  }

  if (step === 'username') {
    return (
      <div className="wizard" data-testid="wizard-username">
        {head('Pick a username')}
        <UsernameField value={typed} onChange={setTyped} onFree={setFree} {...(saved.current.kid ? { kidId: saved.current.kid.id } : {})} />
        {err ? <p className="error" role="alert">{err}</p> : null}
        <div className="row">
          <button type="button" className="btn btn-ghost btn-small" onClick={() => setStep('who')}>Back</button>
          <button type="button" className="btn" data-testid="wizard-next" disabled={free === null || free !== cleanUsername(typed)} onClick={() => { setErr(null); setStep(saved.current.pinned ? 'start' : 'passcode'); }}>Next</button>
        </div>
      </div>
    );
  }

  if (step === 'passcode') {
    const back = () => setPass({ kind: pass.kind, sub: 'pick' });
    let body: React.ReactNode;
    if (pass.sub === 'pick') {
      body = (
        <>
          <p>Every player needs a passcode. They type it every time they open Math Quest.</p>
          <div className="row">
            <button type="button" className="btn" data-testid="pass-digits" onClick={() => { setPassErr(null); setPass({ kind: 'digits', sub: 'digits1' }); }}>4 digits</button>
            <button type="button" className="btn" data-testid="pass-pictures" onClick={() => { setPassErr(null); setPass({ kind: 'pictures', sub: 'pics1' }); }}>4 pictures</button>
          </div>
          <p className="muted">Pictures are for players who cannot read digits yet. They also get a spare 4-digit PIN that only you keep.</p>
        </>
      );
    } else if (pass.sub === 'pics1' || pass.sub === 'pics2') {
      const second = pass.sub === 'pics2';
      body = (
        <>
          <p>{second ? 'Tap the same 4 pictures again.' : 'Tap 4 pictures. The same one can repeat.'}</p>
          <PicturePad
            key={pass.sub}
            compact
            onCancel={back}
            onComplete={(c) => {
              if (!second) {
                setPics(c);
                setPassErr(null);
                setPass({ kind: 'pictures', sub: 'pics2' });
                return true;
              }
              if (c !== pics) {
                setPassErr('Those did not match. Start over.');
                setPics('');
                setPass({ kind: 'pictures', sub: 'pics1' });
                return false;
              }
              setPassErr(null);
              setPass({ kind: 'pictures', sub: 'digits1' });
              return true;
            }}
          />
        </>
      );
    } else {
      const second = pass.sub === 'digits2';
      const spare = pass.kind === 'pictures';
      body = (
        <PinPad
          key={pass.sub}
          embedded
          title={second ? 'Type it again' : spare ? 'A spare 4-digit PIN' : '4-digit passcode'}
          subtitle={second ? undefined : spare ? 'You keep this one. It works too.' : 'The player types it every time.'}
          error={passErr}
          onCancel={back}
          onComplete={(p) => {
            if (!second) {
              setDigits(p);
              setPassErr(null);
              setPass({ kind: pass.kind, sub: 'digits2' });
              return;
            }
            if (p !== digits) {
              setPassErr('Those did not match. Start over.');
              setDigits('');
              setPass({ kind: pass.kind, sub: 'digits1' });
              return false;
            }
            setPassErr(null);
            setStep('start');
          }}
        />
      );
    }
    return (
      <div className="wizard" data-testid="wizard-passcode">
        {head('Choose a passcode')}
        {passErr && pass.sub !== 'digits1' && pass.sub !== 'digits2' ? <p className="error" role="alert">{passErr}</p> : null}
        {body}
        {pass.sub === 'pick' ? <button type="button" className="btn btn-ghost btn-small" onClick={() => setStep('username')}>Back</button> : null}
      </div>
    );
  }

  if (step === 'start') {
    const on = modulesOf(settings);
    const bands = [...new Set(MODULES.filter((m) => m.status === 'live').map((m) => m.gradeBand))];
    return (
      <div className="wizard" data-testid="wizard-start-step">
        {head('Where do they start?')}
        <fieldset className="player-type">
          <legend>Player type</legend>
          <label className="check">
            <input type="radio" name="wizard-type" checked={learner === 'reader'} onChange={() => { setLearner('reader'); setSettings(settingsFor('reader')); }} />
            Reader (7+)
          </label>
          <label className="check">
            <input type="radio" name="wizard-type" checked={learner === 'prereader'} onChange={() => { setLearner('prereader'); setSettings(settingsFor('prereader')); }} />
            Pre-reader (4–6)
          </label>
        </fieldset>
        <fieldset className="wizard-modules">
          <legend>Modules</legend>
          {bands.map((band) => (
            <div key={band}>
              <p className="muted">{band}</p>
              {MODULES.filter((m) => m.status === 'live' && m.gradeBand === band).map((m) => (
                <label key={m.id} className="check">
                  <input type="checkbox" checked={on[m.id]} onChange={(e) => setSettings((x) => withModule(x, m.id, e.target.checked))} />
                  {m.name}
                </label>
              ))}
            </div>
          ))}
        </fieldset>
        {err ? <p className="error" role="alert">{err}</p> : null}
        <div className="row">
          <button type="button" className="btn btn-ghost btn-small" disabled={busy} onClick={() => setStep('passcode')}>Back</button>
          <button type="button" className="btn" data-testid="wizard-create" disabled={busy} onClick={() => void finish()}>{busy ? 'Saving…' : err ? 'Try again' : 'Add player'}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="wizard" data-testid="wizard-card">
      <h2 className="pixel">Sign-in card</h2>
      {done ? <PrintCard username={done.username ?? ''} avatar={done.avatar ?? avatar} /> : null}
      <p className="muted">Print it or write the username down. The passcode is not on the card.</p>
      <div className="row">
        <button type="button" className="btn" data-testid="wizard-another" onClick={reset}>Add another player</button>
        <button type="button" className="btn btn-ghost" data-testid="wizard-done" onClick={() => done && onOpen(done.id)}>Done</button>
      </div>
    </div>
  );
}

// ---------- a player who already exists ----------

/** Set or change the username of a player who already exists, with the same suggestion and check. This is how every existing player gets one before L4. */
export function KidUsernamePanel({ kid, fresh, onSet }: { kid: Kid; fresh: Fresh; onSet: (username: string) => void }) {
  const [typed, setTyped] = useState(kid.username ?? '');
  const [free, setFree] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const same = cleanUsername(typed) === (kid.username ?? '');
  return (
    <section className="panel" data-testid="kid-username-panel">
      <h2>Username for {kid.name}</h2>
      <p className="muted">
        {kid.username ? <>The username is <strong data-testid="kid-username-now">{kid.username}</strong>.</> : 'No username yet. Without one, this player still signs in with their name until you set one.'}
      </p>
      <UsernameField value={typed} onChange={setTyped} kidId={kid.id} onFree={setFree} />
      <button
        type="button"
        className="btn btn-small"
        data-testid="username-save"
        disabled={busy || same || free === null || free !== cleanUsername(typed)}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const saved = await fresh(() => setUsername(kid.id, typed));
            onSet(saved);
            setTyped(saved);
            setFree(null);
            setMsg({ ok: true, text: 'Username saved.' });
          } catch (e) {
            setMsg({ ok: false, text: errText(e, 'The username was not saved.') });
          } finally {
            setBusy(false);
          }
        }}
      >
        Save username
      </button>
      {msg ? <span className={msg.ok ? 'muted' : 'error'} role={msg.ok ? 'status' : 'alert'}> {msg.text}</span> : null}
    </section>
  );
}

// ---------- the Sign-in tab: school mode, devices, lockouts ----------

const minutesLeft = (until: number, now = Date.now()) => Math.max(1, Math.ceil((until - now) / 60_000));
const fmtWhen = (ms: number) => (ms ? new Date(ms).toLocaleDateString([], { month: 'short', day: 'numeric' }) : 'never');

export function SignInPortal({ repo, kids }: { repo: Repo; kids: Kid[] }) {
  return (
    <div className="signin-portal" data-testid="signin-portal">
      <SchoolModePanel repo={repo} />
      <LockoutsPanel kids={kids} />
      <DevicesPanel repo={repo} kids={kids} />
    </div>
  );
}

function SchoolModePanel({ repo }: { repo: Repo }) {
  const [family, setFamily] = useState<Family | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void repo.getFamily().then((f) => live && setFamily(f)).catch(() => undefined);
    return () => {
      live = false;
    };
  }, [repo]);
  const on = family?.schoolMode === true;
  return (
    <section className="panel" data-testid="school-mode-panel">
      <h2>School mode</h2>
      <p className="muted">When on, no player is remembered on a device. Nobody gets a picture tile, and Back on Home signs out to an empty username form. Use it on shared devices.</p>
      <label className="check">
        <input
          type="checkbox"
          data-testid="school-mode"
          checked={on}
          disabled={busy || !family}
          onChange={async (e) => {
            const next = e.target.checked;
            setBusy(true);
            try {
              await repo.setSchoolMode(next);
              setFamily((f) => (f ? { ...f, schoolMode: next } : f));
            } catch (err) {
              reportFailure('School mode was not saved.', err);
            } finally {
              setBusy(false);
            }
          }}
        />
        School mode: {on ? 'On' : 'Off'}
      </label>
    </section>
  );
}

function LockoutsPanel({ kids }: { kids: Kid[] }) {
  const [status, setStatus] = useState<KidLockStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => kidLockStatus().then((s) => { setStatus(s); setFailed(false); }, () => setFailed(true));
  useEffect(() => {
    void load();
  }, []);
  const nameOf = (id: string) => kids.find((k) => k.id === id)?.name ?? 'A player';
  const rows = status?.lockedKids ?? [];
  const locked = status?.locked === true;
  return (
    <section className="panel" data-testid="lockouts-panel">
      <h2>Lockouts</h2>
      {failed ? <p className="error" role="alert">Could not load the lockouts. Check the internet.</p> : null}
      {status && !locked ? <p className="muted" data-testid="lockouts-none">Nobody is locked out.</p> : null}
      {rows.length ? (
        <ul className="lockout-list">
          {rows.map((r) => (
            <li key={r.kidId} data-testid="lockout-row">{nameOf(r.kidId)} is locked for about {minutesLeft(r.until)} min after wrong passcodes.</li>
          ))}
        </ul>
      ) : null}
      {status && locked && !rows.length ? <p className="muted">Sign-in is paused for this family, or for a network or device. Unlock clears it.</p> : null}
      {status?.lockedDevices?.length ? <p className="muted" data-testid="lockout-devices">{status.lockedDevices.length} device{status.lockedDevices.length === 1 ? '' : 's'} locked for wrong tries.</p> : null}
      <div className="row">
        <button
          type="button"
          className="btn btn-small"
          data-testid="lockouts-unlock"
          disabled={busy || !locked}
          onClick={async () => {
            setBusy(true);
            try {
              await unlockKidSignIn();
              await load();
            } catch (e) {
              reportFailure('Unlock did not work.', e);
            } finally {
              setBusy(false);
            }
          }}
        >
          Unlock everyone
        </button>
        <button type="button" className="btn btn-small btn-ghost" onClick={() => void load()}>Refresh</button>
      </div>
    </section>
  );
}

function DevicesPanel({ repo, kids }: { repo: Repo; kids: Kid[] }) {
  const [devices, setDevices] = useState<DeviceRecord[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [ask, setAsk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = () => repo.listDevices().then((d) => { setDevices(d); setFailed(false); }, () => setFailed(true));
  useEffect(() => {
    void load();
  }, [repo]);
  const set = async (id: string, revoked: boolean) => {
    setBusy(true);
    try {
      await repo.setDeviceRevoked(id, revoked);
      setDevices((list) => (list ?? []).map((d) => (d.id === id ? { ...d, revoked } : d)));
      setAsk(null);
    } catch (e) {
      reportFailure(revoked ? 'The device was not forgotten.' : 'The device was not allowed again.', e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel" data-testid="devices-panel">
      <h2>Devices</h2>
      <p className="muted">Devices where a player signed in. Forget a device and its next sign-in fails until you allow it again.</p>
      {failed ? <p className="error" role="alert">Could not load the devices. Check the internet.</p> : null}
      {devices && !devices.length ? <p className="muted" data-testid="devices-none">No device has signed a player in yet.</p> : null}
      <ul className="device-list">
        {(devices ?? []).map((d) => (
          <li key={d.id} className="device-row" data-testid="device-row" data-revoked={d.revoked ? 'true' : 'false'}>
            <div>
              <strong data-testid="device-label">{d.label}</strong>
              {d.revoked ? <span className="error"> Forgotten</span> : null}
              <p className="muted">
                Last used {fmtWhen(d.lastSeen)}. {d.kids.length ? d.kids.map((id) => kids.find((k) => k.id === id)?.name ?? 'A player').join(', ') : 'No players'}
              </p>
            </div>
            {d.revoked ? (
              <button type="button" className="btn btn-small btn-ghost" data-testid="device-allow" disabled={busy} onClick={() => void set(d.id, false)}>Allow again</button>
            ) : ask === d.id ? (
              <span className="row">
                <button type="button" className="btn btn-small" data-testid="device-forget-yes" disabled={busy} onClick={() => void set(d.id, true)}>Forget it</button>
                <button type="button" className="btn btn-small btn-ghost" onClick={() => setAsk(null)}>Keep it</button>
              </span>
            ) : (
              <button type="button" className="btn btn-small btn-ghost" data-testid="device-forget" onClick={() => setAsk(d.id)}>Forget device</button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
