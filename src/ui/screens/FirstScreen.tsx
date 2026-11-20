import { useEffect, useRef, useState } from 'react';
import { AVATAR_SWATCH } from '../AvatarPicker';
import { PinPad } from '../PinPad';
import { PicturePad } from '../early/PicturePad';
import { Sprite } from '../sprites';
import { PixelButton } from '../pixel';
import type { DeviceTile, PasscodeKind } from '../../data/deviceTiles';
import { Intro } from './Intro';
import { TitleScreen } from './TitleScreen';

/**
 * The two-door first screen (config/app.signin2). Nobody who is signed out sees a player's name here: the doors say "I'm a
 * player" and "Grown-ups", the tiles are hero pictures with no text, and the pad's title never names the player. A tile skips
 * typing the username and never the passcode. The username form asks passcodeKind which pad to show, then the pad signs in.
 */
export interface FirstScreenProps {
  /** 'grownups' opens the Google sign-in directly (the grown-up sign-in after a break screen). */
  initialView?: 'doors' | 'grownups';
  error: string | null;
  tiles: readonly DeviceTile[];
  /** Which pad this username types on. Rejects when the server cannot be reached. */
  kindOf: (username: string) => Promise<PasscodeKind>;
  /** Resolve to false when the passcode was refused, so the slots shake and clear. */
  onKidSubmit: (username: string, code: string, kind: PasscodeKind) => void | boolean | Promise<void | boolean>;
  onParentSignIn: () => void;
  /** Called on every move between views, so the caller clears an old error. */
  onViewChange?: () => void;
}

type View =
  | { name: 'doors' }
  | { name: 'username' }
  | { name: 'pad'; username: string; kind: PasscodeKind; from: 'doors' | 'username' }
  | { name: 'grownups' }
  | { name: 'intro' };

const USERNAME_OK = /^[A-Za-z0-9_]{3,20}$/;

export function FirstScreen({ initialView = 'doors', error, tiles, kindOf, onKidSubmit, onParentSignIn, onViewChange }: FirstScreenProps) {
  const [view, setViewRaw] = useState<View>(() => (initialView === 'grownups' ? { name: 'grownups' } : { name: 'doors' }));
  const setView = (v: View) => {
    onViewChange?.();
    setViewRaw(v);
  };
  const [typed, setTyped] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (view.name === 'username') inputRef.current?.focus();
  }, [view.name]);

  /** Asks the server which pad, then opens it. A failure leaves the screen as it was, with a plain line. */
  const openPad = async (username: string, from: 'doors' | 'username') => {
    setBusy(true);
    setNote(null);
    try {
      const kind = await kindOf(username);
      setView({ name: 'pad', username, kind, from });
    } catch (e) {
      const code = (e as { code?: string }).code;
      setNote(code === 'functions/resource-exhausted' ? (e as Error).message : 'Could not reach Math Quest. Check the internet and try again.');
    } finally {
      setBusy(false);
    }
  };

  const goBack = () => {
    setNote(null);
    setView({ name: 'doors' });
  };
  const back = (
    <button type="button" className="btn btn-ghost btn-small" data-testid="first-back" onClick={goBack}>
      Back
    </button>
  );

  let body: React.ReactNode;
  if (view.name === 'intro') {
    return (
      <TitleScreen>
        <Intro onStart={() => setView({ name: 'grownups' })} onBack={goBack} />
      </TitleScreen>
    );
  }
  if (view.name === 'doors') {
    body = (
      <div className="screen center title-menu first-doors" data-testid="first-doors">
        <PixelButton tone="gold" className="title-play" data-testid="door-player" onClick={() => { setTyped(''); setNote(null); setView({ name: 'username' }); }}>
          <span className="pixel-label">I'M A PLAYER</span>
        </PixelButton>
        <PixelButton tone="neutral" className="title-grownups" data-testid="door-grownups" onClick={() => setView({ name: 'grownups' })}>
          <span className="pixel-label">GROWN-UPS</span>
        </PixelButton>
        {tiles.length > 0 ? (
          <div className="tile-row" data-testid="tile-row" role="group" aria-label="Players on this device">
            {tiles.map((t, i) => (
              <button
                key={t.username}
                type="button"
                className="tile-btn"
                data-testid="tile"
                data-hero={t.hero}
                data-kind={t.kind}
                aria-label={`Player ${i + 1}, the ${t.hero}`}
                disabled={busy}
                style={{ ['--kid-color' as string]: AVATAR_SWATCH[t.color] }}
                onClick={() => void openPad(t.username, 'doors')}
              >
                <Sprite name={t.hero} size={88} />
              </button>
            ))}
          </div>
        ) : null}
        {note ? <p className="error" role="alert">{note}</p> : null}
        <button type="button" className="title-link" data-testid="title-intro" onClick={() => setView({ name: 'intro' })}>What is Math Quest?</button>
      </div>
    );
  } else if (view.name === 'username') {
    const ok = USERNAME_OK.test(typed.trim());
    body = (
      <div className="screen center">
        <form
          className="panel pin-panel first-username"
          data-testid="first-username"
          onSubmit={(e) => {
            e.preventDefault();
            if (ok && !busy) void openPad(typed.trim().toLowerCase(), 'username');
          }}
        >
          <h2 className="pixel">Your username</h2>
          <label htmlFor="first-username-input" className="visually-hidden">Username</label>
          <input
            id="first-username-input"
            ref={inputRef}
            className="kid-name-input"
            value={typed}
            onChange={(e) => { setTyped(e.target.value); setNote(null); }}
            placeholder="username"
            maxLength={20}
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
          />
          {note ? <p className="error" role="alert">{note}</p> : <p className="muted">Letters, numbers and _ only.</p>}
          <button type="submit" className="btn btn-big" data-testid="username-next" disabled={!ok || busy}>
            {busy ? 'Checking…' : 'Next'}
          </button>
          {back}
        </form>
      </div>
    );
  } else if (view.name === 'pad') {
    const { username, kind, from } = view;
    const cancel = () => setView({ name: from === 'username' ? 'username' : 'doors' });
    body = (
      <div className="screen center">
        <div className="panel pin-panel first-pad" data-testid="first-pad" data-kind={kind}>
          {kind === 'pictures' ? (
            <>
              <PicturePad onComplete={(code) => onKidSubmit(username, code, kind)} onCancel={cancel} />
              {error ? <p className="error">{error}</p> : null}
            </>
          ) : (
            <PinPad embedded title="Your passcode" subtitle="Type your 4-digit passcode." error={error} onCancel={cancel} onComplete={(pin) => onKidSubmit(username, pin, kind)} />
          )}
        </div>
      </div>
    );
  } else {
    body = (
      <div className="screen center">
        <div className="panel title-panel landing-parent" data-testid="first-grownups">
          {error ? <p className="error">{error}</p> : null}
          <p className="muted landing-sub">For parents and teachers</p>
          <button type="button" className="btn btn-big" onClick={onParentSignIn}>Sign in with Google</button>
          <p className="muted">New here? Sign in with Google to create your family.</p>
          {back}
        </div>
      </div>
    );
  }
  // A pad has no logo above it: the picture pad is 4 rows of 120 px and has to fit an iPad held wide with the address bar showing.
  if (view.name === 'pad') return body;
  return <TitleScreen>{body}</TitleScreen>;
}
