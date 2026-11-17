import { onAuthStateChanged } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import { FirestoreRepo } from './data/firestoreRepo';
import { LocalRepo } from './data/localRepo';
import { hashPin, type Repo } from './data/repo';
import type { Family, Kid } from './engine/models';
import type { RunSummary } from './engine/session';
import { dataMode, getFirebase, kidClaims, registerParent, signInKid, signInParent, signOutParent } from './firebase';
import { PinPad } from './ui/PinPad';
import { KidHome, Landing, Picker, Summary } from './ui/screens/KidScreens';
import { ParentArea, Setup } from './ui/screens/Parent';
import { Run } from './ui/screens/Run';

type Screen =
  | { name: 'boot' }
  | { name: 'kidsignin' }
  | { name: 'signin' }
  | { name: 'kidpin'; kidId: string }
  | { name: 'setup' }
  | { name: 'picker' }
  | { name: 'home'; kidId: string }
  | { name: 'run'; kidId: string; key: number }
  | { name: 'summary'; kidId: string; summary: RunSummary }
  | { name: 'pin' }
  | { name: 'parent' };

export function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'boot' });
  const [repo, setRepo] = useState<Repo | null>(null);
  const [salt, setSalt] = useState('local');
  const [family, setFamily] = useState<Family | null>(null);
  const [kids, setKids] = useState<Kid[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  /** A kid session (custom token) can reach only that kid's data and never the parent area. */
  const [kidSession, setKidSession] = useState(false);

  const load = useCallback(async (r: Repo) => {
    try {
      const [f, ks] = await Promise.all([r.getFamily(), r.listKids()]);
      setFamily(f);
      setKids(ks);
      if (!f?.pinHash) setScreen({ name: 'setup' });
      else if (!ks.length) setScreen({ name: 'pin' });
      else setScreen({ name: 'picker' });
    } catch (e) {
      setError((e as Error).message);
      setScreen({ name: 'signin' });
    }
  }, []);

  useEffect(() => {
    if (dataMode === 'local') {
      const r = new LocalRepo();
      setRepo(r);
      void load(r);
      return;
    }
    const { auth, db } = getFirebase();
    return onAuthStateChanged(auth, (user) => {
      if (!user) {
        setRepo(null);
        setKids([]);
        setFamily(null);
        setKidSession(false);
        // No session: the kid PIN pad. The Parent link moves to the Google screen and stays there.
        setScreen((s) => (s.name === 'signin' ? s : { name: 'kidsignin' }));
        return;
      }
      void (async () => {
        const claims = await kidClaims();
        if (claims) {
          const r = new FirestoreRepo(db, claims.familyUid);
          try {
            const k = await r.getKid(claims.kidId);
            if (!k) throw new Error('That player was removed.');
            setRepo(r);
            setKids([k]);
            setKidSession(true);
            setScreen({ name: 'home', kidId: k.id });
          } catch (e) {
            setError((e as Error).message);
            void signOutParent();
          }
          return;
        }
        setKidSession(false);
        // Join the parent registry first. At the cap the message is shown and the account signs out.
        try {
          await registerParent();
        } catch (e) {
          setError((e as Error).message || 'Could not sign in. Try again.');
          setScreen({ name: 'signin' });
          void signOutParent();
          return;
        }
        const r = new FirestoreRepo(db, user.uid);
        setRepo(r);
        setSalt(user.uid);
        void load(r);
      })();
    });
  }, [load]);

  const kid = 'kidId' in screen ? kids.find((k) => k.id === screen.kidId) : undefined;

  const saveKid = useCallback(
    async (k: Kid) => {
      setKids((ks) => ks.map((x) => (x.id === k.id ? k : x)));
      await repo?.saveKid(k);
    },
    [repo],
  );

  if (screen.name === 'boot') return <div className="screen center"><p className="pixel blink">Loading…</p></div>;
  if (screen.name === 'kidsignin' || screen.name === 'signin')
    return (
      <Landing
        key={screen.name}
        {...(screen.name === 'signin' ? { initialTab: 'parent' as const } : {})}
        error={screen.name === 'signin' ? error : (pinError ?? error)}
        onTabChange={() => {
          setPinError(null);
          setError(null);
        }}
        onKidSubmit={(name, pin) => {
          if (!name.trim()) {
            setPinError('Type your first name first.');
            return;
          }
          setPinError(null);
          setError(null);
          signInKid(name, pin).catch((e: { message?: string }) => setPinError(e.message ?? "That name and PIN didn't match"));
        }}
        onParentSignIn={() => {
          setError(null);
          signInParent().catch((e: Error) => setError(e.message));
        }}
      />
    );
  if (!repo) return null;

  switch (screen.name) {
    case 'setup':
      return (
        <Setup
          repo={repo}
          salt={salt}
          onDone={(f, ks) => {
            setFamily(f);
            setKids(ks);
            setScreen({ name: 'picker' });
          }}
        />
      );
    case 'picker':
      return (
        <Picker
          kids={kids}
          // A kid with a PIN must type it, so a sibling cannot play as them on a parent's device.
          onPick={(k) => {
            setPinError(null);
            setScreen(k.hasPin && dataMode === 'firestore' ? { name: 'kidpin', kidId: k.id } : { name: 'home', kidId: k.id });
          }}
          onParent={() => setScreen({ name: 'pin' })}
        />
      );
    case 'kidpin':
      return kid ? (
        <PinPad
          title={`${kid.name}'s PIN`}
          error={pinError}
          onCancel={() => { setPinError(null); setScreen({ name: 'picker' }); }}
          onComplete={(p) => {
            signInKid(kid.name, p).catch((e: { message?: string }) => setPinError(e.message ?? "That name and PIN didn't match"));
          }}
        />
      ) : null;
    case 'home':
      return kid ? (
        <KidHome
          kid={kid}
          onSave={(k) => void saveKid(k)}
          onStart={() => setScreen({ name: 'run', kidId: kid.id, key: Date.now() })}
          onBack={() => (kidSession ? void signOutParent() : setScreen({ name: 'picker' }))}
        />
      ) : null;
    case 'run':
      return kid ? (
        <Run
          key={screen.key}
          repo={repo}
          kid={kid}
          onExit={() => setScreen({ name: 'home', kidId: kid.id })}
          onDone={(summary, updated) => {
            setKids((ks) => ks.map((x) => (x.id === updated.id ? updated : x)));
            setScreen({ name: 'summary', kidId: kid.id, summary });
          }}
        />
      ) : null;
    case 'summary':
      return kid ? (
        <Summary
          kid={kid}
          summary={screen.summary}
          onAgain={() => setScreen({ name: 'run', kidId: kid.id, key: Date.now() })}
          onHome={() => setScreen({ name: 'home', kidId: kid.id })}
        />
      ) : null;
    case 'pin':
      return (
        <PinPad
          title="Parent PIN"
          error={pinError}
          onCancel={kids.length ? () => { setPinError(null); setScreen({ name: 'picker' }); } : undefined}
          onComplete={async (p) => {
            if ((await hashPin(salt, p)) === family?.pinHash) {
              setPinError(null);
              setScreen({ name: 'parent' });
            } else setPinError('Wrong PIN. Try again.');
          }}
        />
      );
    case 'parent':
      return (
        <ParentArea
          repo={repo}
          salt={salt}
          kids={kids}
          onKids={setKids}
          onFamily={setFamily}
          onExit={() => setScreen(kids.length ? { name: 'picker' } : { name: 'parent' })}
          onSignOut={dataMode === 'firestore' ? () => void signOutParent() : undefined}
        />
      );
  }
}
