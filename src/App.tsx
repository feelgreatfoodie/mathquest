import { onAuthStateChanged } from 'firebase/auth';
import { useCallback, useEffect, useState } from 'react';
import { FirestoreRepo } from './data/firestoreRepo';
import { LocalRepo } from './data/localRepo';
import { hashPin, type Repo } from './data/repo';
import type { Family, Kid } from './engine/models';
import type { RunSummary } from './engine/session';
import { dataMode, getFirebase, signInParent, signOutParent } from './firebase';
import { PinPad } from './ui/PinPad';
import { KidHome, Picker, SignIn, Summary } from './ui/screens/KidScreens';
import { ParentArea, Setup } from './ui/screens/Parent';
import { Run } from './ui/screens/Run';

type Screen =
  | { name: 'boot' }
  | { name: 'signin' }
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
        setScreen({ name: 'signin' });
        return;
      }
      const r = new FirestoreRepo(db, user.uid);
      setRepo(r);
      setSalt(user.uid);
      void load(r);
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
  if (screen.name === 'signin')
    return (
      <SignIn
        error={error}
        onSignIn={() => {
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
      return <Picker kids={kids} onPick={(k) => setScreen({ name: 'home', kidId: k.id })} onParent={() => setScreen({ name: 'pin' })} />;
    case 'home':
      return kid ? (
        <KidHome
          kid={kid}
          onSave={(k) => void saveKid(k)}
          onStart={() => setScreen({ name: 'run', kidId: kid.id, key: Date.now() })}
          onBack={() => setScreen({ name: 'picker' })}
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
